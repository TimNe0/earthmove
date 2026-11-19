'use strict';
/* Differential test: the current engine must reproduce a tagged baseline engine byte for byte
 * on every scenario where the Phase 4 (A1-A5) modules are off, and also with them ticked at their defaults
 * (until a step deliberately changes that).
 *
 *   git archive pre-step2 src | tar -x -C .baseline/        (done once per baseline tag)
 *   node tests/diff.js [baselineDir]                        (default .baseline/src)
 *
 * Compares the full movement log, summary, sections, daily tonnage, chart data and truck statistics.
 * Prints the first differing scenario and the first differing field, then exits 1.
 */
const path = require('path');
const baseDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '.baseline', 'src'));
const Old = { Engine: require(path.join(baseDir, 'engine.js')) };
const New = { Engine: require('../src/engine.js'), Model: require('../src/model.js') };
const Optim = require('../src/optimiser.js');
const Model = New.Model;

// ---- seeded random numbers, so every run sees the same scenarios ----
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];

const clone = o => JSON.parse(JSON.stringify(o));
const scenarios = [];
const add = (name, sc) => scenarios.push({ name, sc });
const withMods = (sc, on, params) => {
  sc = clone(sc); sc.setup.level = 'custom';
  Object.keys(on).forEach(k => (sc.setup.modules[k] = on[k]));
  for (const k in params || {}) sc.modules[k] = Object.assign({}, sc.modules[k], params[k]);
  return sc;
};
const A_ALL = { A1: true, A2: true, A3: true, A4: true, A5: true };
const B_ALL = { B1: true, B2: true, B3: true, B4: true, B5: true, B6: true };

const simple = Model.exampleSimple(), mods = Model.exampleModules();
add('simple', simple);
add('modules demo', mods);
['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].forEach(m => add('only ' + m, withMods(simple, { [m]: true }, m === 'B1' ? { B1: { fleet: 25 } } : {})));
add('all B on, defaults', withMods(simple, B_ALL));
add('B1 depot', withMods(simple, { B1: true }, { B1: { fleet: 30, depotOn: true, depotM: 3000, depotLeave: '06:30' } }));
{ const s = clone(simple); Model.setUnits(s, 'm3'); add('m3 units', s); add('m3 + all B', withMods(s, B_ALL)); }
add('D5 only', withMods(simple, { D5: true }));
add('E8 only', withMods(simple, { E8: true }));

// random scenarios: varied lengths, quantities, hours, opening dates, working days and module mixes
for (let k = 0; k < 40; k++) {
  const o = Model.defaults();
  o.settings.startDate = pick(['2027-01-11', '2027-02-05', '2027-03-01']);
  o.settings.speedKph = pick([3, 5, 8]); o.settings.loadTonnes = pick([10, 20, 25]);
  o.settings.loadMinutes = pick([5, 10, 15]); o.settings.maxMovesPerDay = pick([20, 60, 200]);
  const n = ri(3, 9), secs = [];
  let bal = 0;
  for (let i = 0; i < n; i++) {
    const s = Model.newSection(i); s.id = 'r' + i; s.name = 'R' + i; s.lengthM = ri(2, 20) * 100;
    const q = i === n - 1 ? -bal : (rnd() < 0.5 ? 1 : -1) * ri(1, 40) * 100; bal += i === n - 1 ? 0 : q;
    Model.setQty(s, i === n - 1 && bal === 0 ? -ri(1, 20) * 100 : q);
    s.maxLoaders = ri(1, 3); s.workStart = pick(['06:00', '07:00', '08:00']); s.workEnd = pick(['16:00', '17:00', '19:00']);
    if (rnd() < 0.25) s.openFrom = pick(['2027-01-25', '2027-02-15', '2027-03-15']);
    if (rnd() < 0.2) s.workDays = [1, 1, 1, 1, 1, 1, 0];
    secs.push(s);
  }
  o.sections = secs;
  let sc = Model.normalise(o);
  const on = {}; ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].forEach(m => { if (rnd() < 0.4) on[m] = true; });
  sc = withMods(sc, on, { B1: { fleet: ri(2, 30) }, B4: { rate: pick([100, 300]), bays: ri(1, 3) }, B6: { lorries: pick([80, 100]), excavators: pick([85, 100]), receiving: 100 } });
  if (rnd() < 0.2) { sc = clone(sc); Model.setUnits(sc, 'm3'); }
  add('random ' + k, sc);
}
// the same scenarios with every A module ticked at neutral settings (huge lorry body, no compaction, densities equal to the site density):
// the material layer must then reproduce the core result exactly
const baseList = scenarios.slice();
baseList.forEach(s => {
  const c = withMods(s.sc, A_ALL, { A1: { bodyM3: 1e6 } });
  c.materials.forEach(m => { m.compaction = 1; m.bulking = 1; m.density = +c.settings.density; });
  add(s.name + ' + A1-A5 neutral', c);
});
// Phase 5-7 modules at neutral settings (each module adds its entry here as it is built): they run through the full dispatcher
// and must still reproduce the original engine exactly.
const NEUTRAL = {
  D4: { shifts: [{ start: '00:00', end: '23:59' }], replace: false, weekendSat: false, weekendSun: false, holidaysOn: false }
};
const NEUTRAL_ON = Object.keys(NEUTRAL).reduce((o, k) => ((o[k] = true), o), {});
baseList.forEach(s => add(s.name + ' + C/D neutral', withMods(s.sc, NEUTRAL_ON, NEUTRAL)));
// and everything neutral together with the material modules
baseList.filter((_, i) => i % 3 === 0).forEach(s => {
  const c = withMods(s.sc, Object.assign({}, A_ALL, NEUTRAL_ON), Object.assign({ A1: { bodyM3: 1e6 } }, NEUTRAL));
  c.materials.forEach(m => { m.compaction = 1; m.bulking = 1; m.density = +c.settings.density; });
  add(s.name + ' + A and C/D neutral', c);
});
// an optimiser plan applied to both engines (its signature is recomputed per engine)
{
  const job = Optim.create(clone(simple), 'tonneKm', { budgetMs: 1e9, maxIter: 80 });
  while (!job.done) job.step(250);
  if (job.result.plan) { const s = clone(simple); s.plan = job.result.plan; add('optimiser plan', s); }
}

// ---- comparison ----
const plain = v => JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x instanceof Map ? Array.from(x.entries()) : x === Infinity ? 'Inf' : x === -Infinity ? '-Inf' : typeof x === 'number' && isNaN(x) ? 'NaN' : x));
const firstDiff = (a, b, p) => {
  if (a === b) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return p + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  return null;
};
function snapshot(E, sc) {
  const s = clone(sc);
  if (s.plan) s.plan.sig = E.sigOf(s);
  const r = E.simulate(s);
  const out = { summary: r.summary, n: r.n, daily: r.daily, sections: r.sections, log: r.log };
  if (r.log) { out.chart = E.chartData(r); out.trucks = E.truckStats(r); out.series = E.buildSeries(r); (out.chart.pairs || []).forEach(p => delete p.mat); } // the material layer adds the band's material to chart pairs; nothing else may differ
  const noLog = E.simulate(s, { noLog: true });
  out.fast = { summary: noLog.summary, n: noLog.n };
  return JSON.parse(plain(out));
}
let bad = 0;
for (const { name, sc } of scenarios) {
  let a, b;
  try { a = snapshot(Old.Engine, sc); } catch (e) { a = { error: String(e) }; }
  try { b = snapshot(New.Engine, sc); } catch (e) { b = { error: String(e) }; }
  const d = firstDiff(a, b, '');
  if (d) { bad++; console.log('  DIFF  ' + name + '\n        first difference at ' + d.slice(0, 300)); }
}
console.log((bad ? '  FAIL ' : '  PASS ') + scenarios.length + ' scenarios compared against ' + path.relative(process.cwd(), baseDir) + ' (' + bad + ' differ)');
process.exit(bad ? 1 : 0);
