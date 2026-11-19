'use strict';
const Engine = require('../src/engine.js');
const Model = require('../src/model.js');
const crypto = require('crypto');
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  PASS ' : '  FAIL ') + msg); if (!c) fails++; };
const hhmm = (m) => Engine.fmtClock(m % 1440);

function tiny(over) {
  const o = Model.defaults();
  o.settings.startDate = '2027-01-11'; // Monday
  const a = Model.newSection(0); a.id = 'a'; a.name = 'Cut'; a.lengthM = 1000; Model.setQty(a, 100); a.maxLoaders = 1;
  const b = Model.newSection(1); b.id = 'b'; b.name = 'Fill'; b.lengthM = 1000; Model.setQty(b, -100);
  o.sections = [a, b];
  return Model.normalise(Object.assign(o, over || {}));
}

console.log('\n1. HAND CALCULATION: 2 sections x 1 km, midpoints 1 km apart, 5 kph, 100 t, 20 t loads, 10 min loading, 1 loader');
{
  // Hand: 100 t / 20 t = 5 loads. Travel = 1 km / 5 kph = 12 min.
  // Loads start 07:00 07:10 07:20 07:30 07:40; each leaves 10 min later; tips 12 min after leaving.
  const hand = [['07:00', '07:10', '07:22'], ['07:10', '07:20', '07:32'], ['07:20', '07:30', '07:42'], ['07:30', '07:40', '07:52'], ['07:40', '07:50', '08:02']];
  const r = Engine.simulate(tiny());
  console.log('   load | hand start/depart/tip   | simulated start/depart/tip');
  let match = r.n === 5;
  for (let k = 0; k < r.n; k++) {
    const sim = [hhmm(r.log.start[k]), hhmm(r.log.depart[k]), hhmm(r.log.tip[k])];
    console.log('   ' + (k + 1) + '    | ' + hand[k].join(' / ') + ' | ' + sim.join(' / '));
    if (sim.join() !== hand[k].join()) match = false;
  }
  ok(match, 'all 5 loads match the hand calculation');
  const sa = r.sections[0], sb = r.sections[1];
  console.log('   hand: cut level 07:50 (last load leaves), fill level 08:02 (last tip)');
  console.log('   sim : cut level ' + hhmm(sa.levelTime) + ', fill level ' + hhmm(sb.levelTime));
  ok(hhmm(sa.levelTime) === '07:50' && hhmm(sb.levelTime) === '08:02', 'level times match');
  ok(Math.abs(r.summary.tonneKm - 100) < 1e-9, 'tonne-km = 100 t x 1 km = 100 (sim ' + r.summary.tonneKm + ')');
  ok(r.summary.complete && r.summary.moves === 5, 'complete in 5 movements');
}

console.log('\n2. DAILY CAP: cap of 3 movements/day, 5 loads => 3 on Monday, 2 on Tuesday');
{
  const s = tiny(); s.settings.maxMovesPerDay = 3;
  const r = Engine.simulate(s);
  ok(r.daily[0] === 3 && r.daily[1] === 2, 'daily counts ' + JSON.stringify(r.daily));
}

console.log('\n3. EARLIEST TIPPING DATE: fill opens Wed 13/01/2027 => nothing tipped before it; cut can still be loaded only when a tip is possible');
{
  const s = tiny(); s.sections[1].openFrom = '2027-01-13';
  const r = Engine.simulate(s);
  const first = Math.min(...r.log.tip);
  ok(Math.floor(first / 1440) >= 2, 'first tip is on day ' + Math.floor(first / 1440) + ' (>= 2)');
}

console.log('\n4. WORKING DAYS: loads never start at weekends; start Fri, 5 loads, cap 3 => Fri 3, Mon 2');
{
  const s = tiny(); s.settings.startDate = '2027-01-15'; s.settings.maxMovesPerDay = 3;
  const r = Engine.simulate(s);
  ok(r.daily.length === 4 && r.daily[0] === 3 && r.daily[1] === 0 && r.daily[2] === 0 && r.daily[3] === 2, 'daily ' + JSON.stringify(r.daily));
}

console.log('\n5. IMBALANCE is reported, never silent');
{
  const s = tiny(); Model.setQty(s.sections[0], 140);
  let r = Engine.simulate(s);
  ok(Math.abs(r.summary.unplacedSurplus - 40) < 1e-9 && !r.summary.complete, 'surplus: 40 t left unplaced');
  const s2 = tiny(); Model.setQty(s2.sections[1], -130);
  r = Engine.simulate(s2);
  ok(Math.abs(r.summary.unfilled - 30) < 1e-9, 'shortfall: 30 t unfilled');
}

console.log('\n6. LOADER LIMIT: 2 loaders at the cut => loads leave in pairs');
{
  const s = tiny(); s.sections[0].maxLoaders = 2;
  const r = Engine.simulate(s);
  ok(r.log.start[0] === r.log.start[1] && r.log.start[2] === r.log.start[0] + 10, 'starts ' + [0, 1, 2].map(k => hhmm(r.log.start[k])).join(', '));
}

console.log('\n7. CONSTRAINT AUDIT on the examples');
function audit(name, scn) {
  const r = Engine.simulate(scn), P = r.P, L = r.log;
  let bad = 0; const perDay = {};
  const slotEvents = {};
  for (let k = 0; k < r.n; k++) {
    const i = L.src[k], j = L.dst[k], day = Math.floor(L.start[k] / 1440), tod = L.start[k] - day * 1440;
    if (tod < P.ws[i] || tod >= P.we[i]) bad++;
    if (!P.workDays[i][Engine.dowOf(P.startDay + day)]) bad++;
    if (Math.floor(L.tip[k] / 1440) < P.openDay[j]) bad++;
    const maxPay = Math.max(P.loadT, ...P.cfg.types.map(t => t.payload).filter(isFinite));
    if (L.t[k] > maxPay + 1e-9 || L.t[k] <= 0) bad++;
    if (!P.cfg.exc && P.cfg.uExc === 1 && L.depart[k] - L.start[k] !== P.loadMin) bad++;
    perDay[day] = (perDay[day] || 0) + 1;
    (slotEvents[i] = slotEvents[i] || []).push([L.start[k], 1], [L.depart[k], -1]);
  }
  for (const d in perDay) if (perDay[d] > P.cap) bad++;
  if (L.lorry.length) { // a lorry is never in two places: its next load starts after its previous tip
    const byL = {};
    for (let k = 0; k < r.n; k++) (byL[L.lorry[k]] = byL[L.lorry[k]] || []).push(k);
    for (const l in byL) { const ks = byL[l].sort((a, b) => L.start[a] - L.start[b]); for (let q = 1; q < ks.length; q++) if (L.start[ks[q]] < L.tip[ks[q - 1]]) bad++; }
    if (Object.keys(byL).length > P.cfg.fleetSize) bad++;
  }
  for (const i in slotEvents) {
    const e = slotEvents[i].sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0;
    for (const [, v] of e) { c += v; if (c > P.loaders[i]) { bad++; break; } }
  }
  // soil conservation
  const out = new Float64Array(P.n), inn = new Float64Array(P.n);
  for (let k = 0; k < r.n; k++) { out[L.src[k]] += L.t[k]; inn[L.dst[k]] += L.t[k]; }
  for (let i = 0; i < P.n; i++) { if (out[i] > Math.max(P.qty[i], 0) + 1e-6) bad++; if (inn[i] > Math.max(-P.qty[i], 0) + 1e-6) bad++; }
  ok(bad === 0, name + ': ' + r.n + ' movements, ' + bad + ' violations');
  return r;
}
const ex1 = audit('simple example', Model.exampleSimple());
audit('modules-demo example', Model.exampleModules());

console.log('\n8. ALL MODULES OFF = CORE (snapshot hash of simple example)');
{
  const r = ex1;
  const h = crypto.createHash('sha1').update(JSON.stringify([r.log.src, r.log.dst, r.log.start, r.log.tip, r.log.t])).digest('hex').slice(0, 12);
  console.log('   hash ' + h + ', completion ' + (r.summary.completion === null ? 'n/a' : Engine.fmtTime(r.summary.completion, r.P.startDay)) +
    ', moves ' + r.summary.moves + ', util ' + (r.summary.utilisation * 100).toFixed(1) + '%, tonne-km ' + r.summary.tonneKm.toFixed(0));
  const fs = require('fs'), f = __dirname + '/snapshot.json';
  if (process.argv.includes('--update') || !fs.existsSync(f)) { fs.writeFileSync(f, JSON.stringify({ hash: h })); console.log('   snapshot written'); }
  else ok(JSON.parse(fs.readFileSync(f)).hash === h, 'matches the stored phase-1 snapshot');
}

console.log('\n9. PERFORMANCE: 100 sections, ~2 years');
{
  const o = Model.defaults(); o.settings.maxMovesPerDay = 480; // sized so the job takes about two years
  for (let i = 0; i < 100; i++) {
    const s = Model.newSection(i); s.id = 'p' + i; s.lengthM = 80;
    Model.setQty(s, i % 2 === 0 ? 100000 : -100000); s.maxLoaders = 2; o.sections.push(s);
  }
  const sc = Model.normalise(o);
  const t0 = Date.now(), r = Engine.simulate(sc), ms = Date.now() - t0;
  const days = Math.floor(r.summary.endTime / 1440);
  console.log('   ' + r.n + ' movements over ' + days + ' days simulated in ' + ms + ' ms');
  ok(days > 600 && days < 900 && ms < 2000, 'about two years (' + days + ' days) simulated in ' + ms + ' ms');
}

console.log('\n10. VALIDATION catches bad input');
{
  const s = tiny(); s.sections[0].workStart = '19:00'; s.sections[0].workEnd = '07:00'; s.sections[1].lengthM = 0;
  const v = Model.validate(s).filter(x => x.level === 'error');
  ok(v.length === 2, v.map(x => x.text).join(' | '));
}

console.log('\n12. TRUCKS NEEDED: hand calculation');
{
  // Each load occupies a truck from loading start to its return: 10 load + 12 loaded + 12 empty = 34 min.
  // Loads start every 10 min => trucks needed = ceil(34/10) = 4. Peak is 4 (07:30-07:34 loads 1-4; 07:40 loads 2-5).
  // Truck-hours = 5 loads x 34 min / 60 = 2.833.
  const r = Engine.simulate(tiny()), ts = Engine.truckStats(r);
  console.log('   hand: peak 4 trucks, avg cycle 34 min, truck-hours 2.833');
  console.log('   sim : peak ' + ts.peak + ' trucks, avg cycle ' + ts.avgCycleMin + ' min, truck-hours ' + ts.truckHours.toFixed(3));
  ok(ts.peak === 4 && ts.avgCycleMin === 34 && Math.abs(ts.truckHours - 5 * 34 / 60) < 1e-9, 'matches hand calculation');
  ok(Engine.trucksAt(ts, 7 * 60 + 32) === 4 && Engine.trucksAt(ts, 7 * 60 + 35) === 3 && Engine.trucksAt(ts, 6 * 60) === 0 && Engine.trucksAt(ts, 9 * 60) === 0, 'trucks: 07:32 = 4 (loads 1-4), 07:35 = 3 (load 1 back at 07:34), before 07:00 = 0, after 08:14 = 0');
  const s2 = tiny(); s2.settings.maxMovesPerDay = 3; // 3 on Monday, 2 on Tuesday
  const t2 = Engine.truckStats(Engine.simulate(s2));
  ok(t2.dayPeak[0] === 3 && t2.dayPeak[1] === 2, 'cap of 3/day => peaks per day ' + Array.from(t2.dayPeak).join(','));
  const ex = Engine.truckStats(ex1);
  console.log('   simple example: peak ' + ex.peak + ', median ' + ex.median + ', 95th pct ' + ex.p95 + ', avg cycle ' + ex.avgCycleMin.toFixed(1) + ' min');
  ok(ex.peak > 0 && ex.p95 <= ex.peak && ex.median <= ex.p95, 'example statistics are consistent');
}

console.log('\n13. LONG HAUL ARRIVING AFTER MIDNIGHT: loads may start late on day 0 for a fill that opens on day 1');
{
  const s = tiny(); s.sections[0].lengthM = 40000; s.sections[1].lengthM = 40000; // midpoints 40 km apart => 480 min trip
  s.sections[1].openFrom = '2027-01-12'; // opens Tuesday
  const r = Engine.simulate(s), L = r.log;
  console.log('   first load starts ' + hhmm(L.start[0]) + ' on day ' + Math.floor(L.start[0] / 1440) + ', tips ' + hhmm(L.tip[0]) + ' on day ' + Math.floor(L.tip[0] / 1440));
  ok(Math.floor(L.start[0] / 1440) === 0 && Math.floor(L.tip[0] / 1440) === 1, 'first load leaves on Monday evening and tips on Tuesday');
  ok(L.start[0] === 15 * 60 + 50, 'earliest start that arrives at 00:00 is 15:50 (hand: 1440 - 480 - 10 = 950 min)');
  audit('long-haul case', s);
}

console.log('\n14. UNITS: quantities in m3 behave identically to the same job in tonnes');
{
  // 50 m3 cut at 2.0 t/m3 = 100 t; load 10 m3 = 20 t. Must reproduce the hand-calculated tonne job exactly.
  const t = tiny(), m = tiny();
  m.settings.units = 'm3'; m.settings.density = 2; m.settings.loadTonnes = 10;
  Model.setQty(m.sections[0], 50); Model.setQty(m.sections[1], -50);
  const a = Engine.simulate(t), b = Engine.simulate(m);
  ok(JSON.stringify(a.log) === JSON.stringify(b.log), 'identical movement log (5 loads, 07:00 to 08:02)');
  ok(Math.abs(b.summary.tonnesMoved - 100) < 1e-9 && Math.abs(b.summary.tonneKm - 100) < 1e-9, 'engine still reports 100 t and 100 t-km (' + b.summary.tonnesMoved + ', ' + b.summary.tonneKm + ')');
  // switching units converts the entries; switching back restores them
  const c = tiny(); c.settings.density = 2;
  Model.setUnits(c, 'm3');
  ok(Model.secQty(c.sections[0]) === 50 && c.settings.loadTonnes === 10 && c.settings.units === 'm3', 'tonnes -> m3 at 2 t/m3: 100 t becomes 50 m3, 20 t load becomes 10 m3');
  Model.setUnits(c, 'tonnes');
  ok(Model.secQty(c.sections[0]) === 100 && c.settings.loadTonnes === 20, 'm3 -> tonnes restores 100 t and 20 t');
  const d = tiny(); d.settings.units = 'm3'; d.settings.density = 0;
  ok(Model.validate(d).some(x => x.level === 'error' && /density/.test(x.text)), 'a zero density is reported in plain English');
}

console.log('\n15. OPTIMISER: hand calculation where greedy dispatch is provably worse');
const Optim = require('../src/optimiser.js');
function runOpt(sc, goal, budgetMs, extra) {
  const job = Optim.create(sc, goal, Object.assign({ budgetMs }, extra || {}));
  while (!job.done) job.step(250);
  return job.result;
}
{
  // Road (m): E fill 0-1000 | Z through 1000-2000 | S1 cut 2000-3000 | S2 cut 3000-4000 | D fill 4000-4800. 20 t each.
  // Midpoints: E 500, S1 2500, S2 3500, D 4400.  Greedy: S1 loads first (lower index) and takes its nearest fill D (1.9 km);
  // S2 is left with E (3.0 km): 20 x (1.9 + 3.0) = 98 t-km.  Best: S1->E (2.0) and S2->D (0.9): 20 x 2.9 = 58 t-km.
  const o = Model.defaults(); o.settings.startDate = '2027-01-11';
  const mk = (id, len, q) => { const x = Model.newSection(0); x.id = id; x.name = id; x.lengthM = len; Model.setQty(x, q); x.maxLoaders = 1; return x; };
  o.sections = [mk('E', 1000, -20), mk('Z', 1000, 0), mk('S1', 1000, 20), mk('S2', 1000, 20), mk('D', 800, -20)];
  const sc = Model.normalise(o);
  const base = Engine.simulate(sc);
  console.log('   hand: greedy 98 t-km, best 58 t-km');
  ok(Math.abs(base.summary.tonneKm - 98) < 1e-6, 'greedy baseline simulates to 98 t-km (sim ' + base.summary.tonneKm.toFixed(3) + ')');
  const mc = Optim.minCostFlow([20, 20], [20, 20], [2.0, 0.9 + 0 * 1, 3.0, 0.9].map((v, i) => [2.0, 1.9, 3.0, 0.9][i]));
  ok(Math.abs(mc.total - 40) < 1e-9 && Math.abs(mc.F[0] - 20) < 1e-9 && Math.abs(mc.F[3] - 20) < 1e-9, 'min-cost flow picks S1->E and S2->D');
  const r = runOpt(sc, 'tonneKm', 1000);
  sc.plan = r.plan;
  const aft = Engine.simulate(sc);
  console.log('   sim : optimised ' + aft.summary.tonneKm.toFixed(3) + ' t-km (' + r.iterations + ' iterations, ' + r.evals + ' simulations)');
  ok(r.improved && Math.abs(aft.summary.tonneKm - 58) < 1e-6, 'optimiser reaches the hand-calculated 58 t-km');
  ok(aft.summary.tonnesMoved === base.summary.tonnesMoved, 'same soil moved (' + aft.summary.tonnesMoved + ' t)');
}

console.log('\n16. OPTIMISER on the 12-section example (never worse, constraints still hold)');
{
  const names = { completion: 'earliest completion', utilisation: 'highest utilisation', tonneKm: 'lowest tonne-km' };
  for (const goal of ['completion', 'utilisation', 'tonneKm']) {
    const sc = Model.exampleSimple();
    const r = runOpt(sc, goal, 4000);
    const B = r.before, A = r.after, d = (m, x) => Engine.fmtTime(m, B.startDay);
    console.log('   ' + names[goal] + ': ' + r.iterations + ' iterations (' + Math.round(r.evals / r.seconds) + ' sims/s)');
    console.log('     before: finish ' + d(B.endTime) + ', util ' + (B.utilisation * 100).toFixed(1) + '%, ' + Math.round(B.tonneKm) + ' t-km, idle ' + B.idleDays + ', peak trucks ' + B.peakTrucks);
    console.log('     after : finish ' + d(A.endTime) + ', util ' + (A.utilisation * 100).toFixed(1) + '%, ' + Math.round(A.tonneKm) + ' t-km, idle ' + A.idleDays + ', peak trucks ' + A.peakTrucks);
    const metric = { completion: x => x.endTime, utilisation: x => -x.utilisation, tonneKm: x => x.tonneKm }[goal];
    ok(metric(A) <= metric(B) + 1e-9, goal + ': result is no worse than before');
    ok(Math.abs(A.tonnesMoved - B.tonnesMoved) < 0.5, goal + ': same soil moved (' + Math.round(A.tonnesMoved) + ' t)');
    if (r.plan) { sc.plan = r.plan; ok(Engine.planStatus(sc) === 'on', 'plan is active'); audit('optimised (' + goal + ')', sc); }
  }
}

console.log('\n17. OPTIMISER: deterministic, stale plans ignored');
{
  const a = runOpt(Model.exampleSimple(), 'tonneKm', 1e9, { maxIter: 150 }), b = runOpt(Model.exampleSimple(), 'tonneKm', 1e9, { maxIter: 150 });
  ok(JSON.stringify(a.plan) === JSON.stringify(b.plan), 'same seed and iteration count give the same plan');
  const sc = Model.exampleSimple(); sc.plan = a.plan;
  const withPlan = Engine.simulate(sc).summary.tonneKm;
  sc.sections[0].lengthM += 100;
  ok(Engine.planStatus(sc) === 'stale', 'editing a length marks the plan stale');
  const noPlan = Engine.simulate(Object.assign({}, sc, { plan: null })).summary.tonneKm;
  ok(Engine.simulate(sc).summary.tonneKm === noPlan, 'a stale plan is ignored, not applied');
  sc.sections[0].lengthM -= 100; sc.plan.active = false;
  ok(Engine.planStatus(sc) === 'off' && Engine.simulate(sc).summary.tonneKm !== withPlan, 'switching the plan off restores baseline dispatch');
  // module settings are part of what a plan was made for
  const sm = Model.exampleModules(); sm.plan = { goal: 'tonneKm', sig: Engine.sigOf(sm), active: true, arcs: [], rank: {} };
  ok(Engine.planStatus(sm) === 'on', 'fresh plan is on');
  sm.modules.B1.fleet = (+sm.modules.B1.fleet || 0) + 1;
  ok(Engine.planStatus(sm) === 'stale', 'changing a module setting marks the plan stale');
}

console.log('\n18. D5 SCENARIOS: switching the module off and on keeps what was saved, and never changes results');
{
  const a = Model.exampleSimple();
  a.saved.push({ id: 'x1', name: 'Baseline', savedAt: '2026-11-19T10:00:00Z', scenario: JSON.parse(JSON.stringify(Model.exampleSimple())) });
  const r0 = Engine.simulate(a).summary;
  a.setup.modules.D5 = true;  const r1 = Engine.simulate(a).summary;
  a.setup.modules.D5 = false; a.setup.modules.D5 = true;
  const b = Model.normalise(JSON.parse(JSON.stringify(a)));
  ok(JSON.stringify(r0) === JSON.stringify(r1), 'D5 on with defaults gives identical results (it adds comparison, not physics)');
  ok(b.saved.length === 1 && b.saved[0].name === 'Baseline' && b.setup.modules.D5 === true, 'saved scenarios survive off/on and a save/load round trip');
}

console.log('\n19. PLAYBACK SKIPS IDLE HOURS');
{
  const hm2 = m => Engine.fmtClock(m % 1440) + ' day ' + Math.floor(m / 1440);
  const sc = tiny(); sc.settings.maxMovesPerDay = 3;           // Mon: 3 loads 07:00-07:20, last tip 07:42, truck-free after that
  const r = Engine.simulate(sc);                               // Tue: 2 loads 07:00, 07:10
  const cases = [[0, 420, 'before the first load: jumps to 07:00'], [425, 425, 'mid-loading: stays put'], [7 * 60 + 35, 7 * 60 + 35, 'a load is still in transit: stays put'],
                 [9 * 60, 1440 + 420, 'Monday 09:00, nothing moving: jumps to Tuesday 07:00'], [1440 + 7 * 60 + 5, 1440 + 7 * 60 + 5, 'Tuesday 07:05, a load is moving: stays put']];
  console.log('   hand: last Monday tip = 07:20 start + 10 load + 12 trip = 07:42; so 09:00 is idle and the next start is Tue 07:00');
  for (const [t, want, why] of cases) { const got = Engine.nextActive(r, t); ok(got === want, why + ' (' + hm2(t) + ' -> ' + hm2(got) + ')'); }
  ok(Engine.nextActive(r, 1440 + 9 * 60) === 1440 + 9 * 60, 'after the final movement it stays put, so playback can finish');
}

// ---------- fleet and plant modules ----------
const hh = m => Engine.fmtClock(m % 1440);
const withMods = (sc, on, params) => { sc.setup.modules = Object.assign({}, sc.setup.modules, on); for (const k in params || {}) sc.modules[k] = Object.assign({}, sc.modules[k], params[k]); return sc; };
const logTimes = (r, f) => Array.from({ length: r.n }, (_, k) => hh(f(k)));
const coreEnd = Engine.simulate(tiny()).summary.endTime;

console.log('\n20. B1 FLEET AND EMPTY RETURN: hand calculation with 2 lorries (cycle 10 load + 12 loaded + 12 empty back)');
{
  // L1 07:00 -> tips 07:22 -> back at source 07:34.  L2 07:10 -> tips 07:32 -> back 07:44.
  // load3: loader free 07:20 but no lorry until L1 returns at 07:34; load4: L2 back 07:44; load5: L1 back again 07:56+12 = 08:08.
  const hand = { start: ['07:00', '07:10', '07:34', '07:44', '08:08'], tip: ['07:22', '07:32', '07:56', '08:06', '08:30'] };
  const sc = withMods(tiny(), { B1: true }, { B1: { fleet: 2 } });
  const r = Engine.simulate(sc);
  const st = logTimes(r, k => r.log.start[k]), tp = logTimes(r, k => r.log.tip[k]);
  console.log('   hand starts ' + hand.start.join(' ') + ' | tips ' + hand.tip.join(' '));
  console.log('   sim  starts ' + st.join(' ') + ' | tips ' + tp.join(' '));
  ok(st.join() === hand.start.join() && tp.join() === hand.tip.join(), 'all 5 loads match the hand calculation');
  ok(r.summary.fleetDelayMin === 28, 'minutes loading was held up for a lorry: 14 + 0 + 14 = 28 (sim ' + r.summary.fleetDelayMin + ')');
  ok(Engine.truckStats(r).peak === 2, 'peak trucks in use is the fleet of 2');
  ok(r.summary.endTime > coreEnd, 'finish is later than with unlimited lorries (' + hh(r.summary.endTime) + ' vs ' + hh(coreEnd) + ')');
  audit('B1 fleet of 2', sc);
  // a huge fleet never limits, so the result must equal the core exactly
  const big = withMods(Model.exampleSimple(), { B1: true }, { B1: { fleet: 1500 } });
  const rb = Engine.simulate(big), r0 = Engine.simulate(Model.exampleSimple());
  const hsh = r => crypto.createHash('sha1').update(JSON.stringify([r.log.src, r.log.dst, r.log.start, r.log.tip, r.log.t])).digest('hex').slice(0, 12);
  ok(hsh(rb) === hsh(r0), 'a fleet of 1,500 on the 12-section example reproduces the core exactly (' + hsh(rb) + ')');
  const t60 = Engine.simulate(withMods(Model.exampleSimple(), { B1: true }, { B1: { fleet: 60 } }));
  ok(t60.summary.endTime === r0.summary.endTime && Engine.truckStats(t60).peak <= 60, 'a fleet of 60 is enough for this job (its real peak is ' + Engine.truckStats(t60).peak + '), so nothing changes');
  const t30 = Engine.simulate(withMods(Model.exampleSimple(), { B1: true }, { B1: { fleet: 30 } }));
  console.log('   fleet 30: finish ' + Engine.fmtTime(t30.summary.endTime, t30.P.startDay) + ' (core ' + Engine.fmtTime(r0.summary.endTime, t30.P.startDay) + '), lorry wait ' + Math.round(t30.summary.fleetDelayMin / 60) + ' h, peak ' + Engine.truckStats(t30).peak);
  ok(t30.summary.endTime > r0.summary.endTime && Engine.truckStats(t30).peak <= 30 && t30.summary.fleetDelayMin > 0, 'a tight fleet of 30 finishes later, never uses more than 30, and the lost time is reported');
  audit('B1 fleet of 30', withMods(Model.exampleSimple(), { B1: true }, { B1: { fleet: 30 } }));
}

console.log('\n21. B2 VEHICLE TYPES: bigger payload, fewer loads');
{
  // one type, 25 t payload: 100 t = 4 loads (not 5). Starts 07:00..07:30, last tip 07:30 + 10 + 12 = 07:52 (core 08:02).
  const sc = withMods(tiny(), { B2: true }, { B2: { types: [{ id: 'a', name: 'ADT', payload: 25, speedLoaded: 5, speedEmpty: 5, qty: 10, publicRoad: false }] } });
  const r = Engine.simulate(sc);
  console.log('   hand: 4 loads of 25 t, last tip 07:52. sim: ' + r.n + ' loads, last tip ' + hh(r.summary.endTime));
  ok(r.n === 4 && hh(r.summary.endTime) === '07:52' && r.log.t.every(t => t === 25), '4 loads of 25 t, finish 07:52');
  // two types: 1 x 20 t and 1 x 10 t lorry; 100 t needs all loads <= payload of the lorry used
  const sc2 = withMods(tiny(), { B2: true }, { B2: { types: [{ id: 'a', name: 'Big', payload: 20, speedLoaded: 5, speedEmpty: 5, qty: 1, publicRoad: true }, { id: 'b', name: 'Small', payload: 10, speedLoaded: 5, speedEmpty: 5, qty: 1, publicRoad: true }] } });
  const r2 = Engine.simulate(sc2);
  ok(r2.summary.complete && Engine.truckStats(r2).peak <= 2, 'a mixed fleet of 2 still moves all 100 t using at most 2 lorries');
  audit('B2 mixed fleet', sc2);
}

console.log('\n22. B3 LOADED / EMPTY SPEEDS, SPEED LIMITS, GRADIENTS');
{
  const a = Engine.simulate(withMods(tiny(), { B3: true }, { B3: { loadedKph: 4, emptyKph: 4 } }));
  console.log('   hand: 1 km at 4 kph = 15 min, last load 07:40 + 10 + 15 = 08:05. sim: ' + hh(a.summary.endTime));
  ok(hh(a.summary.endTime) === '08:05', 'loaded speed 4 kph: finish 08:05');
  // gradient 0.5 (loaded) on the cut section: first 500 m at 2.5 kph = 12 min, last 500 m at 5 kph = 6 min => 18 min
  const g = Engine.simulate(withMods(tiny(), { B3: true }, { B3: { loadedKph: 5, emptyKph: 5, mode: 'bySection', bySection: { a: { limitKph: '', gradLoaded: 0.5, gradEmpty: 1 } } } }));
  console.log('   hand: 500 m at 2.5 kph (12 min) + 500 m at 5 kph (6 min) = 18 min, first tip 07:10 + 18 = 07:28. sim: ' + hh(g.log.tip[0]));
  ok(hh(g.log.tip[0]) === '07:28', 'gradient factor 0.5 on the cut half: first tip 07:28');
  const lm = Engine.simulate(withMods(tiny(), { B3: true }, { B3: { loadedKph: 5, emptyKph: 5, mode: 'bySection', bySection: { a: { limitKph: 2.5, gradLoaded: 1, gradEmpty: 1 } } } }));
  ok(hh(lm.log.tip[0]) === '07:28', 'a 2.5 kph speed limit on the cut section gives the same 18 min trip');
  // empty speed only matters with a fleet: 2 lorries, empty 10 kph = 6 min back, so load 3 starts at 07:28 (07:22 + 6)
  const f = Engine.simulate(withMods(tiny(), { B1: true, B3: true }, { B1: { fleet: 2 }, B3: { loadedKph: 5, emptyKph: 10 } }));
  console.log('   hand: lorry 1 tips 07:22, back in 6 min => load 3 starts 07:28 (07:34 at 5 kph). sim: ' + hh(f.log.start[2]));
  ok(hh(f.log.start[2]) === '07:28', 'faster empty return brings the lorry back sooner');
  audit('B3 on', withMods(Model.exampleSimple(), { B3: true }));
}

console.log('\n23. B4 RECEIVING RATES: lorries queue to tip');
{
  // 100 t/h, 1 bay: a 20 t load takes 12 min to tip. Arrivals 07:22 07:32 07:42 07:52 08:02.
  // tips: 07:22-07:34, 07:34-07:46, 07:46-07:58, 07:58-08:10, 08:10-08:22. waits 0+2+4+6+8 = 20 min. Finish 08:22.
  const sc = withMods(tiny(), { B4: true }, { B4: { rate: 100, bays: 1, mode: 'site', bySection: {} } });
  const r = Engine.simulate(sc);
  console.log('   hand: finish 08:22, queue wait 20 min. sim: finish ' + hh(r.summary.endTime) + ', wait ' + r.summary.tipWaitMin + ' min');
  ok(hh(r.summary.endTime) === '08:22' && r.summary.tipWaitMin === 20, 'tipping queue matches the hand calculation');
  const two = Engine.simulate(withMods(tiny(), { B4: true }, { B4: { rate: 200, bays: 2, mode: 'site', bySection: {} } }));
  // 200 t/h over 2 bays = 100 t/h per bay: 12 min per load. Arrivals 07:22 07:32 07:42 07:52 08:02 alternate bays, each free in time: no queue.
  // Last tip = 08:02 + 12 = 08:14.
  ok(two.summary.tipWaitMin === 0 && hh(two.summary.endTime) === '08:14', '200 t/h over 2 bays: no queue, finish 08:14 (sim ' + hh(two.summary.endTime) + ', wait ' + two.summary.tipWaitMin + ')');
  // Slow receiving (40 t/h, 1 bay = 30 min per load) with a 30 min queue limit: loading is held so no lorry queues longer than 30 min.
  // load1 07:00 arr 07:22 tips to 07:52. load2 arr 07:32 waits 20, tips to 08:22. load3 would wait 40 so it is held to start 07:30
  // (= 08:22 - 30 - 12 trip - 10 load), arr 07:52, waits 30, tips to 08:52. load4 starts 08:00, load5 08:30. last tip 09:52. total wait 0+20+30+30+30 = 110.
  const q = Engine.simulate(withMods(tiny(), { B4: true }, { B4: { rate: 40, bays: 1, maxQueueMin: 30, mode: 'site', bySection: {} } }));
  console.log('   hand: starts 07:00 07:10 07:30 08:00 08:30, finish 09:52, max wait 30, total wait 110');
  console.log('   sim : starts ' + logTimes(q, k => q.log.start[k]).join(' ') + ', finish ' + hh(q.summary.endTime) + ', max wait ' + q.summary.tipWaitMax + ', total wait ' + q.summary.tipWaitMin);
  ok(logTimes(q, k => q.log.start[k]).join() === '07:00,07:10,07:30,08:00,08:30' && hh(q.summary.endTime) === '09:52' && q.summary.tipWaitMax === 30 && q.summary.tipWaitMin === 110, 'queue limit holds loading back exactly as calculated');
  const nolim = Engine.simulate(withMods(tiny(), { B4: true }, { B4: { rate: 40, bays: 1, maxQueueMin: '', mode: 'site', bySection: {} } }));
  ok(nolim.summary.tipWaitMax > 30 && nolim.summary.endTime === q.summary.endTime, 'with no limit lorries queue longer (' + nolim.summary.tipWaitMax + ' min) but the finish is the same: the fill is the bottleneck');
  const defq = Engine.simulate(withMods(Model.exampleSimple(), { B4: true })).summary;
  ok(defq.tipWaitMax <= 30, 'on the 12-section example no lorry queues more than 30 min (longest ' + defq.tipWaitMax + ' min, total ' + Math.round(defq.tipWaitMin / 60) + ' h)');
  ok(Engine.simulate(withMods(Model.exampleSimple(), { B4: true })).summary.endTime >= Engine.simulate(Model.exampleSimple()).summary.endTime, 'default receiving rates never finish earlier than unlimited tipping');
  audit('B4 on', withMods(Model.exampleSimple(), { B4: true }));
}

console.log('\n24. B5 EXCAVATORS');
{
  // 60 t/h => a 20 t load takes 20 min. Starts every 20 min: 07:00 .. 08:20. Last tip 08:20 + 20 + 12 = 08:52.
  const a = Engine.simulate(withMods(tiny(), { B5: true }, { B5: { mode: 'site', rate: 60, relocMin: 60, machines: [] } }));
  console.log('   hand: loads every 20 min, finish 08:52. sim: starts ' + logTimes(a, k => a.log.start[k]).join(' ') + ', finish ' + hh(a.summary.endTime));
  ok(hh(a.summary.endTime) === '08:52', 'site-wide 60 t/h gives 20-minute loads: finish 08:52');
  // relocation: one 120 t/h machine does cut C1 on Monday, then C2 from Tuesday; it loses 60 min moving.
  const o = Model.defaults(); o.settings.startDate = '2027-01-11'; o.setup.modules.B5 = true;
  const mk = (id, len, q) => { const x = Model.newSection(0); x.id = id; x.name = id; x.lengthM = len; Model.setQty(x, q); x.maxLoaders = 1; return x; };
  o.sections = [mk('C1', 1000, 40), mk('F', 1000, -80), mk('C2', 1000, 40)];
  const sc = Model.normalise(o);
  sc.modules.B5 = { mode: 'byMachine', rate: 120, relocMin: 60, machines: [{ id: 'm1', name: 'Ex 1', rate: 120, assignments: [{ sec: 'C1', from: '', to: '2027-01-11' }, { sec: 'C2', from: '2027-01-12', to: '' }] }] };
  const r = Engine.simulate(sc);
  const days = Array.from({ length: r.n }, k => 0).map((_, k) => Math.floor(r.log.start[k] / 1440) + ':' + hh(r.log.start[k]));
  console.log('   hand: Mon C1 loads 07:00, 07:10 (120 t/h = 10 min, first posting no move). Tue C2 loses 60 min: 08:00, 08:10');
  console.log('   sim : ' + days.join(' '));
  ok(days.join() === '0:07:00,0:07:10,1:08:00,1:08:10', 'machine relocation costs 60 min on the day it moves');
  audit('B5 individual machines', withMods(Model.exampleModules(), {}));
  ok(Model.validate(Model.normalise(Object.assign(JSON.parse(JSON.stringify(sc)), {}))).every(x => x.level !== 'error'), 'valid machine assignments raise no errors');
  const bad = JSON.parse(JSON.stringify(sc)); bad.modules.B5.machines[0].assignments = [{ sec: 'C1', from: '', to: '' }];
  ok(Model.validate(Model.normalise(bad)).some(x => x.level === 'error' && /C2/.test(x.text) && /never be loaded/.test(x.text)), 'a surplus section with no excavator is reported in plain English');
}

console.log('\n25. B6 AVAILABILITY: uptime applied as lost time');
{
  // 50% uptime on lorries and excavators: loading 10/0.5 = 20 min, trip 12/0.5 = 24 min.
  // Starts 07:00 07:20 07:40 08:00 08:20; last tip 08:20 + 20 + 24 = 09:04.
  const r = Engine.simulate(withMods(tiny(), { B6: true }, { B6: { lorries: 50, excavators: 50, receiving: 100 } }));
  console.log('   hand: finish 09:04. sim: ' + hh(r.summary.endTime));
  ok(hh(r.summary.endTime) === '09:04', '50% uptime doubles loading and travel time: finish 09:04');
  ok(Engine.simulate(withMods(Model.exampleSimple(), { B6: true })).summary.endTime > Engine.simulate(Model.exampleSimple()).summary.endTime, 'default 90% availability finishes later');
  audit('B6 on', withMods(Model.exampleSimple(), { B6: true }));
}

console.log('\n26. EVERY MODULE ON WITH ONLY ITS DEFAULTS: runs, honours constraints, moves in the expected direction');
{
  const base = Engine.simulate(Model.exampleSimple()).summary, rows = [];
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
    const sc = withMods(Model.exampleSimple(), { [id]: true });
    const errs = Model.validate(sc).filter(x => x.level === 'error');
    const r = audit(id + ' defaults', sc), s = r.summary;
    rows.push([id, Engine.fmtTime(s.endTime, r.P.startDay), (s.endTime - base.endTime) / 1440]);
    ok(errs.length === 0 && s.moves > 0 && s.tonnesMoved >= base.tonnesMoved - 0.5, id + ' defaults: no validation errors, all soil still moved');
  }
  console.log('   baseline finish ' + Engine.fmtTime(base.endTime, Engine.prepare(Model.exampleSimple()).startDay));
  rows.forEach(r => console.log('   ' + r[0] + ' on -> finish ' + r[1] + ' (' + (r[2] >= 0 ? '+' : '') + r[2].toFixed(2) + ' days)'));
  const get = id => rows.find(r => r[0] === id)[2];
  ok(get('B4') > 0 && get('B6') > 0, 'receiving rates and availability delay the finish');
  ok(get('B5') < 0, 'excavators at 150 t/h load a 20 t lorry in 8 min (core: 10), so the finish comes earlier');
  ok(Math.abs(get('B1')) < 1e-9 && Math.abs(get('B2')) < 1e-9, 'a default fleet of 60 is not a limit on this job, so B1 and B2 defaults do not change the result');
  ok(Math.abs(get('B3')) < 1e-9, 'B3 defaults (empty speed only) cannot change a job with no fleet, so no change');
  ok(Engine.simulate(withMods(Model.exampleSimple(), { B1: true, B2: true, B3: true, B4: true, B5: true, B6: true })).summary.moves > 0, 'all six together run');
  audit('B1-B6 all on', withMods(Model.exampleSimple(), { B1: true, B2: true, B3: true, B4: true, B5: true, B6: true }));
}

console.log('\n27. SWITCHING A MODULE OFF AND ON KEEPS ITS ENTRIES');
{
  const sc = Model.exampleSimple();
  withMods(sc, { B1: true }, { B1: { fleet: 123 } });
  sc.setup.modules.B1 = false;
  ok(Engine.simulate(sc).summary.endTime === Engine.simulate(Model.exampleSimple()).summary.endTime, 'with B1 off the entered fleet is ignored (results equal the core)');
  const back = Model.normalise(JSON.parse(JSON.stringify(sc)));
  back.setup.modules.B1 = true;
  ok(back.modules.B1.fleet === 123 && Engine.simulate(back).summary.fleetSize === 123, 'switching B1 on again restores fleet = 123 (even after save and load)');
  const u = Model.normalise(JSON.parse(JSON.stringify(Model.exampleModules()))); Model.setUnits(u, 'm3');
  ok(Math.abs(u.modules.B2.types[0].payload - 25 / 1.8) < 1e-3 && u.modules.B4.rate > 0, 'switching to m3 converts module payloads and rates too');
}

console.log('\n28. OPTIMISER WITH MODULES ON, AND SPEED WITH A 300-LORRY FLEET');
{
  const sc = Model.exampleModules();
  const r = runOpt(sc, 'completion', 4000);
  console.log('   modules demo, earliest completion: ' + r.iterations + ' iterations (' + Math.round(r.evals / r.seconds) + ' sims/s); finish ' + Engine.fmtTime(r.before.endTime, r.before.startDay) + ' -> ' + Engine.fmtTime(r.after.endTime, r.before.startDay));
  ok(r.after.endTime <= r.before.endTime && Math.abs(r.after.tonnesMoved - r.before.tonnesMoved) < 0.5, 'never worse, same soil moved');
  if (r.plan) { sc.plan = r.plan; audit('optimised, modules on', sc); }
  const big = Model.defaults(); big.settings.maxMovesPerDay = 480;
  for (let i = 0; i < 100; i++) { const x = Model.newSection(i); x.id = 'p' + i; x.lengthM = 80; Model.setQty(x, i % 2 === 0 ? 100000 : -100000); x.maxLoaders = 2; big.sections.push(x); }
  const bs = Model.normalise(big); bs.setup.modules.B1 = true; bs.modules.B1.fleet = 300;
  const t0 = Date.now(), br = Engine.simulate(bs), ms = Date.now() - t0;
  const tr = Engine.truckStats(br);
  console.log('   100 sections, fleet of 300: ' + br.n + ' movements, ' + Math.floor(br.summary.endTime / 1440) + ' days in ' + ms + ' ms; peak in use ' + tr.peak);
  ok(tr.peak <= 300 && br.summary.complete, 'a 300-lorry fleet over a two-year job completes, never using more than 300 (peak ' + tr.peak + ')');
  ok(ms < 8000, 'and simulates in ' + ms + ' ms');
}

console.log('\n29. B1 DEPOT RETURN: lorries go home overnight and leave at a set time');
{
  // 2 lorries, cap 3/day, depot at chainage 0 (500 m from the cut midpoint = 6 min empty), leave 07:00. Fill midpoint is 1,500 m from the depot (18 min).
  // Day 0: both lorries leave the depot 07:00, reach the cut 07:06. L1 loads 07:06 (tips 07:28); L2 loads 07:16 (tips 07:38); L1 is back 07:40: load 3 starts 07:40, tips 08:02.
  // Overnight both drive home (L1 08:02 + 18 min) and wait; Day 1 they leave 07:00, arrive 07:06: load 4 starts 07:06 (tips 07:28), load 5 07:16 (tips 07:38).
  const mk = dep => { const sc = withMods(tiny(), { B1: true }, { B1: { fleet: 2, depotOn: dep, depotM: 0, depotLeave: '07:00' } }); sc.settings.maxMovesPerDay = 3; return sc; };
  const r = Engine.simulate(mk(true));
  const lab = k => Math.floor(r.log.start[k] / 1440) + ':' + hh(r.log.start[k]), labT = k => Math.floor(r.log.tip[k] / 1440) + ':' + hh(r.log.tip[k]);
  const hs = '0:07:06,0:07:16,0:07:40,1:07:06,1:07:16', ht = '0:07:28,0:07:38,0:08:02,1:07:28,1:07:38';
  console.log('   hand starts ' + hs + ' | tips ' + ht);
  console.log('   sim  starts ' + Array.from({ length: r.n }, (_, k) => lab(k)).join() + ' | tips ' + Array.from({ length: r.n }, (_, k) => labT(k)).join());
  ok(Array.from({ length: r.n }, (_, k) => lab(k)).join() === hs && Array.from({ length: r.n }, (_, k) => labT(k)).join() === ht, 'all 5 loads match the hand calculation');
  const nd = Engine.simulate(mk(false));
  ok(r.summary.endTime > nd.summary.endTime, 'returning to the depot finishes later than staying where they stopped (day 1 loads start 07:06 and 07:16, not 07:00 and 07:10)');
  // same depot with B3 switched on exercises the per-section travel path: empty at 6 kph, 500 m = 5 min, so the first load starts 07:05
  const b3 = withMods(mk(true), { B3: true }, { B3: { loadedKph: 5, emptyKph: 6, mode: 'site', bySection: {} } });
  const rb = Engine.simulate(b3);
  ok(hh(rb.log.start[0]) === '07:05', 'with a separate 6 kph empty speed the depot trip is 5 min: first load 07:05 (sim ' + hh(rb.log.start[0]) + ')');
  audit('depot return', mk(true));
  const ex = withMods(Model.exampleSimple(), { B1: true }, { B1: { fleet: 80, depotOn: true, depotM: 0, depotLeave: '07:00' } });
  audit('depot return, 12-section example', ex);
  ok(Model.validate(withMods(tiny(), { B1: true }, { B1: { fleet: 2, depotOn: true, depotM: 99999, depotLeave: '07:00' } })).some(x => x.level === 'error' && /depot chainage/.test(x.text)), 'a depot off the end of the road is reported in plain English');
}

console.log('\n30. E8 CHART DATA: start and finish dates against an independent reading of the movement log');
{
  const sc = Model.exampleSimple(), r = Engine.simulate(sc), cd = Engine.chartData(r), L = r.log;
  let bad = 0, rows = [];
  for (let i = 0; i < r.P.n; i++) {
    let st = Infinity, fin = -1; // independent: scan the log directly
    for (let k = 0; k < r.n; k++) {
      if (L.src[k] === i) { st = Math.min(st, L.start[k]); fin = Math.max(fin, L.depart[k]); }
      if (L.dst[k] === i) { st = Math.min(st, L.tip[k]); fin = Math.max(fin, L.tip[k]); }
    }
    const c = cd.sections[i], res = r.sections[i];
    const wantStart = st === Infinity ? null : st, wantEnd = res.levelTime !== null ? res.levelTime : (fin >= 0 ? fin : null);
    if (c.start !== wantStart || c.end !== wantEnd) bad++;
    if (res.levelTime !== null && c.end !== res.levelTime) bad++;               // equals the results table's "reaches level"
    const moved = Math.abs(res.qty) - res.remaining;
    if (Math.abs(c.pref[c.pref.length - 1] - moved) > 1) bad++;                   // daily tonnage adds up to what moved
    rows.push(res.name.padEnd(24) + (c.start === null ? '-' : Engine.fmtTime(c.start, r.P.startDay)) + '  ->  ' + (c.end === null ? '-' : Engine.fmtTime(c.end, r.P.startDay)) + (c.reached || c.end === null ? '' : ' (not reached)'));
  }
  console.log(rows.map(x => '   ' + x).join('\n'));
  ok(bad === 0, 'all ' + r.P.n + ' sections: chart start and finish equal the log and the results table, and daily tonnage adds up');
  const tot = cd.pairs.reduce((a, p) => a + p.tonnes, 0);
  ok(Math.abs(tot - r.summary.tonnesMoved) < 1e-6 && cd.pairs.every(p => p.t1 >= p.t0 && p.src !== p.dst), 'haul bands carry exactly the tonnes moved (' + Math.round(tot) + ' t) and run forward in time');
  const hsh = x => crypto.createHash('sha1').update(JSON.stringify([x.log.src, x.log.dst, x.log.start, x.log.tip, x.log.t])).digest('hex').slice(0, 12);
  const on = Model.exampleSimple(); on.setup.modules.E8 = true; on.ui.timeChainage.minimised = true;
  ok(hsh(Engine.simulate(on)) === hsh(r) && JSON.stringify(Engine.simulate(on).summary) === JSON.stringify(r.summary), 'E8 on or off, and any chart state, leaves the simulation identical');
  const big = Model.defaults(); big.settings.maxMovesPerDay = 480;
  for (let i = 0; i < 100; i++) { const x = Model.newSection(i); x.id = 'p' + i; x.lengthM = 80; Model.setQty(x, i % 2 === 0 ? 100000 : -100000); x.maxLoaders = 2; big.sections.push(x); }
  const br = Engine.simulate(Model.normalise(big)), t0 = Date.now(), bc = Engine.chartData(br), ms = Date.now() - t0;
  console.log('   100 sections, two years: ' + br.n + ' movements, ' + bc.pairs.length + ' haul pairs, chart data in ' + ms + ' ms');
  ok(ms < 1500, 'chart data for a 250,000-movement job builds in ' + ms + ' ms');
}

console.log('\n31. E8 VIEW STATE IS SAVED IN THE SCENARIO FILE');
{
  const a = Model.exampleSimple(); a.setup.modules.E8 = true;
  a.ui.timeChainage = { minimised: true, height: 333, timeDown: false, spanDays: 30, startDay: 12.5, follow: false };
  const b = Model.normalise(JSON.parse(JSON.stringify(a)));
  ok(JSON.stringify(b.ui.timeChainage) === JSON.stringify(a.ui.timeChainage) && b.setup.modules.E8 === true, 'minimised, height, direction, zoom span and position survive save and load');
  const old = JSON.parse(JSON.stringify(Model.exampleSimple())); delete old.ui;
  ok(Model.normalise(old).ui.timeChainage.height === 280 && Model.normalise(old).ui.timeChainage.minimised === false, 'a file saved before E8 loads with the default view');
}

console.log('\n11. SAVE / LOAD ROUND TRIP (level + modules + sections survive JSON)');
{
  const a = Model.exampleSimple(); a.setup.level = 'custom'; a.modules.B1 = { site: { fleet: 12 }, mode: 'site' };
  const b = Model.normalise(JSON.parse(JSON.stringify(a)));
  const ra = Engine.simulate(a), rb = Engine.simulate(b);
  ok(JSON.stringify(ra.log) === JSON.stringify(rb.log), 'identical movement log after round trip');
  ok(b.setup.level === 'custom' && b.modules.B1.site.fleet === 12, 'level and stored module entries preserved (even though B1 is off)');
  const old = JSON.parse(JSON.stringify(a)); delete old.setup; delete old.modules;
  ok(Model.normalise(old).setup.level === 'simple', 'older file without setup loads as Simple');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
