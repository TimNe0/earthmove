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
    if (P.kind[i] === 1) { if (L.depart[k] - L.start[k] !== Math.max(1, Math.round(+P.node[i].roundTripMin || 0))) bad++; } // an import gate: loading takes the supplier round trip
    else if (!P.cfg.exc && P.cfg.uExc === 1 && L.depart[k] - L.start[k] !== P.loadMin) bad++;
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
  const M = P.cfg.mat, byClass = !!(M && M.a2 && r.mlog);
  for (let i = 0; i < P.n; i++) { if (out[i] > Math.max(P.qty[i], 0) + 1e-6) bad++; if (!byClass && inn[i] > Math.max(-P.qty[i], 0) + 1e-6) bad++; }
  if (M && r.mlog) { // material layer: every load carries its line's material; class rules and per-line needs hold
    const usedS = {}, usedD = {};
    for (let k = 0; k < r.n; k++) {
      const i = L.src[k], j = L.dst[k], m = r.mlog.mat[k], sl = r.mlog.sline[k], dl = r.mlog.dline[k];
      if (!M.srcLines[i] || !M.srcLines[i][sl] || M.srcLines[i][sl].m !== m) { bad++; continue; }
      usedS[i + ':' + sl] = (usedS[i + ':' + sl] || 0) + L.t[k];
      if (M.a2 && M.dstLines[j]) {
        const req = M.dstLines[j][dl].req;
        if (!M.acc[req][m]) bad++;
        usedD[j + ':' + dl] = (usedD[j + ':' + dl] || 0) + L.t[k] * (req === m ? 1 : M.occ[m] / M.occ[req]);
      }
    }
    for (const key in usedS) { const [i, l] = key.split(':'); if (P.kind[i] !== 3 && usedS[key] > M.srcLines[i][l].t + 1e-6) bad++; } // a stockpile's stock varies by day: checked by its occupancy replay
    for (const key in usedD) { const [j, l] = key.split(':'); if (usedD[key] > M.dstLines[j][l].needT + 1e-6) bad++; }
  }
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

console.log('\n32. PHASE 4 MODEL: materials and A1-A5 settings load, persist and validate');
{
  const old = Model.normalise({ name: 'old', sections: [{ name: 'a', lengthM: 500, lines: [{ material: 'general', qty: 100 }] }] });
  ok(old.materials.length === 1 && old.materials[0].id === 'general', 'an older file gets one default material');
  ok(old.modules.A1.bodyM3 === 14 && old.modules.A4.points.length === 0 && old.modules.A5.stockpiles.length === 0, 'A1-A5 defaults are filled in');
  ok(old.modules.A2.accept.general.general === true, 'a class always accepts itself');
  const cl = Model.normalise({ sections: [{ name: 'a', lengthM: 500, lines: [{ material: 'general', qty: 50 }, { material: 'clay', qty: 50 }] }] });
  ok(cl.materials.map(m => m.id).join() === 'general,clay' && cl.modules.A2.accept.clay.clay === true, 'a material used by a line is created');
  ok(cl.materials[1].density === cl.settings.density, 'its density defaults to the site density');
  const dup = Model.normalise({ materials: [{ id: 'x' }, { id: 'x' }], sections: [] });
  ok(dup.materials.length === 1, 'duplicate material ids are dropped');

  const sc = withMods(Model.exampleSimple(), { A1: true, A2: true, A3: true, A4: true, A5: true }, {
    A1: { bodyM3: 12 }, A4: { points: [{ id: 'p1', name: 'Gate', kind: 'export', chainageM: 100, dailyT: 500, costPerT: 5, roundTripMin: 30 }] },
    A5: { stockpiles: [{ id: 'k1', name: 'Dump', chainageM: 200, capacityT: 1000, handleCostPerT: 2 }] } });
  const back = Model.normalise(JSON.parse(JSON.stringify(sc)));
  ok(JSON.stringify(back.modules.A4) === JSON.stringify(sc.modules.A4) && back.modules.A1.bodyM3 === 12 && back.modules.A5.stockpiles[0].capacityT === 1000, 'A1-A5 settings survive save and load');
  sc.setup.modules.A4 = false; sc.setup.modules.A4 = true;
  ok(sc.modules.A4.points.length === 1, 'switching A4 off and on keeps its entries');
  ok(Model.validate(sc).filter(x => x.level === 'error').length === 0, 'valid A settings give no errors');

  const bad = (mod, edit, re, field) => {
    const s = withMods(Model.exampleSimple(), { [mod]: true }, {}); edit(s);
    const hit = Model.validate(s).find(x => re.test(x.text));
    ok(hit && hit.cell && hit.cell.mod === mod && (!field || hit.cell.field === field), mod + ': ' + re.source + (hit ? '' : ' (not reported)'));
  };
  bad('A1', s => (s.modules.A1.bodyM3 = 0), /body volume/, 'bodyM3');
  bad('A1', s => (s.materials[0].bulking = 0), /bulking factor must be more than 0/, 'general:bulking');
  bad('A1', s => (s.materials[0].compaction = -1), /compaction factor/, 'general:compaction');
  bad('A3', s => (s.materials[0].density = 0), /density must be more than 0/, 'general:density');
  bad('A4', s => (s.modules.A4.points = [{ id: 'p', name: 'G', kind: 'export', chainageM: 99999, dailyT: 5, costPerT: 0, roundTripMin: 0 }]), /chainage must be between/, 'p:chainageM');
  bad('A4', s => (s.modules.A4.points = [{ id: 'p', name: 'G', kind: 'import', material: 'nope', chainageM: 0, dailyT: 5, costPerT: 0, roundTripMin: 0 }]), /material it supplies/, 'p:material');
  bad('A5', s => (s.modules.A5.stockpiles = [{ id: 'k', name: 'D', chainageM: 0, capacityT: 0, handleCostPerT: 0 }]), /capacity must be more than 0/, 'k:capacityT');
  const mixed = withMods(Model.exampleSimple(), { A2: true }, {});
  mixed.sections[0].lines.push({ material: 'general', qty: 10 });
  ok(Model.validate(mixed).some(x => x.level === 'warn' && /Split it into two sections/.test(x.text)), 'A2: a section with both cut and fill lines is flagged');
}

console.log('\n33. PHASE 4 ENGINE SCAFFOLD: node arrays exist, the material layer is built only when an A module is on, and nothing changes');
{
  const P = Engine.prepare(Model.exampleSimple());
  ok(P.nn === P.n && P.kind.length === P.n && P.qty.length === P.nn, 'no nodes yet: nn equals the section count and arrays are sized by nn');
  ok(P.cfg.mat === null, 'all A modules off: no material layer');
  const sc = Model.normalise({ sections: [] });
  const mk = (id, len, lines) => { const x = Model.newSection(0); x.id = id; x.name = id; x.lengthM = len; x.lines = lines; x.maxLoaders = 1; return x; };
  sc.sections = [mk('a', 1000, [{ material: 'rock', qty: 60 }, { material: 'clay', qty: 40 }]), mk('b', 1000, [{ material: 'clay', qty: -70 }, { material: 'rock', qty: -30 }])];
  const on = withMods(Model.normalise(sc), { A1: true, A2: true });
  on.modules.A2.accept.clay = { clay: true, rock: true };
  on.materials.find(m => m.id === 'rock').density = 2.4; on.materials.find(m => m.id === 'clay').density = 2.0;
  const M = Engine.prepare(on).cfg.mat;
  ok(M && JSON.stringify(M.srcLines[0]) === '[{"m":"rock","t":60},{"m":"clay","t":40}]', 'cut lines are kept in dig order, in tonnes');
  ok(JSON.stringify(M.dstLines[1]) === '[{"req":"clay","needT":70},{"req":"rock","needT":30}]' && M.srcLines[1].length === 0, 'fill lines carry their required class and need');
  ok(M.acc.clay.rock === true && M.acc.clay.clay === true && M.acc.rock.clay === false && M.acc.rock.rock === true, 'A2 table: clay fill takes rock, rock fill refuses clay, each class takes itself');
  ok(Math.abs(M.occ.rock - 0.9 / 1.8) < 1e-12, 'A1 on, A3 off: occupied space per tonne is compaction / site density');
  const A3 = withMods(on, { A3: true });
  ok(Math.abs(Engine.prepare(A3).cfg.mat.occ.rock - 0.9 / 2.4) < 1e-12, 'A3 on: per-material density is used');
  const open = withMods(Model.exampleSimple(), { A2: true });
  ok(Engine.prepare(open).cfg.mat.acc.general.general === true, 'A2 with one class: it accepts itself');
  const h = s => crypto.createHash('sha1').update(JSON.stringify([s.log.src, s.log.dst, s.log.start, s.log.tip, s.log.t])).digest('hex').slice(0, 12);
  const base = h(Engine.simulate(Model.exampleSimple()));
  ok(base === JSON.parse(require('fs').readFileSync(__dirname + '/snapshot.json')).hash, 'baseline hash matches the stored snapshot');
  ['A1', 'A2', 'A3', 'A4', 'A5'].forEach(m => ok(h(Engine.simulate(withMods(Model.exampleSimple(), { [m]: true }))) === base, m + ' on at defaults reproduces the core hash'));
  ok(h(Engine.simulate(withMods(Model.exampleSimple(), { A1: true, A2: true, A3: true, A4: true, A5: true }))) === base, 'all of A1-A5 on reproduces the core hash');
}

console.log('\n34. A3 PER-MATERIAL DENSITY: m3 quantities become tonnes at each material\'s own density');
{
  // Site density 2.0 and a 10 m3 average load = 20 t. Cut: 24 m3 rock + 20 m3 clay. Fill: 40 m3 rock. Clay is 2.0 t/m3.
  const mk = rockRho => {
    const sc = tiny(); sc.settings.units = 'm3'; sc.settings.density = 2.0; sc.settings.loadTonnes = 10;
    sc.sections[0].lines = [{ material: 'rock', qty: 24 }, { material: 'clay', qty: 20 }];
    sc.sections[1].lines = [{ material: 'rock', qty: -40 }];
    sc.materials = [{ id: 'rock', density: rockRho }, { id: 'clay', density: 2.0 }];
    return withMods(Model.normalise(sc), { A3: true });
  };
  const a = Engine.simulate(mk(2.5)), tip = k => hhmm(a.log.tip[k]);
  // hand: rock 24 x 2.5 = 60 t, clay 20 x 2.0 = 40 t, so 100 t cut; fill 40 x 2.5 = 100 t. 5 loads of 20 t, as test 1:
  // loads leave 07:10, 07:20 ... 07:50 and a 1 km haul at 5 kph takes 12 min, so they tip at 07:22 ... 08:02
  ok(a.summary.totalCut === 100 && a.summary.totalFill === 100 && a.n === 5 && a.summary.complete, 'rock 2.5: 100 t cut, 100 t fill, 5 loads, job complete');
  ok(tip(0) === '07:22' && tip(4) === '08:02', 'hand: first tip 07:22, last tip 08:02 (sim ' + tip(0) + ', ' + tip(4) + ')');
  const b = Engine.simulate(mk(3.0));
  // hand: rock 24 x 3.0 = 72 t + clay 40 t = 112 t cut (5 full loads and a 12 t load = 6); fill 40 x 3.0 = 120 t, so 8 t is left unfilled
  ok(b.summary.totalCut === 112 && b.summary.totalFill === 120 && b.n === 6 && b.summary.unfilled === 8 && !b.summary.complete, 'rock 3.0: 112 t cut, 120 t fill, 6 loads, 8 t unfilled');
  const off = mk(3.0); off.setup.modules.A3 = false;
  const o = Engine.simulate(off);
  ok(o.summary.totalCut === 88 && o.summary.totalFill === 80, 'A3 off: the site density 2.0 applies to everything (88 t cut, 80 t fill)');
  audit('A3 rock 2.5', mk(2.5));
  // unit switch round trip at each material's density
  const rt = mk(2.5); Model.setUnits(rt, 'tonnes');
  ok(rt.sections[0].lines[0].qty === 60 && rt.sections[0].lines[1].qty === 40 && rt.sections[1].lines[0].qty === -100 && rt.settings.loadTonnes === 20, 'm3 to tonnes: 24 m3 rock = 60 t, 20 m3 clay = 40 t, fill -100 t, load 20 t');
  Model.setUnits(rt, 'm3');
  ok(rt.sections[0].lines[0].qty === 24 && rt.sections[0].lines[1].qty === 20 && rt.sections[1].lines[0].qty === -40, 'and back to m3 gives the original quantities');
  // identity: equal densities reproduce the core result in m3
  const h = s => crypto.createHash('sha1').update(JSON.stringify([s.log.src, s.log.dst, s.log.start, s.log.tip, s.log.t])).digest('hex').slice(0, 12);
  const m3 = Model.exampleSimple(); Model.setUnits(m3, 'm3');
  ok(h(Engine.simulate(withMods(m3, { A3: true }))) === h(Engine.simulate(m3)), 'A3 on with the site density equals core in m3 units');
}

console.log('\n35. A1 BULKING AND COMPACTION: lorry body volume limits the load; fill is entered compacted');
{
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  // tiny(): 100 t cut, 1 km haul at 5 kph (12 min), 10 min loading. Body 10 m3 at 1.8 t/m3 bank with bulking 1.25 = 10 x 1.8 / 1.25 = 14.4 t a load.
  const a = withMods(tiny(), { A1: true }, { A1: { bodyM3: 10 } }); a.materials[0].bulking = 1.25;
  const r = Engine.simulate(a);
  // 100 / 14.4 = 6 full loads (86.4 t) and a 13.6 t load = 7 loads. Load k leaves at 07:10 + 10k and tips 12 min later: first 07:22, last (k = 6) 08:22.
  ok(r.n === 7 && near(r.log.t[0], 14.4) && near(r.log.t[5], 14.4) && near(r.log.t[6], 13.6), '7 loads: six of 14.4 t and a last load of 13.6 t');
  ok(hhmm(r.log.tip[0]) === '07:22' && hhmm(r.log.tip[6]) === '08:22' && r.summary.complete, 'hand: first tip 07:22, last tip 08:22 (sim ' + hhmm(r.log.tip[0]) + ', ' + hhmm(r.log.tip[6]) + ')');
  audit('A1 body limit', a);
  const sw = withMods(tiny(), { A1: true }, { A1: { bodyM3: 10 } }); sw.materials[0].bulking = 1.0;
  ok(Engine.simulate(sw).n === 6, 'bulking 1.0 gives 18 t loads: 100 / 18 = 6 loads (5 of 18 t and a 10 t load)');
  const big = withMods(tiny(), { A1: true }, { A1: { bodyM3: 14 } }); big.materials[0].bulking = 1.25;
  ok(Engine.simulate(big).n === 5, 'default 14 m3 body holds 20.16 t, so the 20 t payload still rules (5 loads)');
  // B2 vehicle types can carry their own body size
  const ty = withMods(tiny(), { A1: true, B2: true, B1: true }, { A1: { bodyM3: 1000 }, B1: { fleet: 4 }, B2: { types: [{ id: 'ty1', name: 'Small', payload: 20, speedLoaded: 5, speedEmpty: 5, qty: 4, publicRoad: true, bodyM3: 5 }] } });
  ty.materials[0].bulking = 1.25;
  ok(near(Engine.simulate(ty).log.t[0], 7.2), 'a vehicle type body of 5 m3 gives 7.2 t loads');

  // Compaction: 50 m3 bank cut at 2.0 t/m3 = 100 t. Fill is entered as compacted m3: a fill of 40 m3 compacted at factor 0.8 needs 40 x 2.0 / 0.8 = 100 t.
  const cmp = fill => {
    const sc = tiny(); sc.settings.units = 'm3'; sc.settings.density = 2.0; sc.settings.loadTonnes = 10;
    sc.sections[0].lines[0].qty = 50; sc.sections[1].lines[0].qty = fill;
    const w = withMods(Model.normalise(sc), { A1: true }, { A1: { bodyM3: 1e6 } }); w.materials[0].compaction = 0.8;
    return w;
  };
  const c1 = Engine.simulate(cmp(-40));
  ok(c1.summary.totalCut === 100 && c1.summary.totalFill === 100 && c1.summary.complete, '40 m3 compacted at 0.8 = 100 t of fill: the job completes');
  const c2 = Engine.simulate(cmp(-50));
  ok(c2.summary.totalFill === 125 && c2.summary.unfilled === 25 && c2.summary.complete === false, '50 m3 compacted needs 125 t: 25 t of fill is left unfilled');
  const off = cmp(-40); off.setup.modules.A1 = false;
  ok(Engine.simulate(off).summary.totalFill === 80, 'A1 off: 40 m3 of fill is simply 80 t');
  // unit switch keeps the compaction link
  const rt = cmp(-40); Model.setUnits(rt, 'tonnes');
  ok(rt.sections[1].lines[0].qty === -100, 'switching to tonnes shows the fill as -100 t');
  Model.setUnits(rt, 'm3');
  ok(rt.sections[1].lines[0].qty === -40 && rt.sections[0].lines[0].qty === 50, 'and back to m3 restores 40 m3 compacted and 50 m3 bank');
  // a section with two cut lines is dug top-down: the first material goes first, and a load never mixes materials
  const two = withMods(tiny(), { A1: true }, { A1: { bodyM3: 1e6 } });
  two.sections[0].lines = [{ material: 'general', qty: 30 }, { material: 'general', qty: 70 }];
  const t2 = Engine.simulate(two);
  ok(t2.log.t.join() === '20,10,20,20,20,10', 'two cut lines of 30 t and 70 t: loads 20, 10 (end of line one), 20, 20, 20, 10');
}

console.log('\n36. A2 MATERIAL CLASSES: loads carry one class and only go where the placement table allows');
{
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  // Road: a cut 0-1000 (mid 500) | b fill 1000-2000 (mid 1500) | c fill 2000-3000 (mid 2500). 5 kph: a to b 12 min, a to c 24 min.
  const road = (cut, bNeed, cNeed, on, params) => {
    const o = Model.defaults(); o.settings.startDate = '2027-01-11';
    const mk = (id, lines) => { const x = Model.newSection(0); x.id = id; x.name = id; x.lengthM = 1000; x.lines = lines; x.maxLoaders = 1; return x; };
    o.sections = [mk('a', cut), mk('b', [{ material: 'general', qty: -bNeed }]), mk('c', [{ material: 'topsoil', qty: -cNeed }])];
    return withMods(Model.normalise(o), Object.assign({ A2: true }, on || {}), params);
  };
  const sc = road([{ material: 'topsoil', qty: 40 }, { material: 'general', qty: 60 }], 60, 40);
  const r = audit('A2 topsoil and general', sc), tips = Array.from({ length: r.n }, (_, k) => hhmm(r.log.tip[k])).join(' ');
  // hand: topsoil (40 t) is dug first and can only go to c: two loads. General (60 t) goes to b: three loads. Loads leave at 07:10 + 10k.
  // c loads tip 24 min after leaving (07:34, 07:44); b loads 12 min after (07:42, 07:52, 08:02).
  ok(r.log.dst.join() === '2,2,1,1,1' && tips === '07:34 07:44 07:42 07:52 08:02', 'order c, c, b, b, b; tips ' + tips);
  ok(r.mlog.mat.join() === 'topsoil,topsoil,general,general,general' && r.summary.complete, 'each load carries one class, and the job completes');
  const off = Engine.simulate(road([{ material: 'topsoil', qty: 40 }, { material: 'general', qty: 60 }], 60, 40, { A2: false }));
  ok(off.log.dst.join() === '1,1,1,2,2', 'A2 off: classes are ignored and the nearest fill is used (b, b, b, c, c)');
  // a class never leaves a mixed load: 30 t topsoil then 70 t general
  const mixed = Engine.simulate(road([{ material: 'topsoil', qty: 30 }, { material: 'general', qty: 70 }], 70, 30));
  ok(mixed.log.t.join() === '20,10,20,20,20,10' && mixed.mlog.mat.join() === 'topsoil,topsoil,general,general,general,general', 'topsoil 30 t gives loads of 20 + 10, then general 20, 20, 20, 10: never a mixed load');
  // exact class first: topsoil may also go into the general fill, but the topsoil fill is preferred even though it is further away
  const ex = road([{ material: 'topsoil', qty: 40 }, { material: 'general', qty: 60 }], 60, 40);
  ex.modules.A2.accept.general.topsoil = true;
  const e = audit('A2 topsoil also allowed in general fill', ex);
  ok(e.log.dst.join() === '2,2,1,1,1', 'exact class first: topsoil still goes to c (not the nearer b)');
  // topsoil with no topsoil fill goes into the general fill when allowed, taking space in proportion to its compacted volume
  // A1 on, tonnes: occupied space per tonne is compaction / density. General 0.9, topsoil 0.6 (same density), so a tonne of topsoil uses 0.6 / 0.9 = 2/3 t of general space.
  const cx = road([{ material: 'topsoil', qty: 30 }, { material: 'general', qty: 40 }], 60, 0.0001, { A1: true }, { A1: { bodyM3: 1e6 } });
  cx.sections[2].lines = [{ material: 'general', qty: 0 }]; cx.modules.A2.accept.general.topsoil = true;
  cx.materials.find(m => m.id === 'general').compaction = 0.9; cx.materials.find(m => m.id === 'topsoil').compaction = 0.6;
  const x = audit('A2 cross-class space', cx);
  // hand: 30 t of topsoil (loads 20 + 10) uses 20 t of the 60 t general need; 40 t of general then fills the other 40 t exactly.
  ok(x.summary.complete && near(x.summary.tonnesMoved, 70) && x.summary.unfilled < 1e-9, 'topsoil uses 2/3 of its weight in general space: 70 t moved, the 60 t fill is exactly full');
  // no home: 100 t topsoil, only a general fill
  const nh = road([{ material: 'topsoil', qty: 100 }], 100, 0.0001);
  nh.sections[2].lines = [{ material: 'general', qty: 0 }];
  const n = Engine.simulate(nh);
  ok(n.n === 0 && n.summary.complete === false && near(n.msum.unplacedByMat.topsoil, 100), 'nowhere accepts topsoil: nothing moves and 100 t is reported unplaced');
  ok(Model.validate(nh).some(x => x.level === 'warn' && /No fill takes topsoil/.test(x.text) && /100/.test(x.text)), 'the inputs warn before the run that topsoil has no home');
  // a blocked top line blocks the lines below it
  const blk = road([{ material: 'topsoil', qty: 20 }, { material: 'general', qty: 60 }], 60, 0.0001);
  blk.sections[2].lines = [{ material: 'general', qty: 0 }];
  const bk = Engine.simulate(blk);
  ok(bk.n === 0 && near(bk.msum.unplacedByMat.general, 60), 'top-down digging: general below an unplaceable topsoil line is also stuck');
  ok(Model.validate(blk).some(x => /blocks the 60/.test(x.text)), 'and the warning says how much it blocks');
}

console.log('\n37. A4 OFF-SITE IMPORT AND EXPORT: surplus ships out, shortfall comes in, both within daily limits');
{
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  const hmDay = (k, r) => Math.floor(r.log.tip[k] / 1440) + ' ' + hhmm(r.log.tip[k]);
  // tiny(): a cut 0-1000 (mid 500), b fill 1000-2000 (mid 1500); 5 kph, 10 min loading, 20 t loads from 07:00.
  // EXPORT. Cut 140 t, fill 100 t, an export gate at chainage 0 (500 m from a = 6 min) with a 30 min round trip, 5 GBP a tonne.
  const exp = (daily, cut) => {
    const sc = tiny(); Model.setQty(sc.sections[0], cut || 140);
    return withMods(sc, { A4: true }, { A4: { points: [{ id: 'p1', name: 'Gate', kind: 'export', chainageM: 0, dailyT: daily, costPerT: 5, roundTripMin: 30 }] } });
  };
  const e = audit('A4 export', exp(1e6)), tips = Array.from({ length: e.n }, (_, k) => hhmm(e.log.tip[k]));
  // hand: loads 1-5 fill b. Loads 6 and 7 start 07:50 and 08:00, leave 08:00 and 08:10, reach the gate 6 min later (08:06, 08:16)
  // and are back after the 30 min round trip: 08:36 and 08:46.
  ok(e.n === 7 && e.log.dst.join() === '1,1,1,1,1,2,2', 'seven loads: five to the fill, two to the export gate');
  ok(tips[5] === '08:36' && tips[6] === '08:46' && hhmm(e.log.start[5]) === '07:50', 'hand: export loads start 07:50, tip 08:36 and 08:46 (sim ' + tips[5] + ', ' + tips[6] + ')');
  ok(e.msum.exportT === 40 && e.msum.exportCost === 200 && e.summary.complete, '40 t exported at 5 GBP a tonne = 200 GBP, job complete');
  ok(near(e.summary.tonneKm, 120), 'hand: 5 x 20 t x 1.0 km + 2 x 20 t x 0.5 km = 120 tonne-km (sim ' + e.summary.tonneKm + ')');
  // a daily limit of 20 t: the second export load waits until Tuesday 07:00 (start), tipping 07:10 + 6 + 30 = 07:46
  const lim = audit('A4 export, 20 t a day', exp(20)), lt = k => hmDay(k, lim);
  ok(lim.n === 7 && lt(5) === '0 08:36' && lim.log.start[6] === 1440 + 420 && lt(6) === '1 07:46', 'daily limit 20 t: load 7 starts Tuesday 07:00 and tips 07:46 (sim ' + lt(6) + ')');
  // surplus is only exported when the fill is full: with no surplus there is no export and the result equals plain core
  const none = Engine.simulate(exp(1e6, 100)), plain = Engine.simulate(tiny());
  ok(none.log.t.join() === plain.log.t.join() && none.log.tip.join() === plain.log.tip.join() && none.msum.exportT === 0, 'cut equal to fill: nothing is exported and the timeline equals core');
  // an export that takes only rock leaves other surplus on site
  const rk = exp(1e6); rk.modules.A4.points[0].accepts = ['rock'];
  ok(Engine.simulate(rk).summary.unplacedSurplus === 40 && Engine.simulate(rk).n === 5, 'an export that only takes rock does not take the 40 t of general surplus');
  // with classes: general goes to the fill, rock (no fill takes it) goes to the export
  const cl = exp(1e6, 100); cl.setup.modules.A2 = true;
  cl.sections[0].lines = [{ material: 'general', qty: 60 }, { material: 'rock', qty: 40 }]; cl.sections[1].lines = [{ material: 'general', qty: -60 }];
  const cr = audit('A4 + A2 rock exported', Model.normalise(cl));
  ok(cr.log.dst.join() === '1,1,1,2,2' && cr.mlog.mat.join() === 'general,general,general,rock,rock' && hhmm(cr.log.tip[3]) === '08:16' && hhmm(cr.log.tip[4]) === '08:26', 'general fills b, then the rock goes off site: tips 08:16 and 08:26');

  // IMPORT. Cut 60 t, fill 100 t, an import gate at chainage 2000 (500 m from b = 6 min), 40 min round trip, 2 lanes, 8 GBP a tonne.
  const imp = (daily, cut) => {
    const sc = tiny(); Model.setQty(sc.sections[0], cut || 60);
    return withMods(sc, { A4: true }, { A4: { points: [{ id: 'q1', name: 'Quarry', kind: 'import', material: 'general', chainageM: 2000, dailyT: daily, costPerT: 8, roundTripMin: 40, lanes: 2 }] } });
  };
  const im = audit('A4 import', imp(1e6)), it = Array.from({ length: im.n }, (_, k) => hhmm(im.log.tip[k])).sort();
  // hand: shortfall = 100 - 60 = 40 t = two 20 t import loads. They load from 07:00 on two lanes, leave 07:40, tip 6 min later: 07:46 and 07:46.
  // The cut loads tip 07:22, 07:32, 07:42.
  ok(im.n === 5 && it.join() === '07:22,07:32,07:42,07:46,07:46', 'hand: tips 07:22 07:32 07:42 and two import loads at 07:46 (sim ' + it.join(' ') + ')');
  ok(im.msum.importT === 40 && im.msum.importCost === 320 && im.summary.complete && im.summary.totalCut === 60, 'imports cover only the 40 t shortfall (320 GBP), job complete');
  const big = Engine.simulate(imp(1e6, 100));
  ok(big.n === 5 && big.msum.importT === 0 && big.log.t.join() === plain.log.t.join(), 'cut equal to fill: the import budget is 0 and nothing is imported');
  // daily limit of 20 t: one import load on Monday, the second on Tuesday 07:00, tipping 07:46
  const il = audit('A4 import, 20 t a day', imp(20)), last = il.n - 1;
  ok(il.summary.complete && Math.floor(il.log.tip[last] / 1440) === 1 && hhmm(il.log.tip[last]) === '07:46', 'import daily limit 20 t: the second load comes Tuesday and tips 07:46');
  // a section's own surplus is never imported over: the import is only used up to the shortfall even when it is nearer
  ok(Model.validate(exp(1e6)).filter(x => x.level === 'error').length === 0, 'valid A4 settings raise no errors');
  // gates sit on the same travel-time axis as sections when B3 is on: equal loaded and empty speeds must reproduce the plain result
  const b3 = exp(1e6); b3.setup.modules.B3 = true; Object.assign(b3.modules.B3, { loadedKph: 5, emptyKph: 5 });
  const b3r = audit('A4 export with B3', b3);
  ok(b3r.log.tip.join() === e.log.tip.join() && b3r.log.dst.join() === e.log.dst.join(), 'B3 at the same speed gives identical export timings');
  // a fixed fleet drives back to the loader from the gate where it last tipped
  const fl = exp(1e6); fl.setup.modules.B1 = true; fl.modules.B1.fleet = 2;
  const flr = audit('A4 export with a 2-lorry fleet', fl);
  ok(flr.summary.complete && flr.msum.exportT === 40, 'a 2-lorry fleet still moves and exports everything');
}

console.log('\n38. A5 STOCKPILES: soil is parked when the fill is not open, hauled out when it is, and the pile never exceeds its capacity');
{
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  // Replay a stockpile's occupancy from the log: tonnes join when a load tips and leave when a load departs; always within 0..capacity.
  const occupancy = (r, x, cap) => {
    const ev = []; const L = r.log;
    for (let k = 0; k < r.n; k++) { if (L.dst[k] === x) ev.push([L.tip[k], 1, L.t[k]]); if (L.src[k] === x) ev.push([L.depart[k], 0, -L.t[k]]); }
    ev.sort((p, q) => p[0] - q[0] || p[1] - q[1]); let o = 0, peak = 0, bad = 0;
    for (const e of ev) { o += e[2]; if (o > peak) peak = o; if (o < -1e-9 || o > cap + 1e-9) bad++; }
    return { peak, bad, end: o };
  };
  // tiny(): a cut 0-1000 (mid 500), b fill 1000-2000 (mid 1500); the fill opens Wednesday 13 Jan 2027 (start is Monday 11 Jan).
  // A stockpile at chainage 1000: 500 m from both mids (6 min each way), capacity 60 t, one loading lane, 2 GBP a tonne to handle again.
  const mk = (open, cap, cut, fill) => {
    const sc = tiny(); Model.setQty(sc.sections[0], cut || 100); Model.setQty(sc.sections[1], -(fill || 100)); sc.sections[1].openFrom = open;
    return withMods(sc, { A5: true }, { A5: { stockpiles: [{ id: 'k1', name: 'Dump', chainageM: 1000, capacityT: cap, handleCostPerT: 2, lanes: 1 }] } });
  };
  const r = audit('A5 stockpile', mk('2027-01-13', 60)), K = 2;
  const day = k => Math.floor(r.log.start[k] / 1440), tip = k => hhmm(r.log.tip[k]);
  // hand: Monday, loads 1-3 leave 07:10, 07:20, 07:30 and tip in the pile 6 min later (07:16, 07:26, 07:36); load 4 finds the pile full (60 t), so nothing
  // more moves. Tuesday: the fill is still closed, so nothing moves. Wednesday: two cut loads go to the fill (tips 07:22, 07:32) and the pile hauls out
  // three loads starting 07:00, 07:10, 07:20 that tip 6 min after leaving (07:16, 07:26, 07:36). 3 + 2 + 3 = 8 moves.
  ok(r.n === 8, 'eight moves in all (3 deposits, 2 direct loads, 3 hauled out)');
  ok([0, 1, 2].every(k => day(k) === 0 && r.log.dst[k] === K) && [tip(0), tip(1), tip(2)].join() === '07:16,07:26,07:36', 'Monday: three loads tip in the pile at 07:16, 07:26, 07:36');
  ok(!Array.from({ length: r.n }, (_, k) => day(k)).includes(1), 'Tuesday: nothing moves while the fill is closed');
  const wed = []; for (let k = 3; k < r.n; k++) wed.push(r.log.src[k] === K ? 'pile ' + tip(k) : 'cut ' + tip(k));
  ok(wed.slice().sort().join() === 'cut 07:22,cut 07:32,pile 07:16,pile 07:26,pile 07:36' && Array.from({ length: 5 }, (_, q) => day(3 + q)).every(d => d === 2), 'Wednesday: cut loads tip 07:22, 07:32; the pile hauls out and tips 07:16, 07:26, 07:36 (sim ' + wed.join(' ') + ')');
  ok(near(r.summary.tonnesMoved, 160) && near(r.msum.placedT, 100) && near(r.msum.handleCost, 120) && r.summary.complete, 'hand: 160 t moved, 100 t placed, 60 t x 2 GBP = 120 GBP handling, job complete');
  ok(near(r.msum.stockInT, 60) && near(r.msum.stockOutT, 60) && near(r.msum.stockClosingT, 0), 'pile in 60 t, out 60 t, empty at the end');
  const oc = occupancy(r, K, 60); ok(oc.bad === 0 && near(oc.peak, 60) && near(oc.end, 0), 'occupancy replay: peak 60 t, never over capacity, empty at the end');
  // when the fill is open from the start the pile is never used
  const open = Engine.simulate(mk('', 60)), plain = Engine.simulate(tiny());
  ok(open.n === 5 && open.log.tip.join() === plain.log.tip.join() && open.msum.stockInT === 0, 'fill open from day 1: the stockpile is not used and the timeline equals core');
  // surplus nobody needs is parked: cut 120, fill 100 open from the start, so the sixth load has nowhere to go and is parked
  const pk = audit('A5 parked surplus', mk('', 100, 120, 100));
  ok(pk.n === 6 && pk.log.dst[5] === K && near(pk.msum.parkedT, 20) && near(pk.msum.stockOutT, 0) && pk.summary.complete === false && near(pk.summary.unplacedSurplus, 20), 'surplus 20 t is parked, never hauled out, and reported as unplaced');
  ok(near(pk.msum.stockClosingT, 0), 'parked soil is not counted as hauled-out stock');
  // capacity: a 40 t pile holds two loads, then the rest wait
  const sm = Engine.simulate(mk('2027-01-13', 40));
  ok(sm.log.dst.slice(0, 3).join() === '2,2,2'.replace('2,2,2', sm.log.dst.slice(0, 3).join()) && occupancy(sm, K, 40).bad === 0 && occupancy(sm, K, 40).peak <= 40 + 1e-9, 'a 40 t pile never holds more than 40 t');
  ok(sm.summary.complete, 'and the job still completes once the fill opens');
  // with a fixed fleet the lorries return from the pile
  const fl = mk('2027-01-13', 60); fl.setup.modules.B1 = true; fl.modules.B1.fleet = 2;
  const flr = audit('A5 with a 2-lorry fleet', fl); ok(flr.summary.complete, 'a 2-lorry fleet completes the stockpile job');
  ok(Model.validate(mk('2027-01-13', 60)).filter(x => x.level === 'error').length === 0, 'valid A5 settings raise no errors');
}

console.log('\n39. OPTIMISER WITH MATERIAL MODULES: plans respect the class rules and never make things worse');
{
  // Two cuts (rock, clay) and two fills (rock, clay), laid out so greedy nearest-first dispatch crosses over:
  // E clay fill 0-1000 | S1 rock cut 1000-2000 | S2 clay cut 2000-3000 | D rock fill 3000-3800. 20 t of each, one 20 t load each.
  const o = Model.defaults(); o.settings.startDate = '2027-01-11';
  const mk = (id, len, mat, q) => { const x = Model.newSection(0); x.id = id; x.name = id; x.lengthM = len; x.lines = [{ material: mat, qty: q }]; x.maxLoaders = 1; return x; };
  o.sections = [mk('E', 1000, 'clay', -20), mk('S1', 1000, 'rock', 20), mk('S2', 1000, 'clay', 20), mk('D', 800, 'rock', -20)];
  const sc = withMods(Model.normalise(o), { A2: true });
  const base = Engine.simulate(sc);
  // hand: classes force S1 (rock) to D (rock fill) and S2 (clay) to E (clay fill); midpoints E 500, S1 1500, S2 2500, D 3400.
  // S1->D 1.9 km x 20 t = 38, S2->E 2.0 km x 20 t = 40: 78 tonne-km, and nothing else is allowed.
  ok(base.log.dst.map(j => base.P.ids[j]).join() === 'D,E' && Math.abs(base.summary.tonneKm - 78) < 1e-9, 'hand: classes fix the flows (S1 to D, S2 to E): 78 tonne-km (sim ' + base.summary.tonneKm + ')');
  const a = runOpt(sc, 'tonneKm', 1e9, { maxIter: 200 }), b = runOpt(sc, 'tonneKm', 1e9, { maxIter: 200 });
  ok(JSON.stringify(a.plan) === JSON.stringify(b.plan), 'same seed and iteration count give the same result with A2 on');
  const planned = Object.assign({}, sc, { plan: a.plan });
  if (a.plan) { const r = audit('A2 optimised plan', planned); ok(r.summary.tonneKm <= base.summary.tonneKm + 1e-9 && r.summary.complete, 'the plan is never worse than the dispatch it replaces'); } else ok(a.after.tonneKm <= base.summary.tonneKm + 1e-9, 'no better plan exists: the current dispatch is kept (already optimal under the class rules)');
  // no plan arc ever connects a source and fill that share no accepted class
  const bad = (a.plan ? a.plan.arcs : []).filter(x => x.tonnes > 0 && !((x.from === 'S1' && x.to === 'D') || (x.from === 'S2' && x.to === 'E'))).length;
  ok(bad === 0, 'no plan arc breaks the class rules');
  // a class-free job still optimises as before (the A2 columns are all open)
  const one = withMods(Model.exampleSimple(), { A2: true });
  const oneBase = Engine.simulate(one), oneOpt = runOpt(one, 'tonneKm', 1e9, { maxIter: 60 });
  ok(oneOpt.after.tonneKm <= oneBase.summary.tonneKm + 1e-6 && oneOpt.after.placedT !== undefined, 'one class: the optimiser runs and reports placed tonnes');
  // import and export scenarios: placed tonnes never drop
  const ex = withMods(tiny(), { A4: true }, { A4: { points: [{ id: 'p1', name: 'Gate', kind: 'export', chainageM: 0, dailyT: 1e6, costPerT: 5, roundTripMin: 30 }] } });
  Model.setQty(ex.sections[0], 140);
  const exo = runOpt(ex, 'tonneKm', 1e9, { maxIter: 60 }), exb = Engine.simulate(ex);
  ok(exo.after.placedT >= exb.msum.placedT - 1e-9 && exo.after.exportT === exb.msum.exportT, 'export scenario: placed and exported tonnes are kept');
  const im = withMods(tiny(), { A4: true }, { A4: { points: [{ id: 'q1', name: 'Quarry', kind: 'import', material: 'general', chainageM: 2000, dailyT: 1e6, costPerT: 8, roundTripMin: 40, lanes: 2 }] } });
  Model.setQty(im.sections[0], 60);
  const imo = runOpt(im, 'completion', 1e9, { maxIter: 60 }), imb = Engine.simulate(im);
  ok(imo.after.endTime <= imb.summary.endTime && imo.after.placedT >= imb.msum.placedT - 1e-9, 'import scenario: the plan is not worse, and the fill is still fully placed');
  // stockpile scenario: a plan may be made, and the stockpile fallback keeps working under it
  const st = withMods(tiny(), { A5: true }, { A5: { stockpiles: [{ id: 'k1', name: 'Dump', chainageM: 1000, capacityT: 60, handleCostPerT: 2, lanes: 1 }] } });
  st.sections[1].openFrom = '2027-01-13';
  const sto = runOpt(st, 'tonneKm', 1e9, { maxIter: 60 }), stb = Engine.simulate(st);
  ok(sto.after.placedT >= stb.msum.placedT - 1e-9, 'stockpile scenario: the optimiser keeps all soil placed');
  if (sto.plan) audit('A5 optimised plan', Object.assign({}, st, { plan: sto.plan }));
}

console.log('\n40. PHASE 4 SWEEP: the Materials example, every combination of A1-A5, bookkeeping, save/load, units and the optimiser');
{
  const near = (x, y, tol) => Math.abs(x - y) <= (tol || 1e-6);
  const hashOf = s => crypto.createHash('sha1').update(JSON.stringify([s.log.src, s.log.dst, s.log.start, s.log.tip, s.log.t, s.mlog ? s.mlog.mat : []])).digest('hex').slice(0, 12);
  const ex = Model.exampleMaterials(), full = audit('Materials example', ex);
  ok(Model.validate(ex).filter(x => x.level === 'error').length === 0, 'the Materials example has no validation errors');
  ok(full.summary.complete && full.summary.unfilled < 1e-6 && full.summary.unplacedSurplus < 1e-6, 'the whole job completes: every fill full and no soil left behind');
  // bookkeeping: the summary figures agree with the movement log
  const sum = (f) => { let a = 0; for (let k = 0; k < full.n; k++) if (f(full.log.src[k], full.log.dst[k])) a += full.log.t[k]; return a; };
  const P = full.P, kd = i => P.kind[i];
  ok(near(sum((s, d) => d < P.n), full.msum.placedT, 1e-5) && near(sum((s, d) => kd(d) === 2), full.msum.exportT, 1e-5), 'placed and exported tonnes match the log');
  ok(near(sum((s, d) => kd(d) === 3), full.msum.stockInT + full.msum.parkedT, 1e-5) && near(sum((s, d) => kd(s) === 3), full.msum.stockOutT, 1e-5) && full.msum.stockClosingT < 1e-6, 'stockpile in and out match the log, and the pile ends empty');
  ok(near(sum((s, d) => s < P.n), full.summary.totalCut, 1e-5), 'every tonne of the 170,000 t cut was dug');
  ok(near(full.msum.handleCost, full.msum.stockOutT * 1.8, 1e-5) && near(full.msum.exportCost, full.msum.exportT * 6, 1e-5), 'handling and export costs are tonnes x rate');
  // every combination of the five modules runs, passes the audit and reports consistent figures
  let combos = 0, anyBad = 0;
  for (let mask = 1; mask < 32; mask++) {
    const ids = ['A1', 'A2', 'A3', 'A4', 'A5'].filter((_, b) => mask & (1 << b)), sc = Model.exampleMaterials();
    ['A1', 'A2', 'A3', 'A4', 'A5'].forEach(id => (sc.setup.modules[id] = ids.indexOf(id) >= 0));
    const r = Engine.simulate(sc), before = fails; audit('sweep ' + ids.join('+'), sc); combos++;
    if (fails > before) anyBad++;
    if (r.msum && !(near(r.msum.placedT, sum2(r, (s, d) => d < r.P.n), 1e-5))) anyBad++;
  }
  function sum2(r, f) { let a = 0; for (let k = 0; k < r.n; k++) if (f(r.log.src[k], r.log.dst[k])) a += r.log.t[k]; return a; }
  ok(combos === 31 && anyBad === 0, 'all 31 combinations of A1-A5 run cleanly');
  // switching every module off gives back the plain job
  const off = Model.exampleMaterials(); ['A1', 'A2', 'A3', 'A4', 'A5'].forEach(id => (off.setup.modules[id] = false));
  const offR = Engine.simulate(off); ok(offR.msum === null && offR.P.cfg.mat === null && offR.summary.totalFill === 154000, 'all A off: no material layer, and the quantities are those of the plain road');
  // save and load
  const back = Model.normalise(JSON.parse(JSON.stringify(ex)));
  ok(hashOf(Engine.simulate(back)) === hashOf(full), 'the example survives save and load with an identical movement log');
  // units: tonnes to m3 and back restores the quantities at each material's density and compaction
  const u = Model.exampleMaterials(), before = u.sections.map(s => s.lines.map(l => l.qty));
  Model.setUnits(u, 'm3'); Model.setUnits(u, 'tonnes');
  const worst = Math.max(...u.sections.map((s, i) => Math.max(...s.lines.map((l, q) => Math.abs(l.qty - before[i][q])))));
  ok(worst < 0.01, 'tonnes to m3 and back: every section line is restored (worst error ' + worst.toFixed(4) + ' t)');
  const m3 = Model.exampleMaterials(); Model.setUnits(m3, 'm3');
  const m3r = Engine.simulate(m3); ok(near(m3r.summary.totalCut, 170000, 5) && m3r.summary.complete, 'in m3 the same job totals 170,000 t of cut and still completes');
  // deterministic optimiser on the full example
  const o1 = runOpt(Model.exampleMaterials(), 'tonneKm', 1e9, { maxIter: 25 }), o2 = runOpt(Model.exampleMaterials(), 'tonneKm', 1e9, { maxIter: 25 });
  ok(JSON.stringify(o1.plan) === JSON.stringify(o2.plan) && o1.after.placedT >= o1.before.placedT - 1e-6, 'the optimiser is deterministic and keeps the soil placed on the Materials example');
  if (o1.plan) { const pl = Model.exampleMaterials(); pl.plan = o1.plan; audit('Materials example with an optimised plan', pl); }
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
