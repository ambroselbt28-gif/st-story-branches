// 剧情分支助手 — AGPL-3.0
import { createStore } from './src/store.js';
import { createBranchService } from './src/service.js';
import { createPanel } from './src/view.js';

const getContext = () => globalThis.SillyTavern?.getContext?.();
let panel;
function hostBusy() {
    if (document.body.dataset.generating === 'true') return true;
    const stop = document.getElementById('mes_stop');
    if (!stop) return false;
    const style = getComputedStyle(stop);
    return style.display !== 'none' && style.visibility !== 'hidden';
}
function open(floor) {
    if (!panel) {
        const store = createStore();
        const service = createBranchService({ getContext, getBook: () => globalThis.STBaiBaiBook,
            loadNative: () => import('/scripts/bookmarks.js'), store, isBusy: hostBusy });
        panel = createPanel({ service, store, getContext });
    }
    panel.show(floor);
}

/** 消息入口跟随虚拟化 DOM 重建，读取点击时的 mesid。 */
function mountMessageButtons(chat) {
    const attach = element => {
        for (const native of element.querySelectorAll('.mes_create_branch')) {
            if (native.parentElement.querySelector('.sb-message-button')) continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sb-message-button';
            button.textContent = '剧情分支';
            button.title = '选择此楼并预览柏宝书记忆';
            button.style.cssText = 'font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:4px 8px;min-height:44px;cursor:pointer;';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const floor = Number(button.closest('.mes[mesid]')?.getAttribute('mesid'));
                if (Number.isInteger(floor)) open(floor);
            });
            native.after(button);
        }
    };
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; attach(chat); });
    });
    observer.observe(chat, { childList: true, subtree: true });
    attach(chat);
}

let mountedChat, commandRegistered = false;
function mount() {
    const menu = document.getElementById('extensionsMenu');
    if (menu && !document.getElementById('story-branches-menu-item')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'extension_container interactable';
        const item = document.createElement('a');
        item.id = 'story-branches-menu-item';
        item.className = 'list-group-item';
        item.href = '#';
        item.textContent = '剧情分支助手';
        item.addEventListener('click', event => { event.preventDefault(); open(); menu.style.display = 'none'; });
        wrapper.append(item);
        menu.append(wrapper);
    }
    const chat = document.getElementById('chat');
    if (chat && chat !== mountedChat) { mountedChat = chat; mountMessageButtons(chat); }
    const context = getContext();
    if (!commandRegistered && typeof context?.registerSlashCommand === 'function') {
        context.registerSlashCommand('plot-branches', (_args, value) => {
            const number = String(value ?? '').trim();
            open(number ? Number(number) - 1 : undefined);
            return '';
        }, [], '打开剧情分支助手，可追加从 1 开始的楼层号。');
        commandRegistered = true;
        const types = context.eventTypes ?? context.event_types;
        if (types?.CHAT_CHANGED) context.eventSource?.on(types.CHAT_CHANGED, () => panel?.chatChanged());
    }
}

function initialize() {
    mount();
    const observer = new MutationObserver(() => {
        if (!document.getElementById('story-branches-menu-item') || document.getElementById('chat') !== mountedChat || !commandRegistered) mount();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();

globalThis.STStoryBranches = Object.freeze({ apiVersion: 1, open });
globalThis.stStoryBranchesSelfTest = async () => {
    const { testBrowser } = await import('./dev/browser.test.js');
    const results = await testBrowser();
    console.table(results);
    return results;
};
