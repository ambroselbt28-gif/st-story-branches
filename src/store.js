// 剧情分支助手 — AGPL-3.0
/** 每条分支独立落盘，避免多个页面写整表互相覆盖。只存导航信息。 */
export function createStore(indexedDB = globalThis.indexedDB) {
    let connection;
    function open() {
        connection ??= new Promise((resolve, reject) => {
            let blocked = false;
            const request = indexedDB.open('st-story-branches', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('branches', { keyPath: 'id' });
            request.onsuccess = () => {
                const db = request.result;
                if (blocked) { db.close(); return; }
                db.onversionchange = () => { db.close(); connection = undefined; };
                resolve(db);
            };
            request.onerror = () => { connection = undefined; reject(request.error); };
            request.onblocked = () => { blocked = true; connection = undefined; reject(new Error('请关闭其他旧版分支助手页面后重试。')); };
        });
        return connection;
    }
    async function run(mode, operation) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('branches', mode);
            const request = operation(transaction.objectStore('branches'));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error ?? new Error('分支记录未保存。'));
            transaction.onerror = () => reject(transaction.error ?? new Error('无法访问分支记录。'));
        });
    }
    return {
        put: record => run('readwrite', store => store.put(record)),
        list: () => run('readonly', store => store.getAll()),
        close: async () => { if (connection) (await connection).close(); connection = undefined; },
    };
}
