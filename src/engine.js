/* Earthmove engine: pure simulation, no DOM. Shared by page, worker and Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 1440;
  const DEPOT = -3; // lorry position: at the depot
  const EPS = 0.01; // tonnes: remainders under 10 kg count as done, so unit-conversion rounding never makes a phantom load

  // ---------- date / time helpers (all UTC, no time zones) ----------
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const v = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(v);
    if (d.getUTCMonth() !== +m[2] - 1) return null; // e.g. 31 Feb
    return Math.floor(v / 86400000);
  }
  function hm(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    if (!m) return null;
    const v = +m[1] * 60 + +m[2];
    return v <= 1440 ? v : null;
  }
  const pad = n => (n < 10 ? '0' + n : '' + n);
  function dayToISO(dn) {
    const d = new Date(dn * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function fmtDay(dn) {
    const d = new Date(dn * 86400000);
    return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function fmtClock(minOfDay) {
    const m = Math.round(minOfDay);
    return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  }
  // minutes-since-project-start -> "dd/mm/yyyy hh:mm"
  function fmtTime(min, startDay) {
    const d = Math.floor(min / DAY);
    return fmtDay(startDay + d) + ' ' + fmtClock(min - d * DAY);
  }
  const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // Monday = 0. 1970-01-01 was a Thursday.
  const dowOf = dn => (((dn + 3) % 7) + 7) % 7;

  // ---------- scenario -> flat typed arrays ----------
  function netQty(s) {
    let q = 0;
    for (const l of s.lines || []) q += +l.qty || 0;
    return q;
  }
  // Tonnes held by one unit of a section line's quantity. Tonnes mode: 1. m3 mode: the material density (A3) or the site
  // density, divided by the compaction factor for fill lines when A1 is on (fill is entered as compacted m3, cut as bank m3).
  function lineFactor(scn, l, units) {
    if ((units || scn.settings.units) !== 'm3') return 1;
    const mods = (scn.setup && scn.setup.modules) || {}, st = scn.settings;
    const m = (scn.materials || []).find(x => x.id === l.material);
    const rho = mods.A3 && m && +m.density > 0 ? +m.density : (+st.density > 0 ? +st.density : 1);
    const cf = mods.A1 && +l.qty < 0 && m && +m.compaction > 0 ? +m.compaction : 1;
    return rho / cf;
  }
  const lineTonnes = (scn, l) => (+l.qty || 0) * lineFactor(scn, l);
  function prepare(scn) {
    const st = scn.settings, secs = scn.sections, n = secs.length, nn = n; // nn = sections + off-site/stockpile nodes (none yet)
    const startDay = parseISO(st.startDate);
    // Quantities are stored in the unit the user chose (settings.units) and converted to tonnes here.
    const uf = st.units === 'm3' && +st.density > 0 ? +st.density : 1;
    const modsOn = (scn.setup && scn.setup.modules) || {}, perLine = !!(modsOn.A1 || modsOn.A2 || modsOn.A3 || modsOn.A4 || modsOn.A5); // per-line conversion only when a material module is on
    const P = {
      n, nn, kind: new Uint8Array(nn), startDay, unitF: uf, // kind: 0 section, 1 import, 2 export, 3 stockpile
      speed: +st.speedKph, loadT: +st.loadTonnes * uf, loadMin: Math.round(+st.loadMinutes), cap: Math.floor(+st.maxMovesPerDay),
      ids: [], names: [],
      len: new Float64Array(nn), chain: new Float64Array(nn), mid: new Float64Array(nn), qty: new Float64Array(nn),
      openDay: new Float64Array(nn), ws: new Int32Array(nn), we: new Int32Array(nn), loaders: new Int32Array(nn),
      workDays: [], total: 0, srcs: [], dsts: [], destOrder: []
    };
    let c = 0;
    for (let i = 0; i < n; i++) {
      const s = secs[i];
      P.ids.push(s.id); P.names.push(s.name);
      P.len[i] = +s.lengthM; P.chain[i] = c; P.mid[i] = c + P.len[i] / 2; c += P.len[i];
      P.qty[i] = perLine ? (s.lines || []).reduce((a, l) => a + lineTonnes(scn, l), 0) : netQty(s) * uf;
      const od = s.openFrom ? parseISO(s.openFrom) : null;
      P.openDay[i] = od === null ? -1e9 : od - startDay;
      P.ws[i] = hm(s.workStart); P.we[i] = hm(s.workEnd);
      P.loaders[i] = Math.max(1, Math.floor(+s.maxLoaders || 1));
      P.workDays.push((s.workDays || [1, 1, 1, 1, 1, 0, 0]).map(Boolean));
      if (P.qty[i] > 0) P.srcs.push(i);
      else if (P.qty[i] < 0) P.dsts.push(i);
    }
    P.total = c;
    P.cfg = buildCfg(scn, P, uf);
    // per-source destination list, nearest first (ties by section order)
    for (const i of P.srcs) {
      P.destOrder[i] = P.dsts.slice().sort((a, b) => Math.abs(P.mid[a] - P.mid[i]) - Math.abs(P.mid[b] - P.mid[i]) || a - b);
    }
    return P;
  }

  // Optional fleet-and-plant modules (B1-B6), read from the scenario. Every module is off unless its flag is true,
  // and with all of them off `simple` is true and the engine follows the original core path exactly.
  function buildCfg(scn, P, uf) {
    const mods = (scn.setup && scn.setup.modules) || {}, md = scn.modules || {}, st = scn.settings, n = P.n;
    const num = (v, d) => (+v > 0 ? +v : d);
    const idx = {}; P.ids.forEach((id, i) => (idx[id] = i));
    const c = { useFleet: false, fleetSize: 0, types: [], simple: true, recv: null, exc: null, uLorry: 1, uExc: 1, uRecv: 1, mat: null };
    if (mods.B6) {
      const b = md.B6 || {}, pct = v => (+v > 0 && +v <= 100 ? +v / 100 : 1);
      c.uLorry = pct(b.lorries); c.uExc = pct(b.excavators); c.uRecv = pct(b.receiving);
    }
    const b3 = mods.B3 ? (md.B3 || {}) : null;
    const baseL = b3 ? num(b3.loadedKph, +st.speedKph) : +st.speedKph;
    const baseE = b3 ? num(b3.emptyKph, baseL) : baseL;
    const a1body = mods.A1 ? num((md.A1 || {}).bodyM3, Infinity) : Infinity; // lorry body in loose m3 (A1)
    let defs = null;
    if (mods.B2) {
      const ts = ((md.B2 || {}).types || []).filter(t => Math.floor(+t.qty) > 0 && +t.payload > 0);
      if (ts.length) defs = ts.map(t => ({ name: t.name, payload: +t.payload * uf, vL: num(t.speedLoaded, baseL), vE: num(t.speedEmpty, baseE), qty: Math.floor(+t.qty), body: num(t.bodyM3, a1body) }));
    }
    if (!defs) defs = [{ name: 'Lorry', payload: P.loadT, body: a1body, vL: baseL, vE: baseE, qty: mods.B1 ? Math.max(1, Math.floor(num((md.B1 || {}).fleet, 1))) : Infinity }];
    c.useFleet = !!mods.B1 || defs[0].qty !== Infinity;
    c.simple = !(mods.B2 || mods.B3 || c.uLorry !== 1);
    // per-section speed limit and gradient factors (B3, "vary by section")
    const lim = new Float64Array(n), gL = new Float64Array(n).fill(1), gE = new Float64Array(n).fill(1);
    if (b3 && b3.mode === 'bySection') {
      for (let i = 0; i < n; i++) {
        const o = (b3.bySection || {})[P.ids[i]];
        if (o) { lim[i] = +o.limitKph > 0 ? +o.limitKph : 0; gL[i] = num(o.gradLoaded, 1); gE[i] = num(o.gradEmpty, 1); }
      }
    }
    // cumulative travel minutes from the road start to each section midpoint, so a trip is |cum[j] - cum[i]|
    const cum = (v, g) => {
      const mid = new Float64Array(n), start = new Float64Array(n), mpmA = new Float64Array(n); let acc = 0;
      for (let i = 0; i < n; i++) {
        const sp = (lim[i] > 0 ? Math.min(v, lim[i]) : v) * g[i], mpm = 60 / (1000 * sp) / c.uLorry;
        start[i] = acc; mpmA[i] = mpm; mid[i] = acc + P.len[i] / 2 * mpm; acc += P.len[i] * mpm;
      }
      return { mid, start, mpm: mpmA };
    };
    c.types = defs.map(d => {
      const t = { name: d.name, payload: d.payload, qty: d.qty, body: d.body };
      if (!c.simple) { const l = cum(d.vL, gL), e = cum(d.vE, gE); t.cumL = l.mid; t.cumE = e.mid; t.eStart = e.start; t.eMpm = e.mpm; }
      return t;
    });
    // B1 option: lorries go back to a depot at the end of each day and leave it at a set time next morning
    const b1 = mods.B1 ? (md.B1 || {}) : null;
    c.depot = b1 && b1.depotOn ? { x: Math.min(Math.max(+b1.depotM || 0, 0), P.total), leave: hm(b1.depotLeave) === null ? 420 : hm(b1.depotLeave) } : null;
    c.fleetSize = c.useFleet ? c.types.reduce((a, t) => a + Math.min(t.qty, 20000), 0) : 0;
    if (mods.B4) { // receiving rates: tonnes per hour per fill section, and tipping bays
      const b = md.B4 || {}, rate = new Float64Array(n), bays = new Int32Array(n);
      for (const j of P.dsts) {
        let r = num(b.rate, 300), bb = Math.max(1, Math.floor(num(b.bays, 1)));
        if (b.mode === 'bySection') { const o = (b.bySection || {})[P.ids[j]]; if (o) { r = num(o.rate, r); bb = Math.max(1, Math.floor(num(o.bays, bb))); } }
        rate[j] = r * uf; bays[j] = bb;
      }
      c.recv = { rate, bays, maxQ: +b.maxQueueMin >= 0 && b.maxQueueMin !== '' && b.maxQueueMin !== null ? +b.maxQueueMin : Infinity };
    }
    if (mods.B5) { // excavators: one site-wide output rate, or individual machines assigned over time
      const b = md.B5 || {};
      c.exc = { mode: b.mode === 'byMachine' ? 'byMachine' : 'site', rate: num(b.rate, 150) * uf, reloc: Math.max(0, Math.round(+b.relocMin || 0)), machines: [] };
      if (c.exc.mode === 'byMachine') {
        c.exc.machines = (b.machines || []).map(m => ({
          rate: num(m.rate, 150) * uf,
          asg: (m.assignments || []).map(a => {
            const si = idx[a.sec]; if (si === undefined) return null;
            const f = a.from ? parseISO(a.from) : null, t = a.to ? parseISO(a.to) : null;
            return { i: si, from: f === null ? -Infinity : f - P.startDay, to: t === null ? Infinity : t - P.startDay };
          }).filter(Boolean)
        }));
      }
    }
    if (['A1', 'A2', 'A3', 'A4', 'A5'].some(k => mods[k])) c.mat = buildMat(scn, P, uf); // material layer (Phase 4); null keeps the core path untouched
    return c;
  }
  // Material layer inputs (A1-A5). Quantities are in tonnes. Not read by simulate() yet.
  //   srcLines[i] = [{m, t}]  cut lines in dig order;  dstLines[j] = [{req, needT}]  fill lines;
  //   occ[m] = compacted m3 occupied by one tonne;  acc[req][m] = true when class m may be placed in required class req.
  function buildMat(scn, P, uf) {
    const mods = scn.setup.modules, md = scn.modules || {}, st = scn.settings;
    const mats = scn.materials || [], byId = {}; mats.forEach(m => (byId[m.id] = m));
    const a1 = !!mods.A1, a3 = !!mods.A3, accept = mods.A2 ? ((md.A2 || {}).accept || {}) : null;
    const M = { ids: mats.map(m => m.id), srcLines: [], dstLines: [], occ: {}, acc: {}, rho: {}, bulk: {}, a1, a2: !!mods.A2, a3, a4: !!mods.A4, a5: !!mods.A5 };
    mats.forEach(m => {
      const rho = a3 && +m.density > 0 ? +m.density : (+st.density > 0 ? +st.density : 1.8);
      M.occ[m.id] = (a1 && +m.compaction > 0 ? +m.compaction : 1) / rho;
      M.rho[m.id] = rho; M.bulk[m.id] = a1 && +m.bulking > 0 ? +m.bulking : 1;
    });
    mats.forEach(r => { M.acc[r.id] = {}; mats.forEach(m => (M.acc[r.id][m.id] = accept ? !!((accept[r.id] || {})[m.id]) || r.id === m.id : true)); });
    scn.sections.forEach((s, i) => {
      const lines = s.lines || [];
      M.srcLines[i] = lines.filter(l => +l.qty > 0).map(l => ({ m: l.material, t: lineTonnes(scn, l) }));
      M.dstLines[i] = lines.filter(l => +l.qty < 0).map(l => ({ req: l.material, needT: -lineTonnes(scn, l) }));
    });
    return M;
  }
  const dist = (P, i, j) => Math.abs(P.mid[i] - P.mid[j]);
  const travelMin = (P, i, j) => Math.round(dist(P, i, j) / 1000 / P.speed * 60);
  const tripL = (P, t, i, j) => (P.cfg.simple ? travelMin(P, i, j) : Math.round(Math.abs(t.cumL[j] - t.cumL[i]) + 1e-9));
  // empty trip between a depot at chainage x (metres) and the midpoint of section i
  const tripX = (P, t, x, i) => {
    if (P.cfg.simple) return Math.round(Math.abs(x - P.mid[i]) / 1000 / P.speed * 60);
    let lo = 0, hi = P.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P.chain[m] <= x) lo = m; else hi = m - 1; }
    return Math.round(Math.abs(t.cumE[i] - (t.eStart[lo] + (x - P.chain[lo]) * t.eMpm[lo])) + 1e-9);
  };
  const tripE = (P, t, i, j) => (P.cfg.simple ? travelMin(P, i, j) : Math.round(Math.abs(t.cumE[j] - t.cumE[i]) + 1e-9));

  // Exact minimum tonne-km flow (transportation problem) by successive shortest paths.
  // supply[s], need[d], cost[s*nd+d] (km). Returns flat flow array and total flow.
  function minCostFlow(supply, need, cost) {
    const ns = supply.length, nd = need.length, S = 0, T = ns + nd + 1, N = T + 1;
    const to = [], cap = [], cst = [], nxt = [], head = new Array(N).fill(-1);
    const add = (u, v, c, w) => {
      to.push(v); cap.push(c); cst.push(w); nxt.push(head[u]); head[u] = to.length - 1;
      to.push(u); cap.push(0); cst.push(-w); nxt.push(head[v]); head[v] = to.length - 1;
    };
    for (let s = 0; s < ns; s++) add(S, 1 + s, supply[s], 0);
    for (let s = 0; s < ns; s++) for (let d = 0; d < nd; d++) add(1 + s, 1 + ns + d, Infinity, cost[s * nd + d]);
    for (let d = 0; d < nd; d++) add(1 + ns + d, T, need[d], 0);
    const EPS = 1e-9;
    let total = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const dist = new Float64Array(N).fill(Infinity), inq = new Uint8Array(N), prev = new Int32Array(N).fill(-1);
      dist[S] = 0; const q = [S]; inq[S] = 1;
      for (let qi = 0; qi < q.length; qi++) {
        const u = q[qi]; inq[u] = 0;
        for (let e = head[u]; e >= 0; e = nxt[e]) {
          if (cap[e] > EPS && dist[u] + cst[e] < dist[to[e]] - 1e-12) {
            dist[to[e]] = dist[u] + cst[e]; prev[to[e]] = e;
            if (!inq[to[e]]) { inq[to[e]] = 1; q.push(to[e]); }
          }
        }
        if (q.length > 4000000) break;
      }
      if (dist[T] === Infinity) break;
      let f = Infinity;
      for (let v = T; v !== S; v = to[prev[v] ^ 1]) f = Math.min(f, cap[prev[v]]);
      for (let v = T; v !== S; v = to[prev[v] ^ 1]) { cap[prev[v]] -= f; cap[prev[v] ^ 1] += f; }
      total += f;
    }
    const F = new Float64Array(ns * nd);
    for (let s = 0; s < ns; s++) for (let e = head[1 + s]; e >= 0; e = nxt[e]) {
      if (e % 2 === 0 && to[e] > ns && to[e] <= ns + nd) F[s * nd + (to[e] - 1 - ns)] = cap[e ^ 1];
    }
    return { F, total };
  }

  // ---------- plans ----------
  // A plan = { goal, sig, active, arcs:[{from,to,tonnes}] in priority order, rank:{sectionId:number} }.
  // A source that has arcs only sends along them (an arc of 0 t means "send nothing").
  // `sig` fingerprints the inputs the plan was made for, so a stale plan is never silently applied.
  function sigOf(scn) {
    const str = JSON.stringify([scn.settings, scn.setup && scn.setup.modules, scn.modules, scn.materials, scn.sections.map(s => [s.id, +s.lengthM, Math.round(netQty(s) * 1e6) / 1e6, s.workStart, s.workEnd, s.openFrom || '', +s.maxLoaders, (s.workDays || []).map(Number).join('')])]);
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16) + '-' + str.length;
  }
  function activePlan(scn) { const p = scn.plan; return p && p.active !== false && p.sig === sigOf(scn) ? p : null; }
  function planStatus(scn) { const p = scn.plan; return !p ? 'none' : p.sig !== sigOf(scn) ? 'stale' : p.active === false ? 'off' : 'on'; }

  // ---------- simulation ----------
  // opts: { plan (default: the scenario's active plan), P (prepared arrays, reused by the optimiser),
  //         noLog (fast path: summary only), horizonDays }
  function simulate(scn, opts) {
    opts = opts || {};
    const P = opts.P || prepare(scn), n = P.n, nn = P.nn, cfg = P.cfg; // node-indexed arrays use nn; section loops stop at n
    const plan = opts.plan !== undefined ? opts.plan : activePlan(scn);
    const noLog = !!opts.noLog;
    const horizon = opts.horizonDays || 3650;
    const remSrc = new Float64Array(nn), freeNeed = new Float64Array(nn);
    let totalRem = 0, totalCut = 0, totalFill = 0;
    for (let i = 0; i < n; i++) {
      if (P.qty[i] > 0) { remSrc[i] = P.qty[i]; totalRem += P.qty[i]; totalCut += P.qty[i]; }
      else if (P.qty[i] < 0) { freeNeed[i] = -P.qty[i]; totalFill += -P.qty[i]; }
    }
    const idx = {}; P.ids.forEach((id, i) => (idx[id] = i));
    const rank = new Float64Array(nn); for (let i = 0; i < nn; i++) rank[i] = i;
    const arcsBySrc = {};
    if (plan) {
      if (plan.rank) for (const id in plan.rank) if (idx[id] !== undefined) rank[idx[id]] = plan.rank[id];
      for (const a of plan.arcs || []) {
        const f = idx[a.from], t = idx[a.to];
        if (f === undefined || t === undefined || !(P.qty[f] > 0) || !(P.qty[t] < 0)) continue;
        (arcsBySrc[f] = arcsBySrc[f] || []).push({ to: t, rem: +a.tonnes });
      }
    }
    // material layer: tonnes left on each cut line, in dig order (top-down), and the line being dug
    const M = cfg.mat, srcLeft = [], curLine = new Int32Array(nn);
    if (M) for (const i of P.srcs) srcLeft[i] = M.srcLines[i].map(l => l.t);
    const ptr = new Int32Array(nn); // first possibly-not-full destination per source (greedy)
    const L = { src: [], dst: [], t: [], start: [], depart: [], tip: [], bs: [], lorry: [] };
    const lastDepart = new Float64Array(nn).fill(-1), lastTip = new Float64Array(nn).fill(-1);
    const daily = [];
    let moves = 0, tonnesMoved = 0, tonneKm = 0, endTime = 0, fleetDelayMin = 0, tipWaitMin = 0, tipWaitMax = 0;
    let maxOpen = 0;
    for (const j of P.dsts) if (P.openDay[j] > maxOpen) maxOpen = P.openDay[j];
    let lastMove = 0, stuck = false, firstDay = -1, lastDay = -1, d = 0;
    const slots = []; for (let i = 0; i < nn; i++) slots.push(new Int32Array(P.loaders[i]));
    const rates = new Array(nn).fill(null); // per-slot excavator rate (B5 individual machines)
    const blocked = new Uint8Array(nn);
    const types = cfg.types, tCore = types[0];

    // ---- B1/B2: the lorry pool. Each lorry has a free time and a position (the section it last tipped in).
    const fleetOn = cfg.useFleet;
    let lFree = null, lLoc = null, lType = null, nL = 0;
    // Cached best lorry per source. A lorry's readiness for any source never improves once it has been used, so after every
    // dispatch the cached values are only lower bounds (marked stale) and a source is recomputed exactly only when it is about to win.
    const rdyT = new Float64Array(nn), rdyK = new Int32Array(nn).fill(-1), rdyStale = new Uint8Array(nn).fill(1);
    if (fleetOn) {
      nL = cfg.fleetSize; lFree = new Float64Array(nL); lLoc = new Int32Array(nL).fill(cfg.depot ? DEPOT : -1); lType = new Int32Array(nL);
      let k = 0; types.forEach((t, ti) => { for (let q = 0; q < Math.min(t.qty, 20000); q++) lType[k++] = ti; });
    }
    // Earliest a lorry can be at source i, ready to load (it drives empty from where it last tipped). Exact recomputation.
    function freshen(i) {
      let bk = -1, bt = Infinity, bp = -1;
      for (let k = 0; k < nL; k++) {
        const t = types[lType[k]];
        const r = lFree[k] + (lLoc[k] === -1 ? 0 : lLoc[k] === DEPOT ? tripX(P, t, cfg.depot.x, i) : tripE(P, t, lLoc[k], i));
        if (r < bt || (r === bt && t.payload > bp)) { bt = r; bk = k; bp = t.payload; }
      }
      rdyK[i] = bk; rdyT[i] = bt; rdyStale[i] = 0;
    }

    // ---- B4: tipping bays per fill section (absolute minutes)
    const recv = cfg.recv, bayFree = [];
    // ---- B5/B6: loading time
    const exc = cfg.exc, uExc = cfg.uExc;
    const svcMin = (i, k, tonnes) => {
      let m;
      if (exc) { const r = rates[i] ? rates[i][k] : exc.rate; m = Math.max(1, Math.round(tonnes * 60 / r)); } else m = P.loadMin;
      return uExc === 1 ? m : Math.max(1, Math.round(m / uExc));
    };
    const machineLast = exc && exc.mode === 'byMachine' ? new Int32Array(exc.machines.length).fill(-1) : null;

    // With B4: when would a load of tn tonnes arriving at fill j at arrAbs finish tipping, and how long would it queue?
    function tipAt(j, arrAbs, tn) {
      const bf = bayFree[j]; let mf = 0;
      if (bf) { mf = Infinity; for (let q = 0; q < bf.length; q++) if (bf[q] < mf) mf = bf[q]; }
      const dur = Math.max(1, Math.round(tn * 60 / (recv.rate[j] / recv.bays[j]) / cfg.uRecv));
      const ts = Math.max(arrAbs, mf);
      return { ts, te: ts + dur, mf };
    }
    // Choose a destination for a load leaving source i at departT on day `day` with a lorry of type ty.
    // Returns {j, arc}, or {wait: s} when no destination can take it yet (s = earliest loading start that would work:
    // a fill not open on arrival, or, with B4, a tipping queue longer than the allowed limit), or null.
    function pick(i, departT, day, ty, svc, capT) {
      const arcs = arcsBySrc[i];
      let minWait = Infinity;
      // can this load go to fill j now? returns tip end time, or sets minWait and returns -1
      const consider = (j, tr) => {
        if (P.openDay[j] > day + Math.floor((departT + tr) / DAY)) {
          const w = (P.openDay[j] - day) * DAY - tr - svc;
          if (w < minWait) minWait = w;
          return -1;
        }
        if (!recv) return 0;
        const arr = day * DAY + departT + tr, ti = tipAt(j, arr, Math.min(capT, remSrc[i], freeNeed[j]));
        if (ti.ts - arr > recv.maxQ) { // queue too long: hold loading until it would be short enough
          const w = ti.mf - recv.maxQ - tr - svc - day * DAY;
          if (w < minWait) minWait = w;
          return -1;
        }
        return ti.te;
      };
      if (arcs) {
        let live = 0;
        for (const a of arcs) {
          if (a.rem < EPS || freeNeed[a.to] <= 0) continue;
          live++;
          if (consider(a.to, tripL(P, ty, i, a.to)) >= 0) return { j: a.to, arc: a };
        }
        return live > 0 ? { wait: minWait } : null; // planned destinations unavailable for now, or plan finished for this source
      }
      const order = P.destOrder[i];
      let p = ptr[i];
      while (p < order.length && freeNeed[order[p]] <= 0) p++;
      ptr[i] = p;
      let bestJ = -1, bestTip = Infinity;
      for (let k = p; k < order.length; k++) {
        const j = order[k];
        if (freeNeed[j] <= 0) continue;
        const te = consider(j, tripL(P, ty, i, j));
        if (te < 0) continue;
        if (!recv) return { j, arc: null }; // nearest open destination
        if (te < bestTip) { bestTip = te; bestJ = j; } // with receiving rates: where it will finish tipping soonest (nearest wins ties)
      }
      if (bestJ >= 0) return { j: bestJ, arc: null };
      return minWait === Infinity ? null : { wait: minWait };
    }

    for (d = 0; d < horizon; d++) {
      if (totalRem <= EPS) break;
      if (d > maxOpen + 14 && d - lastMove > 14) { stuck = true; break; }
      const dow = dowOf(P.startDay + d);
      const base = d * DAY;
      if (fleetOn && cfg.depot) { // overnight every lorry is back at the depot, and leaves it at the set time
        const lv = base + cfg.depot.leave;
        for (let k = 0; k < nL; k++) {
          if (lLoc[k] !== DEPOT) { lFree[k] += tripX(P, types[lType[k]], cfg.depot.x, lLoc[k]); lLoc[k] = DEPOT; }
          if (lFree[k] < lv) lFree[k] = lv;
        }
        rdyStale.fill(1);
      }
      const active = [];
      if (exc && exc.mode === 'byMachine') {
        // individual excavators: today's loading slots are the machines assigned to each section today
        const per = {};
        exc.machines.forEach((m, k) => {
          for (const a of m.asg) if (d >= a.from && d <= a.to) { (per[a.i] = per[a.i] || []).push(k); break; }
        });
        for (const i of P.srcs) {
          rates[i] = null;
          if (!(remSrc[i] > 0 && P.workDays[i][dow]) || !per[i]) continue;
          const ks = per[i], sl = new Int32Array(ks.length), rt = new Float64Array(ks.length);
          ks.forEach((k, q) => {
            rt[q] = exc.machines[k].rate;
            sl[q] = P.ws[i] + (machineLast[k] >= 0 && machineLast[k] !== i ? exc.reloc : 0); // lost time when a machine relocates
            machineLast[k] = i;
          });
          slots[i] = sl; rates[i] = rt; active.push(i); blocked[i] = 0;
        }
      } else {
        for (const i of P.srcs) if (remSrc[i] > 0 && P.workDays[i][dow]) active.push(i);
        for (const i of active) { slots[i].fill(P.ws[i]); blocked[i] = 0; }
      }
      if (!active.length) continue;
      let used = 0;
      while (used < P.cap) {
        let best = -1, bestT = Infinity, bestSlot = 0, bestSlotT = 0;
        for (const i of active) {
          if (blocked[i] || remSrc[i] <= 0) continue;
          const sl = slots[i]; let mi = 0;
          for (let k = 1; k < sl.length; k++) if (sl[k] < sl[mi]) mi = k;
          let mt = sl[mi];
          if (fleetOn) { const r = rdyT[i] - base; if (r > mt) mt = r; } // no lorry back yet (cached bound, checked below)
          if (mt >= P.we[i]) { blocked[i] = 1; continue; }
          if (mt < bestT || (mt === bestT && rank[i] < rank[best])) { bestT = mt; best = i; bestSlot = mi; bestSlotT = sl[mi]; }
        }
        if (best < 0) break;
        if (fleetOn && rdyStale[best]) { freshen(best); continue; } // the winner's bound was stale: get its exact value and choose again
        const lorry = fleetOn ? rdyK[best] : -1;
        const ty = fleetOn ? types[lType[lorry]] : tCore;
        let capT = ty.payload, lineIdx = -1;
        if (M) { // one material per load: the first cut line with soil left, limited by the lorry body (A1: loose volume / bulking)
          const sl = srcLeft[best]; let c = curLine[best];
          while (c < sl.length && sl[c] <= EPS) c++;
          curLine[best] = c;
          if (c >= sl.length) { remSrc[best] = 0; continue; }
          lineIdx = c; capT = Math.min(capT, sl[c]);
          if (M.a1) { const mid = M.srcLines[best][c].m; capT = Math.min(capT, ty.body * M.rho[mid] / M.bulk[mid]); }
        }
        const svc = svcMin(best, bestSlot, Math.min(capT, remSrc[best]));
        const departT = bestT + svc;
        const pk = pick(best, departT, d, ty, svc, capT);
        if (!pk || pk.wait !== undefined) {
          // Nowhere to tip yet. If a destination opens at midnight and a long trip can still reach it
          // after loading later today, hold this source until then; otherwise it is done for today.
          if (pk && pk.wait < P.we[best] && pk.wait > bestT) {
            const sl = slots[best];
            for (let k = 0; k < sl.length; k++) if (sl[k] < pk.wait) sl[k] = pk.wait;
          } else blocked[best] = 1;
          continue;
        }
        const j = pk.j;
        let tonnes = Math.min(capT, remSrc[best], freeNeed[j]);
        if (pk.arc) tonnes = Math.min(tonnes, pk.arc.rem);
        const arrAbs = base + departT + tripL(P, ty, best, j);
        let tipAbs = arrAbs;
        if (recv) { // queue for a tipping bay, then tip at the section's receiving rate
          const bf = bayFree[j] || (bayFree[j] = new Float64Array(recv.bays[j]));
          let bi = 0; for (let k = 1; k < bf.length; k++) if (bf[k] < bf[bi]) bi = k;
          const ts = Math.max(arrAbs, bf[bi]);
          const dur = Math.max(1, Math.round(tonnes * 60 / (recv.rate[j] / recv.bays[j]) / cfg.uRecv));
          tipAbs = ts + dur; bf[bi] = tipAbs; tipWaitMin += ts - arrAbs; if (ts - arrAbs > tipWaitMax) tipWaitMax = ts - arrAbs;
        }
        remSrc[best] -= tonnes; freeNeed[j] -= tonnes; totalRem -= tonnes;
        if (M) { const sl = srcLeft[best]; sl[lineIdx] -= tonnes; if (sl[lineIdx] < EPS) sl[lineIdx] = 0; }
        if (pk.arc) pk.arc.rem -= tonnes;
        if (remSrc[best] < EPS) { totalRem -= remSrc[best]; remSrc[best] = 0; }
        if (freeNeed[j] < EPS) freeNeed[j] = 0;
        slots[best][bestSlot] = departT;
        let bs = base + bestT;
        if (fleetOn) {
          if (rdyT[best] - base > bestSlotT) fleetDelayMin += rdyT[best] - base - bestSlotT;
          const prevFree = lFree[lorry], approach = lLoc[lorry] === -1 ? 0 : lLoc[lorry] === DEPOT ? tripX(P, ty, cfg.depot.x, best) : tripE(P, ty, lLoc[lorry], best);
          bs = lLoc[lorry] === -1 ? base + bestT : Math.max(prevFree, base + bestT - approach);
          lFree[lorry] = tipAbs; lLoc[lorry] = j;
          rdyStale.fill(1);
        }
        if (!noLog) { L.src.push(best); L.dst.push(j); L.t.push(tonnes); L.start.push(base + bestT); L.depart.push(base + departT); L.tip.push(tipAbs); if (fleetOn) { L.bs.push(bs); L.lorry.push(lorry); } }
        if (base + departT > lastDepart[best]) lastDepart[best] = base + departT;
        if (tipAbs > lastTip[j]) lastTip[j] = tipAbs;
        if (tipAbs > endTime) endTime = tipAbs;
        moves++; tonnesMoved += tonnes; tonneKm += tonnes * dist(P, best, j) / 1000;
        used++; lastMove = d;
        if (firstDay < 0) firstDay = d;
        lastDay = d;
        daily[d] = used;
      }
    }
    for (let k = 0; k <= lastDay; k++) if (daily[k] === undefined) daily[k] = 0;

    // ----- summary -----
    const unplacedSurplus = P.srcs.reduce((s, i) => s + remSrc[i], 0);
    const unfilled = P.dsts.reduce((s, j) => s + freeNeed[j], 0);
    const complete = unplacedSurplus <= EPS && unfilled <= EPS && (totalCut > 0 || totalFill > 0);
    let span = 0, idle = 0;
    if (firstDay >= 0) {
      for (let k = firstDay; k <= lastDay; k++) {
        const dow = dowOf(P.startDay + k);
        let any = false;
        for (const i of P.srcs) if (P.workDays[i][dow]) { any = true; break; }
        if (any) { span++; if (!daily[k]) idle++; }
      }
    }
    const summary = {
      moves, tonnesMoved, tonneKm, endTime, firstDay, lastDay, workingSpan: span, idleDays: idle,
      utilisation: span > 0 ? moves / (P.cap * span) : 0,
      totalCut, totalFill, imbalance: totalCut - totalFill, unplacedSurplus, unfilled, complete, stuck,
      fleetSize: fleetOn ? cfg.fleetSize : null, fleetDelayMin, tipWaitMin, tipWaitMax
    };
    if (noLog) return { P, log: null, n: moves, daily, sections: null, summary };

    const sections = [];
    for (let i = 0; i < n; i++) {
      const isCut = P.qty[i] > 0, isFill = P.qty[i] < 0;
      let level = null, remaining = 0;
      if (isCut) { remaining = remSrc[i]; if (remaining <= EPS) level = lastDepart[i]; }
      else if (isFill) { remaining = freeNeed[i]; if (remaining <= EPS) level = lastTip[i]; }
      sections.push({ id: P.ids[i], name: P.names[i], qty: P.qty[i], type: isCut ? 'cut' : isFill ? 'fill' : 'none', levelTime: level, remaining, to: {}, from: {} });
    }
    for (let k = 0; k < moves; k++) {
      const a = L.src[k], b = L.dst[k];
      if (a >= n || b >= n) continue; // off-site and stockpile nodes have no section row
      sections[a].to[b] = (sections[a].to[b] || 0) + L.t[k];
      sections[b].from[a] = (sections[b].from[a] || 0) + L.t[k];
    }
    const reached = sections.filter(s => s.type !== 'none' && s.levelTime !== null);
    summary.completion = reached.length ? reached.reduce((mx, s) => Math.max(mx, s.levelTime), 0) : null;
    summary.completionDay = summary.completion === null ? null : Math.floor(summary.completion / DAY);
    return { P, log: L, n: moves, daily, sections, summary };
  }

  // ---------- time-chainage chart data (E8) ----------
  // Reads only the movement log and the section results, so the chart can never disagree with the road view or the results table.
  // A section's earthworks start at its first load (cut) or first tip (fill) and finish when it reaches level.
  function chartData(res) {
    const L = res.log, P = res.P, n = P.n, nn = P.nn, nd = Math.floor(res.summary.endTime / DAY) + 2;
    const first = new Float64Array(nn).fill(Infinity), last = new Float64Array(nn).fill(-1);
    const daily = []; for (let i = 0; i < nn; i++) daily.push(new Float32Array(nd + 1));
    const pairs = new Map();
    for (let k = 0; k < res.n; k++) {
      const s = L.src[k], d = L.dst[k], t = L.t[k];
      if (L.start[k] < first[s]) first[s] = L.start[k];
      if (L.depart[k] > last[s]) last[s] = L.depart[k];
      if (L.tip[k] < first[d]) first[d] = L.tip[k];
      if (L.tip[k] > last[d]) last[d] = L.tip[k];
      daily[s][Math.floor(L.start[k] / DAY)] += t; daily[d][Math.floor(L.tip[k] / DAY)] += t;
      const key = s * nn + d; let pr = pairs.get(key);
      if (!pr) pairs.set(key, (pr = { src: s, dst: d, t0: L.start[k], t1: L.tip[k], tonnes: 0, count: 0 }));
      if (L.start[k] < pr.t0) pr.t0 = L.start[k]; if (L.tip[k] > pr.t1) pr.t1 = L.tip[k];
      pr.tonnes += t; pr.count++;
    }
    let maxDaily = 0;
    const sections = [];
    for (let i = 0; i < n; i++) {
      const pref = new Float32Array(nd + 2); let m = 0;
      for (let d = 0; d <= nd; d++) { pref[d + 1] = pref[d] + daily[i][d]; if (daily[i][d] > m) m = daily[i][d]; }
      if (m > maxDaily) maxDaily = m;
      const lvl = res.sections[i].levelTime;
      sections.push({ i, type: res.sections[i].type, start: first[i] === Infinity ? null : first[i],
        end: lvl !== null ? lvl : (last[i] >= 0 ? last[i] : null), reached: lvl !== null, pref });
    }
    const pl = Array.from(pairs.values()), maxPair = pl.reduce((a, p) => Math.max(a, p.tonnes), 0);
    return { nd, sections, pairs: pl, maxDaily, maxPair };
  }

  // ---------- playback helpers ----------
  // Remaining quantity per section over time, from the movement log.
  function buildSeries(res) {
    const P = res.P, L = res.log, n = P.n, nn = P.nn;
    const ev = []; for (let i = 0; i < nn; i++) ev.push([]);
    for (let k = 0; k < res.n; k++) {
      ev[L.src[k]].push([L.depart[k], L.t[k]]);
      ev[L.dst[k]].push([L.tip[k], L.t[k]]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = ev[i].sort((a, b) => a[0] - b[0]);
      const times = new Float64Array(e.length), rem = new Float64Array(e.length + 1);
      rem[0] = Math.abs(P.qty[i]);
      for (let k = 0; k < e.length; k++) { times[k] = e[k][0]; rem[k + 1] = rem[k] - e[k][1]; }
      out.push({ times, rem });
    }
    return out;
  }
  function upperBound(arr, x) { // count of elements <= x
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function remainingAt(series, i, t) {
    const s = series[i]; const r = s.rem[upperBound(s.times, t)];
    return r < 1e-9 ? 0 : r;
  }
  // Trucks needed. A truck is busy from the start of loading until it is back at the loading point
  // empty (the empty return is assumed to take as long as the loaded trip). Not run inside simulate()
  // so the optimiser pays nothing for it.
  function truckStats(res) {
    const L = res.log, n = res.n, nd = Math.max(res.daily.length, 1);
    const out = { dayPeak: new Int32Array(nd), times: new Float64Array(0), counts: new Int32Array(0), peak: 0, peakDay: -1, median: 0, p95: 0, mean: 0, truckHours: 0, avgCycleMin: 0, activeDays: 0 };
    if (!n) return out;
    const ev = new Float64Array(2 * n);
    let busyMin = 0;
    const fleet = L.bs && L.bs.length === n; // with a modelled fleet a lorry is busy from leaving for the source until it has tipped
    for (let k = 0; k < n; k++) {
      const st = fleet ? L.bs[k] : L.start[k], end = fleet ? L.tip[k] : L.tip[k] + (L.tip[k] - L.depart[k]);
      ev[2 * k] = st * 2 + 1; ev[2 * k + 1] = end * 2; // ends sort before starts at the same minute
      busyMin += end - st;
    }
    ev.sort();
    const times = new Float64Array(2 * n), counts = new Int32Array(2 * n);
    let c = 0, lastDay = -1; const dp = [];
    for (let i = 0; i < ev.length; i++) {
      const v = ev[i], t = Math.floor(v / 2), start = v - 2 * t === 1, day = Math.floor(t / DAY);
      while (lastDay < day) { lastDay++; dp[lastDay] = c; } // trucks still out from the day before count too
      c += start ? 1 : -1;
      if (c > dp[day]) dp[day] = c;
      times[i] = t; counts[i] = c;
    }
    const dayPeak = new Int32Array(Math.max(nd, dp.length));
    for (let d = 0; d < dp.length; d++) dayPeak[d] = dp[d];
    const act = [];
    let peak = 0, peakDay = -1;
    for (let d = 0; d < dayPeak.length; d++) {
      if (dayPeak[d] > peak) { peak = dayPeak[d]; peakDay = d; }
      if (res.daily[d] > 0) act.push(dayPeak[d]);
    }
    act.sort((a, b) => a - b);
    const q = f => (act.length ? act[Math.min(act.length - 1, Math.floor(f * act.length))] : 0);
    out.dayPeak = dayPeak; out.times = times; out.counts = counts; out.peak = peak; out.peakDay = peakDay;
    out.median = q(0.5); out.p95 = q(0.95); out.activeDays = act.length;
    out.mean = act.length ? act.reduce((a, b) => a + b, 0) / act.length : 0;
    out.truckHours = busyMin / 60; out.avgCycleMin = busyMin / n;
    return out;
  }
  function trucksAt(ts, t) { const i = upperBound(ts.times, t); return i ? ts.counts[i - 1] : 0; }
  // Playback helper: if no load is being loaded or is in transit at time t, return the start of the next
  // load (so playback can jump over idle hours); otherwise return t. Returns t when nothing more happens.
  function nextActive(res, t) {
    const L = res.log, n = res.n; if (!n) return t;
    if (res.maxSpan === undefined) { let m = 0; for (let k = 0; k < n; k++) if (L.tip[k] - L.start[k] > m) m = L.tip[k] - L.start[k]; res.maxSpan = m; }
    const hi = upperBound(L.start, t), lo = upperBound(L.start, t - res.maxSpan - 1);
    for (let k = hi - 1; k >= lo; k--) if (L.tip[k] > t) return t;
    return hi < n ? L.start[hi] : t;
  }
  function startedBy(res, t) { return upperBound(res.log.start, t); } // log.start is non-decreasing

  return { DAY, parseISO, hm, dayToISO, fmtDay, fmtClock, fmtTime, dowOf, DOW_NAMES, netQty, lineFactor, lineTonnes, prepare, dist, travelMin, tripL, tripE, tripX, simulate, minCostFlow, sigOf, activePlan, planStatus, buildSeries, remainingAt, upperBound, startedBy, truckStats, trucksAt, nextActive, chartData };
});
