/* Persistence adapter: IndexedDB (per browser profile = per user's PC).
 * Exposes a tiny async key/value + collection API so the store never touches
 * IndexedDB directly. A remote HTTP adapter with the same surface can replace
 * this later without changing any UI code (see docs/ARCHITECTURE.md). */
(function (NX) {
  'use strict';

  const DB_NAME = 'nutanix-se-pipeline';
  const DB_VERSION = 1;
  const COLLECTIONS = ['accounts', 'deals', 'meetings', 'tasks'];
  const INDEXES = {
    accounts: [['name', 'name']],
    deals: [['accountId', 'accountId'], ['stage', 'stage']],
    meetings: [['accountId', 'accountId'], ['dealId', 'dealId'], ['date', 'date']],
    tasks: [['accountId', 'accountId'], ['dealId', 'dealId'], ['meetingId', 'meetingId'], ['status', 'status'], ['dueDate', 'dueDate']],
  };

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  class IndexedDBAdapter {
    constructor() { this.kind = 'indexeddb'; this.db = null; }

    async open() {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of COLLECTIONS) {
            if (!db.objectStoreNames.contains(name)) {
              const os = db.createObjectStore(name, { keyPath: 'id' });
              for (const [idx, path] of INDEXES[name]) os.createIndex(idx, path);
            }
          }
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Database blocked by another open tab'));
      });
      return this;
    }

    async getAll(collection) {
      const tx = this.db.transaction(collection, 'readonly');
      return promisify(tx.objectStore(collection).getAll());
    }

    /** Applies puts/deletes across collections atomically. ops: [{collection, put?: rec, del?: id}] */
    async commit(ops) {
      if (!ops.length) return;
      const names = [...new Set(ops.map((o) => o.collection))];
      const tx = this.db.transaction(names, 'readwrite');
      for (const op of ops) {
        const os = tx.objectStore(op.collection);
        if (op.put) os.put(op.put);
        else if (op.del) os.delete(op.del);
      }
      return txDone(tx);
    }

    async replaceAll(snapshot) {
      const tx = this.db.transaction(COLLECTIONS, 'readwrite');
      for (const name of COLLECTIONS) {
        const os = tx.objectStore(name);
        os.clear();
        for (const rec of snapshot[name] || []) os.put(rec);
      }
      return txDone(tx);
    }

    async getMeta(key) {
      const tx = this.db.transaction('meta', 'readonly');
      return promisify(tx.objectStore('meta').get(key));
    }

    async setMeta(key, value) {
      const tx = this.db.transaction('meta', 'readwrite');
      if (value === undefined) tx.objectStore('meta').delete(key);
      else tx.objectStore('meta').put(value, key);
      return txDone(tx);
    }
  }

  /** Used when IndexedDB is unavailable (some private-browsing modes). Data lives only in memory. */
  class MemoryAdapter {
    constructor() { this.kind = 'memory'; this.data = { meta: {} }; COLLECTIONS.forEach((c) => (this.data[c] = new Map())); }
    async open() { return this; }
    async getAll(c) { return [...this.data[c].values()]; }
    async commit(ops) { for (const o of ops) o.put ? this.data[o.collection].set(o.put.id, o.put) : this.data[o.collection].delete(o.del); }
    async replaceAll(s) { COLLECTIONS.forEach((c) => { this.data[c] = new Map((s[c] || []).map((r) => [r.id, r])); }); }
    async getMeta(k) { return this.data.meta[k]; }
    async setMeta(k, v) { if (v === undefined) delete this.data.meta[k]; else this.data.meta[k] = v; }
  }

  async function openDatabase() {
    if (typeof indexedDB === 'undefined') return new MemoryAdapter().open();
    try {
      return await new IndexedDBAdapter().open();
    } catch (err) {
      console.warn('IndexedDB unavailable, falling back to memory storage', err);
      return new MemoryAdapter().open();
    }
  }

  NX.db = { openDatabase, COLLECTIONS, IndexedDBAdapter, MemoryAdapter };
})(globalThis.NX = globalThis.NX || {});
