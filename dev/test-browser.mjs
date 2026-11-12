// 剧情分支助手 — AGPL-3.0
// 使用本机已有 Chrome 与 Node 内置 CDP，不安装浏览器或依赖。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createPreviewServer } from './preview.mjs';

const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = path.join(project, '.tmp');
await fs.mkdir(temp, { recursive: true });
let chrome;
for (const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
    try { await fs.access(candidate); chrome = candidate; break; } catch { /* 尝试下一款已安装浏览器。 */ }
}
if (!chrome) throw new Error('需要本机已安装 Chrome 或 Edge。');
const server = createPreviewServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await fs.mkdtemp(path.join(temp, 'browser-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-crash-reporter', '--disable-breakpad', '--disable-features=OptimizationHints,MediaRouter', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore', env: { ...process.env, TEMP: profile, TMP: profile, LOCALAPPDATA: profile, APPDATA: profile } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, sequence = 0;
const calls = new Map(), errors = [], blocked = [];
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { calls.delete(id); reject(new Error(`${method} 超时`)); }, 20000);
        calls.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
}
try {
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    if (!port) throw new Error('浏览器未启动。');
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    socket.addEventListener('message', async event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const call = calls.get(message.id);
            if (!call) return;
            clearTimeout(call.timer);
            calls.delete(message.id);
            message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
        } else if (message.method === 'Fetch.requestPaused') {
            const url = new URL(message.params.request.url);
            if (url.origin !== origin || url.pathname.startsWith('/api/')) {
                blocked.push(url.origin + url.pathname);
                await send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' });
            } else await send('Fetch.continueRequest', { requestId: message.params.requestId });
        } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const report = [];
    for (const [width, height] of [[390, 844], [320, 640], [1024, 768]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 });
        await send('Page.navigate', { url: `${origin}/?closed=1` });
        for (let i = 0; !(await evaluate('window.previewReady === true')); i++) {
            if (i > 100) throw new Error('合成页面未就绪 ' + JSON.stringify(errors));
            await delay(50);
        }
        const checks = await evaluate('stStoryBranchesSelfTest()');
        console.log(`${width}×${height} 浏览器检查通过 ${checks.length} 项`);
        await evaluate(`document.querySelector('.sb-message-button').click()`);
        await delay(150);
        const opened = await evaluate(`document.getElementById('st-story-branches-panel').shadowRoot.querySelector('.selected-context h2').textContent`);
        if (!opened.includes('第 1 楼')) throw new Error('消息入口没有定位到所选楼');
        await evaluate(`STStoryBranches.open(1)`);
        await delay(100);
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(temp, `preview-${width}.png`), Buffer.from(screenshot.data, 'base64'));
        await evaluate(`document.getElementById('st-story-branches-panel').shadowRoot.querySelector('.primary').click()`);
        let created;
        for (let i = 0; i < 100; i++) {
            created = await evaluate(`document.getElementById('st-story-branches-panel').shadowRoot.querySelector('.notice').textContent.includes('已核对一致')`);
            if (created) break;
            await delay(50);
        }
        if (!created || await evaluate('fixture.nativeCalls') !== 1) throw new Error('正式入口创建分支失败');
        report.push({ width, height, checks: checks.length, entryPoint: true });
    }
    if (blocked.length || errors.length) throw new Error(JSON.stringify({ blocked, errors }));
    await fs.writeFile(path.join(temp, 'browser-result.json'), JSON.stringify(report, null, 2));
    console.log('正式消息入口、创建与切换验证通过，外部/API 请求与未捕获异常为 0。');
} finally {
    socket?.close();
    browser.kill();
    await once(browser, 'exit').catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (!profile.startsWith(temp + path.sep)) throw new Error('拒绝清理项目以外的浏览器目录');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
