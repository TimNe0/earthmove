/* Monotone check (follow-up 1). For every example scenario and every constraint that can be removed:
 * the OPTIMISED finish with the constraint removed must be no later than the optimised finish with it in place.
 * The relaxed run starts from the constrained plan, as the page does when you edit a plan and optimise again.
 * Usage: node tests/monotone.js [exampleName ...]   (default: all examples) */
const Engine = require('../src/engine.js'), Model = require('../src/model.js'), Optim = require('../src/optimiser.js');
const ITER = +process.env.ITER || 150;
const clone = o => JSON.parse(JSON.stringify(o));
function opt(sc) { const j = Optim.create(sc, 'completion', { budgetMs: 1e9, maxIter: ITER, seed: +process.env.SEED || undefined }); while (!j.done) j.step(250); return j.result; }
// every single constraint that can be taken away, as [label, function that removes it from a scenario]
function relaxations(sc) {
  const out = [], on = id => sc.setup.modules[id], md = sc.modules;
  sc.sections.forEach((s, i) => { if (s.openFrom) out.push(['opening date of ' + s.name, x => { x.sections[i].openFrom = ''; }]); });
  if (on('C1')) md.C1.blocks.forEach((b, i) => out.push(['blockage ' + b.name, x => { x.modules.C1.blocks.splice(i, 1); }]));
  if (on('C2')) md.C2.stretches.forEach((b, i) => out.push(['lane stretch ' + b.name, x => { x.modules.C2.stretches.splice(i, 1); }]));
  if (on('C3')) md.C3.periods.forEach((b, i) => out.push(['closed period ' + (b.note || b.id), x => { x.modules.C3.periods.splice(i, 1); }]));
  if (on('C4')) out.push(['layered fill', x => { x.modules.C4 = { layers: 1, waitDays: 0, mode: 'site', bySection: {} }; }]);
  if (on('C5')) out.push(['public movement cap', x => { x.modules.C5.publicLimit = 1e6; }]);
  if (on('D4') && md.D4.holidaysOn) out.push(['bank holidays', x => { x.modules.D4.holidaysOn = false; }]);
  if (on('D1')) out.push(['weather lost days', x => { x.modules.D1.lostDays = new Array(12).fill(0); x.modules.D1.winterOn = false; }]);
  return out;
}
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(Model.EXAMPLES);
let fails = [], total = 0; const t0 = Date.now();
for (const nm of names) {
  const base = Model.EXAMPLES[nm](), rel = relaxations(base);
  if (!rel.length) { console.log(nm + ': no removable constraints'); continue; }
  const A = opt(clone(base)), endA = A.after.endTime;
  for (const [label, fn] of rel) {
    const x = clone(base); fn(x); const sc = Model.normalise(x);
    if (A.plan) sc.plan = clone(A.plan);              // the plan made with the constraint; now stale, as after an edit
    sc.optCheck = clone(A.optCheck);                   // what the page stores after every optimise run
    const B = opt(sc); total++;
    // soil placed in the fills counts first (the optimiser's own order; with material modules `unfilled` also counts exports as moved, so placed tonnes are used there):
    // a job that fills more is better whatever its last tip; only at equal placement must the finish be no later
    const short = r => (r.placedT !== undefined ? -r.placedT : r.unfilled), shortA = short(A.after), shortB = short(B.after);
    const good = shortB < shortA - 0.5 || (Math.abs(shortB - shortA) <= 0.5 && B.after.endTime <= endA + 1e-9);
    console.log((good ? '  ok   ' : '  FAIL ') + nm + ' - without ' + label + ': ' + B.after.endTime + ' vs with ' + endA + (Math.abs(shortB - shortA) > 0.5 ? ' (soil placed ' + Math.round(-shortB) + ' t vs ' + Math.round(-shortA) + ' t)' : ''));
    if (!good) fails.push({ example: nm, constraint: label, withIt: endA, without: B.after.endTime });
  }
}
console.log('\n' + total + ' removals checked in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s; ' + fails.length + ' failures');
if (fails.length) { console.log('example | constraint | finish with | finish without'); fails.forEach(f => console.log([f.example, f.constraint, f.withIt, f.without].join(' | '))); }
process.exit(fails.length ? 1 : 0);
