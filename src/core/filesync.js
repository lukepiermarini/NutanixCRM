/* Auto-save to a JSON file on the user's PC via the File System Access API
 * (Chrome / Edge). IndexedDB is always the primary store; the linked file is a
 * continuously-updated mirror the user owns, can back up, or move to a new PC.
 * Browsers without the API (Firefox / Safari) fall back to manual export. */
(function (NX) {
  'use strict';

  const FILE_TYPES = [{ description: 'SE Pipeline workspace', accept: { 'application/json': ['.json'] } }];

  function createFileSync(store) {
    const supported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
    let handle = null;
    // status: unsupported | disconnected | needs-permission | saving | saved | error
    let state = { status: supported ? 'disconnected' : 'unsupported', fileName: '', lastSavedAt: '', error: '' };
    const listeners = new Set();

    function setState(patch) {
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state);
    }

    async function writeNow() {
      if (!handle) return;
      try {
        setState({ status: 'saving' });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(store.workspace.snapshot(), null, 2));
        await writable.close();
        setState({ status: 'saved', lastSavedAt: new Date().toISOString(), error: '' });
      } catch (err) {
        console.error('File save failed', err);
        const lost = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        setState({ status: lost ? 'needs-permission' : 'error', error: err.message || String(err) });
      }
    }
    const scheduleWrite = NX.util.debounce(writeNow, 700);

    async function readHandle(h) {
      const file = await h.getFile();
      const text = await file.text();
      return text.trim() ? JSON.parse(text) : null;
    }

    /** If the file on disk is newer than the browser copy (e.g. edited on another PC), load it. */
    async function reconcile() {
      const disk = await readHandle(handle).catch(() => null);
      const local = await store.workspace.lastChangeAt();
      if (disk && disk.savedAt && (!local || disk.savedAt > local)) {
        await store.workspace.load(disk, 'replace');
        return 'loaded-from-file';
      }
      await writeNow();
      return 'wrote-to-file';
    }

    async function adopt(h) {
      handle = h;
      // Persisting the handle lets the link survive restarts; if the browser can't store it, keep saving this session.
      await store.adapter.setMeta('fileHandle', h).catch((e) => console.warn('Could not remember file handle', e));
      setState({ fileName: h.name, status: 'saved' });
    }

    const api = {
      supported,
      getState: () => state,
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

      /** Restores a previously linked file at startup (permission may need a click to re-grant). */
      async init() {
        if (!supported) return;
        const saved = await store.adapter.getMeta('fileHandle').catch(() => null);
        if (!saved) return;
        handle = saved;
        setState({ fileName: saved.name });
        const perm = await saved.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
        if (perm === 'granted') { setState({ status: 'saved' }); await reconcile(); }
        else setState({ status: 'needs-permission' });
      },

      /** Create a new save file (must run from a click handler). */
      async createFile() {
        const h = await window.showSaveFilePicker({ suggestedName: 'se-pipeline-workspace.json', types: FILE_TYPES });
        await adopt(h);
        await writeNow();
      },

      /** Open an existing workspace file, load it, and keep auto-saving to it. */
      async openFile() {
        const [h] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
        const perm = await h.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') throw new Error('Write permission was not granted');
        const data = await readHandle(h);
        if (data) await store.workspace.load(data, 'replace');
        await adopt(h);
        await writeNow();
      },

      /** Re-grant access after a browser restart (must run from a click handler). */
      async reconnect() {
        if (!handle) return;
        const perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { setState({ status: 'needs-permission' }); return; }
        setState({ status: 'saved' });
        return reconcile();
      },

      async disconnect() {
        handle = null;
        await store.adapter.setMeta('fileHandle', undefined);
        setState({ status: 'disconnected', fileName: '', lastSavedAt: '' });
      },

      /** Called on every store change. */
      notifyChange() { if (handle && state.status !== 'needs-permission') scheduleWrite(); },
      flush() { if (handle && state.status !== 'needs-permission') return scheduleWrite.flush(); },
    };
    return api;
  }

  /** Browser download of the current workspace — works everywhere. */
  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function pickJSONFile() {
    return new Promise((resolve, reject) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
      input.onchange = async () => {
        try { resolve(input.files[0] ? JSON.parse(await input.files[0].text()) : null); } catch (e) { reject(new Error('Could not read JSON: ' + e.message)); }
      };
      input.click();
    });
  }

  NX.createFileSync = createFileSync;
  NX.files = { downloadJSON, pickJSONFile };
})(globalThis.NX = globalThis.NX || {});
