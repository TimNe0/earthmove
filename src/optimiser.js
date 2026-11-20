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
    // voluntary holds: constraints a previous plan was made under that have since been removed; the search may choose to keep any of them
    const cands = Engine.holdCandidates(scn), pCache = { '': P };
    const heldScn = hs => Engine.applyHolds(scn, hs.map(i => cands[i]));
    function Pof(hs) { const key = hs.join(','); if (!pCache[key]) { const P2 = Engine.prepare(heldScn(hs)); pCache[key] = P2.ids.join('|') === ids.join('|') && P2.n === P.n ? P2 : P; } return pCache[key]; }
    const act = Engine.activePlan(scn), actHolds = act && act.holds && act.holds.length ? act.holds : null;
    const before = actHolds ? Engine.simulate(scn, { P: Engine.prepare(Engine.applyHolds(scn, actHolds)), plan: act }) : Engine.simulate(scn, { P });           // what the user sees now (active plan or greedy dispatch)
    { const bp = before.msum ? before.msum.placedT : before.summary.tonnesMoved; if (bp > maxFlow) maxFlow = bp; } // never accept placing less soil than the dispatch it replaces, even above the flow estimate
    const beforeScore = scoreOf(goal, scoreSummary(before, scn), maxFlow);
    const job = { done: false, iter: 0, evals: 0, result: null };
    if (!ns || !nd) { job.done = true; job.result = { improved: false, goal, reason: 'There is nothing to optimise: a plan needs at least one cut and one fill section.', before: pack(before), after: pack(before), plan: null, iterations: 0 }; job.step = () => job; job.progress = () => ({ iter: 0, frac: 1 }); return job; }

    const byDist = s => Array.from({ length: nd }, (_, d) => d).sort((a, b) => cost[s * nd + a] - cost[s * nd + b] || a - b);

    function makePlan(st) {
      if (st.fixed) return { arcs: st.fixed.arcs, rank: st.fixed.rank, holds: (st.holds || []).map(i => cands[i]) }; // a fixed plan (the old plan verbatim, or none = plain dispatch) run under the held constraints
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
      return { arcs, rank, holds: (st.holds || []).map(i => cands[i]) };
    }
    function evaluate(st) {
      job.evals++;
      const r = Engine.simulate(scn, { P: Pof(st.holds || []), plan: makePlan(st), noLog: true });
      return { score: scoreOf(goal, scoreSummary(r, scn), maxFlow), summary: r.summary };
    }

    // start point A: the flows the current dispatch produced, in the order each source first used them
    // pair what goes into each stockpile with what comes out again: routes section -> pile -> fill (deposits nobody hauls out are left to the dispatcher)
    function pairVia(dIn, dOut) {
      const via = [];
      stocks.forEach((_, k) => { const ins = (dIn[k] || []).map(x => ({ s: x.s, t: x.t })), outs = dOut[k] || []; let a = 0;
        for (const o of outs) { let need = o.t; while (need > 1e-9 && a < ins.length) { const t = Math.min(need, ins[a].t), e = via.find(v => v.s === ins[a].s && v.d === o.d && v.k === k); if (e) e.t += t; else via.push({ s: ins[a].s, d: o.d, k, t }); ins[a].t -= t; need -= t; if (ins[a].t <= 1e-9) a++; } } });
      return via;
    }
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
    const viaA = pairVia(depIn, depOut);
    const stA = { F: FA, order: [], rank: Float64Array.from(srcs, (_, s) => s), via: viaA, holds: [] };
    for (let s = 0; s < ns; s++) stA.order.push(byDist(s).sort((a, b) => first[s * nd + a] - first[s * nd + b]));
    // start point B: the exact lowest tonne-km flows, nearest first
    const mc = mc0 || minCostFlow(supply, need, cost);
    const stB = { F: mc.F, order: Array.from({ length: ns }, (_, s) => byDist(s)), rank: Float64Array.from(srcs, (_, s) => s), via: [], holds: [] };
    // start point C: the scenario's saved plan, even when its inputs have changed since (a stale plan is not used for dispatch, but it is a good place to start searching from)
    let stC = null;
    if (scn.plan && Array.isArray(scn.plan.arcs)) {
      const FC = new Float64Array(ns * nd), seen = srcs.map(() => []), idOf = {}, kIdx = {}, cIn = {}, cOut = {};
      srcs.forEach((i, s) => (idOf[ids[i]] = s)); const dId = {}; dsts.forEach((j, d) => (dId[ids[j]] = d)); stocks.forEach((x, k) => (kIdx[ids[x]] = k));
      for (const a of scn.plan.arcs) {
        const t = +a.tonnes; if (!(t > 0)) continue;
        const s = idOf[a.from], d = dId[a.to], kd = kIdx[a.to], ks = kIdx[a.from];
        if (s !== undefined && d !== undefined) { if (elig[s * nd + d]) { FC[s * nd + d] += t; if (seen[s].indexOf(d) < 0) seen[s].push(d); } }
        else if (s !== undefined && kd !== undefined) (cIn[kd] = cIn[kd] || []).push({ s, t });
        else if (ks !== undefined && d !== undefined) (cOut[ks] = cOut[ks] || []).push({ d, t });
      }
      const rk = Float64Array.from(srcs, (_, s) => (scn.plan.rank && scn.plan.rank[ids[srcs[s]]] !== undefined ? scn.plan.rank[ids[srcs[s]]] : s));
      stC = { F: FC, order: srcs.map((_, s) => seen[s].concat(byDist(s).filter(d => seen[s].indexOf(d) < 0))), rank: rk, via: pairVia(cIn, cOut), holds: [] };
    }
    const eA = evaluate(stA), eB = evaluate(stB), eC = stC ? evaluate(stC) : null;
    let cur = eB.score < eA.score ? stB : stA, curE = eB.score < eA.score ? eB : eA;
    if (eC && eC.score < curE.score) { cur = stC; curE = eC; }
    if (stC && cands.length) { // the old plan together with every constraint it was made under: reproduces the old schedule, so the search can never do worse than it
      const stH = Object.assign(clone(stC), { holds: cands.map((_, i) => i) }), eH = evaluate(stH);
      if (eH.score < curE.score) { cur = stH; curE = eH; }
    }
    let best = cur, bestE = curE;
    if (cands.length) { // plain dispatch with every removed constraint kept: the old schedule itself, so the result can never be worse than it
      const fixedSt = fx => ({ fixed: fx, F: new Float64Array(ns * nd), order: stA.order, rank: stA.rank, via: [], holds: cands.map((_, i) => i) });
      const fixes = [{ arcs: [], rank: {} }]; if (scn.plan && Array.isArray(scn.plan.arcs) && scn.plan.arcs.length) fixes.push({ arcs: scn.plan.arcs, rank: scn.plan.rank || {} });
      for (const fx of fixes) { const st0 = fixedSt(fx), e0 = evaluate(st0); if (e0.score < bestE.score) { best = st0; bestE = e0; } }
    }
    const startScore = curE.score;
    const bs0 = scoreSummary(before, scn), unit = goal === 'completion' ? 1440 : goal === 'utilisation' ? 1e4 : goal === 'cost' ? Math.max(50, 0.002 * (bs0.costTotal || 0)) : goal === 'carbon' ? Math.max(5, 0.002 * (bs0.co2 || 0) * 1000) : Math.max(20, 0.002 * before.summary.tonneKm);
    const T0 = 0.5 * unit, T1 = 0.02 * unit;
    let lastProg = { iter: 0, evals: job.evals, frac: 0, bestScore: bestE.score, baseScore: beforeScore, startScore, bestSummary: bestE.summary };

    function clone(st) { return { fixed: null, holds: (st.holds || []).slice(), F: st.F.slice(), order: st.order.slice(), rank: st.rank.slice(), via: (st.via || []).map(v => ({ s: v.s, d: v.d, k: v.k, t: v.t })) }; }
    const loadsOf = () => Math.max(P.loadT, 1e-6) * Math.pow(2, Math.floor(rand() * 8));
    function propose(st) {
      if (cands.length && rand() < 0.08) { // keep a removed constraint, or drop one that was being kept
        const c = clone(st), q = Math.floor(rand() * cands.length), at = c.holds.indexOf(q);
        if (at >= 0) c.holds.splice(at, 1); else c.holds.push(q);
        c.holds.sort((a, b) => a - b); return c;
      }
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
      const result = { optCheck: { goal, sig: Engine.sigOf(scn), ctx: Engine.constraintCtx(actHolds ? Engine.applyHolds(scn, actHolds) : scn) }, improved: better, cancelled: !!cancelled, goal, iterations: job.iter, evals: job.evals, seconds: (Date.now() - t0) / 1000, before: pack(before), after: null, plan: null, matchesDispatch: tiesWithRoute };
      if (better) {
        const pl = makePlan(best), hs = best.holds || [];
        const plan = { goal, sig: Engine.sigOf(scn), active: true, arcs: pl.arcs, rank: pl.rank, ctx: Engine.constraintCtx(hs.length ? heldScn(hs) : scn) };
        if (hs.length) plan.holds = pl.holds;
        const after = Engine.simulate(scn, { P: Pof(hs), plan });
        result.after = pack(after); result.plan = plan;
      } else result.after = result.before;
      // E1/E2: cost and carbon before and after, when those modules are on
      const cb = before.csum ? Engine.costCarbon(scn, before) : null;
      if (cb) { result.before.cost = cb.total; result.before.co2t = cb.co2t; const ca = result.after === result.before ? cb : Engine.costCarbon(scn, Engine.simulate(scn, { P: Pof(best.holds || []), plan: result.plan })); if (ca) { result.after = Object.assign({}, result.after, { cost: ca.total, co2t: ca.co2t }); } }
      job.result = result;
    }
    job.cancel = () => finish(true);
    return job;
  }

  return { GOALS, create, minCostFlow, scoreOf, pack };
});
