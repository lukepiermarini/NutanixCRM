/* Modals, side drawers, toasts and confirm dialogs. */
(function (NX) {
  'use strict';
  const { h, icon } = NX.dom;

  const stack = [];
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
  });

  /**
   * openPanel({ title, body, footer, kind: 'modal'|'drawer', size: 'sm'|'md'|'lg', onClose })
   * body / footer may be Nodes or functions (panel) => Node.
   */
  function openPanel(opts) {
    const kind = opts.kind || 'modal';
    const backdrop = h('div.backdrop' + (kind === 'drawer' ? '.backdrop-drawer' : ''));
    const panel = h(`div.${kind}.${kind}-${opts.size || 'md'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '' });
    let closed = false;
    const api = {
      el: panel,
      close() {
        if (closed) return;
        if (opts.beforeClose && opts.beforeClose() === false) return;
        closed = true;
        stack.splice(stack.indexOf(api), 1);
        backdrop.classList.add('closing');
        setTimeout(() => backdrop.remove(), 150);
        opts.onClose && opts.onClose();
      },
      setTitle(t) { titleEl.textContent = t; },
      setBody(node) { NX.dom.clear(bodyEl).appendChild(node); },
      setFooter(node) { NX.dom.clear(footEl); if (node) footEl.appendChild(node); footEl.hidden = !node; },
    };
    const titleEl = h('h2.panel-title', opts.title || '');
    const bodyEl = h('div.panel-body');
    const footEl = h('div.panel-foot');
    panel.append(
      h('div.panel-head', titleEl, h('button.icon-btn', { title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => api.close() }, icon('x'))),
      bodyEl, footEl,
    );
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && !opts.sticky) api.close(); });
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    stack.push(api);
    const resolve = (x) => (typeof x === 'function' ? x(api) : x);
    if (opts.body) bodyEl.appendChild(resolve(opts.body));
    api.setFooter(opts.footer ? resolve(opts.footer) : null);
    requestAnimationFrame(() => {
      const f = panel.querySelector('[autofocus]') || panel.querySelector('input:not([type=checkbox]),textarea,select');
      if (f && kind === 'modal') f.focus();
    });
    return api;
  }

  function toast(message, type = 'info', ms = 3500) {
    let host = document.getElementById('toasts');
    if (!host) { host = h('div.toasts', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
    const el = h(`div.toast.toast-${type}`, message);
    host.appendChild(el);
    setTimeout(() => { el.classList.add('closing'); setTimeout(() => el.remove(), 200); }, ms);
  }

  function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const p = openPanel({
        title, size: 'sm',
        body: h('p.muted', message),
        footer: () => h('div.row.end',
          h('button.btn', { onclick: () => p.close() }, 'Cancel'),
          h('button.btn.' + (danger ? 'btn-danger' : 'btn-primary'), { autofocus: true, onclick: () => { answered = true; p.close(); } }, confirmLabel),
        ),
        onClose: () => resolve(answered),
      });
    });
  }

  function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', multiline = false }) {
    return new Promise((resolve) => {
      let result = null;
      const input = multiline
        ? h('textarea.input', { rows: 3, value, placeholder, autofocus: true })
        : h('input.input', { value, placeholder, autofocus: true });
      const submit = () => { result = input.value; p.close(); };
      if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const p = openPanel({
        title, size: 'sm',
        body: h('label.field', h('span', label), input),
        footer: () => h('div.row.end', h('button.btn', { onclick: () => p.close() }, 'Cancel'), h('button.btn.btn-primary', { onclick: submit }, confirmLabel)),
        onClose: () => resolve(result),
      });
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'success'); }
    catch {
      const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      toast('Copied to clipboard', 'success');
    }
  }

  NX.ui = Object.assign(NX.ui || {}, { openPanel, toast, confirmDialog, promptDialog, copyText });
})(globalThis.NX = globalThis.NX || {});
