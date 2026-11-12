// 剧情分支助手 — AGPL-3.0
/** 所有名字与剧情均为合成数据。可供 Node、浏览器验证与预览共用。 */
export function createFixture() {
    const original = [
        { name: '星灯', is_user: false, mes: '星港的钟响了。向导交给你一张船票，约好明天在码头见。', extra: { bbs_leaf: { id: 'leaf0', delta: { time: '2126-04-01 19:00', location: '星港' } } } },
        { name: '旅人', is_user: true, mes: '我收好船票，决定先去找失联的朋友。', extra: {} },
        { name: '星灯', is_user: false, mes: '朋友在旧灯塔等你，他拿出一把银钥匙。现在要选择赴约还是留下。', extra: { bbs_leaf: { id: 'leaf2', delta: { time: '2126-04-01 20:00', location: '旧灯塔' } } } },
        { name: '旅人', is_user: true, mes: '我留下来，一起打开地下室的门。', extra: {} },
    ];
    const chats = new Map([['星港主线', structuredClone(original)]]);
    const records = new Map();
    let fileName = '星港主线', sequence = 0, nativeCalls = 0, differentMemory = false, missing = [];
    const context = {
        name2: '星灯', characterId: 0, groupId: null, characters: [{ avatar: 'synthetic-star.png' }],
        get chat() { return chats.get(fileName); }, getCurrentChatId: () => fileName,
        async openCharacterChat(name) { if (!chats.has(name)) throw new Error('合成聊天不存在'); fileName = name; },
    };
    const book = {
        apiVersion: 1,
        getSnapshot({ floor = context.chat.length - 1 } = {}) {
            const late = floor >= 2 || (differentMemory && fileName !== '星港主线');
            return { apiVersion: 1, pluginVersion: 'synthetic', chat: { id: fileName }, point: { upToExclusive: floor + 1 },
                coverage: { complete: !missing.length, missingAiFloors: [...missing] },
                state: { time: late ? '2126-04-01 20:00' : '2126-04-01 19:00', location: late ? '旧灯塔' : '星港' },
                protagonist: { condition: '健康' }, vars: { 金币: late ? 80 : 100 },
                items: [{ name: '船票', qty: 1 }], plans: [{ id: 'p0', status: 'open', text: '明天在码头见向导' }], npcs: [{ name: '向导' }], scenes: [], itemLog: [], lifeDetails: [] };
        },
        getHistory({ before = context.chat.length } = {}) {
            return { chat: { id: fileName }, before, coverage: { complete: !missing.length, missingAiFloors: [...missing] },
                text: before >= 3 ? '取得船票，抵达旧灯塔。' : '在星港与向导约定明天见面，取得船票。', nodes: [] };
        },
    };
    const store = {
        async put(record) { records.set(record.id, structuredClone(record)); },
        async list() { return structuredClone([...records.values()]); },
    };
    const native = { async branchChat(floor) {
        nativeCalls++;
        const name = `星港主线 - Branch #${++sequence}`;
        chats.set(name, structuredClone(context.chat.slice(0, floor + 1)));
        fileName = name;
        return name;
    } };
    return { original, context, getContext: () => context, getBook: () => book, store, book, native, records, chats,
        get nativeCalls() { return nativeCalls; },
        setDifferentMemory(value) { differentMemory = value; }, setMissing(value) { missing = value; },
    };
}
