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
    tonneKm: 'Lowest total tonne-km'
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
    const lost = Math.max(0, maxFlow - s.tonnesMoved);
    const pen = lost > 0.5 ? 1e9 + lost * 1e3 : 0;
    if (goal === 'completion') return pen + s.endTime + s.tonneKm * 1e-4;
    if (goal === 'utilisation') return pen - s.utilisation * 1e6 + s.endTime * 0.1;
    return pen + s.tonneKm + s.endTime * 1e-3;
  }

  const minCostFlow = Engine.minCostFlow; // lives in the engine so material nodes can reuse it

  function pack(res) {
    const ts = Engine.truckStats(res), s = res.summary;
    return {
      completion: s.completion, endTime: s.endTime, completionDay: s.completionDay, moves: s.moves, tonnesMoved: s.tonnesMoved, tonneKm: s.tonneKm,
      utilisation: s.utilisation, idleDays: s.idleDays, workingSpan: s.workingSpan, unplacedSurplus: s.unplacedSurplus, unfilled: s.unfilled,
      peakTrucks: ts.peak, p95Trucks: ts.p95, truckHours: ts.truckHours, startDay: res.P.startDay,
      fleetSize: s.fleetSize, fleetDelayMin: s.fleetDelayMin, tipWaitMin: s.tipWaitMin
    };
  }

  function create(scn, goal, opts) {
    opts = opts || {};
    const budgetMs = opts.budgetMs || 20000, rand = rng(opts.seed || 20270111);
    const P = Engine.prepare(scn), ids = P.ids, srcs = P.srcs, dsts = P.dsts, ns = srcs.length, nd = dsts.length;
    const t0 = Date.now();
    const supply = srcs.map(i => P.qty[i]), need = dsts.map(j => -P.qty[j]);
    const sum = a => a.reduce((x, y) => x + y, 0);
    const maxFlow = Math.min(sum(supply), sum(need));
    const before = Engine.simulate(scn, { P });           // what the user sees now (active plan or greedy dispatch)
    const beforeScore = scoreOf(goal, before.summary, maxFlow);
    const job = { done: false, iter: 0, evals: 0, result: null };
    if (!ns || !nd) { job.done = true; job.result = { improved: false, goal, reason: 'There is nothing to optimise: a plan needs at least one cut and one fill section.', before: pack(before), after: pack(before), plan: null, iterations: 0 }; job.step = () => job; job.progress = () => ({ iter: 0, frac: 1 }); return job; }

    const cost = new Float64Array(ns * nd);
    for (let s = 0; s < ns; s++) for (let d = 0; d < nd; d++) cost[s * nd + d] = Engine.dist(P, srcs[s], dsts[d]) / 1000;
    const byDist = s => Array.from({ length: nd }, (_, d) => d).sort((a, b) => cost[s * nd + a] - cost[s * nd + b] || a - b);

    function makePlan(st) {
      const arcs = [], rank = {};
      for (let s = 0; s < ns; s++) {
        let any = false;
        for (const d of st.order[s]) { const f = st.F[s * nd + d]; if (f > 1e-6) { arcs.push({ from: ids[srcs[s]], to: ids[dsts[d]], tonnes: Math.round(f * 1000) / 1000 }); any = true; } }
        if (!any) arcs.push({ from: ids[srcs[s]], to: ids[dsts[st.order[s][0]]], tonnes: 0 });
        rank[ids[srcs[s]]] = st.rank[s];
      }
      return { arcs, rank };
    }
    function evaluate(st) {
      job.evals++;
      const r = Engine.simulate(scn, { P, plan: makePlan(st), noLog: true });
      return { score: scoreOf(goal, r.summary, maxFlow), summary: r.summary };
    }

    // start point A: the flows the current dispatch produced, in the order each source first used them
    const FA = new Float64Array(ns * nd), first = new Float64Array(ns * nd).fill(Infinity);
    const sIdx = {}, dIdx = {}; srcs.forEach((i, s) => (sIdx[i] = s)); dsts.forEach((j, d) => (dIdx[j] = d));
    for (let k = 0; k < before.n; k++) {
      const s = sIdx[before.log.src[k]], d = dIdx[before.log.dst[k]];
      FA[s * nd + d] += before.log.t[k]; if (before.log.start[k] < first[s * nd + d]) first[s * nd + d] = before.log.start[k];
    }
    const stA = { F: FA, order: [], rank: Float64Array.from(srcs, (_, s) => s) };
    for (let s = 0; s < ns; s++) stA.order.push(byDist(s).sort((a, b) => first[s * nd + a] - first[s * nd + b]));
    // start point B: the exact lowest tonne-km flows, nearest first
    const mc = minCostFlow(supply, need, cost);
    const stB = { F: mc.F, order: Array.from({ length: ns }, (_, s) => byDist(s)), rank: Float64Array.from(srcs, (_, s) => s) };
    const eA = evaluate(stA), eB = evaluate(stB);
    let cur = eB.score < eA.score ? stB : stA, curE = eB.score < eA.score ? eB : eA;
    let best = cur, bestE = curE;
    const startScore = curE.score;
    const unit = goal === 'completion' ? 1440 : goal === 'utilisation' ? 1e4 : Math.max(20, 0.002 * before.summary.tonneKm);
    const T0 = 0.5 * unit, T1 = 0.02 * unit;
    let lastProg = { iter: 0, evals: job.evals, frac: 0, bestScore: bestE.score, baseScore: beforeScore, startScore, bestSummary: bestE.summary };

    function clone(st) { return { F: st.F.slice(), order: st.order.slice(), rank: st.rank.slice() }; }
    const loadsOf = () => Math.max(P.loadT, 1e-6) * Math.pow(2, Math.floor(rand() * 8));
    function propose(st) {
      const c = clone(st), u = rand();
      const rows = new Float64Array(ns), cols = new Float64Array(nd), used = [];
      for (let s = 0; s < ns; s++) for (let d = 0; d < nd; d++) { const f = st.F[s * nd + d]; if (f > 1e-6) { rows[s] += f; cols[d] += f; used.push(s * nd + d); } }
      if (u < 0.40) { // exchange: s1->d1, s2->d2 becomes s1->d2, s2->d1
        if (used.length < 2) return null;
        const a = used[Math.floor(rand() * used.length)], b = used[Math.floor(rand() * used.length)];
        const s1 = Math.floor(a / nd), d1 = a % nd, s2 = Math.floor(b / nd), d2 = b % nd;
        if (s1 === s2 || d1 === d2) return null;
        const dl = Math.min(c.F[a], c.F[b], loadsOf()); if (dl < 1e-6) return null;
        c.F[a] -= dl; c.F[b] -= dl; c.F[s1 * nd + d2] += dl; c.F[s2 * nd + d1] += dl; return c;
      }
      if (u < 0.55) { // reassign: another source (with soil to spare) supplies this destination, or this source tips elsewhere (destination with room)
        if (!used.length) return null;
        const a = used[Math.floor(rand() * used.length)], s1 = Math.floor(a / nd), d1 = a % nd;
        if (rand() < 0.5) {
          const cand = []; for (let s = 0; s < ns; s++) if (s !== s1 && supply[s] - rows[s] > 0.5) cand.push(s);
          if (!cand.length) return null;
          const s2 = cand[Math.floor(rand() * cand.length)], dl = Math.min(c.F[a], supply[s2] - rows[s2], loadsOf());
          if (dl < 1e-6) return null; c.F[a] -= dl; c.F[s2 * nd + d1] += dl; return c;
        }
        const cand = []; for (let d = 0; d < nd; d++) if (d !== d1 && need[d] - cols[d] > 0.5) cand.push(d);
        if (!cand.length) return null;
        const d2 = cand[Math.floor(rand() * cand.length)], dl = Math.min(c.F[a], need[d2] - cols[d2], loadsOf());
        if (dl < 1e-6) return null; c.F[a] -= dl; c.F[s1 * nd + d2] += dl; return c;
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
      const better = bestE.score < beforeScore - 1e-6;
      const result = { improved: better, cancelled: !!cancelled, goal, iterations: job.iter, evals: job.evals, seconds: (Date.now() - t0) / 1000, before: pack(before), after: null, plan: null };
      if (better) {
        const pl = makePlan(best);
        const plan = { goal, sig: Engine.sigOf(scn), active: true, arcs: pl.arcs, rank: pl.rank };
        const after = Engine.simulate(scn, { P, plan });
        result.after = pack(after); result.plan = plan;
      } else result.after = result.before;
      job.result = result;
    }
    job.cancel = () => finish(true);
    return job;
  }

  return { GOALS, create, minCostFlow, scoreOf, pack };
});
