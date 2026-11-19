/* Probabilistic dates (D2). Runs the simulation many times with random weather (D1's monthly lost days, drawn per run) and random breakdowns
 * (each loading point is down on a given day with a set chance), then reports the 50% and 80% dates for the whole job and for every section.
 * Stepwise like the optimiser, so it can run in a Web Worker with progress and cancel. Every run is seeded: the same seed gives the same answer.
 * Runs that never finish count as later than any date ("not within the programme").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Risk = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';
  const DAY = 1440, STRIDE = 2200; // breakdown table covers 2,200 days (about six years) per loading point

  // Nearest-rank percentile of values (Infinity = never). p in (0, 1]. Returns Infinity if the rank falls on a run that never finished.
  function percentile(values, p) {
    if (!values.length) return null;
    const v = values.slice().sort((a, b) => a - b), k = Math.min(v.length, Math.max(1, Math.ceil(p * v.length - 1e-9)));
    return v[k - 1];
  }

  // The job's completion in a run: the latest level time of any section that reached its level, or Infinity if some fill was not completely filled.
  function completionOf(res) {
    if (res.summary.unfilled > 0.01) return Infinity;
    let c = -1; for (let i = 0; i < res.levels.length; i++) if (res.levels[i] > c) c = res.levels[i];
    return c < 0 ? Infinity : c;
  }

  function create(scn, opts) {
    opts = opts || {};
    const md = (scn.modules || {}).D2 || {}, mods = (scn.setup && scn.setup.modules) || {};
    const runs = Math.max(1, Math.floor(+md.runs) || 200), seed = Math.floor(+md.seed) || 1, pBrk = Math.min(1, Math.max(0, (+md.breakdownPct || 0) / 100));
    const useWeather = !!mods.D1;
    const P = Engine.prepare(scn), plan = Engine.activePlan(scn), n = P.n;
    const base = Engine.simulate(scn, { P, plan, noLog: true, levels: true });
    const job = { done: false, runsDone: 0, total: runs, result: null };
    const comp = [], lev = []; for (let i = 0; i < n; i++) lev.push([]);
    const t0 = Date.now();
    function one(r) {
      const rng = Engine.mulberry(seed * 1000003 + r * 7919 + 1);
      let dayOff = null;
      if (useWeather && P.cal) dayOff = Engine.buildDayOff(scn, P, rng); // random lost days for this run
      else if (P.cal) dayOff = new Uint8Array(P.cal.base);
      let brk = null;
      if (pBrk > 0) { brk = new Uint8Array(P.nn * STRIDE); for (const i of P.srcs) if (i < n) for (let d = 0; d < STRIDE; d++) if (rng() < pBrk) brk[i * STRIDE + d] = 1; }
      const res = Engine.simulate(scn, { P, plan, noLog: true, levels: true, dayOff, breakdown: brk, breakdownStride: STRIDE });
      comp.push(completionOf(res));
      for (let i = 0; i < n; i++) lev[i].push(res.levels[i] < 0 ? Infinity : res.levels[i]);
    }
    job.step = function (ms) {
      const end = Date.now() + ms;
      while (!job.done && job.runsDone < runs && Date.now() < end) { one(job.runsDone); job.runsDone++; }
      if (!job.done && job.runsDone >= runs) finish();
      return job;
    };
    job.progress = () => ({ done: job.runsDone, total: runs, frac: job.runsDone / runs });
    job.cancel = () => { if (!job.done) { job.done = true; job.result = { cancelled: true, runs: job.runsDone }; } };
    function finish() {
      job.done = true;
      const fin = comp.filter(isFinite), days = fin.map(x => Math.floor(x / DAY));
      const hist = {}; days.forEach(d => (hist[d] = (hist[d] || 0) + 1));
      const sections = [];
      for (let i = 0; i < n; i++) {
        const kind = P.qty[i] > 0 ? 'cut' : P.qty[i] < 0 ? 'fill' : 'none'; if (kind === 'none') continue;
        sections.push({ i, id: P.ids[i], name: P.names[i], type: kind, base: base.levels[i] < 0 ? null : base.levels[i], p50: percentile(lev[i], 0.5), p80: percentile(lev[i], 0.8), reachedPct: Math.round(100 * lev[i].filter(isFinite).length / runs) });
      }
      job.result = {
        cancelled: false, runs, seed, breakdownPct: pBrk * 100, weather: useWeather, seconds: (Date.now() - t0) / 1000, startDay: P.startDay,
        base: isFinite(completionOf(base)) ? completionOf(base) : null,
        p50: percentile(comp, 0.5), p80: percentile(comp, 0.8), finishedPct: Math.round(100 * fin.length / runs),
        hist: Object.keys(hist).map(Number).sort((a, b) => a - b).map(d => ({ day: d, count: hist[d] })), sections
      };
    }
    return job;
  }
  return { create, percentile, STRIDE };
});
