// 剧情分支助手 — AGPL-3.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chatRef, readableText, prefixStamp, readMemory, compareMemory, searchFloors, refKey } from '../src/model.js';
import { createBranchService } from '../src/service.js';
import { createFixture } from './fixture.js';

const results = [];
async function test(name, run) { await run(); results.push(name); console.log(`通过 ${name}`); }
function setup(overrides = {}) {
    const fixture = createFixture();
    const dependencies = { getContext: fixture.getContext, getBook: fixture.getBook, store: fixture.store,
        loadNative: async () => fixture.native, locks: null, ...overrides };
    return { fixture, service: createBranchService(dependencies), dependencies };
}

await test('聊天标识按角色头像或群组隔离，同名文件互不混淆', () => {
    const { fixture } = setup();
    const ref = chatRef(fixture.context);
    assert.equal(ref.avatar, 'synthetic-star.png');
    assert.notEqual(refKey(ref), refKey({ ...ref, avatar: 'other.png' }));
    assert.equal(chatRef({ groupId: 'g', getCurrentChatId: () => 'chat1' }).kind, 'group');
    assert.throws(() => chatRef({}));
});
await test('搜索支持剧情、楼层、角色与分页，标签只作为文字处理', () => {
    const { fixture } = setup();
    assert.equal(searchFloors(fixture.context.chat, '银钥匙').rows[0].floor, 2);
    assert.equal(searchFloors(fixture.context.chat, '1').rows[0].floor, 0);
    assert.equal(searchFloors(fixture.context.chat, '旅人').total, 2);
    assert.equal(searchFloors(fixture.context.chat, '', { limit: 2 }).rows.length, 2);
    assert.equal(searchFloors(fixture.context.chat, '', { offset: 2, limit: 2 }).rows[0].floor, 1);
    assert.equal(readableText('<script>危险脚本</script><div>合成正文</div>'), '合成正文');
    fixture.context.chat[0].mes = '修改后的合成剧情';
    assert.equal(searchFloors(fixture.context.chat, '修改后').rows[0].floor, 0);
});
await test('记忆精确读取所选楼层之后，历史截止为下一楼，未来状态未进入', () => {
    const { fixture, service } = setup();
    const plan = service.plan(1);
    assert.equal(plan.count, 2);
    assert.equal(plan.memory.snapshot.vars.金币, 100);
    assert.equal(service.plan(3).memory.snapshot.vars.金币, 80);
    assert.equal(plan.memory.history.before, 2);
});
await test('旧版接口、读取失败、串聊天及缺少覆盖信息均有明确状态', () => {
    const { fixture } = setup();
    const ref = chatRef(fixture.context);
    assert.equal(readMemory(undefined, ref, 1).available, false);
    assert.equal(readMemory({ ...fixture.book, apiVersion: 2 }, ref, 1).available, false);
    assert.equal(readMemory({ ...fixture.book, getSnapshot() { throw new Error('合成异常'); } }, ref, 1).available, false);
    assert.equal(readMemory(fixture.book, { ...ref, fileName: '其他聊天' }, 1).available, false);
    const noCoverage = { ...fixture.book, getSnapshot(options) { const value = fixture.book.getSnapshot(options); delete value.coverage; return value; } };
    assert.equal(readMemory(noCoverage, ref, 1).complete, false);
});
await test('原生创建与记忆核对经过正式服务入口，保留源码聊天及叶子', async () => {
    const { fixture, service } = setup();
    const before = structuredClone(fixture.context.chat);
    const record = await service.create({ selected: service.plan(1), label: '赴约线', note: '明天去码头' });
    assert.equal(record.status, 'created');
    assert.equal(record.check.status, 'matched');
    assert.equal(record.label, '赴约线');
    assert.equal(fixture.context.chat.length, 2);
    assert.deepEqual(fixture.chats.get('星港主线'), before);
    assert.deepEqual(fixture.context.chat, before.slice(0, 2));
    assert.equal((await fixture.store.list()).length, 1);
});
await test('记忆差异、缺口与无接口可区分，分支结果仍可定位', async () => {
    const first = setup();
    first.fixture.setDifferentMemory(true);
    const changed = await first.service.create({ selected: first.service.plan(1), label: '差异分线' });
    assert.equal(changed.check.status, 'different');
    assert.ok(changed.target.fileName);
    const second = setup();
    second.fixture.setMissing([0]);
    const incomplete = await second.service.create({ selected: second.service.plan(1), label: '缺口分线' });
    assert.equal(incomplete.check.status, 'incomplete');
    const third = setup({ getBook: () => undefined });
    const unavailable = await third.service.create({ selected: third.service.plan(1), label: '普通分线' });
    assert.equal(unavailable.check.status, 'unavailable');
});
await test('预览后正文变化或聊天切换会拒绝创建', async () => {
    const { fixture, service } = setup();
    const selected = service.plan(1);
    fixture.context.chat[0].mes = '合成改稿';
    await assert.rejects(service.create({ selected, label: '过时分线' }), /发生变化/);
    assert.equal(fixture.nativeCalls, 0);
    assert.throws(() => service.plan(-1));
    assert.throws(() => service.plan(50));
});
await test('高亮或摘要完成造成的叶子变化也会使旧预览失效', async () => {
    const { fixture, service } = setup();
    const selected = service.plan(1);
    fixture.context.chat[0].extra.bbs_leaf.delta.time = '2126-04-02 12:00';
    await assert.rejects(service.create({ selected, label: '旧记忆' }), /发生变化/);
    assert.equal(fixture.nativeCalls, 0);
});
await test('原生分支追加导航字段及隐藏变化不造成正文误报', () => {
    const { fixture } = setup();
    const before = prefixStamp(fixture.context.chat, 2);
    fixture.context.chat[1].extra.branches = ['合成分支'];
    fixture.context.chat[0].is_system = true;
    assert.equal(prefixStamp(fixture.context.chat, 2), before);
});
await test('正在生成与空名称均在原生调用前阻止', async () => {
    const { fixture, service } = setup({ isBusy: () => true });
    await assert.rejects(service.create({ selected: service.plan(1), label: '分线' }), /生成/);
    assert.equal(fixture.nativeCalls, 0);
    const other = setup();
    await assert.rejects(other.service.create({ selected: other.service.plan(1), label: ' ' }), /名称/);
    assert.equal(other.fixture.nativeCalls, 0);
});
await test('原生模块加载期间切换聊天会在创建前重新校验', async () => {
    let finish;
    const { fixture, service } = setup({ loadNative: () => new Promise(resolve => { finish = resolve; }) });
    const pending = service.create({ selected: service.plan(1), label: '分线' });
    fixture.chats.set('别的合成聊天', structuredClone(fixture.context.chat));
    await fixture.context.openCharacterChat('别的合成聊天');
    finish(fixture.native);
    await assert.rejects(pending, /发生变化/);
    assert.equal(fixture.nativeCalls, 0);
});
await test('连续点击只创建一次，跨页面锁被占用时也不创建', async () => {
    let finish;
    const { fixture, service } = setup({ loadNative: () => new Promise(resolve => { finish = resolve; }) });
    const selected = service.plan(1);
    const pending = service.create({ selected, label: '唯一分线' });
    await assert.rejects(service.create({ selected, label: '重复分线' }), /正在创建/);
    finish(fixture.native);
    await pending;
    assert.equal(fixture.nativeCalls, 1);
    const locked = setup({ locks: { request: async (_name, _options, run) => run(null) } });
    await assert.rejects(locked.service.create({ selected: locked.service.plan(1), label: '被锁分线' }), /另一个页面/);
    assert.equal(locked.fixture.nativeCalls, 0);
});
await test('记录保存失败时不调用原生创建，创建后存储失败会明确返回文件名', async () => {
    const first = setup({ store: { put: async () => { throw new Error('合成存储失败'); } } });
    await assert.rejects(first.service.create({ selected: first.service.plan(1), label: '分线' }), /存储失败/);
    assert.equal(first.fixture.nativeCalls, 0);
    let writes = 0;
    const second = setup({ store: { put: async () => { if (++writes > 1) throw new Error('合成写入失败'); } } });
    await assert.rejects(second.service.create({ selected: second.service.plan(1), label: '分线' }), /Branch #1.*已创建/);
    assert.equal(second.fixture.nativeCalls, 1);
});
await test('宿主失败保留待核对记录，自动重试次数为零', async () => {
    const { fixture, service } = setup({ loadNative: async () => ({ branchChat: async () => undefined }) });
    await assert.rejects(service.create({ selected: service.plan(1), label: '未完成分线' }), /检查创建结果/);
    const records = await fixture.store.list();
    assert.equal(records[0].status, 'attention');
    assert.equal(records[0].target, null);
});
await test('切换分支、返回来源及同名不同角色的限制', async () => {
    const { fixture, service } = setup();
    const record = await service.create({ selected: service.plan(1), label: '分线' });
    await service.open(record.source);
    assert.equal(fixture.context.getCurrentChatId(), '星港主线');
    await service.open(record.target);
    assert.equal(fixture.context.getCurrentChatId(), record.target.fileName);
    await assert.rejects(service.open({ ...record.target, avatar: 'another.png' }), /所属的角色/);
});
await test('状态对象键顺序、接口修订号不影响语义核对', () => {
    const { fixture, service } = setup();
    const first = service.plan(1).memory;
    const copy = structuredClone(first);
    copy.snapshot.revision = 999;
    assert.equal(compareMemory(first, copy).status, 'matched');
});
await test('同一群组创建与返回来源使用群聊接口', async () => {
    const { fixture, service } = setup();
    fixture.context.groupId = 'synthetic-group';
    let openedGroup;
    fixture.context.openGroupChat = async (groupId, fileName) => {
        openedGroup = groupId;
        await fixture.context.openCharacterChat(fileName);
    };
    const record = await service.create({ selected: service.plan(1), label: '群聊分线' });
    assert.equal(record.target.kind, 'group');
    await service.open(record.source);
    assert.equal(openedGroup, 'synthetic-group');
    assert.equal(fixture.context.getCurrentChatId(), '星港主线');
});
await test('安装清单与原生调用边界检查', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    await fs.access(new URL('../' + manifest.js, import.meta.url));
    for (const file of ['index.js', 'src/model.js', 'src/store.js', 'src/service.js', 'src/view.js']) {
        const source = await fs.readFile(new URL('../' + file, import.meta.url), 'utf8');
        assert.ok(!/\b(?:saveChat|renameChat|deleteMessage|saveMetadata|updateChatMetadata|addOneMessage)\s*\(/.test(source), file);
        assert.ok(!/\/api\/chats\//.test(source), file);
        assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(source), file);
    }
});
console.log(`全部通过，共 ${results.length} 项。使用合成数据。`);
