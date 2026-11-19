/* Module registry. Every module is listed from day one; `built` flips to true in the phase that delivers it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Modules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GROUPS = {
    A: 'A. Materials and quantities',
    B: 'B. Fleet and plant',
    C: 'C. Site constraints',
    D: 'D. Programme and risk',
    E: 'E. Commercial and reporting'
  };
  // [id, name, phase, what it adds, what you will need to supply]
  const RAW = [
    ['A1', 'Bulking and compaction', 4, 'Volume dug, carried and placed differ correctly.', 'Bulking and compaction factors per material.'],
    ['A2', 'Material classes', 4, 'Several soil types, with rules for which class may go where.', 'A class for each section quantity, plus a placement rule table.'],
    ['A3', 'Volume and tonnage', 4, 'Per-material densities. (The simple tonnes or m³ switch with one site-wide density is already in the global settings.)', 'A density per material.'],
    ['A4', 'Off-site import and export', 4, 'Named access points that supply or take soil, at a cost.', 'Chainage, daily limit, cost per tonne and round-trip time for each.'],
    ['A5', 'Stockpiles', 4, 'Temporary storage when the destination is not open yet.', 'Chainage, capacity and double-handling cost for each stockpile.'],
    ['B1', 'Fleet size and empty return', 3, 'A fixed number of lorries that must drive back empty before loading again.', 'The number of lorries.'],
    ['B2', 'Vehicle types', 3, 'Several lorry types with their own payload, speed and numbers.', 'Payload, speeds, quantity and public-road permission per type.'],
    ['B3', 'Loaded and empty speeds', 3, 'Separate speeds loaded and empty, plus per-section speed limits.', 'Loaded and empty speeds; optional limits per section.'],
    ['B4', 'Receiving rates', 3, 'A limit on how fast each fill section can tip, spread and compact.', 'Tonnes per hour and number of tipping bays (one site-wide value to start).'],
    ['B5', 'Excavators', 3, 'Loading machines with output rates, assigned to sections over time.', 'Machines, output rates, assignments and relocation lost time.'],
    ['B6', 'Availability', 3, 'Percentage uptime per plant type, applied as lost time.', 'An uptime percentage per plant type.'],
    ['C1', 'Haul route blockages', 5, 'Points on the road nothing can pass until an opening date.', 'Chainage and opening date for each blockage.'],
    ['C2', 'Single-lane stretches', 5, 'Road lengths that limit lorries per hour or allow one direction at a time.', 'Start and end chainage, and the limit.'],
    ['C3', 'Closing dates and closed periods', 5, 'Sections that close, or are shut for ecology windows or diversions.', 'Closed date ranges per section.'],
    ['C4', 'Layered fill', 5, 'Fill placed in layers, with a waiting period between them.', 'Layer thickness and waiting days.'],
    ['C5', 'Public and internal movements', 5, 'Separate daily limits, with the planning cap on public-road movements only.', 'Which movements use public roads, and the two daily limits.'],
    ['D1', 'Weather', 6, 'Lost days per month, an optional winter shutdown and random rain days.', 'Expected lost days per month.'],
    ['D2', 'Probabilistic dates', 6, 'Many runs with random weather and breakdowns; 50% and 80% dates.', 'Number of runs, plus the weather and breakdown settings.'],
    ['D3', 'Target dates', 5, 'A contract date per section, with late sections flagged.', 'A target date for each section.'],
    ['D4', 'Calendar', 5, 'Shifts, bank holidays (UK defaults) and weekend working.', 'Holiday list and any extra working days.'],
    ['D5', 'Scenario comparison', 2, 'Save named scenarios and compare two side by side.', 'Nothing extra.'],
    ['E1', 'Cost', 7, 'Hire, fuel, labour, tip fees and purchase costs; total and per tonne.', 'Rates for each plant type and cost item.'],
    ['E2', 'Carbon', 7, 'Fuel burn and tCO₂e per scenario.', 'Fuel burn per plant type.'],
    ['E3', 'Mass haul diagram', 7, 'Cumulative cut and fill along the chainage, updating as the sim runs.', 'Nothing extra.'],
    ['E4', 'Programme export', 7, 'Section start and finish dates as CSV for P6 or MS Project.', 'Nothing extra.'],
    ['E5', 'Import', 7, 'Load the section table from CSV or pasted spreadsheet cells.', 'A CSV in the template layout.'],
    ['E6', 'Planned versus actual', 7, 'Enter real tonnages moved per day and re-forecast the finish.', 'Daily actual tonnages.'],
    ['E7', 'Reporting', 7, 'A printable one-page summary and a client-meeting replay mode.', 'Nothing extra.'],
    ['E8', 'Time-chainage chart', 3, 'A chart of the whole programme: chainage across, time down the page, with hauls as sloping bands.', 'Nothing extra.']
  ];
  const list = RAW.map(r => ({ id: r[0], group: r[0][0], name: r[1], phase: r[2], desc: r[3], needs: r[4], built: false }));
  const byId = {}; list.forEach(m => (byId[m.id] = m));
  // Which modules each level switches on (only built ones can actually be ticked).
  const LEVELS = {
    simple: { label: 'Simple', blurb: 'Core model only: the section table and five global settings.', ids: [] },
    standard: { label: 'Standard', blurb: 'Core plus the modules most jobs need.', ids: ['B1', 'B4', 'A1', 'A3', 'D3', 'D4', 'E3', 'E8'] },
    detailed: { label: 'Detailed', blurb: 'Every module switched on.', ids: list.map(m => m.id) },
    custom: { label: 'Custom', blurb: 'Choose modules one by one from the list.', ids: null }
  };
  function setBuilt(ids) { list.forEach(m => (m.built = ids.indexOf(m.id) >= 0)); }
  function activeIds(scn) { return list.filter(m => m.built && scn.setup.modules[m.id]).map(m => m.id); }
  function badgeText(scn) {
    const lv = LEVELS[scn.setup.level] ? LEVELS[scn.setup.level].label : 'Custom';
    const act = activeIds(scn);
    return lv + ' level. Modules on: ' + (act.length ? act.join(', ') : 'none (core model only)');
  }
  return { GROUPS, list, byId, LEVELS, setBuilt, activeIds, badgeText };
});
