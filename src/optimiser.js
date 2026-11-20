/* Earthmove optimiser. Stepwise so it can run in a Web Worker or, as a fallback, on the page.
 *
 * Search space (a "plan"): how many tonnes each source sends to each destination, the order each
 * source tries its destinations in, and a priority rank between sources (decides ties for the
 * daily movement limit). Every candidate is scored by running the real simulation, so every rule
 * the engine knows (hours, days, loaders, opening dates, daily cap, later: modules) is respected
 * automatically. The optimiser only proposes; it never has its own copy of the rules.
 *
 * Start points : the current plan's flows, and the exact minimum tonne-km flows (min-cost flow).
 * Improvement  : simulated annealing over swaps, reassignments, reorderings and rank swaps.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Optim = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  const GOALS = {
    completion: 'Earliest overall completion',
    utilisation: 'Highest use of the daily movement limit',
    tonneKm: 'Lowest total tonne-km',
    cost: 'Lowest total cost (needs E1)',
    carbon: 'Lowest carbon (needs E2)'
  };

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Lower is better. Soil left unmoved always dominates; then the chosen goal; then small tie-breaks.
  function scoreOf(goal, s, maxFlow) {
    const lost = Math.max(0, maxFlow - (s.placedT !== undefined ? s.placedT : s.tonnesMoved)); // material modules: soil placed in fills, not haulage
    const pen = lost > 0.5 ? 1e9 + lost * 1e3 : 0;
    const money = (s.cost || 0) * 1e-6; // import, export and handling cost break ties between otherwise equal plans
    if (goal === 'cost') return pen + (s.costTotal || 0) + s.endTime * 1e-3;
    if (goal === 'carbon') return pen + (s.co2 || 0) * 1000 + s.endTime * 1e-3; // kg CO2e
    if (goal === 'completion') return pen + s.endTime + s.tonneKm * 1e-4 + money;
    if (goal === 'utilisation') return pen - s.utilisation * 1e6 + s.endTime * 0.1 + money;
    return pen + s.tonneKm + s.endTime * 1e-3 + money;
  }
  // the summary the score reads: the core summary, plus placed tonnes and money when a material module is on
  const scoreSummary = (r, scn) => {
    let sm = r.msum ? Object.assign({ placedT: r.msum.placedT, cost: r.msum.importCost + r.msum.exportCost + r.msum.handleCost }, r.summary) : r.summary;
    if (r.csum) { const cc = Engine.costCarbon(scn, r); if (cc) sm = Object.assign({}, sm, { costTotal: cc.total, co2: cc.co2t }); } // E1/E2: what cost and carbon goals minimise
    return sm;
  };

  const minCostFlow = Engine.minCostFlow; // lives in the engine so material nodes can reuse it

  function pack(res) {
    const ts = Engine.truckStats(res), s = res.summary;
    return {
      completion: s.completion, endTime: s.endTime, completionDay: s.completionDay, moves: s.moves, tonnesMoved: s.tonnesMoved, tonneKm: s.tonneKm,
      utilisation: s.utilisation, idleDays: s.idleDays, workingSpan: s.workingSpan, unplacedSurplus: s.unplacedSurplus, unfilled: s.unfilled,
      peakTrucks: ts.peak, p95Trucks: ts.p95, truckHours: ts.truckHours, startDay: res.P.startDay,
      fleetSize: s.fleetSize, fleetDelayMin: s.fleetDelayMin, tipWaitMin: s.tipWaitMin,
      placedT: res.msum ? res.msum.placedT : undefined, importT: res.msum ? res.msum.importT : undefined, exportT: res.msum ? res.msum.exportT : undefined,
      parkedT: res.msum ? res.msum.parkedT : undefined, materialCost: res.msum ? res.msum.importCost + res.msum.exportCost + res.msum.handleCost : undefined
    };
  }

  function create(scn, goal, opts) {
    opts = opts || {};
    const budgetMs = opts.budgetMs || 20000, rand = rng(opts.seed || 20270111);
    const P = Engine.prepare(scn), ids = P.ids, dsts = P.dsts, nd = dsts.length;
    const srcs = P.srcs.filter(i => P.kind[i] !== 3), ns = srcs.length; // stockpiles are not ordinary sources here: they only appear in planned routes (below)
    const stocks = P.nodeIdx.filter(x => P.kind[x] === 3), nk = stocks.length, capK = stocks.map(x => (+P.node[x].capacityT > 0 ? +P.node[x].capacityT : 0));
    const t0 = Date.now();
    const supply = srcs.map(i => P.qty[i]), need = dsts.map(j => -P.qty[j]);
    const sum = a => a.reduce((x, y) => x + y, 0);
    // which source may send to which fill: with A2 on, a fill must accept at least one material the source digs
    const M = P.cfg.mat, elig = new Uint8Array(ns * nd).fill(1), cost = new Float64Array(ns * nd);
    for (let s = 0; s < ns; s++) for (let d = 0; d < nd; d++) {
      if (M && M.a2 && P.kind[srcs[s]] !== 3 && !M.srcLines[srcs[s]].some(l => M.dstLines[dsts[d]].some(f => M.acc[f.req][l.m]))) elig[s * nd + d] = 0;
      cost[s * nd + d] = elig[s * nd + d] ? Engine.dist(P, srcs[s], dsts[d]) / 1000 : Infinity;   // Infinity = not allowed
    }
    let maxFlow = Math.min(sum(supply), sum(need)), mc0 = null;
    if (M && ns && nd) { mc0 = minCostFlow(supply, need, cost); maxFlow = mc0.total; }     // the most that classes and imports allow to be placed
    const before = Engine.simulate(scn, { P });           // what the user sees now (active plan or greedy dispatch)
    { const bp = before.msum ? before.msum.placedT : before.summary.tonnesMoved; if (bp > maxFlow) maxFlow = bp; } // never accept placing less soil than the dispatch it replaces, even above the flow estimate
    const beforeScore = scoreOf(goal, scoreSummary(before, scn), maxFlow);
    const job = { done: false, iter: 0, evals: 0, result: null };
    if (!ns || !nd) { job.done = true; job.result = { improved: false, goal, reason: 'There is nothing to optimise: a plan needs at least one cut and one fill section.', before: pack(before), after: pack(before), plan: null, iterations: 0 }; job.step = () => job; job.progress = () => ({ iter: 0, frac: 1 }); return job; }

    const byDist = s => Array.from({ length: nd }, (_, d) => d).sort((a, b) => cost[s * nd + a] - cost[s * nd + b] || a - b);

    function makePlan(st) {
      const arcs = [], rank = {}, viaSK = {}, viaKD = {}, viaS = {};
      for (const v of st.via || []) { viaSK[v.s + ':' + v.k] = (viaSK[v.s + ':' + v.k] || 0) + v.t; viaKD[v.k + ':' + v.d] = (viaKD[v.k + ':' + v.d] || 0) + v.t; viaS[v.s] = true; }
      for (let s = 0; s < ns; s++) {
        let any = !!viaS[s];
        for (const d of st.order[s]) { const f = st.F[s * nd + d]; if (f > 1e-6) { arcs.push({ from: ids[srcs[s]], to: ids[dsts[d]], tonnes: Math.ceil(f * 1000 - 1e-9) / 1000 }); any = true; } }
        if (!any) arcs.push({ from: ids[srcs[s]], to: ids[dsts[st.order[s][0]]], tonnes: 0 });
        rank[ids[srcs[s]]] = st.rank[s];
      }
      for (const key in viaSK) { const [s, k] = key.split(':').map(Number); arcs.push({ from: ids[srcs[s]], to: ids[stocks[k]], tonnes: Math.ceil(viaSK[key] * 1000 - 1e-9) / 1000 }); }   // deliberate deposit ...
      for (const key in viaKD) { const [k, d] = key.split(':').map(Number); arcs.push({ from: ids[stocks[k]], to: ids[dsts[d]], tonnes: Math.ceil(viaKD[key] * 1000 - 1e-9) / 1000 }); }   // ... and the haul out again
      return { arcs, rank };
    }
    function evaluate(st) {
      job.evals++;
      const r = Engine.simulate(scn, { P, plan: makePlan(st), noLog: true });
      return { score: scoreOf(goal, scoreSummary(r, scn), maxFlow), summary: r.summary };
    }

    // start point A: the flows the current dispatch produced, in the order each source first used them
    const depIn = {}, depOut = {};
    const FA = new Float64Array(ns * nd), first = new Float64Array(ns * nd).fill(Infinity);
    const sIdx = {}, dIdx = {}; srcs.forEach((i, s) => (sIdx[i] = s)); dsts.forEach((j, d) => (dIdx[j] = d));
    for (let k = 0; k < before.n; k++) {
      const s = sIdx[before.log.src[k]], d = dIdx[before.log.dst[k]];
      if (s === undefined || d === undefined) { // loads to or from a stockpile are kept as stockpile routes below; export gates are not section-to-section flows
        const kd = stocks.indexOf(before.log.dst[k]), ks = stocks.indexOf(before.log.src[k]);
        if (s !== undefined && kd >= 0) (depIn[kd] = depIn[kd] || []).push({ s, t: before.log.t[k] });
        else if (d !== undefined && ks >= 0) (depOut[ks] = depOut[ks] || []).push({ d, t: before.log.t[k] });
        continue;
      }
      FA[s * nd + d] += before.log.t[k]; if (before.log.start[k] < first[s * nd + d]) first[s * nd + d] = before.log.start[k];
    }
    // what the dispatcher put into each stockpile and took out again becomes a planned route cut -> pile -> fill (deposits nobody hauled out are left to the dispatcher)
    const viaA = [];
    stocks.forEach((_, k) => { const ins = (depIn[k] || []).map(x => ({ s: x.s, t: x.t })), outs = depOut[k] || []; let a = 0;
      for (const o of outs) { let need = o.t; while (need > 1e-9 && a < ins.length) { const t = Math.min(need, ins[a].t), e = viaA.find(v => v.s === ins[a].s && v.d === o.d && v.k === k); if (e) e.t += t; else viaA.push({ s: ins[a].s, d: o.d, k, t }); ins[a].t -= t; need -= t; if (ins[a].t <= 1e-9) a++; } } });
    const stA = { F: FA, order: [], rank: Float64Array.from(srcs, (_, s) => s), via: viaA };
    for (let s = 0; s < ns; s++) stA.order.push(byDist(s).sort((a, b) => first[s * nd + a] - first[s * nd + b]));
    // start point B: the exact lowest tonne-km flows, nearest first
    const mc = mc0 || minCostFlow(supply, need, cost);
    const stB = { F: mc.F, order: Array.from({ length: ns }, (_, s) => byDist(s)), rank: Float64Array.from(srcs, (_, s) => s), via: [] };
    const eA = evaluate(stA), eB = evaluate(stB);
    let cur = eB.score < eA.score ? stB : stA, curE = eB.score < eA.score ? eB : eA;
    let best = cur, bestE = curE;
    const startScore = curE.score;
    const bs0 = scoreSummary(before, scn), unit = goal === 'completion' ? 1440 : goal === 'utilisation' ? 1e4 : goal === 'cost' ? Math.max(50, 0.002 * (bs0.costTotal || 0)) : goal === 'carbon' ? Math.max(5, 0.002 * (bs0.co2 || 0) * 1000) : Math.max(20, 0.002 * before.summary.tonneKm);
    const T0 = 0.5 * unit, T1 = 0.02 * unit;
    let lastProg = { iter: 0, evals: job.evals, frac: 0, bestScore: bestE.score, baseScore: beforeScore, startScore, bestSummary: bestE.summary };

    function clone(st) { return { F: st.F.slice(), order: st.order.slice(), rank: st.rank.slice(), via: (st.via || []).map(v => ({ s: v.s, d: v.d, k: v.k, t: v.t })) }; }
    const loadsOf = () => Math.max(P.loadT, 1e-6) * Math.pow(2, Math.floor(rand() * 8));
    function propose(st) {
      if (nk && rand() < 0.12) { // route part of a flow through a stockpile, or undo such a route (only drawn when the job has stockpiles)
        const c = clone(st);
        if (c.via.length && rand() < 0.4) { const v = c.via.splice(Math.floor(rand() * c.via.length), 1)[0]; c.F[v.s * nd + v.d] += v.t; return c; }
        const used = []; for (let q = 0; q < ns * nd; q++) if (c.F[q] > 1e-6) used.push(q);
        if (!used.length) return null;
        const a = used[Math.floor(rand() * used.length)], s = Math.floor(a / nd), d = a % nd, k = Math.floor(rand() * nk);
        const inK = c.via.reduce((x, v) => x + (v.k === k ? v.t : 0), 0), dl = Math.min(c.F[a], loadsOf(), capK[k] - inK);
        if (dl < 1e-6) return null;
        c.F[a] -= dl; const e = c.via.find(v => v.s === s && v.d === d && v.k === k); if (e) e.t += dl; else c.via.push({ s, d, k, t: dl });
        return c;
      }
      const c = clone(st), u = rand();
      const rows = new Float64Array(ns), cols = new Float64Array(nd), used = [];
      for (let s = 0; s < ns; s++) for (let d = 0; d < nd; d++) { const f = st.F[s * nd + d]; if (f > 1e-6) { rows[s] += f; cols[d] += f; used.push(s * nd + d); } }
      if (u < 0.40) { // exchange: s1->d1, s2->d2 becomes s1->d2, s2->d1
        if (used.length < 2) return null;
        const a = used[Math.floor(rand() * used.length)], b = used[Math.floor(rand() * used.length)];
        const s1 = Math.floor(a / nd), d1 = a % nd, s2 = Math.floor(b / nd), d2 = b % nd;
        if (s1 === s2 || d1 === d2) return null;
        const dl = Math.min(c.F[a], c.F[b], loadsOf()); if (dl < 1e-6) return null;
        if (!elig[s1 * nd + d2] || !elig[s2 * nd + d1]) return null;
        c.F[a] -= dl; c.F[b] -= dl; c.F[s1 * nd + d2] += dl; c.F[s2 * nd + d1] += dl; return c;
      }
      if (u < 0.55) { // reassign: another source (with soil to spare) supplies this destination, or this source tips elsewhere (destination with room)
        if (!used.length) return null;
        const a = used[Math.floor(rand() * used.length)], s1 = Math.floor(a / nd), d1 = a % nd;
        if (rand() < 0.5) {
          const cand = []; for (let s = 0; s < ns; s++) if (s !== s1 && supply[s] - rows[s] > 0.5) cand.push(s);
          if (!cand.length) return null;
          const s2 = cand[Math.floor(rand() * cand.length)], dl = Math.min(c.F[a], supply[s2] - rows[s2], loadsOf());
          if (dl < 1e-6 || !elig[s2 * nd + d1]) return null; c.F[a] -= dl; c.F[s2 * nd + d1] += dl; return c;
        }
        const cand = []; for (let d = 0; d < nd; d++) if (d !== d1 && need[d] - cols[d] > 0.5) cand.push(d);
        if (!cand.length) return null;
        const d2 = cand[Math.floor(rand() * cand.length)], dl = Math.min(c.F[a], need[d2] - cols[d2], loadsOf());
        if (dl < 1e-6 || !elig[s1 * nd + d2]) return null; c.F[a] -= dl; c.F[s1 * nd + d2] += dl; return c;
      }
      if (u < 0.85) { // reorder one source's destination priority
        const s = Math.floor(rand() * ns), us = st.order[s].filter(d => st.F[s * nd + d] > 1e-6);
        if (us.length < 2) return null;
        const x = us[Math.floor(rand() * us.length)], y = us[Math.floor(rand() * us.length)]; if (x === y) return null;
        const o = st.order[s].slice(), ix = o.indexOf(x), iy = o.indexOf(y);
        if (rand() < 0.5) { o[ix] = y; o[iy] = x; } else { o.splice(ix, 1); o.splice(iy, 0, x); }
        c.order[s] = o; return c;
      }
      if (ns < 2) return null; // swap two sources' priority ranks
      const s1 = Math.floor(rand() * ns), s2 = Math.floor(rand() * ns); if (s1 === s2) return null;
      const r = c.rank[s1]; c.rank[s1] = c.rank[s2]; c.rank[s2] = r; return c;
    }

    job.step = function (ms) {
      const end = Date.now() + ms;
      while (!job.done && Date.now() < end) {
        const elapsed = Date.now() - t0, frac = Math.min(1, elapsed / budgetMs);
        if (frac >= 1 || job.iter >= (opts.maxIter || 1e9)) { finish(false); break; }
        const T = T0 * Math.pow(T1 / T0, frac);
        const cand = propose(cur); job.iter++;
        if (!cand) continue;
        const e = evaluate(cand), dlt = e.score - curE.score;
        if (dlt <= 0 || rand() < Math.exp(-dlt / T)) {
          cur = cand; curE = e;
          if (e.score < bestE.score - 1e-9) { best = cand; bestE = e; }
        }
      }
      lastProg = { iter: job.iter, evals: job.evals, frac: Math.min(1, (Date.now() - t0) / budgetMs), bestScore: bestE.score, baseScore: beforeScore, startScore, bestSummary: bestE.summary };
      return job;
    };
    job.progress = () => lastProg;
    function finish(cancelled) {
      if (job.done) return;
      job.done = true;
      // a plan that routes soil through a stockpile and only ties with plain dispatch is still kept: it writes the stockpile route down instead of leaving it to the dispatcher's fallback
      const tiesWithRoute = !(bestE.score < beforeScore - 1e-6) && Math.abs(bestE.score - beforeScore) <= 1e-6 && (best.via || []).length > 0;
      const better = bestE.score < beforeScore - 1e-6 || tiesWithRoute;
      const result = { improved: better, cancelled: !!cancelled, goal, iterations: job.iter, evals: job.evals, seconds: (Date.now() - t0) / 1000, before: pack(before), after: null, plan: null, matchesDispatch: tiesWithRoute };
      if (better) {
        const pl = makePlan(best);
        const plan = { goal, sig: Engine.sigOf(scn), active: true, arcs: pl.arcs, rank: pl.rank };
        const after = Engine.simulate(scn, { P, plan });
        result.after = pack(after); result.plan = plan;
      } else result.after = result.before;
      // E1/E2: cost and carbon before and after, when those modules are on
      const cb = before.csum ? Engine.costCarbon(scn, before) : null;
      if (cb) { result.before.cost = cb.total; result.before.co2t = cb.co2t; const ca = result.after === result.before ? cb : Engine.costCarbon(scn, Engine.simulate(scn, { P, plan: result.plan })); if (ca) { result.after = Object.assign({}, result.after, { cost: ca.total, co2t: ca.co2t }); } }
      job.result = result;
    }
    job.cancel = () => finish(true);
    return job;
  }

  return { GOALS, create, minCostFlow, scoreOf, pack };
});
