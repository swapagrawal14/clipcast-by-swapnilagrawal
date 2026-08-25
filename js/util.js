/* ClipCast — util.js : tiny DOM/time/color/misc helpers.
   Times are SECONDS everywhere in this app (never 0..1 fractions). */
window.AC = window.AC || {};

AC.util = (() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

  /* format seconds → m:ss.t (tenths) */
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
  }
  /* format seconds → h:mm:ss */
  function fmtTimeFull(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
             : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function parseClock(str) {
    /* "mm:ss" or "hh:mm:ss" (decimal separator . or ,) → seconds */
    const m = String(str).trim().match(/^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/);
    if (!m) return NaN;
    const f = m[1] > 0 ? parseInt(m[1], 10) * 60 : 0; // hh or mm — ambiguous, treat as mm:ss for 2-part
    return NaN;
  }
  function parseTimeStr(str) {
    /* robust "1:23.45" / "01:23.45" / "1:23" → seconds */
    const s = String(str).trim().replace(/,/g, '.');
    const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/);
    if (!m) return NaN;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10);
    return h * 3600 + mm * 60 + parseFloat(m[3]);
  }

  let seq = 0;
  const uid = (p) => `${p || 'id'}_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  /* ── colors ── */
  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!isFinite(n) || h.length !== 6) return { r: 255, g: 255, b: 255 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function mix(c1, c2, t) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return `rgb(${Math.round(lerp(a.r, b.r, t))},${Math.round(lerp(a.g, b.g, t))},${Math.round(lerp(a.b, b.b, t))})`;
  }
  function isDarkColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }
  const withAlpha = rgba;

  /* ── DOM building ── */
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'dataset') Object.assign(n.dataset, attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of children.flat(9)) {
      if (c == null) continue;
      n.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ── toasts ── */
  function toast(msg, kind = 'info', ms = 3200) {
    const root = $('#toasts') || (() => {
      const d = el('div', { id: 'toasts' });
      document.body.appendChild(d);
      return d;
    })();
    const t = el('div', { class: `toast ${kind}`, role: 'status' }, msg);
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 350); }, ms);
  }

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* chars safe for our embedded OFL fonts (no emoji/CJK → tofu). */
  function safeText(text, fontId) {
    if (fontId === 'system') return String(text ?? '');
    return String(text ?? '').replace(/[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u2190-\u21FF\u2200-\u22FF\u2500-\u25FF\u2600-\u26FF\u27C0-\u27EF\u2B00-\u2BFF\u3000-\u303F\uFF00-\uFFEF]/g, ' ');
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    $, $$, clamp, lerp, smooth, easeOutBack, easeOutQuad,
    fmtTime, fmtTimeFull, fmtBytes, parseTimeStr,
    uid, debounce, sleep, makeCanvas, downloadBlob,
    hexToRgb, rgba, mix, isDarkColor, withAlpha,
    el, esc, toast, prefersReducedMotion, safeText, mulberry32,
  };
})();
