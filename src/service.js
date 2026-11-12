// 剧情分支助手 — AGPL-3.0
import { chatRef, sameChat, subjectKey, prefixStamp, readMemory, compareMemory, cleanLabel } from './model.js';

export function createBranchService({ getContext, getBook, loadNative, store, isBusy = () => false, locks = globalThis.navigator?.locks }) {
    let running = false;
    function requireIdle() {
        if (isBusy()) throw new Error('请等当前生成或保存结束后再操作。');
    }
    function plan(floor) {
        const context = getContext(), source = chatRef(context);
        if (!Number.isInteger(floor) || floor < 0 || floor >= context.chat.length) throw new Error('所选楼层已不存在，请重新选择。');
        return { source, floor, count: floor + 1, stamp: prefixStamp(context.chat, floor + 1),
            memory: readMemory(getBook(), source, floor) };
    }
    function unchanged(selected) {
        const context = getContext();
        if (!sameChat(chatRef(context), selected.source) || prefixStamp(context.chat, selected.count) !== selected.stamp) {
            throw new Error('聊天或所选剧情已发生变化，请重新预览后创建。');
        }
    }
    async function perform({ selected, label, note = '' }) {
        requireIdle();
        unchanged(selected);
        const native = await loadNative();
        if (typeof native.branchChat !== 'function') throw new Error('当前宿主没有提供原生分支接口。');
        requireIdle();
        unchanged(selected);
        // 创建前再读一次，避免预览后完成的摘要导致核对基线过时。
        const expected = readMemory(getBook(), selected.source, selected.floor);
        const record = { id: crypto.randomUUID(), source: selected.source, target: null, floor: selected.floor,
            label: cleanLabel(label), note: String(note).trim().slice(0, 500), createdAt: Date.now(), status: 'creating', check: null };
        await store.put(record);
        try {
            requireIdle();
            unchanged(selected);
            const fileName = await native.branchChat(selected.floor);
            if (!fileName) throw new Error('宿主没有返回新分支名称。请先在聊天列表检查创建结果，再决定是否重试。');
            record.target = { ...selected.source, fileName };
            const context = getContext();
            if (!sameChat(chatRef(context), record.target) || context.chat.length !== selected.count
                || prefixStamp(context.chat, selected.count) !== selected.stamp) {
                record.check = { status: 'different', text: '分支已创建，当前页面或正文与所选分叉点不一致，请检查。' };
            } else {
                record.check = compareMemory(expected, readMemory(getBook(), record.target, selected.floor));
            }
            record.status = 'created';
            await store.put(record);
            return record;
        } catch (error) {
            record.status = record.target ? 'created' : 'attention';
            record.error = error.message;
            try { await store.put(record); } catch { /* 原生日志仍保留，界面明确显示保存失败。 */ }
            if (record.target) throw new Error(`分支「${record.target.fileName}」已创建，但助手记录未保存。${error.message}`);
            throw error;
        }
    }
    async function create(options) {
        if (running) throw new Error('正在创建分支，请稍候。');
        running = true;
        try {
            if (!locks) return await perform(options);
            return await locks.request('st-story-branches-create', { ifAvailable: true }, lock => {
                if (!lock) throw new Error('另一个页面正在创建分支，请稍后重试。');
                return perform(options);
            });
        } finally { running = false; }
    }
    async function open(ref) {
        if (running) throw new Error('请等分支创建结束。');
        requireIdle();
        const context = getContext(), current = chatRef(context);
        if (subjectKey(current) !== subjectKey(ref)) throw new Error('请先在酒馆中切到这条分支所属的角色或群组。');
        if (sameChat(current, ref)) return;
        if (ref.kind === 'group') {
            if (typeof context.openGroupChat !== 'function') throw new Error('宿主暂未提供群聊切换接口。');
            await context.openGroupChat(ref.groupId, ref.fileName);
        } else {
            if (typeof context.openCharacterChat !== 'function') throw new Error('宿主暂未提供聊天切换接口。');
            await context.openCharacterChat(ref.fileName);
        }
        if (!sameChat(chatRef(getContext()), ref)) throw new Error('宿主尚未切到目标分支，请在聊天列表确认。');
    }
    return { plan, create, open, get running() { return running; } };
}
