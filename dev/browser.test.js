// 剧情分支助手 — AGPL-3.0
import { createPanel } from '../src/view.js';
import { createBranchService } from '../src/service.js';
import { createStore } from '../src/store.js';
import { createFixture } from './fixture.js';

function assert(value, message) { if (!value) throw new Error(message); }
async function until(check) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('浏览器验证等待超时');
}

export async function testBrowser() {
    const results = [];
    async function test(name, run) { await run(); results.push({ name, passed: true }); }
    const fixture = createFixture();
    const dbName = 'st-story-branches-test-' + crypto.randomUUID();
    const factory = { open: (_name, version) => indexedDB.open(dbName, version) };
    const store = createStore(factory), anotherStore = createStore(factory);
    const service = createBranchService({ getContext: fixture.getContext, getBook: fixture.getBook,
        store, loadNative: async () => fixture.native, locks: null });
    const panel = createPanel({ service, store, getContext: fixture.getContext });
    const root = panel.root;
    try {
        await test('IndexedDB 两个连接并发保存独立记录，重新打开后仍存在', async () => {
            await Promise.all([store.put({ id: 'one' }), anotherStore.put({ id: 'two' })]);
            assert((await store.list()).length === 2, '并发保存丢记录');
            await anotherStore.close();
            assert((await anotherStore.list()).length === 2, '重新打开后丢记录');
        });
        // 上面的存储探针使用同一测试库，界面只接收符合分支结构的记录。
        const uiStore = { put: store.put, list: async () => (await store.list()).filter(record => record.source) };
        panel.host.remove();
        const testedPanel = createPanel({ service, store: uiStore, getContext: fixture.getContext });
        const ui = testedPanel.root;
        try {
            await test('弹窗从指定楼层打开，显示历史状态及无未来剧情的摘要', async () => {
                testedPanel.show(1);
                await until(() => ui.querySelector('link').sheet);
                await new Promise(resolve => requestAnimationFrame(resolve));
                await Promise.all(ui.querySelector('dialog').getAnimations().map(animation => animation.finished));
                assert(ui.querySelector('dialog').open, '弹窗没有打开');
                assert(ui.querySelector('.selected-context').textContent.includes('从第 2 楼之后分支'), '楼层显示错误');
                assert(ui.querySelector('.facts').textContent.includes('星港'), '历史状态不正确');
                assert(!ui.querySelector('.memory').textContent.includes('旧灯塔'), '带入了未来剧情');
            });
            await test('手机和桌面布局不超出视口，关闭与创建按钮完整可见', () => {
                const dialog = ui.querySelector('dialog').getBoundingClientRect();
                const create = ui.querySelector('.primary').getBoundingClientRect();
                const close = ui.querySelector('.close').getBoundingClientRect();
                assert(dialog.left >= -1 && dialog.right <= innerWidth + 1 && dialog.top >= -1 && dialog.bottom <= innerHeight + 1, '弹窗超出视口 ' + JSON.stringify(dialog.toJSON()));
                assert(create.height >= 44 && create.bottom <= innerHeight + 1, '创建按钮被裁切');
                assert(close.width >= 44 && close.right <= innerWidth, '关闭按钮被裁切');
                assert(ui.querySelector('.content').scrollWidth <= ui.querySelector('.content').clientWidth + 1, '内容出现横向溢出');
            });
            await test('搜索历史文字并切换分叉点', async () => {
                const search = ui.querySelector('input[type="search"]');
                search.value = '船票';
                search.dispatchEvent(new Event('input'));
                await until(() => ui.querySelector('.list-count').textContent.includes('2 条'));
                ui.querySelector('[data-floor="0"]').click();
                assert(ui.querySelector('.selected-context h2').textContent.includes('第 1 楼'), '搜索结果无法选择');
            });
            await test('路线草稿跨页签保留，恶意标签按普通文字显示', async () => {
                const label = ui.querySelector('.field input');
                label.value = '<img src=x onerror=alert(1)> 赴约线';
                label.dispatchEvent(new Event('input'));
                const note = ui.querySelector('textarea');
                note.value = '先去码头，保留船票。';
                note.dispatchEvent(new Event('input'));
                ui.querySelectorAll('[role="tab"]')[1].click();
                await until(() => ui.querySelector('.branch-list .empty')?.textContent.includes('还没有'));
                ui.querySelectorAll('[role="tab"]')[0].click();
                assert(ui.querySelector('.field input').value.includes('赴约线'), '分支名称草稿丢失');
                assert(ui.querySelector('textarea').value.includes('保留船票'), '路线备注草稿丢失');
                assert(!ui.querySelector('img'), '执行了用户标签');
            });
            await test('点击创建进入原生分支，显示名称、备注和核对结果', async () => {
                ui.querySelector('.primary').click();
                await until(() => ui.querySelector('.branch-card'));
                assert(fixture.nativeCalls === 1, '原生创建次数错误');
                assert(fixture.context.chat.length === 1, '新分支没有截止到所选楼层');
                assert(ui.querySelector('.branch-card').textContent.includes('赴约线'), '分支名称未显示');
                assert(ui.querySelector('.branch-note').textContent.includes('保留船票'), '路线备注丢失');
                assert(ui.querySelector('.notice').textContent.includes('已核对一致'), '记忆未核对');
                assert(!ui.querySelector('img'), '分支名称被解析为标签');
            });
            await test('返回来源与重新进入分支，记录跨页面重开可用', async () => {
                await until(() => !testedPanel.busy);
                ui.querySelector('.text-button').click();
                await until(() => !testedPanel.busy && fixture.context.getCurrentChatId() === '星港主线');
                await until(() => ui.querySelector('.secondary')?.textContent === '进入分支');
                ui.querySelector('.secondary').click();
                await until(() => !testedPanel.busy && fixture.context.getCurrentChatId() !== '星港主线');
                testedPanel.hide();
                assert(!ui.querySelector('dialog').open, '关闭失效');
                testedPanel.show();
                assert(ui.querySelector('dialog').open, '重新打开失效');
            });
            await test('外部切换聊天后旧选择失效，创建按钮禁用', () => {
                testedPanel.chatChanged();
                assert(ui.querySelector('.primary').disabled, '旧选择仍可创建');
                assert(ui.querySelector('.notice').textContent.includes('当前聊天已变化'), '缺少聊天变化反馈');
            });
        } finally { testedPanel.hide(); testedPanel.host.remove(); }
    } finally {
        panel.host.remove();
        await store.close();
        await anotherStore.close();
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('测试库仍被占用'));
        });
    }
    return results;
}
