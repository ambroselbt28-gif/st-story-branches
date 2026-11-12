// 剧情分支助手 — AGPL-3.0
// 仅提供本仓库源码与合成数据，不接入用户酒馆。
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export function createPreviewServer() {
    return http.createServer(async (request, response) => {
        const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (route === '/') {
            response.setHeader('Content-Type', 'text/html;charset=utf-8');
            response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
                <title>剧情分支助手 · 合成验收</title>
                <style>:root{--SmartThemeBlurTintColor:#f8f5ef;--SmartThemeBodyColor:#302d28}body{font:15px system-ui;background:#eae7df;color:#302d28;margin:24px}button{padding:12px}#chat{max-width:650px;margin:30px auto}.mes{padding:16px;border-bottom:1px solid #bbb}.mes_create_branch{display:inline-block;padding:12px}</style>
                <div id="extensionsMenu"></div><div id="chat"></div>
                <script type="module">
                import {createFixture} from '/dev/fixture.js';
                window.fixture=createFixture();
                window.STBaiBaiBook=fixture.book;
                window.SillyTavern={getContext:()=>({...fixture.context,chat:fixture.context.chat,registerSlashCommand(){}})};
                const chat=document.getElementById('chat');
                fixture.context.chat.forEach((message,index)=>{const floor=document.createElement('div');floor.className='mes';floor.setAttribute('mesid',index);const text=document.createElement('p');text.textContent=message.mes;const branch=document.createElement('span');branch.className='mes_create_branch';branch.textContent='原生分支';floor.append(text,branch);chat.append(floor)});
                await import('/index.js');
                if(!new URLSearchParams(location.search).has('closed')) STStoryBranches.open(1);
                window.previewReady=true;
                </script>`);
            return;
        }
        if (route === '/scripts/bookmarks.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end('export const branchChat = floor => window.fixture.native.branchChat(floor);');
            return;
        }
        const file = path.resolve(project, '.' + route);
        if (!file.startsWith(project + path.sep)) { response.writeHead(403); response.end(); return; }
        try {
            const content = await fs.readFile(file);
            response.setHeader('Content-Type', route.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(content);
        } catch { response.writeHead(404); response.end(); }
    });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = createPreviewServer();
    server.listen(8112, '127.0.0.1', () => console.log('合成预览 http://127.0.0.1:8112'));
}
