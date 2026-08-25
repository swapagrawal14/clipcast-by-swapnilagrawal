/* ClipCast — panels.js : left sidebar (templates / blocks / waveform+caption
   style / backgrounds) and the right-hand inspector for the selected block. */
AC.panels = (() => {
  'use strict';
  const U = AC.util;

  /* ═══════════ left tabs ═══════════ */
  function initTabs() {
    const btns = document.querySelectorAll('#left .tab-btn');
    const panels = {
      templates: document.getElementById('panel-templates'),
      blocks: document.getElementById('panel-blocks'),
      style: document.getElementById('panel-style'),
      bg: document.getElementById('panel-bg'),
    };
    btns.forEach((b) => b.addEventListener('click', () => {
      btns.forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      for (const k in panels) panels[k].classList.toggle('hidden', k !== b.dataset.tab);
      if (b.dataset.tab === 'style') renderWFChips();
    }));
  }

  /* ═══════════ templates ═══════════ */
  function renderTemplates() {
    const grid = document.getElementById('tmplGrid');
    grid.innerHTML = '';
    for (const t of AC.state.TEMPLATES) {
      const card = U.el('button', {
        class: 'tmpl-card', 'aria-label': 'Apply template ' + t.name,
        onclick: () => {
          AC.state.applyTemplate(t.id);
          U.toast('Template applied: ' + t.name, 'ok');
          AC.panels.renderAll();
          AC.stage.setTime(0);
        },
      });
      const thumb = U.el('div', { class: 'thumb', style: 'background:' + t.css });
      thumb.appendChild(U.el('div', { class: 'mini' }, '⟨∿⟩'));
      card.appendChild(thumb);
      const meta = U.el('div', { class: 'meta' });
      meta.appendChild(U.el('b', {}, t.name));
      meta.appendChild(U.el('span', {}, t.blurb));
      card.appendChild(meta);
      grid.appendChild(card);
    }
  }

  /* ═══════════ blocks list ═══════════ */
  const BLOCK_META = {
    cover: { label: 'Cover art', sub: 'image, rounded, Ken Burns', ico: '🖼' },
    title: { label: 'Title', sub: 'headline text', ico: 'T' },
    subtitle: { label: 'Subtitle / @handle', sub: 'secondary text', ico: '₳' },
    waveform: { label: 'Waveform', sub: 'the animated audio visual', ico: '∿' },
    progress: { label: 'Progress bar', sub: 'playback progress', ico: '▬' },
    timer: { label: 'Timer chip', sub: 'elapsed / remaining', ico: '⏱' },
    watermark: { label: 'Watermark line', sub: 'optional text', ico: '©' },
  };

  function renderBlocks() {
    const wrap = document.getElementById('blockList');
    wrap.innerHTML = '';
    const p = AC.state.current();
    for (const type of Object.keys(BLOCK_META)) {
      const meta = BLOCK_META[type];
      const row = U.el('div', { class: 'block-row' });
      const ico = U.el('div', { class: 'b-ico' }, meta.ico);
      row.appendChild(ico);
      const name = U.el('div', { class: 'b-name' }, meta.label);
      name.appendChild(U.el('small', {}, meta.sub));
      row.appendChild(name);
      const existing = p.blocks.find((b) => b.type === type);
      const sw = U.el('label', { class: 'switch', title: 'Show / hide block' });
      const inp = U.el('input', {
        type: 'checkbox', checked: !!(existing && existing.visible !== false),
        onchange: (ev) => {
          AC.state.mutate((pp) => {
            let b = pp.blocks.find((x) => x.type === type);
            if (!b) { b = AC.engine.defaultBlock(type); b.visible = true; pp.blocks.push(b); }
            b.visible = ev.target.checked;
            if (b.visible && b.type === 'waveform' && !pp.blocks.some((x) => x.type === 'waveform')) pp.blocks.push(b);
          });
          if (ev.target.checked) AC.stage.setSelected(existing ? existing.id : (AC.state.current().blocks.find((x) => x.type === type) || {}).id);
        },
      });
      sw.appendChild(inp);
      sw.appendChild(U.el('span', { class: 'track' }));
      row.appendChild(sw);
      wrap.appendChild(row);
    }
  }

  /* ═══════════ waveform + caption style ═══════════ */
  function renderWFChips() {
    const grid = document.getElementById('wfGrid');
    grid.innerHTML = '';
    const p = AC.state.current();
    for (const s of AC.waveform.STYLES) {
      const chip = U.el('button', {
        class: 'wf-chip' + (p.wf.style === s.id ? ' active' : ''),
        'aria-label': 'Waveform style ' + s.label,
        onclick: () => {
          AC.state.mutate((pp) => { pp.wf.style = s.id; });
          renderWFChips(); renderWFControls();
        },
      });
      const cv = U.makeCanvas(120, 44);
      const st = Object.assign({}, p.wf, { style: s.id, bounce: false });
      AC.engine.drawStylePreview(cv, s.id, st);
      chip.appendChild(cv);
      chip.appendChild(U.el('div', { class: 'lbl' }, s.label));
      grid.appendChild(chip);
    }
    renderWFControls();
    renderCapStyleControls();
  }

  function renderWFControls() {
    const wrap = document.getElementById('wfControls');
    wrap.innerHTML = '';
    const p = AC.state.current();
    const st = p.wf;
    const W = (label, input, val, onChange) => {
      const row = U.el('div', { class: 'f-row' });
      row.appendChild(U.el('label', {}, label));
      row.appendChild(input);
      row.appendChild(U.el('span', { class: 'val' }, val));
      input.addEventListener('input', () => { onChange(input); });
      wrap.appendChild(row);
    };
    const range = (v, min, max, step) => {
      const i = U.el('input', { type: 'range', min, max, step, value: v, 'aria-label': label });
      return i;
    };
    let label;
    label = 'Bar count';
    W(label, range(st.bars, 12, 160, 1), st.bars, (i) => AC.state.mutate((pp) => { pp.wf.bars = +i.value; }));
    if (st.style !== 'dots') {
      label = 'Gap';
      W(label, range(st.gap, 0, 0.5, 0.02), st.gap.toFixed(2), (i) => AC.state.mutate((pp) => { pp.wf.gap = +i.value; }));
    }
    if (st.style === 'dots') {
      label = 'Rows';
      W(label, range(st.rows, 3, 10, 1), st.rows, (i) => AC.state.mutate((pp) => { pp.wf.rows = +i.value; }));
    }
    if (st.style === 'mirror' || st.style === 'radial') {
      label = 'Line width';
      W(label, range(st.lineWidth, 1, 8, 0.5), st.lineWidth, (i) => AC.state.mutate((pp) => { pp.wf.lineWidth = +i.value; }));
    }
    label = 'Played color';
    W(label, U.el('input', { type: 'color', value: st.color }), '', (i) => AC.state.mutate((pp) => { pp.wf.color = i.value; }));
    label = 'Unplayed color';
    W(label, U.el('input', { type: 'color', value: hexOf(st.color2) }), '', (i) => AC.state.mutate((pp) => { pp.wf.color2 = i.value; }));
    label = 'Rounded caps';
    W(label, toggle(st.rounded), st.rounded ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.wf.rounded = i.checked; }));
    label = 'Energy bounce';
    W(label, toggle(st.bounce), st.bounce ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.wf.bounce = i.checked; }));
    label = 'Playhead line';
    W(label, toggle(st.playhead), st.playhead ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.wf.playhead = i.checked; }));
    label = 'Level meter';
    W(label, toggle(st.meter), st.meter ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.wf.meter = i.checked; }));
    if (st.style === 'spectrum') {
      label = 'Sparkles';
      W(label, toggle(st.sparkles), st.sparkles ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.wf.sparkles = i.checked; }));
    }
  }

  function hexOf(c) { return /^#/.test(c || '') ? c : '#2dd4bf'; }

  function toggle(checked) {
    const l = U.el('label', { class: 'switch' });
    const i = U.el('input', { type: 'checkbox', checked: !!checked });
    l.appendChild(i);
    l.appendChild(U.el('span', { class: 'track' }));
    return l;
  }

  function renderCapStyleControls() {
    const wrap = document.getElementById('capStyleControls');
    wrap.innerHTML = '';
    const st = AC.state.current().captions.style;
    const W = (label, input, val, onChange) => {
      const row = U.el('div', { class: 'f-row' });
      row.appendChild(U.el('label', {}, label));
      row.appendChild(input);
      row.appendChild(U.el('span', { class: 'val' }, val));
      input.addEventListener('input', () => onChange(input));
      wrap.appendChild(row);
    };
    const sel = U.el('select', { class: 'input' });
    for (const f of AC.assets.FONTS) sel.appendChild(U.el('option', { value: f.id, selected: f.id === st.font ? 'selected' : null }, f.label));
    W('Font', sel, '', (i) => AC.state.mutate((pp) => { pp.captions.style.font = i.value; }));
    const size = U.el('input', { type: 'range', min: 0.03, max: 0.16, step: 0.002, value: st.size });
    W('Size', size, Math.round(st.size * 100) + '%', (i) => AC.state.mutate((pp) => { pp.captions.style.size = +i.value; }));
    W('Text color', U.el('input', { type: 'color', value: st.color }), '', (i) => AC.state.mutate((pp) => { pp.captions.style.color = i.value; }));
    W('Highlight', U.el('input', { type: 'color', value: st.hl }), '', (i) => AC.state.mutate((pp) => { pp.captions.style.hl = i.value; }));
    W('Dimmed words', U.el('input', { type: 'color', value: hexOf(st.dim) }), '', (i) => AC.state.mutate((pp) => { pp.captions.style.dim = i.value; }));
    W('Outline', toggle(st.outline > 0), st.outline > 0 ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.captions.style.outline = i.checked ? 0.02 : 0; }));
    W('Shadow', toggle(st.shadow), st.shadow ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.captions.style.shadow = i.checked; }));
    W('ALL CAPS', toggle(st.caps), st.caps ? 'on' : 'off', (i) => AC.state.mutate((pp) => { pp.captions.style.caps = i.checked; }));
    const mw = U.el('input', { type: 'range', min: 1, max: 10, step: 1, value: st.maxWords });
    W('Max words / line', mw, st.maxWords, (i) => AC.state.mutate((pp) => { pp.captions.style.maxWords = +i.value; }));
  }

  /* ═══════════ backgrounds ═══════════ */
  function renderBG() {
    const grid = document.getElementById('bgGrid');
    grid.innerHTML = '';
    const p = AC.state.current();
    for (const b of AC.engine.BG_DEFS) {
      const sw = U.el('button', {
        class: 'sw' + (p.bg.type === b.id ? ' active' : ''),
        style: 'background:' + b.css,
        title: b.label, 'aria-label': 'Background ' + b.label,
        onclick: () => AC.state.mutate((pp) => { pp.bg.type = b.id; }),
      });
      sw.appendChild(U.el('span', { class: 'sw-name' }, b.label));
      grid.appendChild(sw);
    }
    const c1 = document.getElementById('bgC1');
    const c2 = document.getElementById('bgC2');
    const an = document.getElementById('bgAngle');
    c1.value = hexOf(p.bg.c1);
    c2.value = hexOf(p.bg.c2);
    an.value = p.bg.angle ?? 135;
    document.getElementById('bgAngleVal').textContent = (p.bg.angle ?? 135) + '°';
    c1.oninput = () => AC.state.mutate((pp) => { pp.bg.c1 = c1.value; if (pp.bg.type === 'solid' || pp.bg.type === 'custom' || pp.bg.type === 'grad1' || pp.bg.type === 'grad2' || pp.bg.type === 'grad3' || pp.bg.type === 'grad4') { } });
    c2.oninput = () => AC.state.mutate((pp) => { pp.bg.c2 = c2.value; });
    an.oninput = () => { document.getElementById('bgAngleVal').textContent = an.value + '°'; AC.state.mutate((pp) => { pp.bg.angle = +an.value; }); };
  }

  /* ═══════════ inspector ═══════════ */
  let _inspBuilding = false;
  let _emptyHTML = null;
  function buildInspector() {
    const body = document.getElementById('inspBody');
    const title = document.getElementById('inspTitle');
    const ico = document.getElementById('inspIco');
    const p = AC.state.current();
    const selId = AC.stage.selected();
    const block = p.blocks.find((b) => b.id === selId);
    if (!block) {
      title.textContent = 'Inspector';
      ico.innerHTML = '';
      if (!_emptyHTML) _emptyHTML = document.getElementById('inspEmpty').outerHTML;
      body.innerHTML = _emptyHTML;
      return;
    }
    const meta = BLOCK_META[block.type] || { label: block.type };
    title.textContent = meta.label;
    ico.textContent = meta.ico;
    body.innerHTML = '';
    _inspBuilding = true;

    const F = (label, input, oninput) => {
      const row = U.el('div', { class: 'f-row' });
      row.appendChild(U.el('label', {}, label));
      row.appendChild(input);
      if (typeof oninput === 'function') input.addEventListener('input', oninput);
      body.appendChild(row);
    };
    const numF = (v, step) => {
      const i = U.el('input', { type: 'number', class: 'input', value: v, step, style: 'width:76px' });
      return i;
    };

    /* common position / size */
    F('Position X (%)', numF(Math.round(block.x * 100), 1), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.x = U.clamp(+i.value / 100, 0, 1); }));
    F('Position Y (%)', numF(Math.round(block.y * 100), 1), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.y = U.clamp(+i.value / 100, 0, 1); }));
    F('Width (%)', numF(Math.round(block.w * 100), 1), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.w = U.clamp(+i.value / 100, 0.02, 1); }));
    F('Height (%)', numF(Math.round(block.h * 100), 1), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.h = U.clamp(+i.value / 100, 0.01, 1); }));
    F('Visible', toggle(block.visible !== false), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.visible = i.checked; }));

    const sep = U.el('div', { class: 'sec-h', style: 'margin-top:12px' }, 'Style');
    body.appendChild(sep);

    switch (block.type) {
      case 'title': case 'subtitle': case 'watermark': {
        const ta = U.el('textarea', { class: 'input', rows: 2, 'aria-label': 'text' });
        ta.value = block.text;
        F('Text', ta, () => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.text = ta.value; }));
        const sel = U.el('select', { class: 'input' });
        for (const f of AC.assets.FONTS) sel.appendChild(U.el('option', { value: f.id, selected: f.id === block.font ? 'selected' : null }, f.label));
        F('Font', sel, (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.font = i.value; }));
        const size = U.el('input', { type: 'range', min: 0.01, max: 0.2, step: 0.002, value: block.size });
        F('Size', size, (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.size = +i.value; }));
        F('Color', U.el('input', { type: 'color', value: block.color || '#f8fafc' }), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.color = i.value; }));
        F('Bold', toggle(!!block.bold), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.bold = i.checked; }));
        const al = U.el('select', { class: 'input' });
        for (const [v, l] of [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]) al.appendChild(U.el('option', { value: v, selected: block.align === v ? 'selected' : null }, l));
        F('Align', al, (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.align = i.value; }));
        if (block.type !== 'watermark') {
          F('ALL CAPS', toggle(!!block.caps), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.caps = i.checked; }));
          F('Outline', toggle((block.outline || 0) > 0), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.outline = i.checked ? 0.015 : 0; }));
          F('Shadow', toggle(block.shadow !== false), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.shadow = i.checked; }));
        }
        if (block.type === 'watermark') {
          F('Opacity', U.el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: block.opacity ?? 0.5 }), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.opacity = +i.value; }));
        }
        break;
      }
      case 'cover': {
        const btn = U.el('button', { class: 'btn btn-sm' }, block.assetId ? 'Replace image…' : 'Upload image…');
        btn.addEventListener('click', () => document.getElementById('fileCover').click());
        F('Image', btn, () => {});
        const rnd = U.el('input', { type: 'range', min: 0, max: 0.3, step: 0.01, value: block.rounded ?? 0.05 });
        F('Rounding', rnd, (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.rounded = +i.value; }));
        F('Shadow', toggle(block.shadow !== false), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.shadow = i.checked; }));
        F('Ken Burns zoom', toggle(!!block.kenburns), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.kenburns = i.checked; }));
        F('Grayscale', toggle(!!block.grayscale), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.grayscale = i.checked; }));
        break;
      }
      case 'progress': {
        F('Fill color', U.el('input', { type: 'color', value: block.color || '#2dd4bf' }), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.color = i.value; }));
        const ht = U.el('input', { type: 'range', min: 0.003, max: 0.03, step: 0.001, value: block.height });
        F('Thickness', ht, (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.height = +i.value; }));
        F('Glow', toggle(block.glow !== false), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.glow = i.checked; }));
        break;
      }
      case 'timer': {
        const sel = U.el('select', { class: 'input' });
        sel.appendChild(U.el('option', { value: 'elapsed', selected: block.format === 'elapsed' ? 'selected' : null }, 'elapsed / total'));
        sel.appendChild(U.el('option', { value: 'remaining', selected: block.format === 'remaining' ? 'selected' : null }, 'remaining'));
        F('Format', sel, (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.format = i.value; }));
        F('Chip background', toggle(block.chip !== false), '', (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.chip = i.checked; }));
        F('Color', U.el('input', { type: 'color', value: block.color || '#f8fafc' }), (i) => AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === block.id); if (b) b.color = i.value; }));
        break;
      }
      case 'waveform': {
        body.appendChild(U.el('p', { class: 'muted', style: 'font-size:12px;line-height:1.6' },
          'Waveform style, colors and effects are edited in the left Style tab.'));
        break;
      }
    }

    const sep2 = U.el('div', { class: 'sec-h', style: 'margin-top:14px' }, 'Layer');
    body.appendChild(sep2);
    const zRow = U.el('div', { class: 'row', style: 'gap:6px' });
    const up = U.el('button', { class: 'btn btn-sm' }, '↑ front');
    const down = U.el('button', { class: 'btn btn-sm' }, '↓ back');
    const del = U.el('button', { class: 'btn btn-sm btn-coral', style: 'margin-left:auto' }, 'Delete block');
    up.addEventListener('click', () => {
      AC.state.mutate((pp) => {
        const i = pp.blocks.findIndex((x) => x.id === block.id);
        if (i < pp.blocks.length - 1) { const [b] = pp.blocks.splice(i, 1); pp.blocks.splice(i + 1, 0, b); }
      });
    });
    down.addEventListener('click', () => {
      AC.state.mutate((pp) => {
        const i = pp.blocks.findIndex((x) => x.id === block.id);
        if (i > 0) { const [b] = pp.blocks.splice(i, 1); pp.blocks.splice(i - 1, 0, b); }
      });
    });
    del.addEventListener('click', () => {
      AC.state.mutate((pp) => { pp.blocks = pp.blocks.filter((x) => x.id !== block.id); });
      AC.stage.setSelected(null);
    });
    zRow.appendChild(up); zRow.appendChild(down); zRow.appendChild(del);
    body.appendChild(zRow);
    _inspBuilding = false;
  }

  /* in-place value sync while typing in inputs */
  function syncInspectorValues() {
    const p = AC.state.current();
    const selId = AC.stage.selected();
    const block = p.blocks.find((b) => b.id === selId);
    if (!block) return;
    const body = document.getElementById('inspBody');
    const inputs = body.querySelectorAll('input, textarea, select');
    inputs.forEach((i) => {
      if (document.activeElement === i) return;
      const row = i.closest('.f-row');
      if (!row) return;
      const label = row.querySelector('label')?.textContent;
      const val = row.querySelector('.val');
      if (label === 'Position X (%)') i.value = Math.round(block.x * 100);
      else if (label === 'Position Y (%)') i.value = Math.round(block.y * 100);
      else if (label === 'Width (%)') i.value = Math.round(block.w * 100);
      else if (label === 'Height (%)') i.value = Math.round(block.h * 100);
      else if (label === 'Text' && i.tagName === 'TEXTAREA') i.value = block.text;
      else if (label === 'Opacity' && val) val.textContent = (block.opacity ?? 0.5).toFixed(2);
    });
  }

  /* ═══════════ wiring ═══════════ */
  function init() {
    initTabs();
    renderTemplates();
    renderBlocks();
    renderWFChips();
    renderBG();

    document.getElementById('btnBgImage').addEventListener('click', () => document.getElementById('fileBgImage').click());
    document.getElementById('btnBgImageClear').addEventListener('click', () => AC.state.mutate((pp) => { pp.bg.type = 'aurora'; pp.bg.assetId = null; }));
    document.getElementById('fileBgImage').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try {
        const img = await AC.assets.loadImageFile(f);
        AC.assets.getImage(img.id).then(() => { AC.state.mutate((pp) => { pp.bg.type = 'image'; pp.bg.assetId = img.id; }); });
      } catch (e) { U.toast('Image failed to load', 'bad'); }
      ev.target.value = '';
    });
    document.getElementById('fileCover').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      const selId = AC.stage.selected();
      if (!f || !selId) return;
      try {
        const img = await AC.assets.loadImageFile(f);
        AC.assets.getImage(img.id).then(() => {
          AC.state.mutate((pp) => { const b = pp.blocks.find((x) => x.id === selId); if (b) b.assetId = img.id; });
          buildInspector();
        });
      } catch (e) { U.toast('Image failed to load', 'bad'); }
      ev.target.value = '';
    });

    AC.state.onChange(() => {
      renderBlocks();
      renderBG();
      if (!_inspBuilding) {
        const selId = AC.stage.selected();
        const still = AC.state.current().blocks.find((b) => b.id === selId);
        if (!still) { AC.stage.setSelected(null); buildInspector(); }
        else if (document.activeElement && document.activeElement.closest('#inspBody')) syncInspectorValues();
        else buildInspector();
      }
    });
    AC.stage.onEvent((ev) => { if (ev === 'select') buildInspector(); });
  }

  function renderAll() { renderTemplates(); renderBlocks(); renderWFChips(); renderBG(); buildInspector(); }

  return { init, renderAll, buildInspector };
})();
