/* Earthmove UI: setup screen, road view, playback, tables, results, save/load. */
(function () {
  'use strict';
  const E = Engine, M = Model, MOD = Modules;
  const $ = id => document.getElementById(id);
  const STORE = 'earthmove.scenario.v1';
  MOD.setBuilt(['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'C4', 'C5', 'D1', 'D2', 'D3', 'D4', 'D5', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']); // modules built so far
  const modOn = id => !!(MOD.byId[id] && MOD.byId[id].built && scn.setup.modules[id]);
  const anySite = () => ['C1', 'C2', 'C3', 'C4', 'C5', 'D4'].some(modOn); // site constraints and calendar (the D3 target dates live in the Sections table)
  const anyCommercial = () => ['E1', 'E2', 'E4'].some(modOn); // cost, carbon and the programme export
  const anyRisk = () => ['D1', 'D2'].some(modOn); // weather and risk
  const anyA = () => ['A1', 'A2', 'A3', 'A4', 'A5'].some(modOn); // any materials module on
  const matName = id => { const m = (scn.materials || []).find(x => x.id === id); return m ? (m.name || m.id) : id; };
  const matCol = id => { const m = (scn.materials || []).find(x => x.id === id); return m ? m.colour : null; };

  function h(tag, attrs) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') e[k] = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]).flat(Infinity);
      for (const c of kids) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }
  const fmt = n => Math.round(n).toLocaleString('en-GB');
  // Quantities from the engine are in tonnes; show them in the unit the user chose.
  // Input units (what quantities are typed in) and results units (what results are shown in) are separate. With A1 or A3 on every soil type has its own density,
  // so results are shown in tonnes, which is exact; otherwise results can be shown in tonnes or m³ (at the site density) whichever the inputs use.
  const noMatUnits = () => !(modOn('A1') || modOn('A3'));
  const resUnits = () => { const u = (scn.ui || {}).resUnits; if (!noMatUnits()) return 'tonnes'; if (u === 'tonnes' || u === 'm3') return u; return scn.settings.units === 'm3' ? 'm3' : 'tonnes'; };
  const UF = () => (resUnits() === 'm3' && +scn.settings.density > 0 ? +scn.settings.density : 1); // results factor: tonnes per displayed unit
  const RL = () => (resUnits() === 'm3' ? 'm³' : 't');
  const UL = () => (scn.settings.units === 'm3' ? 'm³' : 't'); // the unit quantities are typed in
  const Q = v => fmt(v / UF()), Q1 = v => fmt1(v / UF());
  const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('en-GB');

  // ---------- state ----------
  let scn, res = null, ser = null, trucks = null, issues = [], endT = 0, maxTrip = 0, maxTh = 1;
  const S = { skip: true, t: 0, playing: false, speedV: 45, zoom: 1, x0: 0, tab: 'sections', screen: 'main', last: 0, dirty: true, delta: null };

  function load() { try { const j = localStorage.getItem(STORE); if (j) return M.normalise(JSON.parse(j)); } catch (e) { } return null; }
  function autosave() { try { localStorage.setItem(STORE, JSON.stringify(scn)); } catch (e) { } }

  // ---------- recompute ----------
  let timer = null;
  function changed(structural) {
    clearTimeout(timer);
    timer = setTimeout(() => recompute(structural), 120);
  }
  function recompute(rebuildTable) {
    issues = M.validate(scn);
    const blocking = issues.some(i => i.level === 'error');
    if (blocking) { res = null; ser = null; trucks = null; endT = 0; }
    else {
      res = E.simulate(scn); ser = E.buildSeries(res); trucks = E.truckStats(res);
      endT = res.summary.endTime;
      maxTrip = 0; const L = res.log;
      for (let k = 0; k < res.n; k++) { const tr = L.tip[k] - L.depart[k]; if (tr > maxTrip) maxTrip = tr; }
      maxTh = 1; for (let i = 0; i < res.P.n; i++) maxTh = Math.max(maxTh, Math.abs(res.P.qty[i]) / res.P.len[i]);
    }
    S.t = Math.min(S.t, endT);
    $('modbadge').textContent = MOD.badgeText(scn) + '. ' + planText(); $('btnReplay').hidden = !modOn('E7');
    if ($('scnname') !== document.activeElement) $('scnname').value = scn.name;
    tcBuild(); tcLayout();
    renderBanner(); renderTabs(rebuildTable); updateClock(); S.dirty = true; autosave();
  }
  function allMessages() {
    const out = issues.slice();
    if (res) {
      const s = res.summary;
      if (s.unplacedSurplus > 0.5) out.push({ level: 'warn', text: 'Cut and fill do not balance: ' + Q(s.unplacedSurplus) + ' ' + RL() + ' of surplus soil has nowhere to go and is left over.' });
      if (s.unfilled > 0.5) out.push({ level: 'warn', text: 'Cut and fill do not balance: ' + Q(s.unfilled) + ' ' + RL() + ' of fill is still short at the end.' });
      if (s.stuck && s.unplacedSurplus > 0.5 && s.unfilled > 0.5) out.push({ level: 'error', text: 'Movement stopped with soil still to move on both sides. A fill section may never open or may be unreachable.' });
    }
    return out;
  }
  function renderBanner() {
    const b = $('banner'); b.replaceChildren();
    if (!res) { b.append(h('div', { class: 'note err' }, 'There are problems to fix before the model can run. See the Messages tab.')); return; }
    const s = res.summary;
    if (E.planStatus(scn) === 'stale') b.append(h('div', { class: 'note warn' }, 'The optimised plan was made for different inputs, so it is not being used. Press Optimise to make a new one.'));
    if (s.unplacedSurplus > 0.5) b.append(h('div', { class: 'note warn' }, '⚠ Does not balance: ' + Q(s.unplacedSurplus) + ' ' + RL() + ' of surplus is left over (total cut ' + Q(s.totalCut) + ' ' + RL() + ', total fill ' + Q(s.totalFill) + ' ' + RL() + ').'));
    if (s.unfilled > 0.5) b.append(h('div', { class: 'note warn' }, '⚠ Does not balance: ' + Q(s.unfilled) + ' ' + RL() + ' short (total cut ' + Q(s.totalCut) + ' ' + RL() + ', total fill ' + Q(s.totalFill) + ' ' + RL() + ').'));
  }

  // ---------- screens ----------
  function showScreen(name) {
    S.screen = name;
    $('screenSetup').hidden = name !== 'setup'; $('screenMain').hidden = name !== 'main';
    if (name === 'setup') renderSetup(); else { S.dirty = true; }
    tcLayout();
    $('btnSetup').textContent = name === 'setup' ? 'Back to model' : 'Setup';
  }

  // ---------- setup screen ----------
  function sumCompletion(sc) {
    if (M.validate(sc).some(i => i.level === 'error')) return null;
    const r = E.simulate(sc); return r.summary.completion === null ? null : E.fmtTime(r.summary.completion, r.P.startDay);
  }
  function applyChange(fn) {
    const before = sumCompletion(scn);
    fn();
    const after = sumCompletion(scn);
    S.delta = { before, after };
    recompute(); renderSetup();
  }
  function setLevel(lv) {
    applyChange(() => {
      scn.setup.level = lv;
      const ids = MOD.LEVELS[lv].ids;
      if (ids) MOD.list.forEach(m => { if (m.built) scn.setup.modules[m.id] = ids.indexOf(m.id) >= 0; });
    });
  }
  function toggleModule(m, on) {
    applyChange(() => { scn.setup.modules[m.id] = on; scn.setup.level = 'custom'; });
  }
  function renderSetup() {
    const el = $('screenSetup'); el.replaceChildren();
    el.append(h('h2', {}, 'How detailed should the model be?'),
      h('p', {}, 'Choose a level, then adjust individual modules if you like. Anything you switch off is hidden but never deleted, so your entries come back when you switch it on again.'));
    const cards = h('div', { class: 'cards' });
    for (const k of ['simple', 'standard', 'detailed', 'custom']) {
      const lv = MOD.LEVELS[k];
      cards.append(h('div', { class: 'card' + (scn.setup.level === k ? ' sel' : ''), onclick: () => (k === 'custom' ? applyChange(() => (scn.setup.level = 'custom')) : setLevel(k)) },
        h('h3', {}, lv.label), h('p', {}, lv.blurb),
        lv.ids && lv.ids.length && k !== 'detailed' ? h('p', {}, 'Includes: ' + lv.ids.join(', ')) : null));
    }
    el.append(cards);
    if (S.delta) {
      const d = S.delta;
      el.append(h('div', { class: 'delta' }, d.before === d.after ? 'No change to the results: completion stays ' + (d.after || 'unknown') + '.'
        : 'Completion date changed: ' + (d.before || 'not complete') + ' → ' + (d.after || 'not complete') + '.'));
    }
    const nBuilt = MOD.list.filter(m => m.built).length;
    if (!nBuilt) el.append(h('div', { class: 'note' }, 'No optional modules are built yet. They are listed below so you can see what is coming, and each becomes tickable in its phase. For now every level runs the core model.'));
    // needs attention
    const att = [];
    MOD.list.forEach(m => { if (m.built && scn.setup.modules[m.id] && m.validate) m.validate(scn).forEach(x => att.push(x)); });
    el.append(h('div', { class: 'group' }, h('h4', {}, 'Needs filling in'),
      att.length ? att.map(x => h('span', { class: 'msg warn' }, x.text, x.cell ? h('a', { onclick: () => focusCell(x.cell) }, 'Go to it') : null)) : h('span', { class: 'msg info' }, 'Nothing: every active module has what it needs.')));
    for (const g in MOD.GROUPS) {
      const grp = h('div', { class: 'group' }, h('h4', {}, MOD.GROUPS[g]));
      MOD.list.filter(m => m.group === g).forEach(m => {
        const inLevel = MOD.LEVELS[scn.setup.level] && MOD.LEVELS[scn.setup.level].ids && MOD.LEVELS[scn.setup.level].ids.indexOf(m.id) >= 0;
        grp.append(h('div', { class: 'mod' },
          h('input', { type: 'checkbox', checked: !!(m.built && scn.setup.modules[m.id]), disabled: !m.built, onchange: ev => toggleModule(m, ev.target.checked) }),
          h('div', { class: 'nm' }, m.id + '  ' + m.name, m.built ? null : h('span', { class: 'tag' }, 'not built yet (phase ' + m.phase + ')'), !m.built && inLevel ? h('span', { class: 'tag' }, 'in this level once built') : null),
          h('div', { class: 'ds' }, m.desc), h('div', { class: 'nd' }, 'You will need: ' + m.needs)));
      });
      el.append(grp);
    }
    el.append(h('p', {}, h('button', { class: 'primary', onclick: () => showScreen('main') }, 'Go to the model')));
  }

  // ---------- playback ----------
  const speedMps = () => 60 * Math.pow(1344, S.speedV / 100); // 1 h/s .. 8 weeks/s
  function speedLabel() {
    const m = speedMps();
    if (m < 1440) return fmt1(m / 60) + ' h / s';
    if (m < 10080) return fmt1(m / 1440) + ' days / s';
    return fmt1(m / 10080) + ' weeks / s';
  }
  function updateClock() {
    if (!res) { $('clock').replaceChildren(h('span', {}, 'Fix problems to run')); $('counter').replaceChildren(); return; }
    const P = res.P, day = Math.floor(S.t / 1440);
    $('clock').replaceChildren(h('span', {}, E.fmtTime(S.t, P.startDay)), h('small', {}, E.DOW_NAMES[E.dowOf(P.startDay + day)] + ', day ' + (day + 1) + (S.t >= endT && endT > 0 ? ', finished' : '')));
    const started = E.startedBy(res, S.t), before = E.startedBy(res, day * 1440 - 1), used = started - before;
    let tn = 0; for (let k = 0; k < started; k++) tn += res.log.t[k];
    $('counter').replaceChildren(h('div', {}, 'Movements today ', h('b', {}, used + ' / ' + P.cap)),
      h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.min(100, used / P.cap * 100) + '%' })),
      h('div', {}, 'Trucks working now ', h('b', {}, E.trucksAt(trucks, S.t)), ' (peak today ' + (trucks.dayPeak[day] || 0) + ', whole job ' + trucks.peak + (res.summary.fleetSize ? ', fleet ' + res.summary.fleetSize : '') + ')'),
      h('small', {}, 'Total so far: ' + fmt(started) + ' loads, ' + Q(tn) + ' ' + RL() + ''));
  }
  function setPlaying(on) { S.playing = on; $('bPlay').textContent = on ? '⏸' : '▶'; S.last = performance.now(); }
  function seek(t) { S.t = Math.max(0, Math.min(endT, t)); updateClock(); S.dirty = true; }
  function frame(ts) {
    if (S.playing && res) {
      const dt = Math.min(0.1, (ts - S.last) / 1000);
      S.t += dt * speedMps();
      if (S.skip) S.t = E.nextActive(res, S.t);
      if (S.t >= endT) { S.t = endT; setPlaying(false); }
      updateClock(); S.dirty = true;
    }
    S.last = ts;
    if (S.dirty && S.screen === 'main') { S.dirty = false; drawRoad(); drawOverview(); drawChart(); drawTC(); if (S.tab === 'masshaul') drawMH(); }
    requestAnimationFrame(frame);
  }

  // ---------- drawing ----------
  let COL = null;
  function colours() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    COL = { sky: g('--sky'), earth: g('--earth'), sand: g('--sand'), sand2: g('--sand2'), accent: g('--accent'), accent2: g('--accent2'), ink: g('--ink'), mute: g('--mute'), line: g('--line'), err: g('--err'), panel: g('--panel') };
  }
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colours(); S.dirty = true; });
  function size(cv) {
    const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr), hh = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }
  const hatchCv = (() => { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.strokeStyle = 'rgba(179,38,30,.8)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke(); return c; })();
  const PAD = 40;
  function geom() {
    const cv = $('road'), W = cv.clientWidth, P = res.P;
    const fit = (W - 2 * PAD) / P.total, ppm = fit * S.zoom, vis = (W - 2 * PAD) / ppm;
    S.x0 = Math.max(0, Math.min(S.x0, P.total - vis));
    return { W, H: cv.clientHeight, ppm, vis };
  }
  function trap(ctx, x, w, y0, dy) {
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + 0.12 * w, y0 + dy); ctx.lineTo(x + 0.88 * w, y0 + dy); ctx.lineTo(x + w, y0); ctx.closePath();
  }
  function hash(k) { let x = (k + 1) * 2654435761 % 4294967296; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; return (x % 1000) / 1000; }
  function drawRoad() {
    if (!COL) colours();
    const cv = $('road'), ctx = size(cv), W = cv.clientWidth, H = cv.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (!res) { ctx.fillStyle = COL.mute; ctx.font = '15px system-ui'; ctx.fillText('Fix the problems listed under Messages to see the road.', 20, 40); return; }
    const P = res.P, g = geom(), ppm = g.ppm, base = Math.round(H * 0.58);
    const X = m => PAD + (m - S.x0) * ppm, kth = 95 / maxTh;
    const day = Math.floor(S.t / 1440);
    ctx.fillStyle = COL.earth; ctx.fillRect(0, base, W, H - base);
    // chainage ticks
    const stepM = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(s => s * ppm >= 70) || 5000;
    ctx.fillStyle = COL.mute; ctx.font = '11px system-ui'; ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    for (let m = Math.ceil(S.x0 / stepM) * stepM; m <= S.x0 + g.vis + 1; m += stepM) {
      const x = Math.round(X(m)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, base); ctx.stroke();
      ctx.fillText('Ch ' + (m / 1000).toFixed(m % 1000 ? 2 : 1) + ' km', x + 3, 14);
    }
    // sections
    const hits = [];
    for (let i = 0; i < P.n; i++) {
      const sx = X(P.chain[i]), sw = P.len[i] * ppm;
      if (sx + sw < 0 || sx > W) continue;
      const q = P.qty[i];
      const rem = E.remainingAt(ser, i, S.t);
      if (q > 0) {
        const th0 = q / P.len[i] * kth, th = rem / P.len[i] * kth;
        ctx.setLineDash([4, 3]); ctx.strokeStyle = COL.sand2; ctx.lineWidth = 1; trap(ctx, sx, sw, base, -th0); ctx.stroke(); ctx.setLineDash([]);
        if (th > 0.3) { ctx.fillStyle = COL.sand; trap(ctx, sx, sw, base, -th); ctx.fill(); ctx.strokeStyle = COL.sand2; ctx.stroke(); }
      } else if (q < 0) {
        const th0 = -q / P.len[i] * kth, th = rem / P.len[i] * kth;
        ctx.save(); trap(ctx, sx, sw, base, th0); ctx.clip();
        ctx.fillStyle = COL.sky; ctx.fillRect(sx, base, sw, th0 + 1);
        ctx.fillStyle = COL.sand; ctx.fillRect(sx, base + th, sw, th0 - th + 1);
        ctx.restore();
        ctx.strokeStyle = COL.accent2; ctx.lineWidth = 1.2; trap(ctx, sx, sw, base, th0); ctx.stroke();
        if (P.openDay[i] > day) {
          ctx.save(); trap(ctx, sx, sw, base, th0); ctx.clip();
          ctx.fillStyle = ctx.createPattern(hatchCv, 'repeat'); ctx.fillRect(sx, base - 70, sw, th0 + 72);
          ctx.restore();
          ctx.fillStyle = COL.err; ctx.font = 'bold 11px system-ui';
          const lab = 'Opens ' + E.fmtDay(P.startDay + P.openDay[i]);
          if (sw > 70) ctx.fillText(lab, sx + 4, base - 6); else if (sw > 24) ctx.fillText('🔒', sx + 3, base - 6);
        }
      }
      ctx.fillStyle = '#f3ead8'; ctx.font = '11px system-ui';
      ctx.save(); ctx.beginPath(); ctx.rect(sx, base + 100, sw - 2, H - base - 100); ctx.clip();
      ctx.fillText(P.names[i], sx + 3, base + 114);
      ctx.fillStyle = '#cdbf9f'; ctx.fillText(q === 0 ? 'no soil' : (q > 0 ? '+' : '−') + Q(rem) + ' ' + RL() + '', sx + 3, base + 128);
      ctx.restore();
      ctx.strokeStyle = COL.line; ctx.beginPath(); ctx.moveTo(sx + 0.5, base); ctx.lineTo(sx + 0.5, H); ctx.stroke();
      hits.push({ i, sx, sw, rem });
    }
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(W, base); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.ink; ctx.font = 'italic 11px system-ui'; ctx.fillText('finished level', 4, base - 3);
    cv._hits = hits;
    if (P.cal && P.cal.dayOff[Math.floor(S.t / 1440)]) { ctx.fillStyle = COL.err; ctx.font = 'bold 12px system-ui'; ctx.fillText('Day off: bank holiday, shutdown or weather', Math.max(8, W - 290), 14); }
    P.nodeIdx.forEach((x, k) => { // off-site gates (A4) and stockpiles (A5) sit on the road at their chainage
      const px = X(P.chain[x]); if (px < -30 || px > W + 30) return;
      const kind = P.kind[x], col = kind === 1 ? COL.accent : kind === 2 ? COL.err : COL.accent2, y0 = 26 + (k % 3) * 13;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, base); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); if (kind === 3) { ctx.moveTo(px, base - 12); ctx.lineTo(px - 7, base); ctx.lineTo(px + 7, base); } else if (kind === 1) { ctx.moveTo(px - 6, y0 - 5); ctx.lineTo(px + 6, y0 - 5); ctx.lineTo(px, y0 + 4); } else { ctx.moveTo(px - 6, y0 + 4); ctx.lineTo(px + 6, y0 + 4); ctx.lineTo(px, y0 - 5); } ctx.closePath(); ctx.fill();
      ctx.font = '10px system-ui'; ctx.fillText((kind === 1 ? 'Import: ' : kind === 2 ? 'Export: ' : 'Stockpile: ') + P.names[x], px + 8, y0 + 3);
    });
    if (P.con) { // site constraints (C1-C5): blockages, closed sections and single-lane stretches, with their dates
      ctx.font = '10px system-ui'; const dn = Math.floor(S.t / 1440);
      (P.con.blocks || []).forEach((bk, k) => {
        const px = X(bk.x); if (px < -30 || px > W + 30) return; const open = S.t >= bk.openAbs;
        ctx.strokeStyle = ctx.fillStyle = open ? COL.mute : COL.err; ctx.lineWidth = open ? 1 : 3; ctx.setLineDash(open ? [3, 3] : []);
        ctx.beginPath(); ctx.moveTo(px, base - 60); ctx.lineTo(px, base + 20); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText((open ? 'Open since ' : 'Blocked until ') + E.fmtDay(P.startDay + Math.floor(bk.openAbs / 1440)), px + 5, base - 50 - (k % 2) * 11);
      });
      (P.con.lanes || []).forEach(ln => {
        const x1 = X(ln.a), x2 = X(ln.b); if (x2 < 0 || x1 > W) return;
        ctx.strokeStyle = ctx.fillStyle = COL.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x1, base + 8); ctx.lineTo(x2, base + 8); ctx.stroke();
        ctx.fillText('Single lane: ' + (ln.alt ? 'alternating, ' + ln.phase + ' min phases' : ln.perHour + ' lorries per hour'), Math.max(x1, 2) + 3, base + 21);
      });
      if (P.con.closed) for (let i = 0; i < P.n; i++) {
        const r = P.con.closed[i], hit = r && r.find(q => dn >= q[0] && dn < q[1]); if (!hit) continue;
        const sx = X(P.chain[i]), sw = P.len[i] * ppm; if (sx + sw < 0 || sx > W) continue;
        ctx.globalAlpha = 0.6; ctx.fillStyle = ctx.createPattern(hatchCv, 'repeat'); ctx.fillRect(sx, base - 70, sw, 70); ctx.globalAlpha = 1;
        ctx.fillStyle = COL.err; ctx.font = 'bold 10px system-ui'; ctx.fillText(hit[1] === Infinity ? 'Closed for good' : 'Closed until ' + E.fmtDay(P.startDay + hit[1]), sx + 3, base - 74);
      }
    }
    // soil in transit
    const L = res.log, hi = E.upperBound(L.depart, S.t), lo = E.upperBound(L.depart, S.t - maxTrip - 1);
    const mps = speedMps(), bandMode = S.playing && mps > 720;
    if (!bandMode) {
      const cand = []; for (let k = lo; k < hi; k++) if (L.tip[k] > S.t) cand.push(k);
      const stride = Math.max(1, Math.ceil(cand.length / 2500));
      ctx.fillStyle = COL.sand2;
      for (let c = 0; c < cand.length; c += stride) {
        const k = cand[c], a = P.mid[L.src[k]], b = P.mid[L.dst[k]], f = (S.t - L.depart[k]) / (L.tip[k] - L.depart[k]);
        if (res.mlog) ctx.fillStyle = matCol(res.mlog.mat[k]) || COL.sand2; // grains take the colour of their soil class (A2)
        const x = X(a + (b - a) * f); if (x < -5 || x > W + 5) continue;
        const grains = Math.max(2, Math.round(L.t[k] / 3 / stride));
        for (let q = 0; q < grains; q++) ctx.fillRect(x + (hash(k * 7 + q) - 0.5) * 16, base - 3 - hash(k * 13 + q) * 14, 3, 3);
      }
    } else {
      const w = Math.max(maxTrip, mps * 0.5), lo2 = E.upperBound(L.depart, S.t - w), n2 = hi - lo2;
      const stride = Math.max(1, Math.ceil(n2 / 1800));
      ctx.strokeStyle = COL.sand2; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.globalAlpha = Math.min(0.5, 0.05 + 0.5 * stride / Math.max(stride, 8));
      ctx.setLineDash([1, 7]);
      for (let k = lo2; k < hi; k += stride) {
        const y = base - 6 - hash(k) * 12;
        ctx.beginPath(); ctx.moveTo(X(P.mid[L.src[k]]), y); ctx.lineTo(X(P.mid[L.dst[k]]), y); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
  }
  function drawOverview() {
    if (!COL) colours();
    const cv = $('overview'), ctx = size(cv), W = cv.clientWidth, H = cv.clientHeight;
    ctx.clearRect(0, 0, W, H); if (!res) return;
    const P = res.P, sc = (W - 8) / P.total, base = H * 0.55;
    for (let i = 0; i < P.n; i++) {
      const q = P.qty[i]; if (!q) continue;
      const rem = E.remainingAt(ser, i, S.t), x = 4 + P.chain[i] * sc, w = Math.max(1, P.len[i] * sc - 1);
      const hh = Math.max(1, Math.abs(q) / P.len[i] / maxTh * (H * 0.45)), rr = rem / Math.abs(q);
      if (q > 0) { ctx.fillStyle = COL.sand; ctx.fillRect(x, base - hh * rr, w, hh * rr); }
      else { ctx.fillStyle = COL.accent2; ctx.globalAlpha = 0.25; ctx.fillRect(x, base, w, hh); ctx.globalAlpha = 1; ctx.fillStyle = COL.sand; ctx.fillRect(x, base + hh * rr, w, hh * (1 - rr)); }
    }
    ctx.strokeStyle = COL.ink; ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(W, base); ctx.stroke();
    const g = geom(), x1 = 4 + S.x0 * sc, w1 = g.vis * sc;
    ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.strokeRect(x1, 2, Math.min(w1, W - 4 - x1), H - 4);
  }
  function drawChart() {
    if (!COL) colours();
    const cv = $('chart'), ctx = size(cv), W = cv.clientWidth, H = cv.clientHeight;
    ctx.clearRect(0, 0, W, H); if (!res) return;
    const d = res.daily, n = Math.max(d.length, 1), cap = res.P.cap, l = 40, b = 18, t = 16, cw = W - l - 40, ch = H - b - t;
    const top = Math.max(cap, ...d), yy = v => t + ch - v / top * ch;
    ctx.fillStyle = COL.mute; ctx.font = '11px system-ui';
    ctx.fillText('0', l - 14, t + ch); ctx.fillText(String(top), l - 8 - 7 * String(top).length, t + 8);
    const curDay = Math.floor(S.t / 1440), bw = Math.max(1, cw / n - (cw / n > 4 ? 1 : 0));
    for (let i = 0; i < d.length; i++) {
      ctx.fillStyle = i === curDay ? COL.ink : (i < curDay ? COL.accent2 : COL.line);
      const x = l + i * cw / n; ctx.fillRect(x, yy(d[i]), bw, t + ch - yy(d[i]));
    }
    ctx.strokeStyle = COL.err; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(l, yy(cap)); ctx.lineTo(l + cw, yy(cap)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.err; ctx.fillText('limit ' + cap + '/day', l + 4, yy(cap) - 3);
    if (trucks && trucks.peak > 0) {
      const tp = trucks.peak, yt = v => t + ch - v / tp * ch;
      ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = l + (i + 0.5) * cw / n, y = yt(trucks.dayPeak[i] || 0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = COL.accent; ctx.fillText(String(tp), l + cw + 5, t + 8); ctx.fillText('0', l + cw + 5, t + ch); ctx.fillText('trucks', l + cw + 5, t + ch / 2);
    }
    const px = l + (S.t / 1440) * cw / n; ctx.strokeStyle = COL.ink; ctx.beginPath(); ctx.moveTo(px, t); ctx.lineTo(px, t + ch); ctx.stroke();
    ctx.fillStyle = COL.mute; ctx.fillText('start', l, H - 4); ctx.fillText(E.fmtDay(res.P.startDay + n - 1), W - 74, H - 4);
    cv._geom = { l, cw, n };
  }

  // ---------- road interaction ----------
  (function () {
    const cv = $('road'); let drag = null;
    cv.addEventListener('pointerdown', e => { if (!res) return; drag = { x: e.clientX, x0: S.x0 }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!res) return;
      if (drag) { S.x0 = drag.x0 - (e.clientX - drag.x) / geom().ppm; S.dirty = true; return; }
      const g = geom(), r = cv.getBoundingClientRect(), m = S.x0 + (e.clientX - r.left - PAD) / g.ppm;
      const hit = (cv._hits || []).find(s => m >= res.P.chain[s.i] && m < res.P.chain[s.i] + res.P.len[s.i]);
      cv.title = hit ? res.P.names[hit.i] + ': ' + Q(res.P.qty[hit.i]) + ' ' + RL() + ' to start, ' + Q(hit.rem) + ' ' + RL() + ' remaining' : '';
    });
    cv.addEventListener('pointerup', () => (drag = null));
    cv.addEventListener('wheel', e => { if (!res) return; e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - cv.getBoundingClientRect().left); }, { passive: false });
    function zoomAt(f, px) {
      const g = geom(), mAt = S.x0 + (px - PAD) / g.ppm;
      S.zoom = Math.max(1, Math.min(60, S.zoom * f));
      const g2 = geom(); S.x0 = mAt - (px - PAD) / g2.ppm; S.dirty = true;
    }
    $('zIn').onclick = () => res && zoomAt(1.5, $('road').clientWidth / 2);
    $('zOut').onclick = () => res && zoomAt(1 / 1.5, $('road').clientWidth / 2);
    $('zFit').onclick = () => { S.zoom = 1; S.x0 = 0; S.dirty = true; };
    const ov = $('overview'); let od = false;
    const ovMove = e => { if (!res) return; const r = ov.getBoundingClientRect(), g = geom(), sc = (r.width - 8) / res.P.total; S.x0 = (e.clientX - r.left - 4) / sc - g.vis / 2; S.dirty = true; };
    ov.addEventListener('pointerdown', e => { od = true; ov.setPointerCapture(e.pointerId); ovMove(e); });
    ov.addEventListener('pointermove', e => od && ovMove(e)); ov.addEventListener('pointerup', () => (od = false));
    $('chart').addEventListener('click', e => {
      const c = $('chart'), g = c._geom; if (!g || !res) return;
      const x = e.clientX - c.getBoundingClientRect().left; seek(Math.floor((x - g.l) / g.cw * g.n) * 1440 + 420);
    });
  })();

  // ---------- tabs ----------
  const tabsList = () => [['sections', 'Sections']].concat(['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].some(modOn) ? [['fleet', 'Fleet & plant']] : [], anyA() ? [['materials', 'Materials & sites']] : [], anySite() ? [['site', 'Site & calendar']] : [], anyRisk() ? [['risk', 'Weather & risk']] : [], anyCommercial() ? [['commercial', 'Cost & carbon']] : [], M.rateFieldsOn(scn).length ? [['rates', M.defaultRates(scn).length ? 'Default rates (' + M.defaultRates(scn).length + ')' : 'Rates']] : [], modOn('E6') ? [['actuals', 'Actual progress']] : [], modOn('E3') ? [['masshaul', 'Mass haul']] : [], [['results', 'Results'], ['log', 'Movement log']]).concat(MOD.activeIds(scn).indexOf('D5') >= 0 ? [['scenarios', 'Scenarios']] : [], [['messages', 'Messages']]);
  function renderTabs(rebuildTable) {
    const tabs = $('tabs'); tabs.replaceChildren();
    const nMsg = allMessages().filter(m => m.level !== 'info').length;
    if (!tabsList().some(t => t[0] === S.tab)) S.tab = 'sections';
    tabsList().forEach(([k, label]) => tabs.append(h('button', { class: S.tab === k ? 'on' : '', onclick: () => { S.tab = k; renderTabs(true); } }, label, k === 'messages' && nMsg ? h('span', { class: 'cnt' }, nMsg) : null)));
    const body = $('tabbody');
    if (S.tab === 'sections') { if (rebuildTable || !body.firstChild || !body.querySelector('#sectable')) renderSections(); else updateChainage(); }
    else if (S.tab === 'fleet') { if (rebuildTable || !body.querySelector('#fleetpane')) renderFleet(); }
    else if (S.tab === 'commercial') { if (rebuildTable || !body.querySelector('#compane')) renderCommercial(); }
    else if (S.tab === 'rates') renderRates();
    else if (S.tab === 'actuals') renderActuals();
    else if (S.tab === 'masshaul') renderMassHaul();
    else if (S.tab === 'risk') { if (rebuildTable || !body.querySelector('#riskpane')) renderRisk(); }
    else if (S.tab === 'site') { if (rebuildTable || !body.querySelector('#sitepane')) renderSite(); }
    else if (S.tab === 'materials') { if (rebuildTable || !body.querySelector('#matpane')) renderMaterials(); }
    else if (S.tab === 'results') renderResults();
    else if (S.tab === 'log') renderLog();
    else if (S.tab === 'scenarios') renderScenarios();
    else renderMessages();
    markDefaults(body);
  }
  const SETTINGS = [['startDate', 'Project start date', 'date'], ['speedKph', 'Average travel speed (kph)', 'number'], ['loadTonnes', 'Average load (tonnes)', 'number'], ['loadMinutes', 'Loading time per lorry (min)', 'number'], ['maxMovesPerDay', 'Max movements per day (whole site)', 'number']];
  function bindNum(inp, obj, key) { inp.addEventListener('input', () => { obj[key] = inp.value === '' ? NaN : +inp.value; changed(false); }); }
  function renderSections() {
    const body = $('tabbody'); body.replaceChildren();
    const st = h('div', { class: 'settings' });
    SETTINGS.forEach(([k, label0, type]) => {
      const label = k === 'loadTonnes' ? 'Average load (' + (UL() === 't' ? 'tonnes' : 'm\u00b3') + ')' : label0;
      const inp = h('input', { type, value: scn.settings[k], 'data-cell': 'settings:' + k, step: 'any' });
      if (type === 'date') inp.addEventListener('input', () => { scn.settings[k] = inp.value; changed(false); }); else bindNum(inp, scn.settings, k);
      st.append(h('div', {}, h('label', {}, label), inp));
    });
    const usel = h('select', { 'data-cell': 'settings:units', onchange: ev => { M.setUnits(scn, ev.target.value); recompute(true); } },
      h('option', { value: 'tonnes', selected: scn.settings.units !== 'm3' }, 'Tonnes'), h('option', { value: 'm3', selected: scn.settings.units === 'm3' }, 'Cubic metres (m\u00b3)'));
    st.append(h('div', {}, h('label', {}, 'Quantities in'), usel));
    if (scn.settings.units === 'm3') {
      const dn = h('input', { type: 'number', value: scn.settings.density, step: 'any', 'data-cell': 'settings:density' }); bindNum(dn, scn.settings, 'density');
      st.append(h('div', {}, h('label', {}, 'Soil density (tonnes per m\u00b3)'), dn));
    }
    body.append(h('h3', {}, 'Global settings'), st);
    if (modOn('E5')) body.append(importPanel());
    const b3v = modOn('B3') && scn.modules.B3.mode === 'bySection', b4v = modOn('B4') && scn.modules.B4.mode === 'bySection', b5m = modOn('B5') && scn.modules.B5.mode === 'byMachine';
    const heads = [['#'], ['Name'], ['Length (m)', 1], [anyA() ? 'Soil (' + UL() + '): + cut, − fill, one line per soil type, dug top to bottom' : 'Soil (' + UL() + '): + surplus, − needs fill', 1], ['Loads start from'], ['to'], ['Earliest tipping date']];
    if (!b5m) heads.push(['Max loaders']);
    if (b3v) heads.push(['Speed limit (kph)', 1], ['Gradient factor, loaded', 1], ['Gradient factor, empty', 1]);
    if (b4v) heads.push(['Receiving rate (' + UL() + '/h)', 1], ['Tipping bays', 1]);
    const c4v = modOn('C4') && scn.modules.C4.mode === 'bySection', d3v = modOn('D3');
    if (c4v) heads.push(['Fill layers', 1], ['Wait between layers (days)', 1]);
    if (d3v) heads.push(['Target date']);
    heads.push(['Working days'], ['Chainage (m)', 1], ['']);
    const tb = h('tbody');
    scn.sections.forEach((s, i) => {
      const cell = (f, inp) => { inp.setAttribute('data-cell', s.id + ':' + f); return h('td', {}, inp); };
      const txt = (f, type, get, set) => { const inp = h('input', { type, value: get(), step: 'any' }); inp.addEventListener('input', () => { set(inp.value); changed(false); }); return cell(f, inp); };
      const num = v => (v === '' ? '' : +v);
      // per-section module inputs, stored by section id so they survive switching the module off
      const mo = (id, def) => () => (scn.modules[id].bySection[s.id] = scn.modules[id].bySection[s.id] || def);
      const msec = (id, f, key, ph, only) => {
        if (only === 'fill' && M.secQty(s) >= 0) return h('td', { class: 'num' }, '–');
        const o = (scn.modules[id].bySection || {})[s.id] || {};
        const inp = h('input', { type: 'number', value: o[key] === undefined ? '' : o[key], step: 'any', placeholder: ph || '' });
        inp.addEventListener('input', () => { mo(id, {})()[key] = num(inp.value); changed(false); });
        return cell(f, inp);
      };
      const linesCell = () => { // A1-A5: a section holds one line per soil type (cut lines positive, fill lines negative)
        const td = h('td', { class: 'lines', 'data-cell': s.id + ':qty' });
        s.lines.forEach((l, li) => {
          const sel = h('select', { title: 'Soil type', onchange: ev => { l.material = ev.target.value; recompute(true); } }, scn.materials.map(m => h('option', { value: m.id, selected: m.id === l.material }, m.name || m.id)));
          const inp = h('input', { type: 'number', value: l.qty, step: 'any', title: 'Quantity: + cut, − fill' }); inp.addEventListener('input', () => { l.qty = inp.value === '' ? NaN : +inp.value; changed(false); });
          td.append(h('div', { class: 'line' }, sel, inp, s.lines.length > 1 ? h('button', { class: 'icon', title: 'Remove this soil line', onclick: () => { s.lines.splice(li, 1); recompute(true); } }, '✕') : null));
        });
        td.append(h('button', { class: 'icon', title: 'Add a soil line', onclick: () => { s.lines.push({ material: scn.materials[0].id, qty: 0 }); recompute(true); } }, '+ line'));
        return td;
      };
      const days = h('td', { class: 'days', 'data-cell': s.id + ':workDays' });
      E.DOW_NAMES.forEach((dn, d) => days.append(h('label', {}, dn.slice(0, 2), h('br'), h('input', { type: 'checkbox', checked: !!s.workDays[d], onchange: ev => { s.workDays[d] = ev.target.checked ? 1 : 0; changed(false); } }))));
      const cells = [
        h('td', {}, i + 1),
        txt('name', 'text', () => s.name, v => (s.name = v)),
        txt('lengthM', 'number', () => s.lengthM, v => { s.lengthM = v === '' ? NaN : +v; updateChainage(); }),
        anyA() ? linesCell() : txt('qty', 'number', () => M.secQty(s), v => M.setQty(s, v === '' ? NaN : +v)),
        txt('workStart', 'time', () => s.workStart, v => (s.workStart = v)),
        txt('workEnd', 'time', () => s.workEnd, v => (s.workEnd = v)),
        txt('openFrom', 'date', () => s.openFrom, v => (s.openFrom = v))];
      if (!b5m) cells.push(txt('maxLoaders', 'number', () => s.maxLoaders, v => (s.maxLoaders = v === '' ? NaN : +v)));
      if (b3v) cells.push(msec('B3', 'b3limit', 'limitKph', 'none'), msec('B3', 'b3gl', 'gradLoaded', '1'), msec('B3', 'b3ge', 'gradEmpty', '1'));
      if (b4v) cells.push(msec('B4', 'b4rate', 'rate', String(scn.modules.B4.rate), 'fill'), msec('B4', 'b4bays', 'bays', String(scn.modules.B4.bays), 'fill'));
      if (c4v) cells.push(msec('C4', 'c4layers', 'layers', String(scn.modules.C4.layers), 'fill'), msec('C4', 'c4wait', 'waitDays', String(scn.modules.C4.waitDays), 'fill'));
      if (d3v) cells.push(txt('d3target', 'date', () => (scn.modules.D3.targets || {})[s.id] || '', v => { (scn.modules.D3.targets = scn.modules.D3.targets || {})[s.id] = v; }));
      cells.push(days, h('td', { class: 'num', 'data-ch': i }, ''),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'icon', title: 'Move up', onclick: () => moveSec(i, -1) }, '↑'), h('button', { class: 'icon', title: 'Move down', onclick: () => moveSec(i, 1) }, '↓'),
          h('button', { class: 'icon', title: 'Delete section', onclick: () => { if (confirm('Delete "' + s.name + '"?')) { scn.sections.splice(i, 1); recompute(true); } } }, '✕')));
      tb.append(h('tr', { 'data-row': s.id }, cells));
    });
    body.append(h('h3', {}, 'Sections (in road order, west to east)'),
      h('div', { class: 'scroll' }, h('table', { id: 'sectable' }, h('thead', {}, h('tr', {}, heads.map(c => h('th', { class: c[1] ? 'num' : '' }, c[0])))), tb)),
      h('p', {}, h('button', { onclick: () => { scn.sections.push(M.newSection(scn.sections.length)); recompute(true); } }, '+ Add section')));
    updateChainage();
  }
  function updateChainage() {
    let c = 0; scn.sections.forEach((s, i) => { const td = document.querySelector('td[data-ch="' + i + '"]'); if (td) td.textContent = isFinite(c) ? fmt(c) : ''; c += +s.lengthM; });
  }
  function moveSec(i, d) { const j = i + d; if (j < 0 || j >= scn.sections.length) return; const a = scn.sections; [a[i], a[j]] = [a[j], a[i]]; recompute(true); }
  function focusCell(cell) {
    showScreen('main'); S.tab = cell.mod ? (cell.mod[0] === 'A' ? 'materials' : /^D[12]$/.test(cell.mod) ? 'risk' : /^[CD]/.test(cell.mod) ? 'site' : /^E[124]$/.test(cell.mod) ? 'commercial' : cell.mod === 'E6' ? 'actuals' : 'fleet') : 'sections'; renderTabs(true);
    const key = cell.settings ? 'settings:' + cell.settings : cell.mod ? 'mod:' + cell.mod + ':' + cell.field : cell.sec + ':' + cell.field;
    const el = document.querySelector('[data-cell="' + key + '"]'); if (!el) return;
    const inp = el.matches('input') ? el : el.querySelector('input');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (inp) { inp.focus(); inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 2500); }
  }
  function renderMessages() {
    const body = $('tabbody'); body.replaceChildren();
    const ms = allMessages();
    if (!ms.length) body.append(h('div', { class: 'msg info' }, 'No problems found.'));
    ms.forEach(m => body.append(h('span', { class: 'msg ' + m.level }, (m.level === 'error' ? 'Problem: ' : m.level === 'warn' ? 'Check: ' : 'Note: ') + m.text, m.cell ? h('a', { onclick: () => focusCell(m.cell) }, 'Go to it') : null)));
  }
  function levelDate(t) { return t === null ? 'not reached' : E.fmtTime(t, res.P.startDay); }
  function renderResults() {
    const body = $('tabbody'); body.replaceChildren();
    if (!res) { body.append(h('div', { class: 'note err' }, 'Fix the problems under Messages first.')); return; }
    const s = res.summary, P = res.P, stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
    body.append(noMatUnits() ? h('p', { class: 'hint' }, 'Show results in ', h('select', { 'data-cell': 'settings:resUnits', onchange: ev => { scn.ui.resUnits = ev.target.value; recompute(true); } },
      h('option', { value: 'auto', selected: !['tonnes', 'm3'].includes(scn.ui.resUnits) }, 'the units I type quantities in'), h('option', { value: 'tonnes', selected: scn.ui.resUnits === 'tonnes' }, 'tonnes'), h('option', { value: 'm3', selected: scn.ui.resUnits === 'm3' }, 'cubic metres (at ' + scn.settings.density + ' t per m³)')), ' (this changes only how results are shown)')
      : h('p', { class: 'hint' }, 'Results are shown in tonnes, which is exact: each soil type has its own density.'));
    body.append(h('div', { class: 'note' }, MOD.badgeText(scn) + '. ' + planText()),
      h('div', { class: 'stats' },
        stat(s.completion === null ? 'Not complete' : E.fmtDay(P.startDay + s.completionDay), 'Overall completion'),
        stat(fmt(s.moves), 'Movements'), stat(Q(s.tonnesMoved) + ' ' + RL() + '', 'Soil moved'), stat(fmt(s.tonneKm) + ' t·km', 'Total tonne-km'),
        stat((s.utilisation * 100).toFixed(1) + '%', 'Avg use of daily limit (first to last move, working days)'),
        stat(s.idleDays + ' of ' + s.workingSpan, 'Idle working days'),
        stat(Q(s.totalCut) + ' / ' + Q(s.totalFill) + ' ' + RL() + '', 'Total cut / total fill'),
        stat((s.imbalance >= 0 ? '+' : '−') + Q(Math.abs(s.imbalance)) + ' ' + RL() + '', 'Balance (+ surplus, − short)')),
      h('h3', {}, 'Trucks needed'),
      h('div', { class: 'stats' },
        stat(String(trucks.peak), 'Peak trucks needed in a day' + (trucks.peakDay >= 0 ? ' (' + E.fmtDay(P.startDay + trucks.peakDay) + ')' : '')),
        stat(String(trucks.p95), 'Trucks to cover 95% of working days'),
        stat(trucks.median + ' median / ' + fmt1(trucks.mean) + ' mean', 'Daily peak trucks, working days'),
        stat(fmt(trucks.truckHours) + ' h', 'Total truck-hours (' + fmt1(trucks.activeDays ? trucks.truckHours / trucks.activeDays : 0) + ' h per working day)'),
        stat(Math.round(trucks.avgCycleMin) + ' min', 'Average truck cycle, load to back empty')),
      h('p', { class: 'hint' }, res.summary.fleetSize ? 'With a modelled fleet a lorry counts as busy from leaving for its loading point until it has tipped.' : 'A truck is counted from the start of loading until it is back at the loading point empty (the empty return is taken as long as the loaded trip). Lorries are unlimited here, so this is how many the plan would need, not a limit. Switch on B1 to set a fixed fleet.'));
    if (['B1', 'B2', 'B4', 'B5', 'B6'].some(modOn)) {
      const shift = P.srcs.length ? P.srcs.reduce((a, i) => a + (P.we[i] - P.ws[i]) / 60, 0) / P.srcs.length : 0;
      const cards = [];
      if (s.fleetSize) {
        cards.push(stat(fmt(s.fleetSize), 'Lorries in the fleet'), stat(String(trucks.peak), 'Most lorries in use at once in a day'),
          stat(trucks.activeDays && shift ? Math.round(trucks.truckHours / (s.fleetSize * trucks.activeDays * shift) * 100) + '%' : '\u2013', 'Fleet use (busy hours \u00f7 fleet hours on working days)'),
          stat(fmt(s.fleetDelayMin / 60) + ' h', 'Loading held up waiting for a lorry'));
      }
      if (modOn('B4')) cards.push(stat(fmt(s.tipWaitMin / 60) + ' h', 'Lorry time queuing to tip'));
      if (cards.length) body.append(h('h3', {}, 'Fleet and plant'), h('div', { class: 'stats' }, cards));
    }
    if (modOn('E1') || modOn('E2')) { // E1/E2: cost and carbon
      const cc = E.costCarbon(scn, res), money = v => '\u00a3' + fmt(v);
      if (cc) body.append(...[h('h3', {}, 'Cost and carbon'), rateNote(['cost', 'fuel'])].filter(Boolean), h('div', { class: 'stats' }, modOn('E1') ? [stat(money(cc.total), 'Total cost'), stat('\u00a3' + (cc.perTonne || 0).toFixed(2), 'Cost per tonne placed'), stat(money(cc.hire), 'Plant hire'), stat(money(cc.fuel), 'Fuel'), stat(money(cc.labour), 'Labour'), stat(money(cc.tip), 'Tip fees and purchases')] : null,
        modOn('E2') ? [stat(cc.co2t.toFixed(1) + ' t CO\u2082e', 'Carbon'), stat(fmt(cc.litres) + ' litres', 'Fuel burned')] : null, stat(fmt(cc.lorryH) + ' / ' + fmt(cc.excH) + ' / ' + fmt(cc.recvH) + ' h', 'Lorry / loader / receiving plant hours')));
    }
    if (modOn('D3')) { // D3: target dates
      const lt = E.lateness(scn, res);
      if (lt.length) body.append(...[h('h3', {}, 'Target dates'), h('div', { class: 'stats' }, stat(lt.filter(x => x.late).length + ' of ' + lt.length, 'Sections late against their target date')),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Section', 'Target date', 'Reaches level', 'Days late'].map((c, i) => h('th', { class: i === 3 ? 'num' : '' }, c)))),
          h('tbody', {}, lt.map(x => h('tr', {}, h('td', {}, x.name), h('td', {}, E.fmtDay(x.targetDay)), h('td', {}, x.reachedDay === null ? 'not reached' : E.fmtDay(x.reachedDay)),
            h('td', { class: 'num', style: x.late ? 'color:var(--err);font-weight:600' : '' }, x.daysLate === null ? 'late' : x.daysLate ? x.daysLate + ' late' : 'on time'))))))]);
      else body.append(h('p', { class: 'hint' }, 'Target dates (D3) is on, but no section has a target date yet. Enter them in the Sections table.'));
    }
    if (res.msum) { // A1-A5 results: what was placed, shipped and stored
      const m = res.msum, money = v => '£' + fmt(v), un = Object.keys(m.unplacedByMat).filter(k => m.unplacedByMat[k] > 0.5);
      body.append(...[h('h3', {}, 'Materials, imports and stockpiles'), h('div', { class: 'stats' },
        stat(fmt(m.placedT) + ' t', 'Soil placed in fills'), modOn('A4') ? stat(fmt(m.importT) + ' t', 'Imported (' + money(m.importCost) + ')') : null, modOn('A4') ? stat(fmt(m.exportT) + ' t', 'Exported (' + money(m.exportCost) + ')') : null,
        modOn('A5') ? stat(fmt(m.stockInT) + ' t in / ' + fmt(m.stockOutT) + ' t out', 'Stockpiles (handling ' + money(m.handleCost) + ')') : null, modOn('A5') && m.parkedT > 0.5 ? stat(fmt(m.parkedT) + ' t', 'Parked in a stockpile, nothing needs it') : null,
        stat(money(m.importCost + m.exportCost + m.handleCost), 'Import, export and handling cost')),
        un.length ? h('div', { class: 'note warn' }, 'Soil with nowhere to go: ' + un.map(k => matName(k) + ' ' + fmt(m.unplacedByMat[k]) + ' t').join(', ') + '. Allow it in a fill (Materials & sites), or add an export or a stockpile.') : null,
        m.nodes.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Site', 'Type', 'Tonnes', 'Cost'].map((c, i) => h('th', { class: i > 1 ? 'num' : '' }, c)))), h('tbody', {}, m.nodes.map(x => h('tr', {}, h('td', {}, x.name), h('td', {}, x.kind === 1 ? 'Import' : x.kind === 2 ? 'Export' : 'Stockpile (in ' + fmt(x.tonnes) + ', out ' + fmt(x.out) + ', left ' + fmt(x.closing) + ')'), h('td', { class: 'num' }, fmt(x.kind === 3 ? x.out : x.tonnes) + ' t'), h('td', { class: 'num' }, money(x.cost))))))) : null].filter(Boolean));
    }
    const name = i => P.names[i], list = o => Object.keys(o).map(k => name(+k) + ' (' + Q(o[k]) + ' ' + RL() + ')').join('; ');
    const tb = h('tbody');
    res.sections.forEach((r, i) => {
      tb.append(h('tr', {}, h('td', {}, name(i)), h('td', { class: r.type }, r.type === 'cut' ? 'Cut' : r.type === 'fill' ? 'Fill' : 'No soil'),
        h('td', { class: 'num' }, r.qty ? (r.qty > 0 ? '+' : '−') + Q(Math.abs(r.qty)) : '0'),
        modOn('E8') ? h('td', {}, TC.data && TC.data.sections[i].start !== null ? levelDate(TC.data.sections[i].start) : '') : null,
        h('td', {}, r.type === 'none' ? '' : (r.remaining > 0.5 ? 'Not reached (' + Q(r.remaining) + ' ' + RL() + ' ' + (r.type === 'cut' ? 'left' : 'short') + ')' : levelDate(r.levelTime))),
        h('td', {}, r.type === 'cut' ? 'Went to: ' + (list(r.to) || 'nowhere') : r.type === 'fill' ? 'Came from: ' + (list(r.from) || 'nowhere') : '')));
    });
    body.append(h('p', {}, h('button', { onclick: exportResults }, 'Export results CSV'), ' ', h('button', { onclick: exportLog }, 'Export movement log CSV'), ' ', h('button', { onclick: exportDaily }, 'Export daily CSV'), modOn('E4') ? [' ', h('button', { onclick: exportProgramme }, 'Export programme CSV')] : null, modOn('E7') ? [' ', h('button', { onclick: printReport }, 'Print report'), ' ', h('button', { onclick: () => setReplay(true) }, 'Replay mode')] : null),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Section', 'Type', 'Starting quantity (' + RL() + ')'].concat(modOn('E8') ? ['Earthworks starts'] : [], ['Reaches level', 'Where the soil went / came from']).map((c, i) => h('th', { class: i === 2 ? 'num' : '' }, c)))), tb)));
  }
  function renderLog() {
    const body = $('tabbody'); body.replaceChildren();
    if (!res) { body.append(h('div', { class: 'note err' }, 'Fix the problems under Messages first.')); return; }
    const L = res.log, P = res.P, tb = h('tbody'), n = Math.min(res.n, 300);
    for (let k = 0; k < n; k++) tb.append(h('tr', {}, h('td', {}, k + 1), h('td', {}, P.names[L.src[k]]), h('td', {}, P.names[L.dst[k]]), res.mlog ? h('td', {}, matName(res.mlog.mat[k])) : null, h('td', { class: 'num' }, Q1(L.t[k])), h('td', {}, E.fmtTime(L.start[k], P.startDay)), h('td', {}, E.fmtTime(L.tip[k], P.startDay))));
    body.append(h('p', {}, fmt(res.n) + ' movements in total' + (res.n > n ? '. The first ' + n + ' are shown; export the CSV for all of them. ' : '. '), h('button', { onclick: exportLog }, 'Export movement log CSV')),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['#', 'From', 'To'].concat(res.mlog ? ['Soil'] : [], [RL() === 't' ? 'Tonnes' : 'm³', 'Loading starts', 'Tipped']).map((c, i) => h('th', { class: c === 'Tonnes' || c === 'm³' ? 'num' : '' }, c)))), tb)));
  }




  // ---------- time-chainage chart (E8) ----------
  // Chainage runs across and shares the road view's scroll and zoom (it calls the same geom()); time runs down or up the page
  // with its own zoom. Everything drawn comes from the movement log via Engine.chartData(), never from a separate calculation.
  const TC = { data: null, ver: 0, layer: null, key: '', hover: null, hit: null, drag: false, nonWork: null, overlays: [] };
  // Later modules add overlay drawers here: C1 blockages, C3 closed periods, D1 weather and winter shutdown, D4 bank holidays,
  // D3 target dates, E6 actual progress. Each is function (ctx, env) drawing in chart space; env = { X(metres), Y(day), plot, win, res, P, pxPerDay }.
  const tcSt = () => scn.ui.timeChainage;
  const SPANS = [[0, 'Whole job'], [182, '6 months'], [91, '3 months'], [30, '1 month'], [14, '2 weeks'], [7, '1 week']];
  const tcSave = () => { autosave(); S.dirty = true; };
  function tcBuild() {
    TC.ver++; TC.layer = null; TC.hover = null;
    if (!res || !modOn('E8')) { TC.data = null; TC.nonWork = null; return; }
    TC.data = E.chartData(res);
    const P = res.P; TC.nonWork = new Uint8Array(TC.data.nd + 2);
    for (let d = 0; d < TC.nonWork.length; d++) { const dow = E.dowOf(P.startDay + d); TC.nonWork[d] = (P.cal && P.cal.dayOff[d]) || (P.srcs.length && P.srcs.every(i => !P.workDays[i][dow])) ? 1 : 0; }
  }
  function tcLayout() {
    const on = modOn('E8') && S.screen === 'main', st = tcSt();
    $('tcpanel').hidden = !on; if (!on) return;
    $('tcbody').hidden = st.minimised; $('tcresize').hidden = st.minimised;
    $('tcMin').textContent = st.minimised ? '▴' : '▾'; $('tcMin').title = st.minimised ? 'Restore the chart' : 'Minimise to a thin bar';
    $('tcchart').style.height = st.height + 'px';
    $('tcDir').textContent = st.timeDown ? 'Time runs down ↓' : 'Time runs up ↑';
    $('tcFollow').checked = !!st.follow; $('tcSpan').value = String(st.spanDays);
    S.dirty = true;
  }
  function tcWindow() {
    const st = tcSt(), total = Math.max(7, TC.data.nd - 1), span = st.spanDays > 0 ? Math.min(st.spanDays, total) : total;
    let t0 = span >= total ? 0 : (st.follow ? S.t / 1440 - span / 2 : +st.startDay || 0);
    t0 = Math.max(0, Math.min(t0, total - span));
    return { t0, span, total };
  }
  const rgba = (c, a) => { const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim()); if (!m) return c; const v = parseInt(m[1], 16); return 'rgba(' + (v >> 16) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')'; };
  const hatchGrey = (() => { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.strokeStyle = 'rgba(120,120,120,.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke(); return c; })();
  const tcShort = (day, step) => { const d = new Date((res.P.startDay + day) * 86400000), p2 = n => (n < 10 ? '0' : '') + n; return step >= 61 ? p2(d.getUTCMonth() + 1) + '/' + String(d.getUTCFullYear()).slice(2) : p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1); };
  const tcGeom = (W, H, win, st) => {
    const pt = 18, pb = H - 22, ph = Math.max(10, pb - pt);
    return { pt, pb, ph, W, H, down: st.timeDown, dayToY: d => (st.timeDown ? pt + (d - win.t0) / win.span * ph : pb - (d - win.t0) / win.span * ph), yToDay: y => (st.timeDown ? win.t0 + (y - pt) / ph * win.span : win.t0 + (pb - y) / ph * win.span) };
  };
  function tcRenderLayer(W, H, dpr, g, win, st) {
    const cw = Math.round(W * dpr), chh = Math.round(H * dpr);
    const cv = TC.layerCv && TC.layerCv.width === cw && TC.layerCv.height === chh ? TC.layerCv : (TC.layerCv = Object.assign(document.createElement('canvas'), { width: cw, height: chh })); // reused between redraws
    const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, chh); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const prof = TC.prof ? [performance.now()] : null;
    const P = res.P, D = TC.data, ppm = g0.ppm, X = m => PAD + (m - S.x0) * ppm, tg = g;
    const Y = tg.dayToY, pxPerDay = tg.ph / win.span;
    ctx.fillStyle = COL.panel; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, tg.pt, W, tg.ph); ctx.clip();
    // non-working days: stripes across the whole road when no cut section works that day (readable only when a day is a few pixels tall)
    if (pxPerDay >= 3 && TC.nonWork) {
      ctx.fillStyle = ctx.createPattern(hatchGrey, 'repeat');
      for (let d = Math.max(0, Math.floor(win.t0)); d < Math.min(TC.nonWork.length, win.t0 + win.span + 1); d++) if (TC.nonWork[d]) { const ya = Y(d), yb = Y(d + 1); ctx.fillRect(PAD, Math.min(ya, yb), W - 2 * PAD, Math.abs(yb - ya)); }
    }
    // time grid and labels
    const step = [1, 7, 14, 30, 61, 91, 182, 365].find(x => x * pxPerDay >= 46) || 365;
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.fillStyle = COL.mute; ctx.font = '10px system-ui';
    for (let d = Math.ceil(win.t0 / step) * step; d <= win.t0 + win.span + 1e-9; d += step) { const y = Math.round(Y(d)) + 0.5; ctx.beginPath(); ctx.moveTo(PAD - 4, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(tcShort(d, step), 2, y - 2); }
    // section edges and names
    ctx.restore(); ctx.save();
    ctx.font = '10px system-ui';
    for (let i = 0; i < P.n; i++) {
      const sx = X(P.chain[i]), sw = P.len[i] * ppm; if (sx + sw < 0 || sx > W) continue;
      ctx.strokeStyle = COL.line; ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, tg.pt); ctx.lineTo(Math.round(sx) + 0.5, tg.pb); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(sx, 0, sw - 1, tg.pt); ctx.clip(); ctx.fillStyle = COL.ink; ctx.fillText(P.names[i], sx + 2, 12); ctx.restore();
    }
    ctx.beginPath(); ctx.rect(0, tg.pt, W, tg.ph); ctx.clip();
    const env = { X, Y, plot: { l: 0, t: tg.pt, w: W, h: tg.ph }, win, res, P, pxPerDay };
    // locked: fill sections that cannot be tipped into until their opening date
    const hit = { blocks: [], pairs: [] }, lockPat = ctx.createPattern(hatchCv, 'repeat');
    for (let i = 0; i < P.n; i++) {
      if (P.qty[i] >= 0 || !(P.openDay[i] > 0) || (TC.skip && TC.skip.locks)) continue;
      const sx = X(P.chain[i]), sw = P.len[i] * ppm; if (sx + sw < 0 || sx > W) continue;
      const ya = Y(0), yb = Y(P.openDay[i]);
      ctx.fillStyle = lockPat; ctx.fillRect(sx, Math.min(ya, yb), sw, Math.abs(yb - ya));
      ctx.strokeStyle = rgba(COL.err, 0.7); ctx.strokeRect(sx + 0.5, Math.min(ya, yb) + 0.5, sw - 1, Math.abs(yb - ya) - 1);
      if (sw > 70) { ctx.fillStyle = COL.err; ctx.font = 'bold 10px system-ui'; ctx.fillText('opens ' + tcShort(P.openDay[i], 1), sx + 3, Math.max(Math.min(ya, yb), tg.pt) + Math.min(Math.abs(yb - ya), 14) - 3); }
    }
    for (const ov of TC.overlays) { try { ov(ctx, env); } catch (e) { } }
    if (prof) prof.push(performance.now());
    // section blocks: shade strength = tonnes handled per day
    const bandPx = pxPerDay >= 2 ? 1 : pxPerDay >= 1 ? 2 : pxPerDay >= 0.5 ? 3 : 5; // sample taller bands when a day is under a pixel (weekends would otherwise flicker the shade every row)
    const LV = 8, maxD = Math.max(1, D.maxDaily), cum = (pref, day) => { const k = Math.max(0, Math.min(pref.length - 2, Math.floor(day))), f = Math.max(0, Math.min(1, day - k)); return pref[k] + f * (pref[k + 1] - pref[k]); };
    // The shading is written into one pixel buffer and drawn with a single call: thousands of small alpha rectangles are slow to rasterise.
    const hexRgb = c => { const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim()), v = m ? parseInt(m[1], 16) : 0x888888; return [v >> 16, (v >> 8) & 255, v & 255]; };
    const rgbCut = hexRgb(COL.sand2), rgbFill = hexRgb(COL.accent2);
    const shades = { cut: [], fill: [] };
    for (let l = 0; l < LV; l++) { shades.cut.push(rgba(COL.sand2, 0.22 + l * 0.11)); shades.fill.push(rgba(COL.accent2, 0.22 + l * 0.11)); }
    const IW = Math.max(1, Math.ceil(W)), IH = Math.max(1, Math.ceil(tg.ph)), img = ctx.createImageData(IW, IH), px = img.data;
    const put = (x0, x1, y0, y1, rgb, alpha) => { // fill [x0,x1) by [y0,y1) in plot coordinates
      const xa = Math.max(0, Math.floor(x0)), xb = Math.min(IW, Math.max(xa + 1, Math.floor(x1))), ya = Math.max(0, y0), yb = Math.min(IH, y1), al = Math.round(alpha * 255);
      for (let y = ya; y < yb; y++) { let o = (y * IW + xa) * 4; for (let x = xa; x < xb; x++, o += 4) { px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = al; } }
    };
    const edges = [];
    for (const sec of D.sections) {
      if (sec.start === null || sec.type === 'none' || (TC.skip && TC.skip.blocks)) continue;
      const i = sec.i, sx = X(P.chain[i]), sw = P.len[i] * ppm; if (sx + sw < 0 || sx > W) continue;
      const d0 = sec.start / 1440, d1 = sec.end / 1440; if (d1 < win.t0 || d0 > win.t0 + win.span) continue;
      const ya = Y(d0), yb = Y(d1), yTop = Math.min(ya, yb), yBot = Math.max(ya, yb), rgb = sec.type === 'cut' ? rgbCut : rgbFill;
      const r0 = Math.max(0, Math.floor(yTop - tg.pt)), r1 = Math.min(IH, Math.ceil(yBot - tg.pt) + 1);
      put(sx, sx + sw, r0, r1, rgb, 0.07);
      for (let y = r0; y < r1; y += bandPx) {
        const da = Math.max(d0, Math.min(d1, tg.yToDay(y + tg.pt))), db = Math.max(d0, Math.min(d1, tg.yToDay(y + bandPx + tg.pt)));
        const lo = Math.min(da, db), hi = Math.max(da, db), v = hi - lo > 1e-9 ? (cum(sec.pref, hi) - cum(sec.pref, lo)) / (hi - lo) : 0;
        if (v > 0) put(sx, sx + sw, y, Math.min(r1, y + bandPx), rgb, 0.22 + Math.min(LV - 1, Math.floor(v / maxD * LV)) * 0.11);
      }
      edges.push([sec, sx, sw, yTop, yBot]);
      hit.blocks.push({ i, x: sx, w: sw, y0: yTop, y1: yBot });
    }
    const tmp = TC.imgCv || (TC.imgCv = document.createElement('canvas')); tmp.width = IW; tmp.height = IH;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 0, 0, IW, IH, 0, tg.pt, IW, IH);
    for (const [sec, sx, sw, yTop, yBot] of edges) {
      const col = sec.type === 'cut' ? COL.sand2 : COL.accent2;
      ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, yTop + 0.5, sw - 1, Math.max(1, yBot - yTop) - 1);
      if (!sec.reached) { ctx.setLineDash([3, 3]); ctx.strokeStyle = COL.err; ctx.beginPath(); const ye = st.timeDown ? yBot : yTop; ctx.moveTo(sx, ye); ctx.lineTo(sx + sw, ye); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (prof) prof.push(performance.now());
    // hauls: a band from the source (when it began) to the destination (when it last tipped), thickness = tonnes
    ctx.lineCap = 'butt'; ctx.strokeStyle = rgba(COL.ink, 0.34);
    const byW = new Map(); // one path and one stroke per whole-pixel width (and material colour), so hundreds of bands stay cheap to draw
    const vis = [];
    for (const p of D.pairs) {
      const t0 = p.t0 / 1440, t1 = p.t1 / 1440; if ((t0 < win.t0 && t1 < win.t0) || (t0 > win.t0 + win.span && t1 > win.t0 + win.span)) continue;
      const x1 = X(P.mid[p.src]), x2 = X(P.mid[p.dst]); if ((x1 < -20 && x2 < -20) || (x1 > W + 20 && x2 > W + 20)) continue;
      vis.push(p);
    }
    const MAXB = 300; // level of detail: when more bands are in view than can be read, draw the heaviest and say so
    if (vis.length > MAXB) vis.sort((a, b) => b.tonnes - a.tonnes);
    hit.hidden = Math.max(0, vis.length - MAXB);
    for (const p of (TC.skip && TC.skip.hauls ? [] : vis.slice(0, MAXB))) {
      const x1 = X(P.mid[p.src]), x2 = X(P.mid[p.dst]), y1 = Y(p.t0 / 1440), y2 = Y(p.t1 / 1440), lw = Math.max(1, Math.min(14, Math.round(14 * Math.sqrt(p.tonnes / Math.max(1, D.maxPair)))));
      const col = p.mat ? matCol(p.mat) : null, gk = lw + '|' + (col || '');
      let gr = byW.get(gk); if (!gr) byW.set(gk, (gr = { lw, col, segs: [] }));
      gr.segs.push([x1, y1, x2, y2]);
      hit.pairs.push({ p, x1, y1, x2, y2, lw });
    }
    [...byW.values()].sort((a, b) => a.lw - b.lw).forEach(gr => { ctx.strokeStyle = gr.col ? rgba(gr.col, 0.7) : rgba(COL.ink, 0.34); ctx.lineWidth = gr.lw; ctx.beginPath(); for (const q of gr.segs) { ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); } ctx.stroke(); });
    ctx.lineCap = 'butt'; ctx.restore();
    // frame and legend
    ctx.strokeStyle = COL.line; ctx.strokeRect(0.5, tg.pt + 0.5, W - 1, tg.ph);
    let lx = 8; const ly = H - 8; ctx.font = '11px system-ui';
    const item = (draw, label) => { draw(lx, ly - 9); ctx.fillStyle = COL.mute; ctx.fillText(label, lx + 18, ly); lx += 26 + ctx.measureText(label).width; };
    item((x, y) => { for (let l = 0; l < 4; l++) { ctx.fillStyle = shades.cut[l * 2]; ctx.fillRect(x + l * 4, y, 4, 10); } }, 'cut (darker = more soil that day)');
    item((x, y) => { for (let l = 0; l < 4; l++) { ctx.fillStyle = shades.fill[l * 2]; ctx.fillRect(x + l * 4, y, 4, 10); } }, 'fill');
    item((x, y) => { ctx.strokeStyle = rgba(COL.ink, 0.5); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + 14, y + 2); ctx.stroke(); }, 'haul (width = tonnes)');
    if (res.mlog) { const seen = {}; for (const p of D.pairs) if (p.mat) seen[p.mat] = 1; Object.keys(seen).forEach(id => item((x, y) => { ctx.strokeStyle = rgba(matCol(id) || COL.ink, 0.85); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + 14, y + 2); ctx.stroke(); }, matName(id))); }
    item((x, y) => { ctx.fillStyle = ctx.createPattern(hatchCv, 'repeat'); ctx.fillRect(x, y, 14, 10); }, 'not open for tipping');
    item((x, y) => { ctx.fillStyle = ctx.createPattern(hatchGrey, 'repeat'); ctx.fillRect(x, y, 14, 10); ctx.strokeStyle = COL.line; ctx.strokeRect(x + 0.5, y + 0.5, 13, 9); }, 'non-working day');
    item((x, y) => { ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.lineTo(x + 14, y + 5); ctx.stroke(); }, 'now');
    if (hit.hidden) { ctx.fillStyle = COL.err; ctx.fillText(fmt(hit.hidden) + ' smaller hauls not drawn (zoom in to see them)', lx + 6, ly); }
    if (prof) { prof.push(performance.now()); TC.profOut = prof.map((v, i) => (i ? Math.round((v - prof[i - 1]) * 10) / 10 : 0)).slice(1); }
    TC.hit = hit;
    return cv;
  }
  // E8 overlays for Phase 5: days off (D4), blockages (C1), closed periods (C3), single-lane stretches (C2) and target dates (D3)
  TC.overlays.push((ctx, env) => {
    const { X, Y, P, win, plot, res: rs } = env, W = plot.w, d0 = Math.max(0, Math.floor(win.t0)), d1 = win.t0 + win.span + 1;
    if (P.cal) for (let d = d0; d < d1 && d < P.cal.dayOff.length; d++) if (P.cal.dayOff[d]) { const ya = Y(d), yb = Y(d + 1); ctx.fillStyle = 'rgba(120,120,120,0.18)'; ctx.fillRect(PAD, Math.min(ya, yb), W - 2 * PAD, Math.max(1, Math.abs(yb - ya))); }
    if (P.con) {
      (P.con.lanes || []).forEach(ln => { ctx.fillStyle = rgba(COL.accent, 0.10); ctx.fillRect(X(ln.a), plot.t, X(ln.b) - X(ln.a), plot.h); });
      (P.con.blocks || []).forEach(bk => {
        const x = X(bk.x), ya = Y(0), yb = Y(bk.openAbs / 1440); ctx.fillStyle = ctx.createPattern(hatchCv, 'repeat'); ctx.fillRect(x - 3, Math.min(ya, yb), 6, Math.abs(yb - ya));
        ctx.strokeStyle = COL.err; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 8, yb); ctx.lineTo(x + 8, yb); ctx.stroke();
      });
      if (P.con.closed) for (let i = 0; i < P.n; i++) (P.con.closed[i] || []).forEach(r => {
        const ya = Y(Math.max(r[0], 0)), yb = Y(r[1] === Infinity ? d1 : r[1]), sx = X(P.chain[i]), sw = X(P.chain[i] + P.len[i]) - sx; if (sx + sw < 0 || sx > W) return;
        ctx.globalAlpha = 0.55; ctx.fillStyle = ctx.createPattern(hatchCv, 'repeat'); ctx.fillRect(sx, Math.min(ya, yb), sw, Math.abs(yb - ya)); ctx.globalAlpha = 1;
      });
    }
    if (modOn('E6')) { const an = M.actualsAnalysis(scn, rs); if (an.length) { const y = Y(an[an.length - 1].day + 1); ctx.strokeStyle = '#2a7d3f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#2a7d3f'; ctx.font = 'bold 10px system-ui'; ctx.fillText('Actuals to ' + E.fmtDay(P.startDay + an[an.length - 1].day), PAD + 4, y - 4); } }
    if (modOn('D3')) E.lateness(scn, rs).forEach(x => { // a diamond at the target date on the section
      const sx = X(P.chain[x.i] + P.len[x.i] / 2), y = Y(x.targetDay - P.startDay); ctx.fillStyle = x.late ? COL.err : '#2a7d3f';
      ctx.beginPath(); ctx.moveTo(sx, y - 6); ctx.lineTo(sx + 6, y); ctx.lineTo(sx, y + 6); ctx.lineTo(sx - 6, y); ctx.closePath(); ctx.fill();
    });
  });
  let g0 = null;
  function drawTC() {
    if (!modOn('E8') || S.screen !== 'main') return;
    const st = tcSt(); if (st.minimised) return;
    if (!COL) colours();
    const cv = $('tcchart'), ctx = size(cv), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!res || !TC.data) { ctx.fillStyle = COL.panel; ctx.fillRect(0, 0, W, H); ctx.fillStyle = COL.mute; ctx.font = '14px system-ui'; ctx.fillText('Fix the problems under Messages to see the chart.', 16, 30); return; }
    const pa = TC.prof ? performance.now() : 0;
    g0 = geom(); const win = tcWindow(), tg = tcGeom(W, H, win, st);
    const key = [TC.ver, W, H, dpr, S.x0.toFixed(3), S.zoom.toFixed(4), st.timeDown, win.t0.toFixed(3), win.span, COL.sand2, COL.accent2, res.mlog ? scn.materials.map(m => m.id + m.colour).join(',') : ''].join('|');
    const pb = TC.prof ? performance.now() : 0;
    if (key !== TC.key || !TC.layer) { TC.layer = tcRenderLayer(W, H, dpr, tg, win, st); TC.key = key; }
    const pc = TC.prof ? performance.now() : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(TC.layer, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (TC.prof) TC.profDraw = { setup: +(pb - pa).toFixed(1), render: +(pc - pb).toFixed(1), blit: +(performance.now() - pc).toFixed(1), W, H, dpr };
    ctx.save(); ctx.beginPath(); ctx.rect(0, tg.pt, W, tg.ph); ctx.clip();
    const hv = TC.hover; // highlight what the pointer is over
    if (hv && hv.kind === 'pair') { ctx.strokeStyle = rgba(COL.accent, 0.55); ctx.lineWidth = hv.o.lw + 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hv.o.x1, hv.o.y1); ctx.lineTo(hv.o.x2, hv.o.y2); ctx.stroke(); }
    if (hv && hv.kind === 'block') { ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.strokeRect(hv.o.x + 1, hv.o.y0 + 1, hv.o.w - 2, Math.max(2, hv.o.y1 - hv.o.y0 - 2)); }
    const ny = tg.dayToY(S.t / 1440);
    if (ny >= tg.pt - 1 && ny <= tg.pb + 1) {
      ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, ny); ctx.lineTo(W, ny); ctx.stroke();
      const lab = E.fmtTime(S.t, res.P.startDay); ctx.font = 'bold 11px system-ui'; const w = ctx.measureText(lab).width + 10, ly = Math.min(Math.max(ny - 8, tg.pt), tg.pb - 16);
      ctx.fillStyle = COL.accent; ctx.fillRect(W - w - 4, ly, w, 16); ctx.fillStyle = '#fff'; ctx.fillText(lab, W - w + 1, ly + 12);
    }
    ctx.restore();
  }
  function tcEnv() { const cv = $('tcchart'), st = tcSt(), win = tcWindow(); return { st, win, tg: tcGeom(cv.clientWidth, cv.clientHeight, win, st), geom: geom() }; }
  function tcPointer(e) { const r = $('tcchart').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function tcHover(e) {
    if (!res || !TC.data || !TC.hit) return;
    const { x, y } = tcPointer(e), en = tcEnv(), tip = $('tctip');
    let found = null, best = Infinity;
    for (const o of TC.hit.pairs) { // nearest band under the pointer
      const dx = o.x2 - o.x1, dy = o.y2 - o.y1, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - o.x1) * dx + (y - o.y1) * dy) / l2));
      const dd = Math.hypot(x - (o.x1 + t * dx), y - (o.y1 + t * dy));
      if (dd <= o.lw / 2 + 3 && dd < best) { best = dd; found = { kind: 'pair', o }; }
    }
    if (!found) for (const o of TC.hit.blocks) if (x >= o.x && x <= o.x + o.w && y >= o.y0 && y <= o.y1) { found = { kind: 'block', o }; break; }
    const same = (a, b) => (!a && !b) || (a && b && a.o === b.o);
    if (!same(found, TC.hover)) { TC.hover = found; S.dirty = true; }
    if (!found) { tip.hidden = true; return; }
    const P = res.P, dt = m => E.fmtTime(m, P.startDay), list = o => Object.keys(o).map(k => P.names[+k] + ' ' + Q(o[k]) + ' ' + RL()).join('; ');
    tip.replaceChildren();
    if (found.kind === 'pair') {
      const p = found.o.p;
      tip.append(h('b', {}, P.names[p.src] + ' → ' + P.names[p.dst] + (p.mat ? ' (' + matName(p.mat) + ')' : '')), h('div', {}, Q(p.tonnes) + ' ' + RL() + ' in ' + fmt(p.count) + ' loads'), h('div', {}, dt(p.t0) + ' to ' + dt(p.t1)), h('div', {}, fmt1(E.dist(P, p.src, p.dst) / 1000) + ' km haul'));
    } else {
      const sec = TC.data.sections[found.o.i], r = res.sections[found.o.i];
      tip.append(h('b', {}, P.names[sec.i] + (sec.type === 'cut' ? ' (cut)' : ' (fill)')), h('div', {}, 'Earthworks ' + dt(sec.start) + ' to ' + dt(sec.end) + (sec.reached ? ', reaches level' : ', does not reach level')),
        h('div', {}, Q(Math.abs(r.qty) - r.remaining) + ' of ' + Q(Math.abs(r.qty)) + ' ' + RL() + (sec.type === 'cut' ? ' removed' : ' placed')), h('div', {}, (sec.type === 'cut' ? 'Going to: ' : 'Coming from: ') + (list(sec.type === 'cut' ? r.to : r.from) || 'nowhere')));
    }
    tip.hidden = false;
    const pr = $('tcbody').getBoundingClientRect(), cr = $('tcchart').getBoundingClientRect();
    tip.style.left = Math.min(x + 14, cr.width - 300) + 'px'; tip.style.top = (y + 16 + (cr.top - pr.top) + 30) + 'px';
  }
  function tcSeekTo(e) {
    if (!res || !TC.data) return;
    const en = tcEnv(), { y } = tcPointer(e); seek(Math.max(0, Math.min(en.win.total, en.tg.yToDay(y))) * 1440);
  }
  (function tcWire() {
    const sel = $('tcSpan'); SPANS.forEach(([v, l]) => sel.append(h('option', { value: String(v) }, l)));
    const cv = $('tcchart');
    cv.addEventListener('pointerdown', e => { if (!res || !TC.data) return; TC.drag = true; cv.setPointerCapture(e.pointerId); setPlaying(false); tcSeekTo(e); });
    cv.addEventListener('pointermove', e => { if (TC.drag) tcSeekTo(e); tcHover(e); });
    cv.addEventListener('pointerup', () => (TC.drag = false));
    cv.addEventListener('pointerleave', () => { TC.hover = null; $('tctip').hidden = true; S.dirty = true; });
    cv.addEventListener('wheel', e => { // scroll the time window (and stop following) when zoomed in on time; otherwise let the page scroll
      if (!res || !TC.data) return; const st = tcSt(), w = tcWindow(); if (w.span >= w.total) return;
      e.preventDefault(); st.follow = false; st.startDay = Math.max(0, Math.min(w.total - w.span, w.t0 + Math.sign(e.deltaY) * w.span * 0.1)); tcLayout(); tcSave();
    }, { passive: false });
    $('tcDir').onclick = () => { const st = tcSt(); st.timeDown = !st.timeDown; tcLayout(); tcSave(); };
    sel.onchange = () => { const st = tcSt(); st.spanDays = +sel.value; if (st.spanDays > 0 && !st.follow) st.startDay = Math.max(0, S.t / 1440 - st.spanDays / 2); tcLayout(); tcSave(); };
    const stepSpan = dir => { const st = tcSt(), i = SPANS.findIndex(x => x[0] === st.spanDays); const j = Math.max(0, Math.min(SPANS.length - 1, (i < 0 ? 0 : i) + dir)); st.spanDays = SPANS[j][0]; tcLayout(); tcSave(); };
    $('tcZoomIn').onclick = () => stepSpan(1); $('tcZoomOut').onclick = () => stepSpan(-1);
    $('tcFollow').onchange = ev => { const st = tcSt(); if (!ev.target.checked) st.startDay = tcWindow().t0; st.follow = ev.target.checked; tcLayout(); tcSave(); };
    $('tcMin').onclick = () => { const st = tcSt(); st.minimised = !st.minimised; tcLayout(); tcSave(); };
    $('tcExport').onclick = () => { drawTC(); $('tcchart').toBlob(b => { if (!b) return; const a = h('a', { href: URL.createObjectURL(b), download: slug() + '_time_chainage.png' }); document.body.append(a); a.click(); a.remove(); }, 'image/png'); };
    let rs = null; const rz = $('tcresize');
    rz.addEventListener('pointerdown', e => { rs = { y: e.clientY, h: tcSt().height }; rz.setPointerCapture(e.pointerId); });
    rz.addEventListener('pointermove', e => { if (!rs) return; tcSt().height = Math.max(120, Math.min(700, Math.round(rs.h - (e.clientY - rs.y)))); $('tcchart').style.height = tcSt().height + 'px'; S.dirty = true; });
    rz.addEventListener('pointerup', () => { if (rs) { rs = null; tcSave(); } });
  })();

  // ---------- fleet and plant tab (B1 to B6) ----------
  // ---------- Cost & carbon (E1, E2) and the programme export (E4) ----------
  function exportProgramme() { if (res) download(slug() + '_programme.csv', '﻿' + M.programmeCSV(scn, res), 'text/csv'); }
  // ---------- placeholder rates: tags, notes and the one screen to enter real numbers ----------
  const rateOfCell = cell => M.rateFieldsOn(scn).find(f => f.cell === cell);
  // tint every rate input that still holds its shipped default, with a small "default" tag beside it
  function markDefaults(root) {
    root.querySelectorAll('.dtag.mk').forEach(x => x.remove()); root.querySelectorAll('input.dflt').forEach(x => x.classList.remove('dflt'));
    root.querySelectorAll('input[data-cell^="mod:"]').forEach(inp => {
      const f = rateOfCell(inp.getAttribute('data-cell')); if (!f || !M.rateIsDefault(scn, f) || inp.closest('#ratetable')) return;
      inp.classList.add('dflt'); inp.title = 'Default rate: replace it with yours'; inp.after(h('small', { class: 'dtag mk' }, 'default'));
    });
  }
  // typing in a rate confirms it: from then on it is your number, even if it equals the default
  $('tabbody').addEventListener('input', ev => {
    const inp = ev.target, f = inp && inp.getAttribute && rateOfCell(inp.getAttribute('data-cell') || '');
    if (!f || inp.value === '') return;
    M.confirmRate(scn, f.id); inp.classList.remove('dflt'); if (inp.nextSibling && inp.nextSibling.classList && inp.nextSibling.classList.contains('mk')) inp.nextSibling.remove();
    autosave();
  });
  // "using default rates" beside cost, carbon and risk results; groups limits it to the rates that result depends on
  function rateNote(groups) {
    const t = M.rateNoteText(scn, groups); if (!t) return null;
    return h('div', { class: 'note warn ratenote' }, 'Result ' + t + ': these are placeholders, not your numbers. ', h('a', { onclick: () => { S.tab = 'rates'; renderTabs(true); } }, 'Enter your rates'));
  }
  function renderRates() {
    const body = $('tabbody'); body.replaceChildren();
    const fields = M.rateFieldsOn(scn), left = () => M.defaultRates(scn).length;
    const head = h('p', { id: 'ratehead' });
    const upd = () => { head.textContent = left() ? left() + ' of ' + fields.length + ' values are still the defaults that came with the program. Results that use them say so. Type your own numbers below (typing in a row marks it as yours).' : 'All ' + fields.length + ' values have been entered or confirmed as yours.'; };
    upd();
    const rows = []; let group = '';
    fields.forEach(f => {
      if (f.group !== group) { group = f.group; rows.push(h('tr', {}, h('th', { colspan: 6, style: 'text-align:left;padding-top:10px' }, group === 'cost' ? 'E1  Cost rates' : group === 'fuel' ? 'E2  Fuel burn' : 'D1, D2  Weather and breakdowns'))); }
      const tag = h('span', {}, '');
      const showTag = () => { const d = M.rateIsDefault(scn, f); tag.textContent = d ? 'default' : 'yours'; tag.className = d ? 'dtag' : ''; tag.style.color = d ? '' : 'var(--ok)'; tag.style.fontWeight = '600'; };
      const inp = h('input', { type: 'number', step: 'any', value: M.rateGet(scn, f), style: 'width:110px', 'data-cell': f.cell });
      inp.addEventListener('input', () => { if (inp.value === '') return; M.rateSet(scn, f, +inp.value); showTag(); upd(); changed(false); });
      showTag();
      rows.push(h('tr', {}, h('td', {}, f.label), h('td', {}, f.mod), h('td', {}, inp), h('td', {}, f.unit), h('td', {}, tag), h('td', { class: 'hint' }, 'was ' + M.rateDefault(f))));
    });
    body.append(h('h3', {}, 'Default rates'), head,
      h('p', {}, h('button', { onclick: () => { M.confirmRates(scn); autosave(); renderTabs(true); recompute(false); } }, 'Confirm all the rest as our real values'), ' ', h('span', { class: 'hint' }, 'Use this when the numbers shown are already right.')),
      h('div', { class: 'scroll' }, h('table', { id: 'ratetable' }, h('thead', {}, h('tr', {}, ['Item', 'Module', 'Value', 'Unit', 'Status', ''].map(c => h('th', {}, c)))), h('tbody', {}, rows))),
      h('p', { class: 'hint' }, 'The fuel burn rates also drive cost when only E1 is on. The carbon factor (2.68 kg of CO\u2082e per litre of diesel) is the usual UK figure, not a placeholder.'));
  }
  function renderCommercial() {
    const body = $('tabbody'); body.replaceChildren();
    const md = scn.modules, pane = h('div', { id: 'compane' });
    const hint = t => h('p', { class: 'hint' }, t);
    const fld = (label, obj, key, cellId, o) => {
      o = o || {};
      const inp = h('input', { type: o.type || 'number', value: obj[key], step: 'any', 'data-cell': cellId });
      inp.addEventListener('input', () => { obj[key] = o.type === 'text' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); });
      return h('div', {}, h('label', {}, label), inp);
    };
    const sel = (label, obj, key, opts, cellId) => h('div', {}, h('label', {}, label), h('select', { 'data-cell': cellId, onchange: ev => { obj[key] = ev.target.value; recompute(true); } }, opts.map(o => h('option', { value: o[0], selected: obj[key] === o[0] }, o[1]))));
    const card = (id, title, kids) => h('div', { class: 'group' }, h('h4', {}, id + '  ' + title), kids);
    if (modOn('E1')) { const b = md.E1; pane.append(card('E1', 'Cost', [
      h('div', { class: 'settings' }, fld('Lorry hire (£ per hour)', b, 'lorryRate', 'mod:E1:lorryRate'), fld('Excavator hire (£ per hour)', b, 'excavatorRate', 'mod:E1:excavatorRate'), fld('Receiving plant hire (£ per hour)', b, 'receivingRate', 'mod:E1:receivingRate'),
        fld('Fuel (£ per litre)', b, 'fuelPrice', 'mod:E1:fuelPrice'), fld('Labour (£ per plant-hour)', b, 'labourRate', 'mod:E1:labourRate'), sel('Lorries are charged for', b, 'basis', [['used', 'Busy hours only'], ['standing', 'The whole fixed fleet, every working day']], 'mod:E1:basis')),
      hint('Plant hours come from the run: a lorry is busy from the start of loading until it is back at the loader; excavators work while loading; receiving plant works at the receiving rate (B4, or 300 t/h). Fuel comes from the burn rates under Carbon (or sensible defaults). Labour is one operator per machine hour. Tip fees and purchases are the off-site gate charges (A4) and stockpile handling (A5). Standing hire charges a fixed fleet (B1 or B2) for every working day of the programme.')])); }
    if (modOn('E2')) { const b = md.E2; pane.append(card('E2', 'Carbon', [
      h('div', { class: 'settings' }, fld('Lorry fuel burn (litres per hour)', b, 'lorryLPerHour', 'mod:E2:lorryLPerHour'), fld('Excavator fuel burn (litres per hour)', b, 'excavatorLPerHour', 'mod:E2:excavatorLPerHour'), fld('Receiving plant fuel burn (litres per hour)', b, 'receivingLPerHour', 'mod:E2:receivingLPerHour'), fld('Carbon factor (kg CO₂e per litre of diesel)', b, 'kgCO2PerLitre', 'mod:E2:kgCO2PerLitre')),
      hint('Litres burned = plant hours × litres per hour. Carbon = litres × the factor (2.68 kg per litre is the usual UK figure for diesel). The optimiser can minimise cost or carbon once these are on.')])); }
    if (modOn('E4')) { const b = md.E4; pane.append(card('E4', 'Programme export', [
      h('div', { class: 'settings' }, sel('Date format', b, 'dateFormat', [['uk', 'UK (dd/mm/yyyy)'], ['iso', 'ISO (yyyy-mm-dd)']], 'mod:E4:dateFormat'), fld('Activity ID prefix', b, 'idPrefix', 'mod:E4:idPrefix', { type: 'text' })),
      h('p', {}, h('button', { class: 'primary', onclick: exportProgramme }, 'Export programme CSV')),
      hint('One row per section with soil: activity ID, name, duration in days, start, finish and percent complete. P6 and MS Project both let you map the columns when you import a CSV: Activity ID or ID, Activity Name or Name, Original Duration or Duration, Start, Finish.')])); }
    body.append(pane);
  }

  // ---------- E5 import ----------
  function importPanel() {
    const det = h('details', { class: 'group', id: 'imppanel' }, h('summary', {}, 'E5  Import sections from a CSV file or a spreadsheet'));
    const ta = h('textarea', { id: 'impText', rows: 6, style: 'width:100%', placeholder: 'Paste rows copied from a spreadsheet here, or choose a CSV file. The first row should name the columns (use the template to see them).' });
    const out = h('div', { id: 'impOut' }); let parsed = null;
    const check = () => {
      parsed = M.parseSections(ta.value, scn); out.replaceChildren();
      parsed.errors.forEach(x => out.append(h('span', { class: 'msg warn' }, x.text)));
      parsed.warnings.forEach(x => out.append(h('span', { class: 'msg info' }, x.text)));
      out.append(h('p', { class: 'hint' }, parsed.sections.length + ' of ' + parsed.rows + ' rows are ready to import' + (parsed.errors.length ? '; the rows with problems are skipped.' : '.') + ' Quantities are read in ' + (scn.settings.units === 'm3' ? 'm³' : 'tonnes') + ', the units you work in.'));
    };
    const apply = mode => { if (!parsed || !parsed.sections.length) { check(); return; } M.applyImport(scn, parsed, mode); parsed = null; recompute(true); };
    const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv', onchange: ev => { const f = ev.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { ta.value = String(rd.result).replace(/^﻿/, ''); check(); }; rd.readAsText(f); } });
    det.append(h('p', { class: 'hint' }, 'Columns: name, length (m), soil quantity (+ cut, − fill), loads start from, loads start to, earliest tipping date, max loaders, working days. Only the length and quantity are required.'),
      h('p', {}, h('button', { onclick: () => download('earthmove_sections_template.csv', '﻿' + M.sectionsCSV(scn, true), 'text/csv') }, 'Download template'), ' ', h('button', { onclick: () => download(slug() + '_sections.csv', '﻿' + M.sectionsCSV(scn), 'text/csv') }, 'Export the current table'), ' ', file),
      ta, h('p', {}, h('button', { onclick: check }, 'Check'), ' ', h('button', { class: 'primary', onclick: () => apply('replace') }, 'Replace the sections table'), ' ', h('button', { onclick: () => apply('append') }, 'Add to the table')), out);
    return det;
  }

  // ---------- Actual progress (E6) ----------
  function renderActuals() {
    const body = $('tabbody'); body.replaceChildren();
    const b = scn.modules.E6, rows = b.actuals.map((x, k) => h('tr', {}, h('td', {}, h('input', { type: 'date', value: x.date, 'data-cell': 'mod:E6:actual' + k + 'd', onchange: ev => { x.date = ev.target.value; recompute(true); } })), h('td', {}, h('input', { type: 'number', value: x.tonnes, step: 'any', 'data-cell': 'mod:E6:actual' + k + 't', oninput: ev => { x.tonnes = ev.target.value === '' ? NaN : +ev.target.value; changed(false); } })),
      h('td', {}, h('button', { class: 'icon', title: 'Remove', onclick: () => { b.actuals = b.actuals.filter(q => q !== x); recompute(true); } }, '✕'))));
    body.append(h('h3', {}, 'Actual progress'), h('p', { class: 'hint' }, 'Enter the tonnes actually moved (placed in fills) on each day. The plan is compared with the actuals, and the finish is re-forecast from where the job has got to.'),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Tonnes moved that day', ''].map(x => h('th', {}, x)))), h('tbody', {}, rows))),
      h('p', {}, h('button', { 'data-cell': 'mod:E6:add', onclick: () => { const last = b.actuals[b.actuals.length - 1], d = last && E.parseISO(last.date) !== null ? E.dayToISO(E.parseISO(last.date) + 1) : scn.settings.startDate; b.actuals.push({ id: M.newId(), date: d, tonnes: 0 }); recompute(true); } }, '+ Add a day')));
    if (!res) { body.append(h('div', { class: 'note err' }, 'Fix the problems under Messages first.')); return; }
    const an = M.actualsAnalysis(scn, res); if (!an.length) { body.append(h('p', { class: 'hint' }, 'No actuals entered yet.')); return; }
    const fc = M.reforecast(scn, res), stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)), sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Q(Math.abs(v)) + ' ' + RL();
    body.append(h('h3', {}, 'Planned versus actual'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Actual that day (' + RL() + ')', 'Actual to date (' + RL() + ')', 'Planned to date (' + RL() + ')', 'Variance'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
      h('tbody', {}, an.map(x => h('tr', {}, h('td', {}, E.fmtDay(E.parseISO(x.date))), h('td', { class: 'num' }, Q(x.actual)), h('td', { class: 'num' }, Q(x.actualCum)), h('td', { class: 'num' }, Q(x.plannedCum)), h('td', { class: 'num', style: 'color:var(' + (x.variance < -0.5 ? '--err' : '--good, #2a7d3f') + ')' }, sg(x.variance))))))));
    if (fc) body.append(h('h3', {}, 'Re-forecast from today’s position'), h('div', { class: 'stats' }, stat(E.fmtDay(E.parseISO(fc.asOf)), 'Actuals up to'), stat(sg(fc.variance), 'Ahead (+) or behind (−) the plan'), stat(fc.plannedEnd, 'Planned finish'),
      stat(fc.finished ? 'Finished' : fc.forecastEnd, 'Re-forecast finish'), stat(fc.finished ? '–' : fc.lagDays === 0 ? 'On programme' : Math.abs(fc.lagDays) + ' day' + (Math.abs(fc.lagDays) === 1 ? '' : 's') + (fc.lagDays > 0 ? ' late' : ' early'), 'Against the plan')),
      h('p', { class: 'hint' }, 'The forecast takes the plan’s state at the point where it had placed the same tonnage as the actuals, then runs the remaining soil from the day after the last actual with the ordinary dispatch.'));
  }

  // ---------- Mass haul diagram (E3) ----------
  function drawMH(cv, W0, H0) {
    cv = cv || $('mhcanvas'); if (!cv || !res) return;
    if (!COL) colours();
    let ctx; if (W0) { cv.width = W0; cv.height = H0; ctx = cv.getContext('2d'); } else ctx = size(cv);
    const W = W0 || cv.clientWidth, H = H0 || cv.clientHeight, mh = E.massHaul(res, S.t, ser), pl = 46, pr = 12, pt = 18, pb = 26;
    const vals = mh.plan.concat(mh.now, [0]), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(1, hi - lo);
    const X = x => pl + x / res.P.total * (W - pl - pr), Y = v => pt + (hi - v) / span * (H - pt - pb);
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = COL.panel || '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COL.line; ctx.fillStyle = COL.mute; ctx.font = '10px system-ui'; ctx.lineWidth = 1;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].map(x => x * UF()).find(x => span / UF() / x <= 6) || 1e6;
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) { ctx.beginPath(); ctx.moveTo(pl, Y(v)); ctx.lineTo(W - pr, Y(v)); ctx.stroke(); ctx.fillText(fmt(v / UF()), 4, Y(v) + 3); }
    res.P.chain.slice(0, res.P.n).forEach(x => { const px = X(x); ctx.beginPath(); ctx.moveTo(px, pt); ctx.lineTo(px, H - pb); ctx.strokeStyle = rgba(COL.line, 0.5); ctx.stroke(); });
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(pl, Y(0)); ctx.lineTo(W - pr, Y(0)); ctx.stroke();
    const line = (ys, col, w, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); ys.forEach((v, i) => (i ? ctx.lineTo(X(mh.xs[i]), Y(v)) : ctx.moveTo(X(mh.xs[i]), Y(v)))); ctx.stroke(); ctx.setLineDash([]); };
    line(mh.plan, COL.accent2, 2, [6, 4]); line(mh.now, COL.accent, 2.5);
    ctx.fillStyle = COL.mute; ctx.fillText('Chainage 0', pl, H - 8); ctx.fillText((res.P.total / 1000).toFixed(1) + ' km', W - pr - 40, H - 8); ctx.fillText('cumulative cut − fill (' + RL() + ')', pl + 4, 11);
  }
  function renderMassHaul() {
    const body = $('tabbody'); body.replaceChildren();
    body.append(h('p', { class: 'hint' }, 'Cumulative cut minus fill along the road. The curve rises over a cut and falls over a fill; where it returns to the line the soil balances within that stretch, and the last value is the surplus (+) or shortage (−) of the whole job. The dashed line is the start; the solid line is the soil still to move at the time shown above.'),
      h('canvas', { id: 'mhcanvas', style: 'width:100%;height:280px;border:1px solid var(--line);border-radius:6px' }));
    if (!res) body.append(h('div', { class: 'note err' }, 'Fix the problems under Messages first.'));
    drawMH();
  }

  // ---------- reporting (E7): printable summary and replay mode ----------
  function setReplay(on) { document.body.classList.toggle('replay', !!on); $('replayExit').hidden = !on; S.dirty = true; }
  function buildReport() {
    let box = $('report'); if (!box) { box = h('div', { id: 'report' }); document.body.append(box); }
    box.replaceChildren();
    const title = ((scn.modules.E7 || {}).title || 'Earthmove summary'), stat = (v, l) => h('tr', {}, h('th', {}, l), h('td', {}, v));
    box.append(h('h1', {}, title), h('p', {}, scn.name + ' — printed ' + new Date().toLocaleDateString('en-GB')), h('p', { class: 'badge' }, MOD.badgeText(scn) + '. ' + planText()));
    if (!res) { box.append(h('p', {}, 'The model has problems that stop it running, so there are no results to print.')); return box; }
    const dr = M.rateNoteText(scn); if (dr) box.append(h('p', { class: 'badge', style: 'font-weight:600' }, 'This report is ' + dr + ': placeholders, not site rates.'));
    const s = res.summary, P = res.P, rows = [stat(s.completion === null ? 'Not complete' : E.fmtDay(P.startDay + s.completionDay), 'Overall completion'), stat(fmt(s.moves), 'Movements'), stat(Q(s.tonnesMoved) + ' ' + RL(), 'Soil moved'), stat(fmt(s.tonneKm) + ' t·km', 'Total tonne-km'), stat((s.utilisation * 100).toFixed(1) + '%', 'Average use of the daily movement limit')];
    const cc = (modOn('E1') || modOn('E2')) ? E.costCarbon(scn, res) : null;
    if (cc && cc.total !== undefined) rows.push(stat('£' + fmt(cc.total) + ' (£' + (cc.perTonne || 0).toFixed(2) + ' a tonne)', 'Total cost'));
    if (cc && cc.co2t !== null) rows.push(stat(cc.co2t.toFixed(1) + ' t CO₂e', 'Carbon'));
    if (modOn('D3')) { const lt = E.lateness(scn, res); if (lt.length) rows.push(stat(lt.filter(x => x.late).length + ' of ' + lt.length, 'Sections late against their target date')); }
    const img = (cv, alt) => { try { return h('img', { src: cv.toDataURL('image/png'), alt, style: 'width:100%;margin:6px 0' }); } catch (e) { return h('p', { class: 'hint' }, '(' + alt + ' could not be drawn)'); } };
    const mhc = document.createElement('canvas'); if (modOn('E3')) drawMH(mhc, 900, 240);
    const kids = [h('table', { class: 'rep' }, h('tbody', {}, rows)), h('h2', {}, 'The road'), img($('road'), 'The road'),
      modOn('E8') && TC.layer ? [h('h2', {}, 'Time-chainage'), img($('tcchart'), 'Time-chainage chart')] : null,
      h('h2', {}, 'Movements per day'), img($('chart'), 'Movements per day'), modOn('E3') ? [h('h2', {}, 'Mass haul'), img(mhc, 'Mass haul diagram')] : null,
      h('h2', {}, 'Sections'), h('table', { class: 'rep' }, h('thead', {}, h('tr', {}, ['Section', 'Type', 'Starting quantity (' + RL() + ')', 'Reaches level'].map(c => h('th', {}, c)))),
        h('tbody', {}, res.sections.map((r, i) => h('tr', {}, h('td', {}, P.names[i]), h('td', {}, r.type === 'cut' ? 'Cut' : r.type === 'fill' ? 'Fill' : 'No soil'), h('td', {}, r.qty ? (r.qty > 0 ? '+' : '\u2212') + Q(Math.abs(r.qty)) : '0'), h('td', {}, r.type === 'none' ? '' : (r.remaining > 0.5 ? 'Not reached' : levelDate(r.levelTime)))))))];
    box.append(...kids.flat(Infinity).filter(x => x != null && x !== false)); // native append would print null and arrays as text
    return box;
  }
  function printReport() { buildReport(); window.print(); }
  $('replayExit').onclick = () => setReplay(false);
  $('btnReplay').onclick = () => setReplay(true);

  // ---------- Weather & risk (D1, D2) ----------
  const RISK = { state: 'idle', frac: 0, result: null, worker: null, sig: '', error: '', cancelFlag: false };
  const riskSig = () => E.sigOf(scn) + JSON.stringify((scn.modules || {}).D2 || {});
  function riskDate(t, r) { return t === null || t === undefined ? 'not reached' : t === Infinity ? 'not within the programme' : E.fmtDay(r.startDay + Math.floor(t / 1440)); }
  function renderRiskResult() {
    const box = $('riskresult'); if (!box) return; box.replaceChildren();
    if (RISK.state === 'running') {
      box.append(h('div', { class: 'optprog' }, h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(RISK.frac * 100) + '%' })), h('span', {}, Math.round(RISK.frac * 100) + '% of the runs done')), h('button', { onclick: cancelRisk }, 'Cancel'));
      return;
    }
    if (RISK.error) box.append(h('div', { class: 'note err' }, RISK.error));
    const r = RISK.result; if (!r) return;
    if (r.cancelled) { box.append(h('div', { class: 'note' }, 'Cancelled after ' + r.runs + ' runs.')); return; }
    box.append(...[rateNote(['weather'])].filter(Boolean));
    if (RISK.sig !== riskSig()) box.append(h('div', { class: 'note warn' }, 'The inputs have changed since this analysis. Run it again to refresh it.'));
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
    box.append(h('div', { class: 'stats' }, stat(riskDate(r.p50, r), '50% confidence completion (half the runs finish by then)'), stat(riskDate(r.p80, r), '80% confidence completion'),
      stat(r.base === null ? 'not reached' : riskDate(r.base, r), 'Single run with expected weather'), stat(r.finishedPct + '%', 'Runs that finished the job'), stat(r.runs + ' runs, ' + r.seconds.toFixed(1) + ' s', 'Seed ' + r.seed + (r.weather ? ', random weather' : ', no weather') + ', breakdowns ' + r.breakdownPct + '% a day')));
    if (r.hist.length) { // when the runs finished: one bar a day, the 50% and 80% days marked
      const max = Math.max(...r.hist.map(x => x.count)), d50 = r.p50 === Infinity ? -1 : Math.floor(r.p50 / 1440), d80 = r.p80 === Infinity ? -1 : Math.floor(r.p80 / 1440), first = r.hist[0].day, last = r.hist[r.hist.length - 1].day, bars = [];
      for (let d = first; d <= last; d++) { const c = (r.hist.find(x => x.day === d) || { count: 0 }).count; bars.push(h('i', { class: d === d50 ? 'p50' : d === d80 ? 'p80' : '', style: 'height:' + Math.max(2, Math.round(c / max * 60)) + 'px', title: E.fmtDay(r.startDay + d) + ': ' + c + ' runs' })); }
      box.append(h('h4', {}, 'When the runs finished'), h('div', { class: 'hist' }, bars), h('p', { class: 'hint' }, E.fmtDay(r.startDay + first) + ' to ' + E.fmtDay(r.startDay + last) + '. Orange bar: 50% date. Red bar: 80% date.'));
    }
    box.append(h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Section', 'Type', 'Single run', '50% date', '80% date', 'Runs that reached level'].map(c => h('th', {}, c)))),
      h('tbody', {}, r.sections.map(x => h('tr', {}, h('td', {}, x.name), h('td', {}, x.type === 'cut' ? 'Cut' : 'Fill'), h('td', {}, riskDate(x.base, r)), h('td', {}, riskDate(x.p50, r)), h('td', {}, riskDate(x.p80, r)), h('td', { class: 'num' }, x.reachedPct + '%')))))));
  }
  function finishRisk(result) { RISK.state = 'done'; RISK.result = result; RISK.sig = riskSig(); if (RISK.worker) { try { RISK.worker.terminate(); } catch (e) { } RISK.worker = null; } renderRiskResult(); const b = $('riskrun'); if (b) b.disabled = false; }
  function cancelRisk() { if (RISK.worker) RISK.worker.postMessage({ cmd: 'cancel' }); else RISK.cancelFlag = true; }
  function startRisk() {
    if (issues.some(i => i.level === 'error')) { RISK.error = 'Fix the problems listed under Messages first.'; renderRiskResult(); return; }
    RISK.state = 'running'; RISK.frac = 0; RISK.error = ''; RISK.cancelFlag = false;
    const sc = JSON.parse(JSON.stringify(scn)); sc.saved = []; const b = $('riskrun'); if (b) b.disabled = true;
    let w = null;
    try { w = new Worker(URL.createObjectURL(new Blob([$('worker-src').textContent], { type: 'text/javascript' }))); } catch (e) { w = null; }
    const onPage = () => { // no worker available: run in small slices on the page so it stays responsive
      if (RISK.worker) { try { RISK.worker.terminate(); } catch (e) { } RISK.worker = null; }
      let job; try { job = Risk.create(sc); } catch (e) { RISK.error = String(e.message || e); RISK.state = 'idle'; renderRiskResult(); if (b) b.disabled = false; return; }
      const tick = () => { if (RISK.cancelFlag) job.cancel(); else job.step(40); RISK.frac = job.progress().frac; renderRiskResult(); if (job.done) finishRisk(job.result); else setTimeout(tick, 0); };
      tick();
    };
    if (w) {
      RISK.worker = w;
      w.onmessage = ev => { const m = ev.data; if (m.type === 'riskprogress') { RISK.frac = m.frac; renderRiskResult(); } else if (m.type === 'riskdone') finishRisk(m.result); else if (m.type === 'error') onPage(); };
      w.onerror = () => onPage();
      renderRiskResult(); w.postMessage({ cmd: 'risk', scn: sc });
    } else { renderRiskResult(); onPage(); }
  }
  function renderRisk() {
    const body = $('tabbody'); body.replaceChildren();
    const md = scn.modules, pane = h('div', { id: 'riskpane' });
    const hint = t => h('p', { class: 'hint' }, t);
    const fld = (label, obj, key, cellId, o) => {
      o = o || {};
      const inp = h('input', { type: o.type || 'number', value: obj[key], step: 'any', 'data-cell': cellId, placeholder: o.ph || '' });
      inp.addEventListener('input', () => { obj[key] = o.type === 'text' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); });
      return h('div', {}, h('label', {}, label), inp);
    };
    const card = (id, title, kids) => h('div', { class: 'group' }, h('h4', {}, id + '  ' + title), kids);
    if (modOn('D1')) {
      const b = md.D1, MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      pane.append(card('D1', 'Weather', [
        h('h5', {}, 'Expected days lost to weather in each month'),
        h('div', { class: 'settings months' }, MN.map((mn, k) => { const inp = h('input', { type: 'number', value: b.lostDays[k], step: 'any', min: 0, 'data-cell': 'mod:D1:lost' + k }); inp.addEventListener('input', () => { b.lostDays[k] = inp.value === '' ? NaN : +inp.value; changed(false); }); return h('div', {}, h('label', {}, mn), inp); })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.winterOn, onchange: ev => { b.winterOn = ev.target.checked; recompute(true); } }), ' Winter shutdown every year'),
        b.winterOn ? h('div', { class: 'settings' }, fld('Shuts down on (month-day, e.g. 12-20)', b, 'winterFrom', 'mod:D1:winterFrom', { type: 'text', ph: 'MM-DD' }), fld('Reopens after (month-day, e.g. 01-05)', b, 'winterTo', 'mod:D1:winterTo', { type: 'text', ph: 'MM-DD' })) : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.random, onchange: ev => { b.random = ev.target.checked; recompute(true); } }), ' Random rain days (otherwise the lost days are spread evenly through each month)'),
        b.random ? h('div', { class: 'settings' }, fld('Random seed', b, 'seed', 'mod:D1:seed')) : null,
        hint('Lost days are days nothing loads anywhere on site. Each month’s lost days are spread over its working days (bank holidays and a winter shutdown are not working days). With random rain days, each working day is lost with a chance of lost days ÷ working days, drawn with the seed above so the answer is repeatable. Lost days are not counted as idle days in the results.')]));
    }
    if (modOn('D2')) {
      const b = md.D2;
      pane.append(card('D2', 'Probabilistic dates', [
        h('div', { class: 'settings' }, fld('Number of runs', b, 'runs', 'mod:D2:runs'), fld('Random seed', b, 'seed', 'mod:D2:seed'), fld('Chance a loading point is down on any day (%)', b, 'breakdownPct', 'mod:D2:breakdownPct')),
        h('p', {}, h('button', { id: 'riskrun', class: 'primary', onclick: startRisk }, 'Run the risk analysis')),
        h('div', { id: 'riskresult' }),
        hint('The model is run many times. Each run draws its own weather (the monthly lost days above, if weather is on) and its own breakdowns, then reports the day the whole job finishes and the day each section reaches level. The 50% date is when half the runs had finished; the 80% date is when four in five had. A run that never finishes counts as later than any date. The same seed always gives the same answer.')]));
    }
    body.append(pane); renderRiskResult();
  }
  // ---------- Site & calendar (C1-C5, D4) ----------
  function renderSite() {
    const body = $('tabbody'); body.replaceChildren();
    const md = scn.modules, pane = h('div', { id: 'sitepane' }), tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0);
    const hint = t => h('p', { class: 'hint' }, t);
    const fld = (label, obj, key, cellId, o) => {
      o = o || {};
      const inp = h('input', { type: o.type || 'number', value: obj[key], step: 'any', 'data-cell': cellId, placeholder: o.ph || '' });
      inp.addEventListener('input', () => { obj[key] = o.type === 'text' || o.type === 'date' || o.type === 'time' ? inp.value : inp.value === '' ? (o.blank ? '' : NaN) : +inp.value; changed(false); });
      return h('div', {}, h('label', {}, label), inp);
    };
    const card = (id, title, kids) => h('div', { class: 'group' }, h('h4', {}, id + '  ' + title), kids);
    const cellIn = (obj, key, cellId, type, w) => { const inp = h('input', { type: type || 'number', value: obj[key], step: 'any', 'data-cell': cellId, style: w ? 'min-width:' + w : '' }); inp.addEventListener('input', () => { obj[key] = type === 'text' || type === 'date' || type === 'time' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); }); return h('td', {}, inp); };
    const rm = (arr, x, key, md2) => h('td', {}, h('button', { class: 'icon', title: 'Remove', onclick: () => { md2[key] = arr.filter(q => q !== x); recompute(true); } }, '✕'));
    const tbl = (heads, rows) => h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map(x => h('th', {}, x)))), h('tbody', {}, rows)));
    const dmy = d => { const n = E.parseISO(d); return n === null ? '' : E.fmtDay(n); };
    if (modOn('D4')) {
      const b = md.D4, shRows = b.shifts.map((x, k) => h('tr', {}, cellIn(x, 'start', 'mod:D4:shift' + k, 'time'), cellIn(x, 'end', 'mod:D4:shift' + k + 'e', 'time'), rm(b.shifts, x, 'shifts', b)));
      const auto = b.holidaysAuto !== false, kids = [
        h('h5', {}, 'Shifts'), tbl(['Shift starts', 'Shift finishes', ''], shRows),
        h('p', {}, h('button', { onclick: () => { b.shifts.push({ start: '07:00', end: '19:00' }); recompute(true); } }, '+ Add a shift')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.replace, onchange: ev => { b.replace = ev.target.checked; recompute(true); } }), ' Shifts replace each section’s own working hours (otherwise a load may only start where a shift and the section’s hours overlap)'),
        hint('A load may only START inside a shift. A shift cannot run past midnight: use two shifts instead. Each section’s own hours and working days are set in the Sections table.'),
        h('h5', {}, 'Weekends and bank holidays'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.weekendSat, onchange: ev => { b.weekendSat = ev.target.checked; recompute(true); } }), ' Work Saturdays on every section'), ' ',
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.weekendSun, onchange: ev => { b.weekendSun = ev.target.checked; recompute(true); } }), ' Work Sundays on every section'),
        h('br'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.holidaysOn !== false, onchange: ev => { b.holidaysOn = ev.target.checked; recompute(true); } }), ' Bank holidays are non-working days')];
      if (b.holidaysOn !== false) {
        if (auto) {
          const y0 = parseInt(String(scn.settings.startDate).slice(0, 4), 10) || 2027, near = E.holidayList(scn).filter(x => { const n = E.parseISO(x.date); const s0 = E.parseISO(scn.settings.startDate); return n !== null && s0 !== null && n >= s0 && n < s0 + 460; });
          kids.push(hint('England and Wales bank holidays, worked out by the usual rules (substitute days included). In the next 15 months: ' + (near.length ? near.map(x => dmy(x.date) + ' ' + x.name).join('; ') : 'none') + '.'),
            h('p', {}, h('button', { onclick: () => { b.holidays = E.holidayList(scn).filter(x => x.date.slice(0, 4) >= String(y0) && x.date.slice(0, 4) < String(y0 + 5)); b.holidaysAuto = false; recompute(true); } }, 'Edit the holiday list')));
        } else {
          const rows = b.holidays.map((x, k) => h('tr', {}, cellIn(x, 'date', 'mod:D4:holiday' + k, 'date'), cellIn(x, 'name', 'mod:D4:holiday' + k + 'n', 'text', '180px'), rm(b.holidays, x, 'holidays', b)));
          kids.push(tbl(['Date', 'Name', ''], rows),
            h('p', {}, h('button', { onclick: () => { b.holidays.push({ date: '', name: 'Closure' }); recompute(true); } }, '+ Add a day'), ' ', h('button', { onclick: () => { b.holidaysAuto = true; recompute(true); } }, 'Go back to the automatic UK list')));
        }
      }
      pane.append(card('D4', 'Calendar', kids));
    }
    if (modOn('C1')) {
      const b = md.C1, rows = b.blocks.map(x => h('tr', {}, cellIn(x, 'name', 'mod:C1:' + x.id + ':name', 'text', '140px'), cellIn(x, 'chainageM', 'mod:C1:' + x.id + ':chainageM'), cellIn(x, 'openDate', 'mod:C1:' + x.id + ':openDate', 'date'), rm(b.blocks, x, 'blocks', b)));
      pane.append(card('C1', 'Haul route blockages', [tbl(['Name', 'Chainage (m)', 'Open from', ''], rows),
        h('p', {}, h('button', { 'data-cell': 'mod:C1:add', onclick: () => { b.blocks.push({ id: M.newId(), name: 'Blockage ' + (b.blocks.length + 1), chainageM: Math.round(tot / 2), openDate: scn.settings.startDate }); recompute(true); } }, '+ Add a blockage')),
        hint('Nothing can pass a blockage (an unbuilt bridge, a river, a live road crossing) before its opening date. A lorry must reach the chainage on or after that date, so a long haul that leaves the day before can still cross just after midnight. Soil can still be tipped on either side, but a fill reachable only across a blockage cannot start earlier.')]));
    }
    if (modOn('C2')) {
      const b = md.C2, rows = b.stretches.map(x => h('tr', {}, cellIn(x, 'name', 'mod:C2:' + x.id + ':name', 'text', '130px'), cellIn(x, 'fromM', 'mod:C2:' + x.id + ':fromM'), cellIn(x, 'toM', 'mod:C2:' + x.id + ':toM'),
        h('td', {}, h('select', { onchange: ev => { x.mode = ev.target.value; recompute(true); } }, h('option', { value: 'rate', selected: x.mode !== 'alternate' }, 'Limit per hour'), h('option', { value: 'alternate', selected: x.mode === 'alternate' }, 'One direction at a time'))),
        x.mode === 'alternate' ? cellIn(x, 'phaseMin', 'mod:C2:' + x.id + ':phaseMin') : cellIn(x, 'perHour', 'mod:C2:' + x.id + ':perHour'), rm(b.stretches, x, 'stretches', b)));
      pane.append(card('C2', 'Single-lane stretches', [tbl(['Name', 'From chainage (m)', 'To chainage (m)', 'Control', 'Lorries per hour / phase length (min)', ''], rows),
        h('p', {}, h('button', { 'data-cell': 'mod:C2:add', onclick: () => { b.stretches.push({ id: M.newId(), name: 'Lane ' + (b.stretches.length + 1), fromM: Math.round(tot / 3), toM: Math.round(tot / 3 + 300), mode: 'rate', perHour: 30, phaseMin: 15 }); recompute(true); } }, '+ Add a stretch')),
        hint('With a limit per hour, a lorry that would be the next one over the limit waits for the next hour. With one direction at a time, the stretch alternates direction in phases (rising chainage first); a lorry that cannot clear the stretch before its phase ends waits for the next phase in its direction. Only loaded trips are delayed.')]));
    }
    if (modOn('C3')) {
      const b = md.C3, rows = b.periods.map(x => h('tr', {},
        h('td', {}, h('select', { 'data-cell': 'mod:C3:' + x.id + ':sec', onchange: ev => { x.sec = ev.target.value; recompute(true); } }, h('option', { value: 'all', selected: !x.sec || x.sec === 'all' }, 'All sections'), scn.sections.map(sec => h('option', { value: sec.id, selected: x.sec === sec.id }, sec.name)))),
        cellIn(x, 'from', 'mod:C3:' + x.id + ':from', 'date'), cellIn(x, 'to', 'mod:C3:' + x.id + ':to', 'date'), cellIn(x, 'note', 'mod:C3:' + x.id + ':note', 'text', '150px'), rm(b.periods, x, 'periods', b)));
      pane.append(card('C3', 'Closing dates and closed periods', [tbl(['Section', 'Closed from', 'Closed until (blank = for good)', 'Reason', ''], rows),
        h('p', {}, h('button', { 'data-cell': 'mod:C3:add', onclick: () => { b.periods.push({ id: M.newId(), sec: 'all', from: scn.settings.startDate, to: scn.settings.startDate, note: 'Closed' }); recompute(true); } }, '+ Add a closed period')),
        hint('While a section is closed nothing loads from it and nothing tips into it (ecology windows, utility diversions, handover). Lorries can still drive through. Loads for a closed fill wait for it to reopen. The earliest tipping date in the Sections table is the opening date; this adds closing dates and closed periods to it.')]));
    }
    if (modOn('C4')) {
      const b = md.C4;
      pane.append(card('C4', 'Layered fill', [h('div', { class: 'settings' }, fld('Layers in each fill', b, 'layers', 'mod:C4:layers'), fld('Wait before the next layer (days)', b, 'waitDays', 'mod:C4:waitDays')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.mode === 'bySection', onchange: ev => { b.mode = ev.target.checked ? 'bySection' : 'site'; recompute(true); } }), ' Vary by section ', h('span', { class: 'hint' }, 'adds layer and wait columns for fill sections')),
        hint('Each fill takes its soil in equal layers. The next layer opens after the waiting period (settlement or surcharge), counted from the last tip in the layer before. A load never straddles two layers, so each layer boundary adds one short load. One layer with no wait is the same as having this module off.')]));
    }
    if (modOn('C5')) {
      const b = md.C5, rows = b.publicStretches.map(x => h('tr', {}, cellIn(x, 'name', 'mod:C5:' + x.id + ':name', 'text', '140px'), cellIn(x, 'fromM', 'mod:C5:' + x.id + ':fromM'), cellIn(x, 'toM', 'mod:C5:' + x.id + ':toM'), rm(b.publicStretches, x, 'publicStretches', b)));
      pane.append(card('C5', 'Public road versus internal movements', [
        h('div', { class: 'settings' }, fld('Public-road movements allowed per day', b, 'publicLimit', 'mod:C5:publicLimit'), fld('Internal movements allowed per day (blank = no extra limit)', b, 'internalLimit', 'mod:C5:internalLimit', { blank: true })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!b.publicAll, onchange: ev => { b.publicAll = ev.target.checked; recompute(true); } }), ' Treat every movement as a public-road movement'),
        tbl(['Public-road stretch', 'From chainage (m)', 'To chainage (m)', ''], rows),
        h('p', {}, h('button', { 'data-cell': 'mod:C5:add', onclick: () => { b.publicStretches.push({ id: M.newId(), name: 'Public road ' + (b.publicStretches.length + 1), fromM: 0, toM: Math.round(tot / 4) }); recompute(true); } }, '+ Add a public-road stretch')),
        hint('A movement is public if its route overlaps a listed stretch (or if you tick the box above, or if it goes to or from an off-site gate). The planning cap counts public movements only; the whole-site daily limit in the global settings still applies to all movements. A vehicle type that may not use public roads (B2) never makes a public movement.')]));
    }
    body.append(pane);
  }
  // ---------- Materials & sites (A1-A5) ----------
  function renderMaterials() {
    const body = $('tabbody'); body.replaceChildren();
    const md = scn.modules, pane = h('div', { id: 'matpane' });
    const hint = t => h('p', { class: 'hint' }, t);
    const fld = (label, obj, key, cellId, o) => {
      o = o || {};
      const inp = h('input', { type: o.type || 'number', value: obj[key], step: 'any', 'data-cell': cellId });
      inp.addEventListener('input', () => { obj[key] = o.type === 'text' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); });
      return h('div', {}, h('label', {}, label), inp);
    };
    const card = (id, title, kids) => h('div', { class: 'group' }, h('h4', {}, id + '  ' + title), kids);
    const cellIn = (obj, key, cellId, type, w) => { const inp = h('input', { type: type || 'number', value: obj[key], step: 'any', 'data-cell': cellId, style: w ? 'min-width:' + w : '' }); inp.addEventListener('input', () => { obj[key] = type === 'text' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); }); return h('td', {}, inp); };
    const mats = scn.materials, tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0);
    const used = id => scn.sections.some(x => x.lines.some(l => l.material === id));
    if (scn.settings.units === 'm3' && (modOn('A1') || modOn('A3'))) pane.append(h('div', { class: 'note' }, 'Quantities are entered in m³ at each soil type\u2019s own density (and fill as compacted m³ when A1 is on). Results are shown in tonnes, which is exact because every soil type has its own density.'));
    if (modOn('A1')) pane.append(card('A1', 'Bulking and compaction', [
      h('div', { class: 'settings' }, fld('Lorry body volume (loose m³)', md.A1, 'bodyM3', 'mod:A1:bodyM3')),
      hint('A load is limited by the lorry body as well as its payload: body volume ÷ bulking factor, times the soil’s density, is the most bank soil it can carry. A vehicle type can have its own body volume (B2). Cut quantities are in-situ (bank) soil; fill quantities are compacted.')]));
    if (modOn('A1') || modOn('A2') || modOn('A3')) {
      const tb = h('tbody');
      mats.forEach(m => tb.append(h('tr', {},
        cellIn(m, 'name', 'mod:A2:' + m.id + ':name', 'text', '130px'),
        h('td', {}, h('input', { type: 'color', class: 'sw', value: m.colour || '#a0855b', title: 'Colour on the time-chainage chart', onchange: ev => { m.colour = ev.target.value; S.dirty = true; changed(false); } })),
        modOn('A3') ? cellIn(m, 'density', 'mod:A3:' + m.id + ':density') : h('td', { class: 'num hint' }, scn.settings.density + ' (site)'),
        modOn('A1') ? cellIn(m, 'bulking', 'mod:A1:' + m.id + ':bulking') : null,
        modOn('A1') ? cellIn(m, 'compaction', 'mod:A1:' + m.id + ':compaction') : null,
        h('td', {}, h('button', { class: 'icon', title: used(m.id) ? 'Used by a section line' : 'Remove this material', disabled: used(m.id) || mats.length < 2, onclick: () => { scn.materials = mats.filter(x => x !== m); delete md.A2.accept[m.id]; for (const k in md.A2.accept) delete md.A2.accept[k][m.id]; recompute(true); } }, '✕')))));
      const heads = ['Soil type', 'Colour', 'Density (t per m³)'].concat(modOn('A1') ? ['Bulking (loose ÷ bank)', 'Compaction (compacted ÷ bank)'] : [], ['']);
      pane.append(card(modOn('A3') ? 'A3' : modOn('A1') ? 'A1' : 'A2', 'Soil types', [
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map(x => h('th', {}, x)))), tb)),
        h('p', {}, h('button', { onclick: () => { const id = M.newId(), m = M.defaultMaterial(scn.settings, id); m.name = 'Soil type ' + (mats.length + 1); mats.push(m); md.A2.accept[id] = { [id]: true }; recompute(true); } }, '+ Add soil type')),
        hint('Give each section line a soil type in the Sections table. A3 turns on the density column: quantities in m³ are converted to tonnes at each type’s own density instead of one site-wide figure.')]));
    }
    if (modOn('A2')) {
      const head = h('tr', {}, h('th', {}, 'Fill asks for ↓ / may take →'), mats.map(m => h('th', {}, m.name || m.id)));
      const rows = mats.map(req => h('tr', {}, h('th', {}, req.name || req.id), mats.map(src => {
        const diag = req.id === src.id, acc = md.A2.accept[req.id] = md.A2.accept[req.id] || {};
        return h('td', { class: 'ctr' }, h('input', { type: 'checkbox', checked: diag || !!acc[src.id], disabled: diag, title: diag ? 'A class always accepts itself' : (src.name || src.id) + ' may be placed in ' + (req.name || req.id) + ' fill', onchange: ev => { acc[src.id] = ev.target.checked; recompute(true); } }));
      })));
      pane.append(card('A2', 'Which soil may go where', [
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, head), h('tbody', {}, rows))),
        hint('Each fill line asks for a soil type. A tick means a different soil type may also be used for it. A load always goes first to a fill that asks for exactly its own type. Soil that fits nowhere is reported on the Messages tab, and it blocks the soil below it in its section.')]));
    }
    if (modOn('A4')) {
      const pts = md.A4.points, tb = h('tbody');
      pts.forEach(x => {
        const imp = x.kind === 'import', acc = x.accepts = x.accepts || [];
        const mc = f => 'mod:A4:' + x.id + ':' + f;
        tb.append(h('tr', {},
          cellIn(x, 'name', mc('name'), 'text', '120px'),
          h('td', {}, imp ? 'Import' : 'Export'),
          cellIn(x, 'chainageM', mc('chainageM')),
          imp ? h('td', {}, h('select', { 'data-cell': mc('material'), onchange: ev => { x.material = ev.target.value; recompute(true); } }, mats.map(m => h('option', { value: m.id, selected: m.id === x.material }, m.name || m.id))))
              : h('td', { class: 'acc' }, mats.map(m => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: acc.indexOf(m.id) >= 0, onchange: ev => { x.accepts = ev.target.checked ? acc.concat([m.id]) : acc.filter(a => a !== m.id); recompute(true); } }), ' ' + (m.name || m.id))), acc.length ? null : h('span', { class: 'hint' }, ' (none ticked = takes anything)')),
          cellIn(x, 'dailyT', mc('dailyT')), cellIn(x, 'costPerT', mc('costPerT')), cellIn(x, 'roundTripMin', mc('roundTripMin')),
          imp ? cellIn(x, 'lanes', mc('lanes')) : h('td', {}, '–'),
          h('td', {}, h('button', { class: 'icon', title: 'Remove this point', onclick: () => { md.A4.points = pts.filter(q => q !== x); recompute(true); } }, '✕'))));
      });
      pane.append(card('A4', 'Off-site import and export', [
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Type', 'Chainage (m)', 'Soil', 'Daily limit (t)', 'Cost (£ per t)', 'Round trip (min)', 'Loading lanes', ''].map(x => h('th', {}, x)))), tb)),
        h('p', {}, h('button', { 'data-cell': 'mod:A4:add', onclick: () => { pts.push({ id: M.newId(), name: 'Export gate ' + (pts.length + 1), kind: 'export', chainageM: Math.round(tot / 2), accepts: [], dailyT: 1000, costPerT: 5, roundTripMin: 45, lanes: 4 }); recompute(true); } }, '+ Export gate'), ' ',
          h('button', { onclick: () => { pts.push({ id: M.newId(), name: 'Import gate ' + (pts.length + 1), kind: 'import', material: mats[0].id, chainageM: Math.round(tot / 2), dailyT: 1000, costPerT: 10, roundTripMin: 45, lanes: 2 }); recompute(true); } }, '+ Import gate')),
        hint('An export takes surplus soil that no fill needs (only once the fills that can take it are full). An import supplies only the shortfall. The round trip is the time a lorry spends off site: loading time at an import, the return after tipping at an export. Quantities here are always tonnes.')]));
    }
    if (modOn('A5')) {
      const sts = md.A5.stockpiles, tb = h('tbody');
      sts.forEach(x => { const mc = f => 'mod:A5:' + x.id + ':' + f; tb.append(h('tr', {}, cellIn(x, 'name', mc('name'), 'text', '120px'), cellIn(x, 'chainageM', mc('chainageM')), cellIn(x, 'capacityT', mc('capacityT')), cellIn(x, 'handleCostPerT', mc('handleCostPerT')), cellIn(x, 'lanes', mc('lanes')),
        h('td', {}, h('button', { class: 'icon', title: 'Remove this stockpile', onclick: () => { md.A5.stockpiles = sts.filter(q => q !== x); recompute(true); } }, '✕')))); });
      pane.append(card('A5', 'Stockpiles', [
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Chainage (m)', 'Capacity (t)', 'Handling cost (£ per t)', 'Loading lanes', ''].map(x => h('th', {}, x)))), tb)),
        h('p', {}, h('button', { 'data-cell': 'mod:A5:add', onclick: () => { sts.push({ id: M.newId(), name: 'Stockpile ' + (sts.length + 1), chainageM: Math.round(tot / 2), capacityT: 10000, handleCostPerT: 2, lanes: 2 }); recompute(true); } }, '+ Add stockpile')),
        hint('When soil cannot go to a fill yet (it is not open), it is tipped at the nearest stockpile with room, and hauled out from the next day once a fill can take it. Hauling it out again costs the handling charge. Soil that nothing needs any more goes to an export if there is one, otherwise it stays parked in the stockpile and is reported as unplaced.')]));
    }
    body.append(pane);
  }
  function renderFleet() {
    const body = $('tabbody'); body.replaceChildren();
    const md = scn.modules, pane = h('div', { id: 'fleetpane' });
    const hint = t => h('p', { class: 'hint' }, t);
    const fld = (label, obj, key, cellId, o) => {
      o = o || {};
      const inp = h('input', { type: o.type || 'number', value: obj[key], step: 'any', 'data-cell': cellId });
      inp.addEventListener('input', () => { obj[key] = o.type === 'text' || o.type === 'date' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); });
      return h('div', {}, h('label', {}, label), inp);
    };
    const card = (id, title, kids) => h('div', { class: 'group' }, h('h4', {}, id + '  ' + title), kids);
    const vary = (id, label, extra) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: md[id].mode === 'bySection', onchange: ev => { md[id].mode = ev.target.checked ? 'bySection' : 'site'; recompute(true); } }), ' ' + label + ' ', h('span', { class: 'hint' }, extra));
    if (modOn('B1')) pane.append(card('B1', 'Fleet size and empty return', [
      h('div', { class: 'settings' }, fld('Number of lorries on site', md.B1, 'fleet', 'mod:B1:fleet')),
      modOn('B2') ? hint('Vehicle types (B2) is also on, so the fleet is the total of the types. This number is kept but not used.') : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!md.B1.depotOn, onchange: ev => { md.B1.depotOn = ev.target.checked; recompute(true); } }), ' Lorries return to a depot at the end of each day'),
      md.B1.depotOn ? h('div', { class: 'settings' }, fld('Depot chainage (m)', md.B1, 'depotM', 'mod:B1:depotM'), fld('Lorries leave the depot at', md.B1, 'depotLeave', 'mod:B1:depotLeave', { type: 'time' })) : null,
      hint(md.B1.depotOn ? 'Overnight every lorry drives empty to the depot and sets off again at the time above, so each morning\u2019s first loads wait for the lorries to arrive from the depot.' : 'Each lorry drives back empty from where it last tipped to its next loading point before it can load again, so a small fleet makes the haul cycle the limit. Without a depot, lorries stay where they finish each day.')]));
    if (modOn('B2')) {
      const tb = h('tbody');
      md.B2.types.forEach(t => {
        const c = (k, type, w) => { const inp = h('input', { type: type || 'number', value: t[k], step: 'any', 'data-cell': 'mod:B2:' + t.id + ':' + k, style: w ? 'min-width:' + w : '' }); inp.addEventListener('input', () => { t[k] = type === 'text' ? inp.value : inp.value === '' ? NaN : +inp.value; changed(false); }); return h('td', {}, inp); };
        tb.append(h('tr', {}, c('name', 'text', '140px'), c('payload'), c('speedLoaded'), c('speedEmpty'), c('qty'),
          h('td', {}, h('input', { type: 'checkbox', checked: t.publicRoad !== false, title: 'Used by the public-road limits in a later module', onchange: ev => { t.publicRoad = ev.target.checked; changed(false); } })),
          h('td', {}, h('button', { class: 'icon', title: 'Remove this type', onclick: () => { md.B2.types = md.B2.types.filter(x => x !== t); recompute(true); } }, '✕'))));
      });
      pane.append(card('B2', 'Vehicle types', [
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Payload (' + UL() + ')', 'Loaded speed (kph)', 'Empty speed (kph)', 'Number of vehicles', 'May use public roads', ''].map(x => h('th', {}, x)))), tb)),
        h('p', {}, h('button', { 'data-cell': 'mod:B2:add', onclick: () => { md.B2.types.push({ id: M.newId(), name: 'Vehicle type ' + (md.B2.types.length + 1), payload: scn.settings.loadTonnes, speedLoaded: scn.settings.speedKph, speedEmpty: scn.settings.speedKph, qty: 10, publicRoad: true }); recompute(true); } }, '+ Add vehicle type')),
        hint('Each lorry takes its own payload. The fleet is the total number of vehicles. When this is on, the global average load and speed are only used for the first loaded and empty speed defaults.')]));
    }
    if (modOn('B3')) pane.append(card('B3', 'Loaded and empty speeds', [
      h('div', { class: 'settings' }, fld('Loaded speed (kph)', md.B3, 'loadedKph', 'mod:B3:loadedKph'), fld('Empty speed (kph)', md.B3, 'emptyKph', 'mod:B3:emptyKph')),
      vary('B3', 'Vary by section', 'adds speed limit and gradient columns to the Sections table'),
      hint('Empty speed only matters when the fleet is limited (B1 or B2), because that is when a lorry’s return trip delays its next load. A gradient factor of 0.5 means half speed through that section.')]));
    if (modOn('B4')) pane.append(card('B4', 'Receiving rates', [
      h('div', { class: 'settings' }, fld('Receiving rate per fill section (' + UL() + ' per hour)', md.B4, 'rate', 'mod:B4:rate'), fld('Lorries that can tip at once', md.B4, 'bays', 'mod:B4:bays'), fld('Longest tipping queue allowed (min)', md.B4, 'maxQueueMin', 'mod:B4:maxQueueMin')),
      vary('B4', 'Vary by section', 'adds rate and bay columns for fill sections'),
      hint('The rate is the most a fill section can tip, spread and compact in an hour, shared between its bays. Lorries that arrive when every bay is busy queue, and the queue time is reported in the results. Loading is held back rather than send a lorry into a queue longer than the limit; blank means no limit.')]));
    if (modOn('B5')) {
      const b5 = md.B5, mach = [];
      if (b5.mode === 'byMachine') {
        const cuts = scn.sections.filter(x => M.secQty(x) > 0);
        b5.machines.forEach(m => {
          const asg = m.assignments.map(a => h('div', { class: 'asg' },
            h('select', { onchange: ev => { a.sec = ev.target.value; changed(false); } }, cuts.map(c => h('option', { value: c.id, selected: a.sec === c.id }, c.name)), cuts.some(c => c.id === a.sec) ? null : h('option', { value: a.sec, selected: true }, '(missing section)')),
            h('input', { type: 'date', value: a.from, title: 'From (blank = from the start)', onchange: ev => { a.from = ev.target.value; changed(false); } }),
            h('input', { type: 'date', value: a.to, title: 'To (blank = to the end)', onchange: ev => { a.to = ev.target.value; changed(false); } }),
            h('button', { class: 'icon', title: 'Remove this assignment', onclick: () => { m.assignments = m.assignments.filter(x => x !== a); recompute(true); } }, '✕')));
          const nm = h('input', { type: 'text', value: m.name }); nm.addEventListener('input', () => { m.name = nm.value; changed(false); });
          mach.push(h('div', { class: 'machine' },
            h('div', { class: 'settings' }, h('div', {}, h('label', {}, 'Machine'), nm), fld('Output (' + UL() + ' per hour)', m, 'rate', 'mod:B5:' + m.id + ':rate'),
              h('div', {}, h('label', {}, ' '), h('button', { onclick: () => { b5.machines = b5.machines.filter(x => x !== m); recompute(true); } }, 'Remove machine'))),
            h('div', { class: 'hint' }, 'Works at (section, from, to; blank dates mean the whole job):'), asg,
            h('button', { onclick: () => { m.assignments.push({ sec: cuts[0] ? cuts[0].id : '', from: '', to: '' }); recompute(true); } }, '+ Assignment')));
        });
      }
      pane.append(card('B5', 'Excavators', [
        h('div', { class: 'settings' },
          h('div', {}, h('label', {}, 'How are loading rates set?'), h('select', { onchange: ev => { b5.mode = ev.target.value; if (b5.mode === 'byMachine' && !b5.machines.length) b5.machines = M.machinesFromLoaders(scn); recompute(true); } },
            h('option', { value: 'site', selected: b5.mode !== 'byMachine' }, 'One output rate for every loader'), h('option', { value: 'byMachine', selected: b5.mode === 'byMachine' }, 'Individual machines, assigned over time'))),
          b5.mode === 'byMachine' ? fld('Lost time when a machine relocates (min)', b5, 'relocMin', 'mod:B5:relocMin') : fld('Output per excavator (' + UL() + ' per hour)', b5, 'rate', 'mod:B5:rate')),
        b5.mode === 'byMachine' ? [mach, h('p', {}, h('button', { 'data-cell': 'mod:B5:addMachine', onclick: () => { b5.machines.push({ id: M.newId(), name: 'Excavator ' + (b5.machines.length + 1), rate: b5.rate, assignments: [] }); recompute(true); } }, '+ Add machine'), ' ',
          h('button', { title: 'Replace the list with one machine per loader the sections allow', onclick: () => { b5.machines = M.machinesFromLoaders(scn); recompute(true); } }, 'Reset from loader counts'))] : null,
        hint(b5.mode === 'byMachine' ? 'Each machine loads one lorry at a time, so a section’s loading capacity is the machines assigned to it that day. The "Max loaders" column is not used.' : 'Each loader (the "Max loaders" column) is an excavator working at this rate, so a load takes load ÷ rate instead of the fixed loading time.')]));
    }
    if (modOn('B6')) pane.append(card('B6', 'Availability', [
      h('div', { class: 'settings' }, fld('Lorries uptime (%)', md.B6, 'lorries', 'mod:B6:lorries'), fld('Excavators uptime (%)', md.B6, 'excavators', 'mod:B6:excavators'), fld('Receiving plant uptime (%)', md.B6, 'receiving', 'mod:B6:receiving')),
      hint('Lost time is spread evenly: at 90% uptime every trip, load and tip takes 1/0.9 times as long. Random breakdowns come with the risk module later.')]));
    body.append(pane);
  }

  // ---------- optimiser panel ----------
  const GOALS = Optim.GOALS;
  const EFFORT = { quick: ['Quick (about 8 s)', 8000], normal: ['Normal (about 25 s)', 25000], thorough: ['Thorough (about 90 s)', 90000] };
  const OPT = { open: false, state: 'idle', goal: 'completion', effort: 'normal', frac: 0, prog: null, result: null, worker: null, job: null, applied: false, error: '' };
  // How the dispatch was decided. Anything that has not been through the optimiser says so plainly, on screen, in the report and in every export.
  function isOptimised(sc) { return E.planStatus(sc) === 'on' || !!(sc.optCheck && !sc.optCheck.improved && sc.optCheck.sig === E.sigOf(sc)); }
  function dispatchLabel(sc) {
    if (E.planStatus(sc) === 'on') { const hs = (sc.plan.holds || []).map(x => x.text); return 'Optimised plan: ' + GOALS[sc.plan.goal] + (hs.length ? ' (' + hs.join('; ') + ')' : ''); }
    if (isOptimised(sc)) return 'Simple dispatch (the optimiser found nothing better for "' + GOALS[sc.optCheck.goal] + '")';
    return 'Simple dispatch, not optimised';
  }
  function planText() { return dispatchLabel(scn); }
  function fmtDur(min) {
    const a = Math.abs(Math.round(min)), sg = min < 0 ? '−' : '+';
    if (a < 1) return 'no change';
    if (a < 60) return sg + a + ' min';
    if (a < 1440) return sg + Math.floor(a / 60) + ' h ' + (a % 60) + ' min';
    return sg + Math.floor(a / 1440) + ' d ' + Math.floor((a % 1440) / 60) + ' h';
  }
  function optRows(B, A) {
    const date = (m, x) => E.fmtTime(m, x.startDay);
    const num = (v, dp) => (dp ? v.toFixed(dp) : fmt(v));
    const diff = (b, a, dp, unit, goodDown) => { const d = a - b; if (Math.abs(d) < (dp ? 0.05 : 0.5)) return [h('span', {}, 'no change'), '']; return [(d > 0 ? '+' : '−') + num(Math.abs(d), dp) + (unit || ''), (d < 0) === goodDown ? 'good' : 'bad']; };
    const rows = [
      ['Last soil tipped', date(B.endTime, B), date(A.endTime, A), [fmtDur(A.endTime - B.endTime), A.endTime < B.endTime ? 'good' : A.endTime > B.endTime ? 'bad' : '']],
      ['Avg use of daily movement limit', (B.utilisation * 100).toFixed(1) + '%', (A.utilisation * 100).toFixed(1) + '%', diff(B.utilisation * 100, A.utilisation * 100, 1, ' pts', false)],
      ['Total tonne-km', fmt(B.tonneKm), fmt(A.tonneKm), diff(B.tonneKm, A.tonneKm, 0, '', true)],
      ['Idle working days', String(B.idleDays), String(A.idleDays), diff(B.idleDays, A.idleDays, 0, '', true)],
      ['Movements', fmt(B.moves), fmt(A.moves), diff(B.moves, A.moves, 0, '', true)],
      ['Peak trucks needed in a day', String(B.peakTrucks), String(A.peakTrucks), diff(B.peakTrucks, A.peakTrucks, 0, '', true)],
      ['Truck-hours', fmt(B.truckHours), fmt(A.truckHours), diff(B.truckHours, A.truckHours, 0, '', true)]
    ];
    if (B.cost !== undefined && A.cost !== undefined) rows.push(['Total cost (\u00a3)', fmt(B.cost), fmt(A.cost), diff(B.cost, A.cost, 0, '', true)]);
    if (B.co2t != null && A.co2t != null) rows.push(['Carbon (tCO\u2082e)', B.co2t.toFixed(1), A.co2t.toFixed(1), diff(B.co2t, A.co2t, 1, '', true)]);
    if (B.fleetDelayMin || A.fleetDelayMin) rows.push(['Hours loading held up for a lorry', fmt(B.fleetDelayMin / 60), fmt(A.fleetDelayMin / 60), diff(B.fleetDelayMin / 60, A.fleetDelayMin / 60, 0, '', true)]);
    if (B.tipWaitMin || A.tipWaitMin) rows.push(['Hours queuing to tip', fmt(B.tipWaitMin / 60), fmt(A.tipWaitMin / 60), diff(B.tipWaitMin / 60, A.tipWaitMin / 60, 0, '', true)]);
    return rows;
  }
  function optTable(B, A) {
    return h('table', { class: 'cmp' }, h('thead', {}, h('tr', {}, ['', 'Before', 'After', 'Change'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
      h('tbody', {}, optRows(B, A).map(r => h('tr', {}, h('td', {}, r[0]), h('td', { class: 'num' }, r[1]), h('td', { class: 'num' }, r[2]), h('td', { class: 'num ' + (r[3][1] || '') }, r[3][0])))));
  }
  function renderOptPanel() {
    const el = $('optpanel'); el.hidden = !OPT.open; if (!OPT.open) return;
    el.replaceChildren();
    el.append(h('div', { class: 'optrow' }, h('h3', { style: 'margin:0;flex:1' }, 'Optimise the plan'), h('button', { onclick: () => { OPT.open = false; renderOptPanel(); } }, 'Close')));
    if (!res) { el.append(h('div', { class: 'note err' }, 'Fix the problems under Messages before optimising.')); return; }
    if (OPT.state === 'running') {
      el.append(h('div', { id: 'optinfo' }, 'Starting…'), h('div', { class: 'optbar' }, h('i', { id: 'optbar' })),
        h('p', {}, h('button', { onclick: cancelOpt }, 'Cancel and show best so far'), ' ', h('span', { class: 'hint' }, OPT.usingWorker ? 'Running in the background; you can keep using the page.' : 'Running on the page (background workers are unavailable here), so the page may feel slower.')));
      updateOptProgress(); return;
    }
    const status = E.planStatus(scn);
    if ((OPT.goal === 'cost' && !modOn('E1')) || (OPT.goal === 'carbon' && !modOn('E2'))) OPT.goal = 'completion';
    const goalSel = h('select', { onchange: ev => (OPT.goal = ev.target.value) }, Object.keys(GOALS).filter(k => (k !== 'cost' || modOn('E1')) && (k !== 'carbon' || modOn('E2'))).map(k => h('option', { value: k, selected: OPT.goal === k }, GOALS[k])));
    const effSel = h('select', { onchange: ev => (OPT.effort = ev.target.value) }, Object.keys(EFFORT).map(k => h('option', { value: k, selected: OPT.effort === k }, EFFORT[k][0])));
    el.append(h('div', { class: 'optrow' }, h('div', {}, h('label', {}, 'Goal'), goalSel), h('div', {}, h('label', {}, 'Search time'), effSel), h('button', { class: 'primary', onclick: startOpt }, OPT.state === 'done' ? 'Run again' : 'Start')));
    el.append(h('p', { class: 'hint' }, 'The search changes which source feeds which destination, in what order, and who gets priority when the daily limit bites. It never changes your inputs, and every candidate is checked by the full simulation, so hours, days, loaders, opening dates and the daily limit are always respected.'));
    if (status !== 'none') {
      el.append(h('p', {}, status === 'on' ? 'Using the optimised plan for "' + GOALS[scn.plan.goal] + '". ' : status === 'off' ? 'An optimised plan is saved but switched off. ' : 'The saved plan is out of date (inputs changed) and is not being used. ',
        status === 'on' ? h('button', { onclick: () => { scn.plan.active = false; recompute(); renderOptPanel(); } }, 'Switch to nearest-available dispatch') : null,
        status === 'off' ? h('button', { onclick: () => { scn.plan.active = true; recompute(); renderOptPanel(); } }, 'Switch the plan on') : null, ' ',
        h('button', { onclick: () => { scn.plan = null; recompute(); renderOptPanel(); } }, 'Remove plan')));
    }
    if (OPT.error) el.append(h('div', { class: 'note err' }, OPT.error));
    const r = OPT.result;
    if (OPT.state === 'done' && r) {
      el.append(h('h3', {}, r.improved ? 'Result for "' + GOALS[r.goal] + '"' : 'No better plan found'),
        h('p', { class: 'hint' }, (r.cancelled ? 'Stopped early. ' : '') + fmt(r.iterations) + ' candidate plans tried in ' + r.seconds.toFixed(0) + ' s. ' + (r.improved ? '' : (r.reason || 'The current plan is the best this search found for this goal. Other limits (such as a fill that does not open until a set date) may be the real bottleneck.'))),
        optTable(r.before, r.after));
      const hs = r.plan && r.plan.holds ? r.plan.holds.map(x => x.text) : [];
      if (r.improved && hs.length) el.append(h('p', { class: 'hint' }, 'This plan ' + hs.join('; ') + ', because with the constraint gone the greedy dispatch finishes later than the plan made with it.'));
      if (r.improved && r.matchesDispatch) el.append(h('p', { class: 'hint' }, 'This plan matches plain dispatch: the dispatcher would also route the soil through the stockpile. The plan writes that route down so it no longer depends on the dispatcher\'s fallback.'));
      if (r.improved) el.append(h('p', {}, OPT.applied ? h('span', { class: 'good' }, 'This plan is now in use. ') : h('button', { class: 'primary', onclick: applyPlan }, 'Use this plan'), ' ', OPT.applied ? null : h('button', { onclick: () => { OPT.state = 'idle'; OPT.result = null; renderOptPanel(); } }, 'Discard')));
    }
  }
  function updateOptProgress() {
    const bar = $('optbar'), info = $('optinfo'), p = OPT.prog; if (!bar || !info) return;
    bar.style.width = Math.round(OPT.frac * 100) + '%';
    if (p && p.best && res) info.textContent = Math.round(OPT.frac * 100) + '%. ' + fmt(p.iter) + ' plans tried. Best so far: last soil tipped ' + E.fmtTime(p.best.endTime, res.P.startDay) + ', ' + (p.best.utilisation * 100).toFixed(1) + '% use of limit, ' + fmt(p.best.tonneKm) + ' t·km.';
  }
  function startOpt() {
    OPT.state = 'running'; OPT.frac = 0; OPT.prog = null; OPT.result = null; OPT.applied = false; OPT.error = '';
    const sc = JSON.parse(JSON.stringify(scn)); sc.saved = [];
    const msg = { cmd: 'start', scn: sc, goal: OPT.goal, budgetMs: EFFORT[OPT.effort][1], seed: 20270111 };
    let w = null;
    try { w = new Worker(URL.createObjectURL(new Blob([$('worker-src').textContent], { type: 'text/javascript' }))); } catch (e) { w = null; }
    const fallback = () => { if (OPT.worker) { try { OPT.worker.terminate(); } catch (e) { } OPT.worker = null; } runOnPage(sc, msg); };
    if (w) {
      OPT.worker = w; OPT.usingWorker = true;
      w.onmessage = ev => {
        const m = ev.data;
        if (m.type === 'progress') { OPT.frac = m.frac; OPT.prog = m; updateOptProgress(); }
        else if (m.type === 'done') { w.terminate(); OPT.worker = null; finishOpt(m.result); }
        else if (m.type === 'error') fallback();
      };
      w.onerror = () => fallback();
      renderOptPanel(); w.postMessage(msg);
    } else { renderOptPanel(); fallback(); }
  }
  function runOnPage(sc, msg) {
    OPT.usingWorker = false; renderOptPanel();
    try { OPT.job = Optim.create(sc, msg.goal, { budgetMs: msg.budgetMs, seed: msg.seed }); } catch (e) { OPT.state = 'idle'; OPT.error = 'The optimiser could not start: ' + e.message; renderOptPanel(); return; }
    const tick = () => {
      const job = OPT.job; if (!job) return;
      job.step(40); const p = job.progress(); OPT.frac = p.frac;
      OPT.prog = { iter: p.iter, best: { endTime: p.bestSummary.endTime, utilisation: p.bestSummary.utilisation, tonneKm: p.bestSummary.tonneKm } };
      updateOptProgress();
      if (job.done) { OPT.job = null; finishOpt(job.result); } else setTimeout(tick, 0);
    };
    tick();
  }
  function cancelOpt() { if (OPT.worker) OPT.worker.postMessage({ cmd: 'cancel' }); else if (OPT.job) OPT.job.cancel(); }
  function finishOpt(r) {
    OPT.state = 'done'; OPT.result = r;
    if (r.optCheck) { scn.optCheck = Object.assign({}, r.optCheck, { improved: !!r.improved }); autosave(); S.dirty = true; }  // remembered so the page can say "nothing better found" and so a later run can keep constraints that were removed
    renderOptPanel();
  }
  function applyPlan() {
    scn.plan = Object.assign({}, OPT.result.plan, { createdAt: Date.now() });
    OPT.applied = true; recompute(); renderOptPanel();
  }
  $('bOpt').onclick = () => { OPT.open = !OPT.open; renderOptPanel(); };

  // ---------- scenarios (D5) ----------
  function scenStats(sc) {
    sc = M.normalise(JSON.parse(JSON.stringify(sc)));
    if (M.validate(sc).some(i => i.level === 'error')) return null;
    const r = E.simulate(sc), p = Optim.pack(r), cc = E.costCarbon(sc, r);
    if (cc) { if (cc.total !== undefined) p.cost = cc.total; if (cc.co2t !== null) p.co2t = cc.co2t; }
    p.setup = MOD.badgeText(sc); p.plan = dispatchLabel(sc); p.optimised = isOptimised(sc);
    p.completionTxt = p.completion === null ? 'not complete' : E.fmtDay(p.startDay + p.completionDay);
    return p;
  }
  function saveScenario() {
    const copy = JSON.parse(JSON.stringify(scn)); copy.saved = [];
    scn.saved.push({ id: M.newId(), name: ($('savename').value || scn.name).trim() || 'Scenario', savedAt: new Date().toISOString(), scenario: copy });
    autosave(); renderTabs(true);
  }
  function loadSaved(sv) {
    const keep = scn.saved.slice(), cur = JSON.parse(JSON.stringify(scn)); cur.saved = [];
    if (JSON.stringify(cur) !== JSON.stringify(sv.scenario)) keep.push({ id: M.newId(), name: 'Backup before loading "' + sv.name + '"', savedAt: new Date().toISOString(), scenario: cur });
    const nx = JSON.parse(JSON.stringify(sv.scenario)); nx.saved = keep; setScenario(nx);
  }
  const CMP = { a: 'cur', b: 'cur' };
  function renderScenarios() {
    const body = $('tabbody'); body.replaceChildren();
    const sv = scn.saved;
    body.append(h('h3', {}, 'Saved scenarios'),
      h('p', {}, h('input', { type: 'text', id: 'savename', value: scn.name, style: 'max-width:320px' }), ' ', h('button', { onclick: saveScenario }, 'Save the current scenario as a new entry')));
    if (!sv.length) body.append(h('p', { class: 'hint' }, 'Nothing saved yet. Save a scenario, change something (switch a module on, optimise, alter a date), then compare the two side by side below.'));
    else body.append(h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Saved', ''].map(c => h('th', {}, c)))),
      h('tbody', {}, sv.map(x => h('tr', {}, h('td', {}, x.name), h('td', {}, new Date(x.savedAt).toLocaleString('en-GB')),
        h('td', { style: 'white-space:nowrap' }, h('button', { onclick: () => loadSaved(x) }, 'Load'), ' ', h('button', { onclick: () => { scn.saved = scn.saved.filter(y => y !== x); if (CMP.a === x.id) CMP.a = 'cur'; if (CMP.b === x.id) CMP.b = 'cur'; autosave(); renderTabs(true); } }, 'Delete'))))))));
    const opt = sel => [h('option', { value: 'cur', selected: sel === 'cur' }, 'Current (live)')].concat(sv.map(x => h('option', { value: x.id, selected: sel === x.id }, x.name)));
    body.append(h('h3', {}, 'Compare two'),
      h('div', { class: 'optrow' }, h('div', {}, h('label', {}, 'A'), h('select', { onchange: ev => { CMP.a = ev.target.value; renderScenarios(); } }, opt(CMP.a))),
        h('div', {}, h('label', {}, 'B'), h('select', { onchange: ev => { CMP.b = ev.target.value; renderScenarios(); } }, opt(CMP.b)))));
    const get = id => { if (id === 'cur') return scenStats(scn); const x = sv.find(y => y.id === id); return x ? scenStats(x.scenario) : null; };
    const A = get(CMP.a), B = get(CMP.b);
    if (!A || !B) { body.append(h('div', { class: 'note err' }, 'One of these scenarios has problems that stop it running, so it cannot be compared.')); return; }
    const un = [['A', A], ['B', B]].filter(x => !x[1].optimised).map(x => x[0]);
    if (un.length) body.append(h('div', { class: 'note warn' }, (un.length === 2 ? 'Neither scenario has been optimised' : 'Scenario ' + un[0] + ' has not been optimised') + ': ' + (un.length === 2 ? 'both use' : 'it uses') + ' simple dispatch, which is greedy and not always the best the job can do. A difference between them may come from the dispatch rather than from the inputs. Optimise ' + (un.length === 2 ? 'both' : 'it') + ' for a fair comparison.'));
    const d = (a, b, dp, unit, goodDown) => { const x = b - a; if (Math.abs(x) < (dp ? 0.05 : 0.5)) return ['no change', '']; return [(x > 0 ? '+' : '−') + (dp ? Math.abs(x).toFixed(dp) : fmt(Math.abs(x))) + (unit || ''), (x < 0) === goodDown ? 'good' : 'bad']; };
    const rows = [
      ['Setup', A.setup, B.setup, ['', '']], ['Dispatch', A.plan, B.plan, ['', '']],
      ['Last soil tipped', E.fmtTime(A.endTime, A.startDay), E.fmtTime(B.endTime, B.startDay), [fmtDur(B.endTime - A.endTime), B.endTime < A.endTime ? 'good' : B.endTime > A.endTime ? 'bad' : '']],
      ['Overall completion (all levels reached)', A.completionTxt, B.completionTxt, ['', '']],
      ['Movements', fmt(A.moves), fmt(B.moves), d(A.moves, B.moves, 0, '', true)],
      ['Soil moved (t)', fmt(A.tonnesMoved), fmt(B.tonnesMoved), d(A.tonnesMoved, B.tonnesMoved, 0, '', false)],
      ['Avg use of daily movement limit', (A.utilisation * 100).toFixed(1) + '%', (B.utilisation * 100).toFixed(1) + '%', d(A.utilisation * 100, B.utilisation * 100, 1, ' pts', false)],
      ['Idle working days', String(A.idleDays), String(B.idleDays), d(A.idleDays, B.idleDays, 0, '', true)],
      ['Total tonne-km', fmt(A.tonneKm), fmt(B.tonneKm), d(A.tonneKm, B.tonneKm, 0, '', true)],
      ['Peak trucks needed in a day', String(A.peakTrucks), String(B.peakTrucks), d(A.peakTrucks, B.peakTrucks, 0, '', true)],
      ['Trucks to cover 95% of days', String(A.p95Trucks), String(B.p95Trucks), d(A.p95Trucks, B.p95Trucks, 0, '', true)],
      ['Truck-hours', fmt(A.truckHours), fmt(B.truckHours), d(A.truckHours, B.truckHours, 0, '', true)]
    ];
    if (A.cost !== undefined && B.cost !== undefined) rows.push(['Total cost (\u00a3)', fmt(A.cost), fmt(B.cost), d(A.cost, B.cost, 0, '', true)]);
    if (A.co2t != null && B.co2t != null) rows.push(['Carbon (tCO\u2082e)', A.co2t.toFixed(1), B.co2t.toFixed(1), d(A.co2t, B.co2t, 1, '', true)]);
    if (A.fleetSize || B.fleetSize) rows.push(['Fleet size', A.fleetSize ? fmt(A.fleetSize) : 'unlimited', B.fleetSize ? fmt(B.fleetSize) : 'unlimited', ['', '']]);
    if (A.fleetDelayMin || B.fleetDelayMin) rows.push(['Hours loading held up for a lorry', fmt(A.fleetDelayMin / 60), fmt(B.fleetDelayMin / 60), d(A.fleetDelayMin / 60, B.fleetDelayMin / 60, 0, '', true)]);
    if (A.tipWaitMin || B.tipWaitMin) rows.push(['Hours queuing to tip', fmt(A.tipWaitMin / 60), fmt(B.tipWaitMin / 60), d(A.tipWaitMin / 60, B.tipWaitMin / 60, 0, '', true)]);
    body.append(h('div', { class: 'scroll' }, h('table', { class: 'cmp' }, h('thead', {}, h('tr', {}, ['', 'A', 'B', 'B minus A'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', {}, r[0]), h('td', { class: 'num' }, r[1]), h('td', { class: 'num' }, r[2]), h('td', { class: 'num ' + (r[3][1] || '') }, r[3][0])))))));
  }

  // ---------- export / save / load ----------
  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove();
  }
  const csvq = v => { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csvRow = a => a.map(csvq).join(',') + '\r\n';
  const slug = () => (scn.name || 'scenario').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  function csvHeader(title) { return csvRow(['# ' + title]) + csvRow(['# Scenario: ' + scn.name]) + csvRow(['# ' + MOD.badgeText(scn)]) + csvRow(['# ' + planText()]) + (M.rateNoteText(scn) ? csvRow(['# Results are ' + M.rateNoteText(scn) + ': placeholders, not site rates']) : '') + csvRow([]); }
  function exportResults() {
    if (!res) return; const P = res.P, s = res.summary;
    let out = '﻿' + csvHeader('Earthmove results');
    out += csvRow(['Overall completion', s.completion === null ? 'not complete' : E.fmtDay(P.startDay + s.completionDay)]);
    out += csvRow(['Movements', s.moves]) + csvRow(['Quantity moved (' + RL() + ')', Math.round(s.tonnesMoved / UF())]) + csvRow(['Tonne-km', Math.round(s.tonneKm)]) + csvRow(['Units', scn.settings.units === 'm3' ? 'm3 (density ' + UF() + ' t per m3)' : 'tonnes']);
    out += csvRow(['Avg utilisation of daily limit %', (s.utilisation * 100).toFixed(1)]) + csvRow(['Idle working days', s.idleDays]);
    out += csvRow(['Peak trucks needed in a day', trucks.peak]) + csvRow(['Trucks to cover 95% of working days', trucks.p95]) + csvRow(['Median daily peak trucks', trucks.median]) + csvRow(['Total truck-hours', Math.round(trucks.truckHours)]) + csvRow(['Average truck cycle min', Math.round(trucks.avgCycleMin)]);
    const u = RL();
    out += csvRow(['Total cut ' + u, Math.round(s.totalCut / UF())]) + csvRow(['Total fill ' + u, Math.round(s.totalFill / UF())]) + csvRow(['Unplaced surplus ' + u, Math.round(s.unplacedSurplus / UF())]) + csvRow(['Unfilled shortfall ' + u, Math.round(s.unfilled / UF())]) + csvRow([]);
    out += csvRow(['Section', 'Type', 'Starting quantity ' + RL()].concat(modOn('E8') ? ['Earthworks start'] : [], ['Reaches level', 'Remaining ' + RL(), 'Soil went to / came from']));
    const list = o => Object.keys(o).map(k => P.names[+k] + ' ' + Math.round(o[k] / UF()) + ' ' + RL()).join('; ');
    res.sections.forEach((r, ri) => (out += csvRow([r.name, r.type, Math.round(r.qty / UF())].concat(modOn('E8') ? [TC.data && TC.data.sections[ri].start !== null ? levelDate(TC.data.sections[ri].start) : ''] : [], [r.type === 'none' ? '' : r.remaining > 0.5 ? 'not reached' : levelDate(r.levelTime), Math.round(r.remaining / UF()), r.type === 'cut' ? list(r.to) : list(r.from)]))));
    download(slug() + '_results.csv', out, 'text/csv');
  }
  function exportDaily() {
    if (!res) return; const L = res.log, P = res.P, tn = [];
    for (let k = 0; k < res.n; k++) { const d = Math.floor(L.start[k] / 1440); tn[d] = (tn[d] || 0) + L.t[k]; }
    let out = '﻿' + csvHeader('Earthmove daily summary') + csvRow(['Date', 'Weekday', 'Movements', (RL() === 't' ? 'Tonnes' : 'm3') + ' loaded', 'Peak trucks needed']);
    for (let d = 0; d < trucks.dayPeak.length; d++) out += csvRow([E.fmtDay(P.startDay + d), E.DOW_NAMES[E.dowOf(P.startDay + d)], res.daily[d] || 0, Math.round((tn[d] || 0) / UF()), trucks.dayPeak[d]]);
    download(slug() + '_daily.csv', out, 'text/csv');
  }
  function exportLog() {
    if (!res) return; const L = res.log, P = res.P;
    let out = '﻿' + csvHeader('Earthmove movement log') + csvRow(['Movement', 'From', 'To', RL() === 't' ? 'Tonnes' : 'm3', 'Distance km', 'Loading starts', 'Departs', 'Tipped'].concat(res.mlog ? ['Soil', 'Tonnes (exact)'] : []));
    for (let k = 0; k < res.n; k++) out += csvRow([k + 1, P.names[L.src[k]], P.names[L.dst[k]], +(L.t[k] / UF()).toFixed(3), (E.dist(P, L.src[k], L.dst[k]) / 1000).toFixed(3), E.fmtTime(L.start[k], P.startDay), E.fmtTime(L.depart[k], P.startDay), E.fmtTime(L.tip[k], P.startDay)].concat(res.mlog ? [matName(res.mlog.mat[k]), +L.t[k].toFixed(3)] : []));
    download(slug() + '_movement_log.csv', out, 'text/csv');
  }
  function setScenario(sc) { scn = M.normalise(sc); S.t = 0; S.zoom = 1; S.x0 = 0; S.delta = null; setPlaying(false); recompute(true); if (S.screen === 'setup') renderSetup(); }

  // ---------- wiring ----------
  $('btnSetup').onclick = () => showScreen(S.screen === 'setup' ? 'main' : 'setup');
  $('btnSave').onclick = () => download(slug() + '.earthmove.json', JSON.stringify(scn, null, 1), 'application/json');
  $('btnLoad').onclick = () => $('fileLoad').click();
  $('fileLoad').onchange = ev => {
    const f = ev.target.files[0]; if (!f) return;
    f.text().then(t => { try { const o = JSON.parse(t); if (!o.sections) throw new Error('This file has no sections.'); setScenario(o); } catch (e) { alert('Could not load that file: ' + e.message); } });
    ev.target.value = '';
  };
  $('selExample').onchange = ev => { const k = ev.target.value; ev.target.value = ''; if (k && confirm('Replace the current scenario with this example?')) setScenario(M.EXAMPLES[k]()); };
  $('scnname').addEventListener('input', ev => { scn.name = ev.target.value; autosave(); });
  $('bPlay').onclick = () => { if (!res) return; if (!S.playing && S.t >= endT) S.t = 0; setPlaying(!S.playing); };
  $('bRestart').onclick = () => { setPlaying(false); seek(0); };
  $('bStepH').onclick = () => { setPlaying(false); seek(S.t + 60); };
  $('bStepD').onclick = () => { setPlaying(false); seek(S.t + 1440); };
  $('skipIdle').onchange = ev => { S.skip = ev.target.checked; try { localStorage.setItem('earthmove.skip', S.skip ? '1' : '0'); } catch (e) { } };
  try { if (localStorage.getItem('earthmove.skip') === '0') { S.skip = false; $('skipIdle').checked = false; } } catch (e) { }
  $('speed').oninput = ev => { S.speedV = +ev.target.value; $('speedlbl').textContent = speedLabel(); };
  $('speed').value = S.speedV; $('speedlbl').textContent = speedLabel();
  window.addEventListener('resize', () => (S.dirty = true));
  window.addEventListener('keydown', ev => { if (ev.code === 'Space' && S.screen === 'main' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(ev.target.tagName)) { ev.preventDefault(); $('bPlay').click(); } });

  // light / dark / automatic (follows the system). Chosen per browser, default light.
  function themeNow() { try { return localStorage.getItem('earthmove.theme') || 'light'; } catch (e) { return 'light'; } }
  function applyTheme(t) {
    const r = document.documentElement;
    if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    $('btnTheme').textContent = 'Theme: ' + (t === 'auto' ? 'Auto (' + (sysDark ? 'dark' : 'light') + ')' : t === 'dark' ? 'Dark' : 'Light');
    colours(); TC.layer = null; S.dirty = true;
  }
  $('btnTheme').onclick = () => { const n = { light: 'dark', dark: 'auto', auto: 'light' }[themeNow()] || 'light'; try { localStorage.setItem('earthmove.theme', n); } catch (e) { } applyTheme(n); };

  scn = load() || M.exampleSimple();
  $('scnname').value = scn.name;
  recompute(true);
  applyTheme(themeNow());
  showScreen('main');
  (function () { // optional start-up hash, e.g. #t=20160&screen=setup&tab=results
    const q = {}; location.hash.slice(1).split('&').forEach(p => { const [k, v] = p.split('='); if (k) q[k] = v; });
    if (q.theme) { try { localStorage.setItem('earthmove.theme', q.theme); } catch (e) { } applyTheme(q.theme); }
    if (q.e8) { scn.setup.modules.E8 = true; recompute(true); }
    if (q.replay) { scn.setup.modules.E7 = true; recompute(true); setReplay(true); }
    if (q.example && M.EXAMPLES[q.example]) setScenario(M.EXAMPLES[q.example]());
    if (q.units) { M.setUnits(scn, q.units); recompute(true); }
    if (q.t && res) seek(+q.t); if (q.zoom) S.zoom = +q.zoom; if (q.x0) S.x0 = +q.x0;
    if (q.tab) { S.tab = q.tab; renderTabs(true); } if (q.screen) showScreen(q.screen);
  })();
  requestAnimationFrame(frame);
  window.__earthmove = { buildReport, setReplay, get scn() { return scn; }, get res() { return res; }, S, recompute, setScenario, geom: () => geom(), drawTC, levelDate,
    tc: () => { const e = tcEnv(); return { win: e.win, data: TC.data, down: e.st.timeDown, y: d => e.tg.dayToY(d), day: y => e.tg.yToDay(y), pt: e.tg.pt, pb: e.tg.pb }; },
    tcSkip: sk => { TC.skip = sk; }, tcProf: () => { TC.prof = true; TC.layer = null; drawTC(); drawTC(); TC.layer = null; drawTC(); return { stages: TC.profOut, draw: TC.profDraw }; }, tcPng: () => { drawTC(); return $('tcchart').toDataURL('image/png'); } };
})();
