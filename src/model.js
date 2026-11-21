/* Scenario model: defaults, normalisation, validation, examples. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./modules.js'));
  else root.Model = factory(root.Engine, root.Modules);
})(typeof self !== 'undefined' ? self : this, function (Engine, Modules) {
  'use strict';
  const VERSION = 1;
  const HEX_COLOUR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i; // the only colours a loaded scenario may carry

  // A material is also a placement class (A2). Density is t per m3, bulking is loose/bank volume, compaction is compacted/bank volume.
  function defaultMaterial(st, id) {
    return { id: id || 'general', name: id && id !== 'general' ? id : 'General fill', colour: '#a0855b',
             density: +(st && st.density) > 0 ? +st.density : 1.8, bulking: 1.25, compaction: 1.0 };  // compaction 1.0: ticking A1 at its defaults changes no quantity
  }
  const MOD_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1', 'C2', 'C3', 'C4', 'C5', 'D1', 'D2', 'D3', 'D4', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'];

  function defaults() {
    const settings = { startDate: '2027-01-11', speedKph: 5, loadTonnes: 20, loadMinutes: 10, maxMovesPerDay: 200,
                  units: 'tonnes', density: 1.8 };
    return {
      version: VERSION, name: 'New scenario',
      setup: { level: 'simple', modules: {} },
      settings,   // units: 'tonnes' | 'm3'. loadTonnes and section quantities are held in this unit; density is t per m3
      materials: [defaultMaterial(settings)],
      sections: [],
      modules: {},          // per-module parameter store; kept when a module is switched off
      ui: { timeChainage: { minimised: false, height: 280, timeDown: true, spanDays: 0, startDay: 0, follow: true } }, // saved view state (E8)
      plan: null,           // optimiser output (phase 2)
      saved: [],            // named scenarios (D5)
      actuals: []           // planned vs actual (E6)
    };
  }
  // Parameters for the optional modules. They always exist in the file, so switching a module off never loses them.
  // Quantity rates (per hour) are held in the scenario's unit, like section quantities.
  function moduleDefaults(st) {
    const uf = st && st.units === 'm3' && +st.density > 0 ? +st.density : 1, spd = +(st && st.speedKph) || 5, ld = +(st && st.loadTonnes) || 20;
    return {
      A1: { bodyM3: 14 },
      A2: { accept: {} },
      A3: {},
      A4: { points: [] },
      A5: { stockpiles: [] },
      // C: site constraints
      C1: { blocks: [] },                       // [{id, name, chainageM, openDate}]
      C2: { stretches: [] },                    // [{id, name, fromM, toM, mode:'rate'|'alternate', perHour, phaseMin}]
      C3: { periods: [] },                      // [{id, sec:'all'|sectionId, from, to ('' = open-ended), note}]
      C4: { layers: 3, waitDays: 2, mode: 'site', bySection: {} },
      C5: { publicLimit: 100, internalLimit: '', publicAll: false, publicStretches: [] },   // internalLimit '' = the global daily limit
      // D: programme and risk
      D1: { lostDays: [5, 4, 3, 2, 1, 1, 1, 1, 2, 3, 4, 5], winterOn: false, winterFrom: '12-20', winterTo: '01-05', random: false, seed: 1 },
      D2: { runs: 200, seed: 1, breakdownPct: 2 },
      D3: { targets: {} },                      // {sectionId: 'yyyy-mm-dd'}
      D4: { shifts: [{ start: '07:00', end: '19:00' }], replace: false, weekendSat: false, weekendSun: false, holidaysOn: true, holidaysAuto: true, holidays: [] },
      // E: commercial and reporting
      E1: { basis: 'used', lorryRate: 45, excavatorRate: 70, receivingRate: 55, fuelPrice: 1.45, labourRate: 28 },
      E2: { lorryLPerHour: 25, excavatorLPerHour: 30, receivingLPerHour: 18, kgCO2PerLitre: 2.68 },
      E3: {}, E4: { dateFormat: 'uk', idPrefix: 'EW' }, E5: {}, E6: { actuals: [], asOf: '' }, E7: { title: 'Earthmove summary' },
      B1: { fleet: 60, depotOn: false, depotM: 0, depotLeave: '07:00' },
      B2: { types: [{ id: 'ty1', name: 'Standard lorry', payload: ld, speedLoaded: spd, speedEmpty: spd, qty: 60, publicRoad: true }] },
      B3: { loadedKph: spd, emptyKph: Math.round(spd * 1.2 * 10) / 10, mode: 'site', bySection: {} },
      B4: { rate: Math.round(300 / uf * 10) / 10, bays: 2, maxQueueMin: 30, mode: 'site', bySection: {} },
      B5: { mode: 'site', rate: Math.round(150 / uf * 10) / 10, relocMin: 60, machines: [] },
      B6: { lorries: 90, excavators: 90, receiving: 90 }
    };
  }
  // One machine per loader the sections currently allow, each assigned to its section for the whole job.
  function machinesFromLoaders(scn) {
    const out = []; let n = 0;
    const uf = scn.settings.units === 'm3' && +scn.settings.density > 0 ? +scn.settings.density : 1;
    scn.sections.forEach(s => { if (secQty(s) > 0) for (let q = 0; q < Math.max(1, +s.maxLoaders || 1); q++) out.push({ id: 'ex' + (++n), name: 'Excavator ' + n, rate: Math.round(150 / uf * 10) / 10, assignments: [{ sec: s.id, from: '', to: '' }] }); });
    return out;
  }
  let seq = 0;
  function newId() { return 's' + Date.now().toString(36) + (seq++).toString(36); }
  function newSection(n) {
    return {
      id: newId(), name: 'Section ' + (n + 1), lengthM: 500,
      lines: [{ material: 'general', qty: 0 }],
      workStart: '07:00', workEnd: '19:00', openFrom: '', maxLoaders: 2, workDays: [1, 1, 1, 1, 1, 0, 0]
    };
  }
  // Fill in anything missing so older or hand-edited files still load.
  function normalise(scn) {
    const d = defaults();
    const o = Object.assign({}, d, scn || {});
    o.setup = Object.assign({}, d.setup, o.setup || {});
    o.setup.modules = Object.assign({}, o.setup.modules || {});
    Modules.list.forEach(m => { if (o.setup.modules[m.id] === undefined) o.setup.modules[m.id] = false; });
    o.settings = Object.assign({}, d.settings, o.settings || {});
    o.modules = o.modules || {}; o.saved = o.saved || []; o.actuals = o.actuals || [];
    o.ui = Object.assign({}, d.ui, o.ui || {}); o.ui.timeChainage = Object.assign({}, d.ui.timeChainage, o.ui.timeChainage || {});
    const md = moduleDefaults(o.settings);
    for (const k in md) o.modules[k] = Object.assign({}, md[k], o.modules[k] || {});
    o.sections = (o.sections || []).map((s, i) => {
      const b = newSection(i);
      const r = Object.assign(b, s);
      if (!s.id) r.id = newId();
      if (!Array.isArray(r.lines) || !r.lines.length) r.lines = [{ material: 'general', qty: 0 }];
      if (!Array.isArray(r.workDays) || r.workDays.length !== 7) r.workDays = [1, 1, 1, 1, 1, 0, 0];
      return r;
    });
    // materials: every line's material must exist, ids are unique, and a class always accepts itself (A2)
    const seen = {};
    o.materials = (Array.isArray(o.materials) && o.materials.length ? o.materials : d.materials).map(m => Object.assign(defaultMaterial(o.settings, m && m.id), m))
      .map(m => (HEX_COLOUR.test(m.colour) ? m : Object.assign(m, { colour: defaultMaterial(o.settings, m.id).colour }))) // a loaded file is untrusted and colours go into canvas and style strings
      .filter(m => (seen[m.id] ? false : (seen[m.id] = true)));
    o.sections.forEach(s => s.lines.forEach(l => {
      if (!l.material) l.material = 'general';
      if (!seen[l.material]) { seen[l.material] = true; o.materials.push(defaultMaterial(o.settings, l.material)); }
    }));
    const a2 = o.modules.A2; a2.accept = a2.accept || {};
    o.materials.forEach(m => { a2.accept[m.id] = Object.assign({}, a2.accept[m.id] || {}); a2.accept[m.id][m.id] = true; });
    ['A4:points', 'A5:stockpiles'].forEach(k => {
      const [mod, f] = k.split(':'); const m = o.modules[mod];
      if (!Array.isArray(m[f])) m[f] = [];
      m[f].forEach(x => { if (!x.id) x.id = newId(); });
    });
    return o;
  }
  const secQty = s => Engine.netQty(s);
  // Switch the quantity unit, converting every entered quantity and the average load at the current density.
  function setUnits(scn, u) {
    const cur = scn.settings.units === 'm3' ? 'm3' : 'tonnes';
    if (u === cur) return;
    const rho = +scn.settings.density > 0 ? +scn.settings.density : 1.8;
    const f = u === 'm3' ? 1 / rho : rho, r = v => Math.round(v * 10000) / 10000;
    const mo = scn.setup.modules || {};
    if (mo.A1 || mo.A3) scn.sections.forEach(s => s.lines.forEach(l => (l.qty = r(+l.qty * Engine.lineFactor(scn, l, cur) / Engine.lineFactor(scn, l, u)))));  // per-material density and compaction
    else scn.sections.forEach(s => s.lines.forEach(l => (l.qty = r(+l.qty * f))));
    scn.settings.loadTonnes = r(+scn.settings.loadTonnes * f);
    const m = scn.modules || {};
    if (m.B2 && m.B2.types) m.B2.types.forEach(t => (t.payload = r(+t.payload * f)));
    if (m.B4) { m.B4.rate = r(+m.B4.rate * f); for (const k in m.B4.bySection || {}) if (m.B4.bySection[k].rate !== undefined && m.B4.bySection[k].rate !== '') m.B4.bySection[k].rate = r(+m.B4.bySection[k].rate * f); }
    if (m.B5) { m.B5.rate = r(+m.B5.rate * f); (m.B5.machines || []).forEach(x => (x.rate = r(+x.rate * f))); }
    scn.settings.units = u;
  }
  function setQty(s, q) { s.lines[0].qty = q; for (let i = 1; i < s.lines.length; i++) s.lines[i].qty = 0; }

  // Problems with the inputs of one module. cell = where to jump to fix it ({mod, field} or {sec, field}).
  function moduleIssues(scn, id) {
    const out = [], m = (scn.modules || {})[id] || {};
    const add = (level, text, cell) => out.push({ level, text, cell: cell || null });
    const mc = f => ({ mod: id, field: f });
    const pos = v => +v > 0;
    if (id === 'B1') {
      if (!(Math.floor(+m.fleet) >= 1)) add('error', 'Fleet size must be a whole number of at least 1 lorry.', mc('fleet'));
      if (m.depotOn) {
        const tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0);
        if (!(+m.depotM >= 0 && +m.depotM <= tot)) add('error', 'The depot chainage must be between 0 and ' + Math.round(tot) + ' m, the length of the road.', mc('depotM'));
        if (Engine.hm(m.depotLeave) === null) add('error', 'The time lorries leave the depot is not a valid time.', mc('depotLeave'));
      }
    } else if (id === 'B2') {
      if (!(m.types || []).length) add('error', 'Vehicle types is switched on but has no vehicle types. Add one.', mc('add'));
      let total = 0;
      (m.types || []).forEach(t => {
        const nm = t.name || 'A vehicle type';
        if (!pos(t.payload)) add('error', nm + ': the payload must be more than 0.', mc(t.id + ':payload'));
        if (!pos(t.speedLoaded)) add('error', nm + ': the loaded speed must be more than 0 kph.', mc(t.id + ':speedLoaded'));
        if (!pos(t.speedEmpty)) add('error', nm + ': the empty speed must be more than 0 kph.', mc(t.id + ':speedEmpty'));
        if (!(Math.floor(+t.qty) >= 0)) add('error', nm + ': the number of vehicles must be 0 or more.', mc(t.id + ':qty')); else total += Math.floor(+t.qty);
      });
      if ((m.types || []).length && total < 1) add('error', 'Every vehicle type has 0 vehicles, so nothing can move.', mc('add'));
    } else if (id === 'B3') {
      if (!pos(m.loadedKph)) add('error', 'The loaded speed must be more than 0 kph.', mc('loadedKph'));
      if (!pos(m.emptyKph)) add('error', 'The empty speed must be more than 0 kph.', mc('emptyKph'));
      if (m.mode === 'bySection') scn.sections.forEach(s => {
        const o = (m.bySection || {})[s.id]; if (!o) return;
        if (o.limitKph !== '' && o.limitKph !== undefined && !pos(o.limitKph)) add('error', (s.name || 'A section') + ': the speed limit must be more than 0 kph, or left blank.', { sec: s.id, field: 'b3limit' });
        if (o.gradLoaded !== '' && o.gradLoaded !== undefined && !pos(o.gradLoaded)) add('error', (s.name || 'A section') + ': the loaded gradient factor must be more than 0.', { sec: s.id, field: 'b3gl' });
        if (o.gradEmpty !== '' && o.gradEmpty !== undefined && !pos(o.gradEmpty)) add('error', (s.name || 'A section') + ': the empty gradient factor must be more than 0.', { sec: s.id, field: 'b3ge' });
      });
    } else if (id === 'B4') {
      if (!pos(m.rate)) add('error', 'The receiving rate must be more than 0 per hour.', mc('rate'));
      if (!(Math.floor(+m.bays) >= 1)) add('error', 'At least 1 lorry must be able to tip at once.', mc('bays'));
      if (m.maxQueueMin !== '' && !(+m.maxQueueMin >= 0)) add('error', 'The longest tipping queue allowed cannot be negative. Leave it blank for no limit.', mc('maxQueueMin'));
      if (m.mode === 'bySection') scn.sections.forEach(s => {
        const o = (m.bySection || {})[s.id]; if (!o || secQty(s) >= 0) return;
        if (o.rate !== '' && o.rate !== undefined && !pos(o.rate)) add('error', (s.name || 'A section') + ': the receiving rate must be more than 0, or left blank.', { sec: s.id, field: 'b4rate' });
        if (o.bays !== '' && o.bays !== undefined && !(Math.floor(+o.bays) >= 1)) add('error', (s.name || 'A section') + ': tipping bays must be at least 1, or left blank.', { sec: s.id, field: 'b4bays' });
      });
    } else if (id === 'B5') {
      if (!pos(m.rate)) add('error', 'The excavator output rate must be more than 0 per hour.', mc('rate'));
      if (!(+m.relocMin >= 0)) add('error', 'Relocation lost time cannot be negative.', mc('relocMin'));
      if (m.mode === 'byMachine') {
        if (!(m.machines || []).length) add('error', 'Individual excavators is chosen but no machines are listed. Add one, or use the button to create them from the loader counts.', mc('addMachine'));
        const ids = {}; scn.sections.forEach(s => (ids[s.id] = s));
        const assigned = {};
        (m.machines || []).forEach(x => {
          const nm = x.name || 'A machine';
          if (!pos(x.rate)) add('error', nm + ': the output rate must be more than 0.', mc(x.id + ':rate'));
          if (!(x.assignments || []).length) add('warn', nm + ' is not assigned to any section, so it will never work.', mc(x.id + ':rate'));
          (x.assignments || []).forEach(a => {
            if (!ids[a.sec]) add('error', nm + ' is assigned to a section that no longer exists.', mc(x.id + ':rate'));
            else assigned[a.sec] = 1;
            if ((a.from && Engine.parseISO(a.from) === null) || (a.to && Engine.parseISO(a.to) === null)) add('error', nm + ': an assignment date is not valid.', mc(x.id + ':rate'));
          });
        });
        scn.sections.forEach(s => { if (secQty(s) > 0 && !assigned[s.id]) add('error', (s.name || 'A section') + ' has soil to remove but no excavator is ever assigned to it, so it can never be loaded.', mc('addMachine')); });
      }
    } else if (id === 'A1') {
      if (!pos(m.bodyM3)) add('error', 'The lorry body volume must be more than 0 m\u00b3.', mc('bodyM3'));
      (scn.materials || []).forEach(x => {
        const nm = x.name || x.id;
        if (!pos(x.bulking)) add('error', nm + ': the bulking factor must be more than 0.', mc(x.id + ':bulking'));
        else if (+x.bulking < 1) add('warn', nm + ': a bulking factor below 1 means the soil shrinks when dug. That is unusual.', mc(x.id + ':bulking'));
        if (!pos(x.compaction)) add('error', nm + ': the compaction factor must be more than 0.', mc(x.id + ':compaction'));
      });
    } else if (id === 'A2') {
      const mods = scn.setup.modules, acc = m.accept || {}, nameOf = id => ((scn.materials || []).find(x => x.id === id) || {}).name || id;
      const homeFor = mat => scn.sections.some(s => s.lines.some(l => +l.qty < 0 && (l.material === mat || (acc[l.material] || {})[mat])))
        || (mods.A4 && ((scn.modules.A4 || {}).points || []).some(p => p.kind === 'export' && (!(p.accepts || []).length || p.accepts.indexOf(mat) >= 0)))
        || (mods.A5 && ((scn.modules.A5 || {}).stockpiles || []).length > 0);
      scn.sections.forEach(s => {
        s.lines.forEach((l, li) => {
          if (!(+l.qty > 0) || homeFor(l.material)) return;
          const below = s.lines.slice(li + 1).reduce((a, x) => a + (+x.qty > 0 ? +x.qty : 0), 0);
          add('warn', (s.name || 'A section') + ': No fill takes ' + nameOf(l.material) + ' (' + l.qty + ')' + (below > 0 ? ', so it blocks the ' + below + ' below it' : '') + '. Allow it in a fill, or add an export or a stockpile.', { sec: s.id, field: 'qty' });
        });
        if (s.lines.some(l => +l.qty > 0) && s.lines.some(l => +l.qty < 0)) add('warn', (s.name || 'A section') + ' has both cut and fill lines. Split it into two sections so soil classes can be placed correctly.', { sec: s.id, field: 'qty' });
      });
    } else if (id === 'A3') {
      (scn.materials || []).forEach(x => { if (!pos(x.density)) add('error', (x.name || x.id) + ': the density must be more than 0 tonnes per m\u00b3.', mc(x.id + ':density')); });
    } else if (id === 'A4' || id === 'A5') {
      const tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0), A4 = id === 'A4';
      (A4 ? m.points : m.stockpiles || []).forEach(x => {
        const nm = x.name || (A4 ? 'An access point' : 'A stockpile');
        if (!x.name) add('warn', nm + ' has no name.', mc(x.id + ':name'));
        if (!(+x.chainageM >= 0 && +x.chainageM <= tot)) add('error', nm + ': the chainage must be between 0 and ' + Math.round(tot) + ' m, the length of the road.', mc(x.id + ':chainageM'));
        if (A4) {
          if (!pos(x.dailyT)) add('error', nm + ': the daily limit must be more than 0 tonnes.', mc(x.id + ':dailyT'));
          if (!(+x.costPerT >= 0)) add('error', nm + ': the cost per tonne cannot be negative.', mc(x.id + ':costPerT'));
          if (!(+x.roundTripMin >= 0)) add('error', nm + ': the round-trip time cannot be negative.', mc(x.id + ':roundTripMin'));
          if (x.kind === 'import' && !(scn.materials || []).some(y => y.id === x.material)) add('error', nm + ': the material it supplies does not exist.', mc(x.id + ':material'));
        } else {
          if (!pos(x.capacityT)) add('error', nm + ': the capacity must be more than 0 tonnes.', mc(x.id + ':capacityT'));
          if (!(+x.handleCostPerT >= 0)) add('error', nm + ': the double-handling cost cannot be negative.', mc(x.id + ':handleCostPerT'));
        }
      });
    } else if (id === 'C1') {
      const tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0);
      (m.blocks || []).forEach(b => {
        const nm = b.name || 'A blockage';
        if (!(+b.chainageM >= 0 && +b.chainageM <= tot)) add('error', nm + ': the chainage must be between 0 and ' + Math.round(tot) + ' m, the length of the road.', mc(b.id + ':chainageM'));
        if (Engine.parseISO(b.openDate) === null) add('error', nm + ': the opening date is not a valid date.', mc(b.id + ':openDate'));
      });
      // plain-English conflicts: soil that can only be reached across a blockage
      const mids = []; let c = 0; scn.sections.forEach(s => { mids.push(c + (+s.lengthM || 0) / 2); c += +s.lengthM || 0; });
      (m.blocks || []).forEach(b => {
        if (!(+b.chainageM >= 0) || Engine.parseISO(b.openDate) === null) return;
        const side = i => (mids[i] < +b.chainageM ? 0 : 1), nm = b.name || 'The blockage', when = Engine.fmtDay(Engine.parseISO(b.openDate));
        scn.sections.forEach((s, i) => {
          const q = Engine.netQty(s); if (!q) return;
          const same = scn.sections.some((o, k) => k !== i && side(k) === side(i) && Math.sign(Engine.netQty(o)) === -Math.sign(q));
          if (!same) add('warn', (s.name || 'A section') + ' can only ' + (q > 0 ? 'send its soil to' : 'receive soil from') + ' the other side of ' + nm + ', so it cannot start before ' + when + '.', mc(b.id + ':openDate'));
        });
      });
    } else if (id === 'E4') {
      if (m.dateFormat !== 'uk' && m.dateFormat !== 'iso') add('error', 'The date format must be UK (dd/mm/yyyy) or ISO (yyyy-mm-dd).', mc('dateFormat'));
    } else if (id === 'E6') {
      const seen = {};
      (m.actuals || []).forEach((a, k) => {
        if (Engine.parseISO(a.date) === null) add('error', 'Actual ' + (k + 1) + ': the date is not a valid date.', mc('actual' + k + 'd'));
        else { if (seen[a.date]) add('warn', 'Two actuals are entered for ' + a.date + '; both are added together.', mc('actual' + k + 'd')); seen[a.date] = 1; }
        if (!(+a.tonnes >= 0)) add('error', 'Actual ' + (k + 1) + ': the tonnes must be 0 or more.', mc('actual' + k + 't'));
      });
    } else if (id === 'E1') {
      [['lorryRate', 'The lorry hire rate'], ['excavatorRate', 'The excavator hire rate'], ['receivingRate', 'The receiving plant hire rate'], ['fuelPrice', 'The fuel price'], ['labourRate', 'The labour rate']].forEach(([k, nm]) => { if (!(+m[k] >= 0)) add('error', nm + ' must be 0 or more.', mc(k)); });
      if (m.basis !== 'used' && m.basis !== 'standing') add('error', 'The lorry hire basis must be "used" or "standing".', mc('basis'));
      if (m.basis === 'standing' && !(scn.setup.modules.B1 || scn.setup.modules.B2)) add('warn', 'Standing hire charges a fixed fleet for every working day, but there is no fixed fleet (switch on B1 or B2), so busy hours are charged instead.', mc('basis'));
    } else if (id === 'E2') {
      [['lorryLPerHour', 'The lorry fuel burn'], ['excavatorLPerHour', 'The excavator fuel burn'], ['receivingLPerHour', 'The receiving plant fuel burn']].forEach(([k, nm]) => { if (!(+m[k] >= 0)) add('error', nm + ' must be 0 or more litres per hour.', mc(k)); });
      if (!(+m.kgCO2PerLitre > 0)) add('error', 'The carbon factor must be more than 0 kg of CO\u2082e per litre.', mc('kgCO2PerLitre'));
    } else if (id === 'D1') {
      (m.lostDays || []).forEach((v, k) => {
        const mn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][k];
        if (!(+v >= 0)) add('error', mn + ': the expected lost days must be 0 or more.', mc('lost' + k));
        else if (+v > 25) add('warn', mn + ': ' + v + ' lost days is more than the working days in a month, so every working day would be lost.', mc('lost' + k));
      });
      if ((m.lostDays || []).length !== 12) add('error', 'Weather needs an expected number of lost days for each of the 12 months.', mc('lost0'));
      if (m.winterOn) ['winterFrom', 'winterTo'].forEach(f => { if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(m[f] || '')) add('error', 'The winter shutdown ' + (f === 'winterFrom' ? 'start' : 'end') + ' must be a month and day written like 12-20.', mc(f)); });
    } else if (id === 'D2') {
      if (!(Math.floor(+m.runs) >= 10 && Math.floor(+m.runs) <= 5000)) add('error', 'The number of runs must be between 10 and 5000.', mc('runs'));
      if (!(+m.breakdownPct >= 0 && +m.breakdownPct <= 100)) add('error', 'The breakdown chance per loading point per day must be between 0 and 100 percent.', mc('breakdownPct'));
    } else if (id === 'D3') {
      const t = m.targets || {};
      Object.keys(t).forEach(k => {
        const sec = scn.sections.find(x => x.id === k); if (!t[k]) return;
        if (Engine.parseISO(t[k]) === null) add('error', (sec ? sec.name || 'A section' : 'A section') + ': the target date is not a valid date.', sec ? { sec: sec.id, field: 'd3target' } : null);
        else if (!sec) add('warn', 'A target date is set for a section that no longer exists, so it is ignored.', null);
        else if (!Engine.netQty(sec)) add('warn', (sec.name || 'A section') + ' has a target date but no soil, so it can never be late.', { sec: sec.id, field: 'd3target' });
      });
    } else if (id === 'C2') {
      const tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0);
      (m.stretches || []).forEach(x => {
        const nm = x.name || 'A single-lane stretch';
        if (!(+x.fromM >= 0 && +x.toM <= tot && +x.fromM < +x.toM)) add('error', nm + ': it must start before it ends, both between 0 and ' + Math.round(tot) + ' m (the length of the road).', mc(x.id + ':fromM'));
        if (x.mode === 'alternate') { if (!(Math.floor(+x.phaseMin) >= 1)) add('error', nm + ': the phase length must be at least 1 minute.', mc(x.id + ':phaseMin')); }
        else if (!(Math.floor(+x.perHour) >= 1)) add('error', nm + ': the limit must be at least 1 lorry per hour.', mc(x.id + ':perHour'));
      });
    } else if (id === 'C5') {
      const tot = scn.sections.reduce((a, x) => a + (+x.lengthM || 0), 0);
      if (!(+m.publicLimit >= 0)) add('error', 'The public-road daily limit must be 0 or more.', mc('publicLimit'));
      if (m.internalLimit !== '' && m.internalLimit !== undefined && !(+m.internalLimit >= 0)) add('error', 'The internal daily limit must be 0 or more, or left blank for no extra limit.', mc('internalLimit'));
      (m.publicStretches || []).forEach(x => { if (!(+x.fromM >= 0 && +x.toM <= tot && +x.fromM < +x.toM)) add('error', (x.name || 'A public-road stretch') + ': it must start before it ends, both between 0 and ' + Math.round(tot) + ' m.', mc(x.id + ':fromM')); });
      if (!m.publicAll && !(m.publicStretches || []).length && !(scn.setup.modules.A4 && ((scn.modules.A4 || {}).points || []).length)) add('warn', 'No public-road stretches are listed (and not every movement is marked public), so no movement counts as public and the public limit has no effect.', mc('publicLimit'));
    } else if (id === 'C4') {
      const chk = (n, w, nm, cell) => {
        if (!(Math.floor(+n) >= 1)) add('error', nm + ': the number of layers must be a whole number of at least 1.', cell('layers'));
        if (!(+w >= 0)) add('error', nm + ': the waiting period cannot be negative.', cell('waitDays'));
      };
      chk(m.layers, m.waitDays, 'Layered fill', f => mc(f));
      if (m.mode === 'bySection') scn.sections.forEach(s => {
        const o = (m.bySection || {})[s.id]; if (!o || Engine.netQty(s) >= 0) return;
        if (o.layers !== '' && o.layers !== undefined && !(Math.floor(+o.layers) >= 1)) add('error', (s.name || 'A section') + ': the number of layers must be at least 1, or left blank.', { sec: s.id, field: 'c4layers' });
        if (o.waitDays !== '' && o.waitDays !== undefined && !(+o.waitDays >= 0)) add('error', (s.name || 'A section') + ': the waiting period cannot be negative, or leave it blank.', { sec: s.id, field: 'c4wait' });
      });
    } else if (id === 'C3') {
      (m.periods || []).forEach((x, k) => {
        const nm = 'Closed period ' + (k + 1) + (x.note ? ' (' + x.note + ')' : '');
        const a = Engine.parseISO(x.from), b = x.to ? Engine.parseISO(x.to) : null;
        if (a === null) add('error', nm + ': the start date is not a valid date.', mc(x.id + ':from'));
        if (x.to && b === null) add('error', nm + ': the end date is not a valid date. Leave it blank if the section is closed for good.', mc(x.id + ':to'));
        if (a !== null && b !== null && b < a) add('error', nm + ': it ends before it starts.', mc(x.id + ':to'));
        if (x.sec && x.sec !== 'all' && !scn.sections.some(sec => sec.id === x.sec)) add('warn', nm + ' refers to a section that no longer exists, so it has no effect.', mc(x.id + ':sec'));
      });
    } else if (id === 'D4') {
      const sh = m.shifts || [];
      sh.forEach((x, k) => {
        const a = Engine.hm(x.start), b = Engine.hm(x.end), nm = 'Shift ' + (k + 1);
        if (a === null || b === null) add('error', nm + ': the start or finish is not a valid time.', mc('shift' + k));
        else if (a >= b) add('error', nm + ': it finishes before it starts. A shift cannot run past midnight, so split it into two.', mc('shift' + k));
      });
      const ok = sh.map(x => [Engine.hm(x.start), Engine.hm(x.end)]).filter(x => x[0] !== null && x[1] !== null && x[0] < x[1]).sort((p, q) => p[0] - q[0]);
      for (let q = 1; q < ok.length; q++) if (ok[q][0] < ok[q - 1][1]) add('warn', 'Two shifts overlap, so they are treated as one continuous shift.', mc('shift0'));
      if (!sh.length) add('warn', 'No shifts are listed, so each section keeps its own working hours.', mc('shift0'));
      if (m.holidaysAuto === false) (m.holidays || []).forEach((h, k) => { if (Engine.parseISO(h.date) === null) add('error', 'Holiday ' + (k + 1) + ' is not a valid date.', mc('holiday' + k)); });
      if (ok.length && !m.replace) scn.sections.forEach(s => {
        if (!(Engine.netQty(s) > 0)) return;
        const a = Engine.hm(s.workStart), b = Engine.hm(s.workEnd);
        if (a !== null && b !== null && !ok.some(x => Math.max(x[0], a) < Math.min(x[1], b))) add('warn', (s.name || 'A section') + ': its working hours do not overlap any shift, so no loads can start there.', { sec: s.id, field: 'workStart' });
      });
    } else if (id === 'B6') {
      [['lorries', 'Lorry'], ['excavators', 'Excavator'], ['receiving', 'Receiving plant']].forEach(([k, nm]) => {
        if (!(+m[k] > 0 && +m[k] <= 100)) add('error', nm + ' availability must be between 1 and 100 percent.', mc(k));
      });
    }
    return out;
  }
  MOD_IDS.forEach(id => { if (Modules.byId[id]) Modules.byId[id].validate = scn => moduleIssues(scn, id); });

  // Plain-English problems. cell = where to jump to fix it.
  function validate(scn) {
    const out = [];
    const add = (level, text, cell) => out.push({ level, text, cell: cell || null });
    const st = scn.settings;
    if (Engine.parseISO(st.startDate) === null) add('error', 'The project start date is not a valid date.', { settings: 'startDate' });
    if (!(+st.speedKph > 0)) add('error', 'Average travel speed must be more than 0 kph.', { settings: 'speedKph' });
    if (!(+st.loadTonnes > 0)) add('error', 'Average load must be more than 0.', { settings: 'loadTonnes' });
    if (st.units === 'm3' && !(+st.density > 0)) add('error', 'The soil density must be more than 0 tonnes per m\u00b3 when quantities are in m\u00b3.', { settings: 'density' });
    if (!(+st.loadMinutes >= 0)) add('error', 'Loading time cannot be negative.', { settings: 'loadMinutes' });
    if (!(+st.maxMovesPerDay >= 1)) add('error', 'The daily movement limit must be at least 1.', { settings: 'maxMovesPerDay' });
    if (!scn.sections.length) { add('error', 'There are no sections yet. Add at least one cut and one fill section.'); return out; }
    const names = {};
    let cut = 0, fill = 0;
    scn.sections.forEach((s, i) => {
      const nm = s.name || 'Section ' + (i + 1);
      const c = f => ({ sec: s.id, field: f });
      if (!s.name) add('warn', 'Section ' + (i + 1) + ' has no name.', c('name'));
      if (s.name) { if (names[s.name]) add('warn', 'Two sections are both called "' + s.name + '".', c('name')); names[s.name] = 1; }
      if (!(+s.lengthM > 0)) add('error', nm + ': the length must be more than 0 m.', c('lengthM'));
      const q = secQty(s);
      if (!isFinite(q)) add('error', nm + ': the soil quantity is not a number.', c('qty'));
      if (q > 0) cut++; else if (q < 0) fill++;
      const a = Engine.hm(s.workStart), b = Engine.hm(s.workEnd);
      if (a === null || b === null) add('error', nm + ': working hours are not valid times.', c('workStart'));
      else if (a >= b) add('error', nm + ': working hours finish before they start, so no loads can ever start here.', c('workEnd'));
      if (!(+s.maxLoaders >= 1)) add('error', nm + ': at least 1 lorry must be able to load at once.', c('maxLoaders'));
      if (s.openFrom && Engine.parseISO(s.openFrom) === null) add('error', nm + ': the earliest tipping date is not a valid date.', c('openFrom'));
      if (q > 0 && !s.workDays.some(Boolean)) add('error', nm + ' has soil to remove but no working days are ticked, so it can never be loaded.', c('workDays'));
    });
    MOD_IDS.forEach(id => { if (scn.setup.modules[id]) moduleIssues(scn, id).forEach(x => out.push(x)); });
    if (!cut) add('warn', 'No section has surplus soil. There is nothing to move.');
    if (!fill) add('warn', 'No section needs fill. Surplus soil has nowhere to go.');
    return out;
  }

  // ---------- E4 programme export, E5 section import, E6 planned versus actual ----------
  // The one CSV cell writer for every export (the page uses it too, as Model.csvCell). Names from a loaded scenario or an imported sheet are
  // untrusted, so a cell that starts with = + - @ TAB or CR gets a leading ' (the OWASP formula-injection guard); otherwise a spreadsheet
  // could run it as a formula. Numbers are written as they are, so a negative fill quantity stays a number. Then quote per RFC 4180;
  // ; and TAB are quoted too, for spreadsheets that use them as the delimiter. The guard matches csvCell in Intelligent Planning's tools/shared/csv.js.
  const csvCell = v => {
    if (typeof v === 'number' && isFinite(v)) return String(v);
    v = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return /[",\n\r;\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const fmtDate = (dn, style) => { if (dn === null || dn === undefined) return ''; const iso = Engine.dayToISO(dn); return style === 'iso' ? iso : iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); };
  const DOWS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const daysText = wd => { const a = (wd || []).map(Boolean); if (a.join() === 'true,true,true,true,true,false,false') return 'Mon-Fri'; if (a.join() === 'true,true,true,true,true,true,false') return 'Mon-Sat'; if (a.every(Boolean)) return 'Mon-Sun'; return a.map((x, i) => (x ? DOWS[i][0].toUpperCase() + DOWS[i].slice(1) : '')).filter(Boolean).join(' '); };

  // E4: section start and finish dates as CSV, for import into P6 or MS Project (map the columns on import: Activity ID / ID, Activity Name / Name, Original Duration / Duration).
  function programmeCSV(scn, res) {
    const e4 = (scn.modules || {}).E4 || {}, style = e4.dateFormat === 'iso' ? 'iso' : 'uk', prefix = String(e4.idPrefix || 'EW');
    const D = Engine.chartData(res), P = res.P, rows = [['Activity ID', 'Activity Name', 'Original Duration (days)', 'Start', 'Finish', 'Percent Complete', 'Type', 'Quantity (t)']], dflt = rateNoteText(scn, ['weather']); // dates depend on the weather rates: flag them in a last column (a comment line would break a P6 import)
    if (dflt) rows[0].push('Note');
    D.sections.forEach((sec, i) => {
      if (sec.type === 'none') return;
      const r = res.sections[i], d0 = sec.start === null ? null : Math.floor(sec.start / Engine.DAY), d1 = sec.start === null ? null : Math.floor(sec.end / Engine.DAY);
      const pct = !sec.reached ? Math.max(0, Math.min(99, Math.round((1 - r.remaining / Math.abs(r.qty)) * 100))) : 100;
      rows.push([prefix + String(i + 1).padStart(3, '0'), P.names[i], d0 === null ? '' : d1 - d0 + 1, d0 === null ? '' : fmtDate(P.startDay + d0, style), sec.reached ? fmtDate(P.startDay + d1, style) : '', d0 === null ? 0 : pct, sec.type === 'cut' ? 'Cut' : 'Fill', Math.round(Math.abs(r.qty))].concat(dflt ? [dflt.charAt(0).toUpperCase() + dflt.slice(1)] : []));
    });
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // E5: the section table as CSV (also the downloadable template), and a forgiving parser for CSV files or cells pasted from a spreadsheet.
  const SECTION_COLS = ['Name', 'Length (m)', 'Soil quantity (+ cut, - fill)', 'Loads start from', 'Loads start to', 'Earliest tipping date', 'Max loaders', 'Working days'];
  function sectionsCSV(scn, template) {
    const rows = [SECTION_COLS];
    if (template) rows.push(['Cutting A', 600, 12000, '07:00', '19:00', '', 2, 'Mon-Fri'], ['Embankment B', 800, -12000, '07:00', '19:00', '08/03/2027', 2, 'Mon-Fri']);
    else scn.sections.forEach(s => rows.push([s.name, s.lengthM, secQty(s), s.workStart, s.workEnd, s.openFrom ? fmtDate(Engine.parseISO(s.openFrom), 'uk') : '', s.maxLoaders, daysText(s.workDays)]));
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function splitRows(text) { // CSV / TSV with quoted fields; the delimiter is whichever of tab, semicolon or comma the first line uses most
    const first = text.split(/\r?\n/).find(l => l.trim()) || '', cnt = c => first.split(c).length - 1;
    const delim = cnt('\t') >= Math.max(cnt(';'), cnt(',')) && cnt('\t') > 0 ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  function parseDate(v) { v = String(v).trim(); let m; if (!v) return ''; if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v))) return v.length === 10 ? v : m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(v))) { const y = m[3].length === 2 ? '20' + m[3] : m[3], iso = y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); return Engine.parseISO(iso) === null ? null : iso; } return null; }
  function parseTime(v) { v = String(v).trim(); const m = /^(\d{1,2})[:.](\d{2})$/.exec(v); if (!m) return null; const t = m[1].padStart(2, '0') + ':' + m[2]; return Engine.hm(t) === null ? null : t; }
  function parseDays(v) {
    v = String(v).trim().toLowerCase(); if (!v) return [1, 1, 1, 1, 1, 0, 0];
    if (/^[01]{7}$/.test(v)) return v.split('').map(Number);
    if (/^(weekdays?|mon-?fri|mon to fri|monday to friday)$/.test(v)) return [1, 1, 1, 1, 1, 0, 0];
    if (/^(mon-?sat|mon to sat|monday to saturday)$/.test(v)) return [1, 1, 1, 1, 1, 1, 0];
    if (/^(all|every day|7 days|mon-?sun|daily)$/.test(v)) return [1, 1, 1, 1, 1, 1, 1];
    const out = [0, 0, 0, 0, 0, 0, 0], toks = v.split(/[\s,;\/+&]+/).filter(Boolean); if (!toks.length) return null;
    for (const t of toks) { const k = DOWS.indexOf(t.slice(0, 3)); if (k < 0) return null; out[k] = 1; }
    return out;
  }
  function parseSections(text, scn) {
    const rows = splitRows(String(text || '')), out = { sections: [], errors: [], warnings: [], rows: 0 };
    if (!rows.length) { out.errors.push({ row: 0, text: 'There is nothing to import: the file or pasted text is empty.' }); return out; }
    const ALIAS = { name: ['name', 'section', 'section name'], lengthM: ['length', 'length (m)', 'len', 'length m'], qty: ['soil quantity (+ cut, - fill)', 'quantity', 'qty', 'soil', 'soil quantity', 'volume', 'tonnes'], workStart: ['loads start from', 'start', 'from', 'work start', 'starts', 'start time'], workEnd: ['loads start to', 'to', 'end', 'finish', 'work end', 'until', 'end time'], openFrom: ['earliest tipping date', 'open', 'opens', 'open from', 'tipping date', 'earliest'], maxLoaders: ['max loaders', 'loaders'], workDays: ['working days', 'days', 'work days'] };
    const norm = h => String(h).trim().toLowerCase().replace(/\s+/g, ' '), idx = {};
    const head = rows[0].map(norm); let dataStart = 1;
    head.forEach((h, c) => { for (const k in ALIAS) if (ALIAS[k].indexOf(h) >= 0 && idx[k] === undefined) idx[k] = c; });
    if (idx.name === undefined && idx.lengthM === undefined && idx.qty === undefined) { // no header row: take the columns in template order
      dataStart = 0; ['name', 'lengthM', 'qty', 'workStart', 'workEnd', 'openFrom', 'maxLoaders', 'workDays'].forEach((k, c) => (idx[k] = c));
    } else if (idx.lengthM === undefined || idx.qty === undefined) {
      out.errors.push({ row: 1, text: 'The first row must name at least the length and the soil quantity columns. Use the template (Download template) to see the layout.' }); return out;
    }
    const get = (r, k) => (idx[k] === undefined || r[idx[k]] === undefined ? '' : String(r[idx[k]]).trim().replace(/^'(?=[=+\-@\t\r])/, '')); // drop the formula guard quote our own export adds
    for (let ri = dataStart; ri < rows.length; ri++) {
      const r = rows[ri], rn = ri + 1; out.rows++;
      const sec = newSection(out.sections.length), errs = out.errors.length, nm = get(r, 'name');
      if (!nm) out.warnings.push({ row: rn, text: 'Row ' + rn + ' has no name, so it is called "Section ' + (out.sections.length + 1) + '".' }); else sec.name = nm;
      const len = parseFloat(get(r, 'lengthM').replace(/,/g, '')), q = parseFloat(get(r, 'qty').replace(/,/g, ''));
      if (!(len > 0)) out.errors.push({ row: rn, text: 'Row ' + rn + ': the length "' + get(r, 'lengthM') + '" is not a number above 0.' }); else sec.lengthM = len;
      if (!isFinite(q)) out.errors.push({ row: rn, text: 'Row ' + rn + ': the soil quantity "' + get(r, 'qty') + '" is not a number.' }); else setQty(sec, q);
      ['workStart', 'workEnd'].forEach(k => { const v = get(r, k); if (!v) return; const t = parseTime(v); if (t === null) out.errors.push({ row: rn, text: 'Row ' + rn + ': "' + v + '" is not a time. Write it like 07:00.' }); else sec[k] = t; });
      const od = get(r, 'openFrom'); if (od) { const d = parseDate(od); if (d === null) out.errors.push({ row: rn, text: 'Row ' + rn + ': "' + od + '" is not a date. Write it like 08/03/2027 or 2027-03-08.' }); else sec.openFrom = d; }
      const ml = get(r, 'maxLoaders'); if (ml) { if (!(Math.floor(+ml) >= 1)) out.errors.push({ row: rn, text: 'Row ' + rn + ': the maximum loaders "' + ml + '" must be a whole number of at least 1.' }); else sec.maxLoaders = Math.floor(+ml); }
      const wd = get(r, 'workDays'); if (wd) { const d = parseDays(wd); if (d === null) out.errors.push({ row: rn, text: 'Row ' + rn + ': the working days "' + wd + '" are not understood. Write Mon-Fri, Mon-Sat, or 1111100.' }); else sec.workDays = d; }
      if (out.errors.length === errs) out.sections.push(sec);
    }
    return out;
  }
  // Put imported sections into a scenario: replace the whole table, or append to it.
  function applyImport(scn, parsed, mode) {
    const secs = parsed.sections.map(x => Object.assign({}, x, { id: newId() }));
    scn.sections = mode === 'append' ? scn.sections.concat(secs) : secs;
    return scn;
  }

  // E6: cumulative tonnes tipped on site by the end of each day, from the movement log.
  function plannedCumulative(res) {
    const L = res.log, n = res.P.n, out = []; let total = 0;
    const days = Math.floor(res.summary.endTime / Engine.DAY) + 2, per = new Float64Array(days);
    for (let k = 0; k < res.n; k++) if (L.dst[k] < n) per[Math.floor(L.tip[k] / Engine.DAY)] += L.t[k];
    for (let d = 0; d < days; d++) { total += per[d]; out.push(total); }
    return out;
  }
  // Variance table: for every day with an actual, the cumulative actual, the cumulative plan to the end of that day, and the difference.
  function actualsAnalysis(scn, res) {
    const e6 = ((scn.modules || {}).E6) || {}, plan = plannedCumulative(res), P = res.P;
    const rows = (e6.actuals || []).filter(a => Engine.parseISO(a.date) !== null && +a.tonnes >= 0).map(a => ({ date: a.date, day: Engine.parseISO(a.date) - P.startDay, tonnes: +a.tonnes })).sort((a, b) => a.day - b.day);
    let cum = 0; const out = rows.map(r => { cum += r.tonnes; const pl = r.day < 0 ? 0 : plan[Math.min(r.day, plan.length - 1)]; return { date: r.date, day: r.day, actual: r.tonnes, actualCum: cum, plannedCum: pl, variance: cum - pl }; });
    return out;
  }
  // Re-forecast from today's position. The plan's state at the moment its tipped tonnage equals the actual tonnage becomes a "leftover" scenario
  // (remaining soil per section, starting the day after the last actual), which is simulated with the ordinary dispatcher.
  function reforecast(scn, res) {
    const rows = actualsAnalysis(scn, res); if (!rows.length) return null;
    const L = res.log, P = res.P, n = P.n, last = rows[rows.length - 1], A = last.actualCum;
    const order = Array.from({ length: res.n }, (_, k) => k).filter(k => L.dst[k] < n).sort((a, b) => L.tip[a] - L.tip[b]);
    let cum = 0, tStar = -1, upto = 0;
    if (A > 1e-9) { for (; upto < order.length; upto++) { cum += L.t[order[upto]]; if (cum >= A - 1e-9) { tStar = L.tip[order[upto]]; upto++; break; } } if (tStar < 0) tStar = Infinity; }
    const plannedEnd = Engine.fmtDay(P.startDay + Math.floor(res.summary.endTime / Engine.DAY)), plannedEndDay = P.startDay + Math.floor(res.summary.endTime / Engine.DAY);
    const totalPlanned = order.reduce((a, k) => a + L.t[k], 0);
    if (tStar === Infinity || A >= totalPlanned - 1e-6) return { asOf: last.date, actual: A, planned: last.plannedCum, variance: A - last.plannedCum, finished: true, plannedEnd, forecastEnd: plannedEnd, lagDays: 0 };
    const out = new Float64Array(n), inn = new Float64Array(n);
    for (let q = 0; q < upto; q++) { const k = order[q]; if (L.src[k] < n) out[L.src[k]] += L.t[k]; inn[L.dst[k]] += L.t[k]; }
    const fc = JSON.parse(JSON.stringify(scn)); fc.plan = null; fc.saved = [];
    fc.settings.startDate = Engine.dayToISO(Engine.parseISO(last.date) + 1);
    const uf = P.unitF;
    fc.sections.forEach((s, i) => {
      const q = P.qty[i]; if (!q) return;
      const rem = q > 0 ? q - out[i] : -q - inn[i], tot = Math.abs(q), f = tot > 0 ? Math.max(0, rem) / tot : 0;
      s.lines.forEach(l => (l.qty = Math.round(+l.qty * f * 1e4) / 1e4));
    });
    const fr = Engine.simulate(fc), fcStart = Engine.parseISO(fc.settings.startDate), forecastEndDay = fcStart + Math.floor(fr.summary.endTime / Engine.DAY);
    return { asOf: last.date, actual: A, planned: last.plannedCum, variance: A - last.plannedCum, finished: false, plannedEnd, plannedEndDay, forecastEnd: Engine.fmtDay(forecastEndDay), forecastEndDay, lagDays: forecastEndDay - plannedEndDay, forecast: fr };
  }

  // ---------- placeholder rates ----------
  // Every cost, fuel-burn and weather value that ships with a guess in it. A value is a placeholder while it still equals its shipped
  // default and has not been confirmed (typing in it, or "confirm", records scn.confirmedRates[id]; kept at the top level so a plan never goes stale).
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const RATE_FIELDS = [
    ['E1', 'lorryRate', 'Lorry hire', '£ per hour', 'cost'], ['E1', 'excavatorRate', 'Excavator hire', '£ per hour', 'cost'], ['E1', 'receivingRate', 'Receiving plant hire', '£ per hour', 'cost'],
    ['E1', 'fuelPrice', 'Fuel price', '£ per litre', 'cost'], ['E1', 'labourRate', 'Labour', '£ per plant-hour', 'cost'],
    ['E2', 'lorryLPerHour', 'Lorry fuel burn', 'litres per hour', 'fuel'], ['E2', 'excavatorLPerHour', 'Excavator fuel burn', 'litres per hour', 'fuel'], ['E2', 'receivingLPerHour', 'Receiving plant fuel burn', 'litres per hour', 'fuel']
  ].map(([mod, key, label, unit, group]) => ({ id: mod + '.' + key, mod, key, idx: null, label, unit, group, cell: 'mod:' + mod + ':' + key }))
    .concat(MONTHS.map((m, k) => ({ id: 'D1.lostDays.' + k, mod: 'D1', key: 'lostDays', idx: k, label: 'Weather: days lost in ' + m, unit: 'days', group: 'weather', cell: 'mod:D1:lost' + k })),
      [{ id: 'D2.breakdownPct', mod: 'D2', key: 'breakdownPct', idx: null, label: 'Breakdowns: chance a loading point is down on a day', unit: '% a day', group: 'weather', cell: 'mod:D2:breakdownPct' }]);
  const RATE_GROUPS = { cost: 'cost rates', fuel: 'fuel burn', weather: 'weather and breakdowns' };
  // the fuel burn rates also drive cost when only E1 is on (decision 23), so they are listed when either module is on
  const rateApplies = (scn, f) => { const m = (scn.setup && scn.setup.modules) || {}; return f.mod === 'E2' ? !!(m.E1 || m.E2) : !!m[f.mod]; };
  const rateGet = (scn, f) => { const b = (scn.modules || {})[f.mod] || {}; return f.idx === null ? b[f.key] : (b[f.key] || [])[f.idx]; };
  const rateDefault = f => { const b = moduleDefaults({})[f.mod]; return f.idx === null ? b[f.key] : b[f.key][f.idx]; };
  function rateSet(scn, f, v) { const b = scn.modules[f.mod]; if (f.idx === null) b[f.key] = v; else b[f.key][f.idx] = v; }
  const rateIsDefault = (scn, f) => !(scn.confirmedRates && scn.confirmedRates[f.id]) && +rateGet(scn, f) === +rateDefault(f);
  const rateFieldsOn = scn => RATE_FIELDS.filter(f => rateApplies(scn, f));
  const defaultRates = scn => rateFieldsOn(scn).filter(f => rateIsDefault(scn, f));
  function confirmRate(scn, id) { (scn.confirmedRates = scn.confirmedRates || {})[id] = true; }
  function confirmRates(scn) { defaultRates(scn).forEach(f => confirmRate(scn, f.id)); }
  // "cost rates, fuel burn" ... for the groups still holding a default
  const defaultRateGroups = (scn, only) => { const g = []; defaultRates(scn).forEach(f => { if ((!only || only.indexOf(f.group) >= 0) && g.indexOf(RATE_GROUPS[f.group]) < 0) g.push(RATE_GROUPS[f.group]); }); return g; };
  const rateNoteText = (scn, only) => { const g = defaultRateGroups(scn, only); return g.length ? 'using default rates (' + g.join(', ') + ')' : ''; };

  // ---------- examples ----------
  function mk(name, lengthM, qty, extra) {
    const s = newSection(0); s.name = name; s.lengthM = lengthM; setQty(s, qty);
    return Object.assign(s, extra || {});
  }
  function exampleSimple() {
    const o = defaults();
    o.name = 'Simple example: 8 km road, 12 sections';
    const S = [
      mk('S1 Eastern approach', 700, -26000, { maxLoaders: 2 }),
      mk('S2 Hill cutting A', 800, 58000, { maxLoaders: 3 }),
      mk('S3 Culvert embankment', 500, -21000, { openFrom: '2027-02-08' }),
      mk('S4 Hill cutting B', 700, 44000, { maxLoaders: 3 }),
      mk('S5 Valley embankment', 900, -52000, { maxLoaders: 3 }),
      mk('S6 Rock cutting', 600, 32000, { maxLoaders: 2, workStart: '08:00', workEnd: '17:00' }),
      mk('S7 Bridge approach W', 500, -17000, { openFrom: '2027-03-08' }),
      mk('S8 River crossing', 400, 0),
      mk('S9 Bridge approach E', 500, -14000, { openFrom: '2027-03-08' }),
      mk('S10 Spur cutting', 800, 26000, { maxLoaders: 2 }),
      mk('S11 Junction embankment', 900, -24000, { maxLoaders: 2 }),
      mk('S12 Western tie-in', 700, 10000, { maxLoaders: 2 })
    ];
    S.forEach((s, i) => (s.id = 's' + (i + 1)));
    o.sections = S;
    return normalise(o);
  }
  // Second example: the same 8 km job with the fleet-and-plant modules switched on.
  function exampleModules() {
    const o = exampleSimple();
    o.name = 'Modules demo: fleet and plant on the 8 km road';
    o.setup.level = 'custom';
    ['B2', 'B3', 'B4', 'B5', 'B6', 'D5'].forEach(id => (o.setup.modules[id] = true));
    const m = o.modules;
    m.B2.types = [
      { id: 'ty1', name: 'Articulated dump truck', payload: 25, speedLoaded: 5, speedEmpty: 6, qty: 40, publicRoad: false },
      { id: 'ty2', name: 'Rigid tipper', payload: 15, speedLoaded: 6, speedEmpty: 7, qty: 30, publicRoad: true }
    ];
    m.B3.mode = 'bySection'; m.B3.bySection = { s2: { limitKph: '', gradLoaded: 0.7, gradEmpty: 1 }, s6: { limitKph: 3.5, gradLoaded: 1, gradEmpty: 1 } };
    m.B4.mode = 'bySection'; m.B4.bySection = { s5: { rate: 450, bays: 3 } };
    m.B5.mode = 'byMachine'; m.B5.machines = machinesFromLoaders(o);
    return normalise(o);
  }
  // Third example: the same 8 km road with soil types, an export gate, a quarry and a topsoil stockpile (A1-A5).
  function exampleMaterials() {
    const o = exampleSimple();
    o.name = 'Materials demo: soil types, export, import and stockpile on the 8 km road';
    o.setup.level = 'custom';
    ['A1', 'A2', 'A3', 'A4', 'A5'].forEach(id => (o.setup.modules[id] = true));
    o.materials = [
      { id: 'general', name: 'General fill', colour: '#a0855b', density: 1.8, bulking: 1.25, compaction: 0.9 },
      { id: 'topsoil', name: 'Topsoil', colour: '#5b8a3c', density: 1.6, bulking: 1.3, compaction: 0.85 },
      { id: 'clay', name: 'Clay', colour: '#b5654a', density: 2.0, bulking: 1.3, compaction: 0.9 },
      { id: 'rock', name: 'Rock', colour: '#6b7280', density: 2.4, bulking: 1.5, compaction: 0.85 }
    ];
    const L = (s, ...lines) => { o.sections.find(x => x.id === s).lines = lines.map(([material, qty]) => ({ material, qty })); };
    L('s1', ['general', -26000]); L('s2', ['topsoil', 8000], ['clay', 30000], ['rock', 20000]); L('s3', ['clay', -21000]);
    L('s4', ['topsoil', 4000], ['general', 40000]); L('s5', ['general', -52000]); L('s6', ['rock', 32000]); L('s7', ['rock', -17000]);
    L('s9', ['general', -14000]); L('s10', ['clay', 26000]); L('s11', ['clay', -24000]); L('s12', ['topsoil', 10000]);
    const m = o.modules;
    m.A2.accept = { general: { general: true, topsoil: true, clay: true, rock: true }, topsoil: { topsoil: true }, clay: { clay: true }, rock: { rock: true } };
    m.A4.points = [
      { id: 'exp1', name: 'Spoil tip', kind: 'export', chainageM: 7600, accepts: [], dailyT: 1500, costPerT: 6, roundTripMin: 50, lanes: 4 },
      { id: 'imp1', name: 'Quarry', kind: 'import', material: 'rock', chainageM: 6200, dailyT: 800, costPerT: 11.5, roundTripMin: 45, lanes: 2 }
    ];
    m.A5.stockpiles = [{ id: 'stk1', name: 'Topsoil bank', chainageM: 2500, capacityT: 20000, handleCostPerT: 1.8, lanes: 2 }];
    return normalise(o);
  }
  // Fourth example: the 8 km road with the site-constraint and calendar modules (C1-C5, D3, D4) switched on.
  function exampleSite() {
    const o = exampleSimple();
    o.name = 'Site demo: blockage, closures, layers, lane works and a calendar on the 8 km road';
    o.setup.level = 'custom';
    ['C1', 'C2', 'C3', 'C4', 'C5', 'D3', 'D4'].forEach(id => (o.setup.modules[id] = true));
    const m = o.modules;
    m.D4.weekendSat = true;   // Saturday working, and the automatic UK bank holiday list
    m.C1.blocks = [{ id: 'bridge', name: 'River bridge', chainageM: 4900, openDate: '2027-02-22' }];
    m.C2.stretches = [{ id: 'lane1', name: 'Utility diversion', fromM: 2000, toM: 2400, mode: 'rate', perHour: 40, phaseMin: 15 }];
    m.C3.periods = [{ id: 'bats', sec: 's6', from: '2027-02-01', to: '2027-02-14', note: 'Bat survey' }];
    m.C4 = { layers: 1, waitDays: 0, mode: 'bySection', bySection: { s5: { layers: 4, waitDays: 3 }, s11: { layers: 3, waitDays: 2 } } };
    m.C5 = { publicLimit: 60, internalLimit: '', publicAll: false, publicStretches: [{ id: 'jn', name: 'Junction road', fromM: 5600, toM: 6400 }] };
    m.D3.targets = { s5: '2027-02-28', s7: '2027-03-12', s12: '2027-03-05' };
    return normalise(o);
  }
  // Fifth example: weather and probabilistic dates on the 8 km road, with the UK bank holidays.
  function exampleRisk() {
    const o = exampleSimple();
    o.name = 'Risk demo: weather, bank holidays and probabilistic dates on the 8 km road';
    o.setup.level = 'custom';
    ['D1', 'D2', 'D4'].forEach(id => (o.setup.modules[id] = true));
    o.modules.D1.winterOn = true; o.modules.D1.winterFrom = '12-20'; o.modules.D1.winterTo = '01-05';
    o.modules.D2.runs = 200; o.modules.D2.breakdownPct = 2;
    return normalise(o);
  }
  // Sixth example: cost, carbon, the mass haul diagram, the programme export, actual progress and reporting on the 8 km road.
  function exampleCommercial() {
    const o = exampleSimple();
    o.name = 'Commercial demo: cost, carbon, mass haul, actuals and reporting on the 8 km road';
    o.setup.level = 'custom';
    ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'].forEach(id => (o.setup.modules[id] = true));
    o.modules.E6.actuals = [['2027-01-11', 3200], ['2027-01-12', 3800], ['2027-01-13', 3600], ['2027-01-14', 3900], ['2027-01-15', 3500]].map(([date, tonnes], k) => ({ id: 'act' + k, date, tonnes }));
    return normalise(o);
  }
  // Seventh example: a cut that closes before its only fill opens, with a stockpile between them (A5, C3). Small enough to check by hand.
  function exampleStockpile() {
    const o = defaults();
    o.name = 'Stockpile demo: the cut closes on 13 Jan, the fill opens on 18 Jan';
    o.setup.level = 'custom';
    ['A5', 'C3'].forEach(id => (o.setup.modules[id] = true));
    o.sections = [mk('Cut', 500, 400, { id: 'cut', maxLoaders: 2 }), mk('Gap', 1000, 0, { id: 'gap' }), mk('Fill', 500, -400, { id: 'fill', maxLoaders: 2, openFrom: '2027-01-18' })];
    const n = normalise(o);
    n.modules.C3.periods = [{ id: 'closes', sec: 'cut', from: '2027-01-13', to: '', note: 'Cut closes for good' }];
    n.modules.A5.stockpiles = [{ id: 'pile', name: 'Pile', chainageM: 1000, capacityT: 1000, handleCostPerT: 2, lanes: 2 }];
    return n;
  }
  const EXAMPLES = { simple: exampleSimple, modules: exampleModules, materials: exampleMaterials, site: exampleSite, risk: exampleRisk, commercial: exampleCommercial, stockpile: exampleStockpile };

  return { csvCell, programmeCSV, sectionsCSV, parseSections, applyImport, actualsAnalysis, plannedCumulative, reforecast, VERSION, MOD_IDS, defaultMaterial, moduleDefaults, machinesFromLoaders, moduleIssues, setUnits, defaults, newSection, newId, normalise, validate, secQty, setQty, EXAMPLES, RATE_FIELDS, RATE_GROUPS, rateGet, rateSet, rateDefault, rateIsDefault, rateFieldsOn, defaultRates, defaultRateGroups, rateNoteText, confirmRate, confirmRates, exampleSimple, exampleModules, exampleMaterials, exampleSite, exampleRisk, exampleCommercial, exampleStockpile };
});
