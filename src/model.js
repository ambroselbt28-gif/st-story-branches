// 剧情分支助手 — AGPL-3.0
export function chatRef(context) {
    const fileName = context?.getCurrentChatId?.();
    if (!fileName) throw new Error('请先打开一个聊天。');
    if (context.groupId) return { kind: 'group', groupId: String(context.groupId), fileName: String(fileName) };
    const avatar = context.characters?.[Number(context.characterId)]?.avatar;
    if (!avatar) throw new Error('当前角色信息尚未就绪。');
    return { kind: 'character', avatar, fileName: String(fileName) };
}

export function subjectKey(ref) { return JSON.stringify([ref.kind, ref.avatar ?? ref.groupId]); }
export function refKey(ref) { return JSON.stringify([subjectKey(ref), ref.fileName]); }
export function sameChat(left, right) { return refKey(left) === refKey(right); }

/** 只处理显示副本，正文中的标签和脚本不会被挂到页面。 */
export function readableText(text) {
    return String(text ?? '').replace(/<(script|style|think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/```[^\n]*\n/g, '').replace(/```/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}

/** 不包含原生分支功能追加的导航字段，也不包含动态隐藏标记。 */
export function prefixStamp(chat, end) {
    let hash = 2166136261;
    for (let i = 0; i < end; i++) {
        const message = chat[i];
        const value = JSON.stringify([message?.name, message?.mes, message?.is_user, message?.swipe_id,
            message?.extra?.bbs_leaf, message?.extra?.bbs_omit]);
        for (let j = 0; j < value.length; j++) hash = Math.imul(hash ^ value.charCodeAt(j), 16777619);
    }
    return `${end}:${hash >>> 0}`;
}

export function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
        .filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
}

const STATE_FIELDS = ['state', 'protagonist', 'vars', 'items', 'plans', 'scenes', 'npcs', 'itemLog', 'lifeDetails'];
export function memoryValue(snapshot) { return Object.fromEntries(STATE_FIELDS.map(key => [key, snapshot[key]])); }

export function readMemory(book, ref, floor) {
    if (!book || book.apiVersion !== 1 || typeof book.getSnapshot !== 'function' || typeof book.getHistory !== 'function') {
        return { available: false, message: '柏宝书读取接口未就绪。可以创建原生分支，记忆核对暂不可用。' };
    }
    try {
        const snapshot = book.getSnapshot({ floor, at: 'after' });
        const history = book.getHistory({ before: floor + 1 });
        if (snapshot.chat.id !== ref.fileName || history.chat.id !== ref.fileName
            || snapshot.point.upToExclusive !== floor + 1 || history.before !== floor + 1) {
            throw new Error('柏宝书返回的聊天或截止楼层与当前选择不一致');
        }
        const missing = [...new Set([...(snapshot.coverage?.missingAiFloors ?? []), ...(history.coverage?.missingAiFloors ?? [])])];
        const complete = snapshot.coverage?.complete === true && history.coverage?.complete === true;
        return { available: true, snapshot, history, complete, missing,
            signature: canonical({ state: memoryValue(snapshot), history: history.text }) };
    } catch (error) {
        return { available: false, message: `记忆读取失败，暂无法核对。${error.message}` };
    }
}

export function compareMemory(before, after) {
    if (!before.available || !after.available) return { status: 'unavailable', text: '分支已创建，柏宝书记忆尚未核对。' };
    if (before.signature !== after.signature) return { status: 'different', text: '分支已创建，但柏宝书状态或历史摘要与分叉点不同，请在继续剧情前检查。' };
    if (!before.complete || !after.complete) return { status: 'incomplete', text: '已有记忆与分叉点一致，部分楼层尚未摘要。' };
    return { status: 'matched', text: '柏宝书状态与历史摘要已核对一致。' };
}

export function cleanLabel(value) {
    const label = String(value ?? '').trim();
    if (!label || label.length > 80) throw new Error('请输入 1–80 字的分支名称。');
    return label;
}

let searchCache = new WeakMap(), cachedChars = 0;
/** 限额内缓存正文显示副本，输入关键词时避免反复清理每楼标签。 */
function searchText(message) {
    const cached = searchCache.get(message);
    if (cached?.raw === message.mes) return cached;
    const text = readableText(message.mes), lower = text.toLocaleLowerCase();
    const value = { raw: message.mes, text, lower };
    if (text.length < 100000) {
        cachedChars += text.length + lower.length;
        if (cachedChars > 4000000) { searchCache = new WeakMap(); cachedChars = text.length + lower.length; }
        searchCache.set(message, value);
    }
    return value;
}

export function searchFloors(chat, query, { offset = 0, limit = 40 } = {}) {
    const needle = String(query).trim().toLocaleLowerCase();
    const rows = [];
    let total = 0;
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message || (message.is_system && message.extra?.type)) continue;
        if (needle && !searchText(message).lower.includes(needle) && !String(i + 1).includes(needle)
            && !String(message.name ?? '').toLocaleLowerCase().includes(needle)) continue;
        if (total >= offset && rows.length < limit) rows.push({ floor: i, name: String(message.name || (message.is_user ? '你' : '角色')), text: searchText(message).text });
        total++;
    }
    return { rows, total };
}
