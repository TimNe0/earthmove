/* Worker glue. Built after engine.js and optimiser.js in one Blob, so it needs no files. */
(function () {
  'use strict';
  let job = null, cancelled = false;
  function loop() {
    if (!job) return;
    if (cancelled) job.cancel();
    else job.step(60);
    const p = job.progress();
    self.postMessage({ type: 'progress', iter: p.iter, evals: p.evals, frac: p.frac, bestScore: p.bestScore, baseScore: p.baseScore, startScore: p.startScore, best: p.bestSummary && { endTime: p.bestSummary.endTime, utilisation: p.bestSummary.utilisation, tonneKm: p.bestSummary.tonneKm } });
    if (job.done) { self.postMessage({ type: 'done', result: job.result }); job = null; }
    else setTimeout(loop, 0); // yield so a cancel message can arrive
  }
  function riskLoop() { // D2: a probabilistic run, reported as it goes
    if (!job) return;
    if (cancelled) job.cancel(); else job.step(60);
    const p = job.progress();
    self.postMessage({ type: 'riskprogress', done: p.done, total: p.total, frac: p.frac });
    if (job.done) { self.postMessage({ type: 'riskdone', result: job.result }); job = null; }
    else setTimeout(riskLoop, 0);
  }
  self.onmessage = function (e) {
    const m = e.data;
    if (m.cmd === 'start') {
      cancelled = false;
      try { job = Optim.create(m.scn, m.goal, { budgetMs: m.budgetMs, seed: m.seed }); loop(); }
      catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
    } else if (m.cmd === 'risk') {
      cancelled = false;
      try { job = Risk.create(m.scn, {}); riskLoop(); }
      catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
    } else if (m.cmd === 'cancel') cancelled = true;
  };
})();
