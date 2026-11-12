// 剧情分支助手 — AGPL-3.0
import { chatRef, subjectKey, sameChat, searchFloors, readableText, cleanLabel } from './model.js';

function node(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'text') element.textContent = value;
        else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
        else element.setAttribute(key, value);
    }
    element.append(...children.filter(child => child != null));
    return element;
}
const button = (text, attrs = {}) => node('button', { type: 'button', text, ...attrs });
const field = (label, control) => node('label', { class: 'field' }, node('span', { text: label }), control);

export function createPanel({ service, store, getContext }) {
    const host = node('div', { id: 'st-story-branches-panel' });
    const root = host.attachShadow({ mode: 'open' });
    const style = node('link', { rel: 'stylesheet', href: new URL('../style.css', import.meta.url).href });
    const dialog = node('dialog', { 'aria-labelledby': 'sb-title' });
    root.append(style, dialog);
    document.body.append(host);
    let tab = 'floors', selected = null, query = '', limit = 40, busy = false, source = null, lastFocused = null;
    let searchTimer, request = 0, result = null;
    let draftLabel = '', draftNote = '', autoLabel = true;
    const title = node('h1', { id: 'sb-title', text: '剧情分支' });
    const subtitle = node('p', { class: 'subtitle' });
    const close = button('×', { class: 'close', 'aria-label': '关闭剧情分支助手', onclick: () => hide() });
    const floorsTab = button('选择分叉点', { id: 'sb-tab-floors', role: 'tab', onclick: () => changeTab('floors') });
    const branchesTab = button('我的分支', { id: 'sb-tab-branches', role: 'tab', onclick: () => changeTab('branches') });
    const tabs = node('nav', { class: 'tabs', role: 'tablist', 'aria-label': '分支工具' }, floorsTab, branchesTab);
    const content = node('div', { class: 'content', role: 'tabpanel' });
    tabs.addEventListener('keydown', event => {
        if (busy || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        changeTab(tab === 'floors' ? 'branches' : 'floors');
        (tab === 'floors' ? floorsTab : branchesTab).focus();
    });
    const notice = node('p', { class: 'notice', role: 'status', 'aria-live': 'polite' });
    const submit = button('创建并进入分支', { class: 'primary', onclick: () => create() });
    const footer = node('footer', {}, node('span', { class: 'footer-hint', text: '所选楼层将作为新分支的最后一楼' }), submit);
    dialog.append(node('header', {}, node('div', {}, title, subtitle), close), tabs, notice, content, footer);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('click', event => {
        if (event.target !== dialog || busy) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) hide();
    });
    dialog.addEventListener('close', () => { lastFocused?.focus?.(); });
    let labelInput, noteInput, selectedBox, memoryBox, listBox, listCount, searchInput;

    function message(text, kind = '') {
        notice.textContent = text;
        notice.dataset.kind = kind;
        notice.hidden = !text;
    }
    function setBusy(value) {
        busy = value;
        close.disabled = value;
        floorsTab.disabled = value;
        branchesTab.disabled = value;
        content.inert = value;
        submit.disabled = value || !selected;
        submit.textContent = value ? '正在创建…' : '创建并进入分支';
    }
    function hide() { if (!busy) { clearTimeout(searchTimer); dialog.close(); } }
    function changeTab(value) {
        if (busy) return;
        tab = value;
        render();
    }
    function show(floor) {
        try {
            if (busy) return;
            clearTimeout(searchTimer);
            const context = getContext();
            source = chatRef(context);
            selected = null;
            result = null;
            query = '';
            limit = 40;
            draftLabel = draftNote = '';
            autoLabel = true;
            tab = 'floors';
            subtitle.textContent = `${context.name2 || '当前角色'} · ${source.fileName}`;
            message('');
            render();
            const index = Number.isInteger(floor) ? floor : context.chat.length - 1;
            if (index >= 0 && index < context.chat.length) select(index);
            if (!dialog.open) { lastFocused = document.activeElement; dialog.showModal(); }
        } catch (error) {
            selected = null;
            submit.disabled = true;
            content.replaceChildren();
            footer.hidden = true;
            message(error.message, 'error');
            if (!dialog.open) dialog.showModal();
        }
    }
    function render() {
        request++;
        floorsTab.setAttribute('aria-selected', String(tab === 'floors'));
        branchesTab.setAttribute('aria-selected', String(tab === 'branches'));
        floorsTab.tabIndex = tab === 'floors' ? 0 : -1;
        branchesTab.tabIndex = tab === 'branches' ? 0 : -1;
        content.setAttribute('aria-labelledby', tab === 'floors' ? floorsTab.id : branchesTab.id);
        content.replaceChildren();
        content.className = `content ${tab}`;
        footer.hidden = tab !== 'floors';
        if (tab === 'floors') renderFloors(); else renderBranches(request);
    }
    function renderFloors() {
        searchInput = node('input', { type: 'search', placeholder: '搜索剧情、角色或楼层号', 'aria-label': '搜索当前聊天', value: query });
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { query = searchInput.value; limit = 40; renderList(); }, 160);
        });
        const jump = node('input', { type: 'number', min: '1', placeholder: '楼层', 'aria-label': '跳到楼层', inputmode: 'numeric' });
        const jumpButton = button('定位', { onclick: () => {
            const floor = Number(jump.value) - 1;
            if (!Number.isInteger(floor) || floor < 0 || floor >= getContext().chat.length) { message('请输入有效楼层号，从 1 开始。', 'error'); return; }
            select(floor);
            root.querySelector('.detail')?.scrollIntoView({ block: 'nearest' });
        } });
        jump.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); jumpButton.click(); } });
        listCount = node('p', { class: 'list-count' });
        listBox = node('div', { class: 'floor-list', 'aria-label': '历史消息' });
        const picker = node('section', { class: 'picker', 'aria-label': '选择分叉点' }, searchInput,
            node('div', { class: 'jump' }, jump, jumpButton), listCount, listBox);
        labelInput = node('input', { type: 'text', maxlength: '80', placeholder: '例如，赴约线', autocomplete: 'off' });
        noteInput = node('textarea', { maxlength: '500', rows: '2', placeholder: '记下这条路线的选择或打算，可留空' });
        labelInput.value = draftLabel;
        noteInput.value = draftNote;
        labelInput.addEventListener('input', () => { draftLabel = labelInput.value; autoLabel = false; });
        noteInput.addEventListener('input', () => { draftNote = noteInput.value; });
        memoryBox = node('section', { class: 'memory', 'aria-label': '分叉点记忆预览' });
        selectedBox = node('section', { class: 'selected-context' });
        const detail = node('section', { class: 'detail' }, selectedBox, memoryBox,
            node('div', { class: 'form-fields' }, field('分支名称', labelInput), field('路线备注', noteInput)),
            node('p', { class: 'muted small name-hint', text: '名称与备注显示在助手内，酒馆聊天文件使用原生分支名称。' }));
        content.append(picker, detail);
        renderList();
        if (selected) paintSelection();
        else memoryBox.append(node('p', { class: 'empty', text: '选择一条消息，查看从这里出发的剧情与记忆。' }));
        submit.disabled = !selected;
    }
    function renderList() {
        const found = searchFloors(getContext().chat ?? [], query, { limit });
        listCount.textContent = `找到 ${found.total} 条消息`;
        listBox.replaceChildren();
        for (const row of found.rows) {
            const item = button('', { class: 'floor-row', 'data-floor': String(row.floor), 'aria-pressed': String(selected?.floor === row.floor), onclick: () => select(row.floor) });
            item.append(node('span', { class: 'row-meta', text: `第 ${row.floor + 1} 楼 · ${row.name}` }),
                node('span', { class: 'row-text', text: row.text.slice(0, 180) || '（空消息）' }));
            listBox.append(item);
        }
        if (!found.rows.length) listBox.append(node('p', { class: 'empty', text: '没有找到匹配的消息。' }));
        if (found.rows.length < found.total) listBox.append(button('再显示 40 条', { class: 'load-more', onclick: () => { limit += 40; renderList(); } }));
    }
    function select(floor) {
        if (busy) return;
        try {
            if (!sameChat(chatRef(getContext()), source)) throw new Error('当前聊天已切换，请重新打开助手。');
            selected = service.plan(floor);
            result = null;
            message('');
            paintSelection();
            submit.disabled = false;
        } catch (error) { selected = null; submit.disabled = true; message(error.message, 'error'); }
    }
    function paintSelection() {
        selectedBox.replaceChildren(node('h2', { text: `从第 ${selected.floor + 1} 楼之后分支` }));
        memoryBox.replaceChildren();
        const messageData = getContext().chat[selected.floor];
        selectedBox.append(node('p', { class: 'selected-text', text: readableText(messageData?.mes).slice(0, 1200) || '（空消息）' }));
        const memory = selected.memory;
        if (!memory.available) {
            memoryBox.append(node('p', { class: 'warning', text: memory.message }));
        } else {
            const snapshot = memory.snapshot;
            const details = node('dl', { class: 'facts' });
            const fact = (term, value) => details.append(node('dt', { text: term }), node('dd', { text: value || '未记录' }));
            fact('剧情时间', snapshot.state?.time);
            fact('所在地点', snapshot.state?.location);
            fact('人物状态', snapshot.protagonist?.condition);
            fact('随行记忆', `${snapshot.items?.length ?? 0} 件物品 · ${snapshot.npcs?.length ?? 0} 位角色 · ${snapshot.plans?.filter(plan => plan.status === 'open').length ?? 0} 项未结计划`);
            memoryBox.append(details);
            memoryBox.append(node('p', { class: memory.complete ? 'good small' : 'warning',
                text: memory.complete ? '此前应摘要的楼层均已有有效记忆。' : `记忆存在缺口${memory.missing.length ? `，未摘楼层 ${memory.missing.slice(0, 12).map(i => i + 1).join('、')}${memory.missing.length > 12 ? '…' : ''}` : ''}。创建后仍需补摘。` }));
            const history = node('details', {}, node('summary', { text: '查看此前剧情摘要' }), node('pre', { class: 'history-text', text: memory.history.text || '此前还没有历史摘要。' }));
            const state = node('details', {}, node('summary', { text: '查看人物、物品与变量' }),
                node('pre', { class: 'history-text', text: JSON.stringify({ protagonist: snapshot.protagonist, items: snapshot.items, plans: snapshot.plans, npcs: snapshot.npcs, vars: snapshot.vars }, null, 2) }));
            memoryBox.append(history, state);
        }
        if (autoLabel) { draftLabel = `第 ${selected.floor + 1} 楼分线`; labelInput.value = draftLabel; }
        for (const row of listBox.querySelectorAll('[data-floor]')) row.setAttribute('aria-pressed', String(Number(row.dataset.floor) === selected.floor));
    }
    async function create() {
        if (busy || !selected) return;
        try { cleanLabel(labelInput.value); } catch (error) { message(error.message, 'error'); labelInput.focus(); return; }
        setBusy(true);
        message('正在调用酒馆原生分支功能…');
        try {
            result = await service.create({ selected, label: labelInput.value, note: noteInput.value });
            selected = null;
            source = chatRef(getContext());
            subtitle.textContent = `${getContext().name2 || '当前角色'} · ${result.target.fileName}`;
            message(`已进入「${result.label}」。${result.check.text}`, result.check.status === 'matched' ? 'success' : 'warning');
            tab = 'branches';
            render();
        } catch (error) { selected = null; message(error.message, 'error'); }
        finally { setBusy(false); }
    }
    async function renderBranches(ticket) {
        const box = node('section', { class: 'branch-list', 'aria-label': '已保存分支' });
        content.append(box);
        box.append(node('p', { class: 'empty', text: '正在读取分支…' }));
        try {
            const records = (await store.list()).filter(record => subjectKey(record.source) === subjectKey(source)).sort((a, b) => b.createdAt - a.createdAt);
            if (ticket !== request) return;
            box.replaceChildren();
            if (!records.length) box.append(node('p', { class: 'empty', text: '这个角色还没有助手记录。选择一条消息，创建第一条剧情分支。' }));
            const aliases = new Map(records.filter(record => record.target).map(record => [record.target.fileName, record.label]));
            for (const record of records) {
                const current = record.target && sameChat(source, record.target);
                const openButton = button(current ? '当前分支' : '进入分支', { class: 'secondary', onclick: () => navigate(record.target) });
                openButton.disabled = !record.target || current;
                const back = button('返回来源', { class: 'text-button', onclick: () => navigate(record.source) });
                const item = node('article', { class: `branch-card${current ? ' current' : ''}` },
                    node('div', { class: 'branch-head' }, node('h2', { text: record.label }), openButton),
                    node('p', { class: 'muted small', text: `来源 ${aliases.get(record.source.fileName) || record.source.fileName} · 第 ${record.floor + 1} 楼之后` }));
                if (record.note) item.append(node('p', { class: 'branch-note', text: record.note }));
                if (record.check) item.append(node('p', { class: record.check.status === 'matched' ? 'good small' : 'warning small', text: record.check.text }));
                if (record.status !== 'created') item.append(node('p', { class: 'warning', text: record.error || '上次创建未完成。请先在酒馆聊天列表核对结果。' }));
                item.append(back);
                box.append(item);
            }
        } catch (error) { if (ticket === request) box.replaceChildren(node('p', { class: 'warning', text: `分支记录读取失败。${error.message}` })); }
    }
    async function navigate(ref) {
        if (busy) return;
        setBusy(true);
        message('正在切换聊天…');
        try {
            await service.open(ref);
            source = chatRef(getContext());
            selected = null;
            subtitle.textContent = `${getContext().name2 || '当前角色'} · ${source.fileName}`;
            message('');
            render();
        } catch (error) { message(error.message, 'error'); }
        finally { setBusy(false); }
    }
    function chatChanged() {
        if (!dialog.open || busy) return;
        selected = null;
        submit.disabled = true;
        message('酒馆当前聊天已变化，请关闭并重新打开助手。', 'warning');
    }
    return { show, hide, chatChanged, host, root, get busy() { return busy; } };
}
