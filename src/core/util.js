/* Shared, dependency-free helpers. Pure functions only — safe to load in Node for tests. */
(function (NX) {
  'use strict';

  const util = {};

  util.uid = function uid(prefix) {
    const rand = (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    return (prefix ? prefix + '_' : '') + rand;
  };

  util.nowISO = () => new Date().toISOString();

  /** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's wall clock). */
  util.toLocalISODate = function toLocalISODate(d) {
    const date = d instanceof Date ? d : new Date(d);
    const off = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - off).toISOString().slice(0, 10);
  };

  util.todayISO = () => util.toLocalISODate(new Date());

  /** Parse YYYY-MM-DD as a local-midnight Date. */
  util.parseISODate = function parseISODate(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return isNaN(dt) ? null : dt;
  };

  util.addDays = function addDays(isoDate, n) {
    const d = util.parseISODate(isoDate) || new Date();
    d.setDate(d.getDate() + n);
    return util.toLocalISODate(d);
  };

  /** Adds business days (skips Sat/Sun). */
  util.addBusinessDays = function addBusinessDays(isoDate, n) {
    const d = util.parseISODate(isoDate) || new Date();
    let left = n;
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) left--;
    }
    return util.toLocalISODate(d);
  };

  /** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is in the past. */
  util.daysBetween = function daysBetween(from, to) {
    const a = util.parseISODate(from), b = util.parseISODate(to);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  };

  util.formatDate = function formatDate(iso, opts) {
    const d = util.parseISODate(iso) || (iso ? new Date(iso) : null);
    if (!d || isNaN(d)) return '';
    return d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', year: 'numeric' });
  };

  /** "Today", "Tomorrow", "in 3 days", "2 days overdue", or a formatted date. */
  util.relativeDue = function relativeDue(iso) {
    if (!iso) return 'No date';
    const diff = util.daysBetween(util.todayISO(), iso);
    if (diff === null) return '';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff < 0) return Math.abs(diff) + ' days overdue';
    if (diff < 7) return 'in ' + diff + ' days';
    return util.formatDate(iso, { month: 'short', day: 'numeric' });
  };

  util.formatMoney = function formatMoney(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M';
    if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + v.toLocaleString();
  };

  util.debounce = function debounce(fn, ms) {
    let t = null;
    const wrapped = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
    wrapped.flush = function (...args) { clearTimeout(t); return fn.apply(this, args); };
    return wrapped;
  };

  util.clone = (o) => JSON.parse(JSON.stringify(o));

  util.normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  util.byKey = function byKey(key, dir) {
    const sign = dir === 'desc' ? -1 : 1;
    return (a, b) => {
      const av = a[key] ?? '', bv = b[key] ?? '';
      return av < bv ? -sign : av > bv ? sign : 0;
    };
  };

  NX.util = util;
})(globalThis.NX = globalThis.NX || {});
