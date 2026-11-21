/* Earthmove tutorials, as data. Reword a step, or add one, by editing this file only: tutorial.js runs whatever is listed here.
 *
 * A tutorial:  { id, title, group: 'start' | 'module', module?, minutes?, blurb, scenario: { example, modules? }, steps: [...] }
 *   scenario.example   which built-in example the tutorial runs on (simple, modules, materials, site, risk, commercial, stockpile).
 *                      It is always a copy: the tutorial never touches your own scenario.
 *   scenario.modules   modules to switch on for it (the level becomes Custom when any are listed).
 *
 * A step:      { target, title, text, tryIt?, done?, auto?, autoOnNext?, show?, ensure? }
 *   target   what to spotlight. A CSS selector, or one of these forms:
 *              tab:<key>      a tab button (sections, fleet, materials, site, risk, commercial, rates, actuals, masshaul, results, log, scenarios, messages)
 *              card:<id>      a module's card on its tab, e.g. card:B1
 *              stat:<label>   a figure on the Results tab, matched by the start of its label
 *              mod:<id>       a module's row on the Setup screen
 *              level:<key>    a level card on the Setup screen (simple, standard, detailed, custom)
 *            Leave it out (null) for a centred card with nothing spotlighted.
 *   text     one or two plain sentences. No em dashes.
 *   tryIt    the "Try it" line. With done, the tutorial moves on by itself when that has happened (Next still works).
 *   done     a check, written name or name:argument. See CHECKS below.
 *   auto     actions that do the try-it for you. Used when Next is pressed on a step with autoOnNext, and by the browser tests.
 *            Actions: { set: selector, value }, { pick: selector, text }, { click: selector }, { check: selector, on: true|false }
 *   show     what to open before showing the step: { tab }, { screen: 'main'|'setup' }, { opt: true|false }, { tc: true } (open the time-chainage chart),
 *            { details: selector } (open a <details> panel).
 *   ensure   modules to switch on before showing the step (for steps that need them when resuming): ['B3']
 *
 * If a step's target is not on screen, the step is skipped and a warning is logged to the console.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tutorials = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The checks a "done" may name. tutorial.js implements each one; tests/tutorials.js makes sure every done here is in this list.
  const CHECKS = {
    playing: 'the simulation is playing',
    viewChanged: 'the road view was zoomed or moved',
    speedChanged: 'the speed slider moved',
    optOpen: 'the optimiser panel is open',
    optimiserDone: 'an optimiser run has finished',
    planApplied: 'an optimised plan is in use',
    riskDone: 'a risk analysis has finished',
    completionChanged: 'the overall completion date changed',
    savedCount: 'a scenario was saved',
    cmpChanged: 'a comparison selector changed',
    tabIs: 'tabIs:<key> the tab is open',
    screenIs: 'screenIs:<main|setup>',
    levelIs: 'levelIs:<level>',
    moduleOn: 'moduleOn:<id>',
    valueChanged: 'valueChanged:<path in the scenario> that value changed, e.g. settings.speedKph',
    fieldChanged: 'fieldChanged:<selector> that field has a different value',
    exists: 'exists:<selector> something matching is on the page'
  };

  const T = []; // the list, in the order shown in the Tutorials menu

  /* ---------------------------------------------------------------- the four guided tutorials ---- */

  T.push({
    id: 'quick', title: 'Quick start', group: 'start', minutes: 5,
    blurb: 'The road view, editing a section, the global settings, playing, and reading the results.',
    scenario: { example: 'simple' },
    steps: [
      { target: null, title: 'Welcome to Earthmove',
        text: 'Earthmove plays out a job where surplus soil is dug from cuttings and carried by lorry to embankments, day by day. This tour uses its own example, so your own work is safe and comes back when you finish.' },
      { target: '#stagewrap', title: 'The road view', show: { tab: 'sections' },
        text: 'This is the road, west to east. Sand colour is soil to dig out (a cut). Pale hollows are fills waiting for soil, and red hatching is a fill that cannot be tipped into yet. The dots are loads on the move.' },
      { target: '#zoomctl', title: 'Zoom and move',
        text: 'Use these buttons to zoom. The thin strip below the road is an overview: click or drag it to move along the road.',
        tryIt: 'Press the + button to zoom in.', done: 'viewChanged', auto: [{ click: '#zIn' }] },
      { target: '#sectable', title: 'The section table', show: { tab: 'sections' },
        text: 'One row for each section of road, in order from west to east. A positive quantity is spare soil to dig out (a cut). A negative quantity is soil needed (a fill).' },
      { target: '[data-cell="s3:qty"]', title: 'Edit a section', show: { tab: 'sections' },
        text: 'Everything you type is simulated again straight away. A message appears above the road if cut and fill stop balancing.',
        tryIt: 'Change this quantity, for example to -15000.', done: 'valueChanged:sections', auto: [{ set: '[data-cell="s3:qty"]', value: '-15000' }] },
      { target: '#tabbody .settings', title: 'The global settings', show: { tab: 'sections' },
        text: 'Five settings apply to the whole site: the start date, the average lorry speed, the load a lorry carries, the loading time, and the most movements allowed in a day across the site.' },
      { target: '[data-cell="settings:speedKph"]', title: 'Change a setting', show: { tab: 'sections' },
        text: 'Faster lorries finish sooner. Try it and the finish date moves.',
        tryIt: 'Change the average travel speed to 10.', done: 'valueChanged:settings.speedKph', auto: [{ set: '[data-cell="settings:speedKph"]', value: '10' }] },
      { target: '#bPlay', title: 'Play the job',
        text: 'Press play to watch the job run. You can also tap the space bar to play and pause.',
        tryIt: 'Press play.', done: 'playing', auto: [{ click: '#bPlay' }] },
      { target: '#speedwrap', title: 'Change the speed',
        text: 'The slider sets how many simulated days pass each second.',
        tryIt: 'Drag the speed slider.', done: 'speedChanged', auto: [{ set: '#speed', value: '70' }] },
      { target: '#counter', title: 'Daily movements',
        text: 'This shows the movements so far today against the daily limit. The bar fills as the day gets closer to the limit. Beside it are the lorries working now and the totals so far.' },
      { target: '#chart', title: 'The daily chart',
        text: 'Each bar is a day, showing how many movements it had. The line shows how many lorries that day needed. Click a bar to jump to that day.' },
      { target: 'tab:results', title: 'Open the results',
        text: 'The tabs hold everything else. Results has the headline dates and figures.',
        tryIt: 'Open the Results tab.', done: 'tabIs:results', auto: [{ click: '#tabs [data-tab="results"]' }] },
      { target: '#resdates', title: 'Dates for every section', show: { tab: 'results' },
        text: 'For each section: the date it reaches finished level, and where its soil went or came from. Overall completion at the top is the date the last section is done. You can find every other tutorial in the Tutorials menu.' }
    ]
  });

  T.push({
    id: 'whatif', title: 'Asking a what-if question', group: 'start', minutes: 4,
    blurb: 'Change one thing, see the completion date move, save a scenario and compare the two.',
    scenario: { example: 'simple', modules: ['D5'] },
    steps: [
      { target: null, title: 'A what-if question',
        text: 'A what-if changes one thing and shows what happens to the finish. First we save today\'s plan, so there is something to compare against.' },
      { target: 'tab:scenarios', title: 'Scenarios',
        text: 'Saved scenarios live on this tab.',
        tryIt: 'Open the Scenarios tab.', done: 'tabIs:scenarios', auto: [{ click: '#tabs [data-tab="scenarios"]' }] },
      { target: '#tabbody p:has(#savename)', title: 'Save today\'s plan', show: { tab: 'scenarios' },
        text: 'Give the plan a name and save it. It is a snapshot, so you can change anything afterwards.',
        tryIt: 'Name it "Limit 200" and press Save.', done: 'savedCount',
        auto: [{ set: '#savename', value: 'Limit 200' }, { click: '#savebtn' }] },
      { target: '[data-cell="settings:maxMovesPerDay"]', title: 'Change one thing', show: { tab: 'sections' },
        text: 'This is the most movements the whole site may make in a day, for example a planning condition. What if it were halved?',
        tryIt: 'Change it to 100.', done: 'valueChanged:settings.maxMovesPerDay', auto: [{ set: '[data-cell="settings:maxMovesPerDay"]', value: '100' }] },
      { target: 'stat:Overall completion', title: 'The date moves', show: { tab: 'results' },
        text: 'The completion date is later. One change, one clear effect: this is how to test a condition before you agree to it.' },
      { target: '#cmpA', title: 'Compare the two', show: { tab: 'scenarios' },
        text: 'A and B choose what to compare. B stays as the live plan. Set A to the plan you saved.',
        tryIt: 'Choose "Limit 200" as A.', done: 'cmpChanged', auto: [{ pick: '#cmpA', text: 'Limit 200' }] },
      { target: '#cmptable', title: 'Reading the comparison', show: { tab: 'scenarios' },
        text: 'The last column is B minus A. Green is better and red is worse. The amber note says neither plan is optimised, so part of a difference can come from how loads are dispatched. The Optimising tutorial covers that.' }
    ]
  });

  T.push({
    id: 'optimise', title: 'Optimising', group: 'start', minutes: 4,
    blurb: 'Run the optimiser, read the before and after figures, and what simple dispatch means.',
    scenario: { example: 'simple' },
    steps: [
      { target: '#modbadge', title: 'Simple dispatch', show: { tab: 'sections' },
        text: 'This line says "Simple dispatch, not optimised". Each load goes to the nearest fill that is open and has room. That is quick and close to what many sites do, but it is not always the best plan.' },
      { target: '#bOpt', title: 'Open the optimiser',
        text: 'The optimiser looks for a better plan and checks every candidate with the full simulation.',
        tryIt: 'Press Optimise.', done: 'optOpen', auto: [{ click: '#bOpt' }] },
      { target: '#optpanel .optrow:has(#optgoal)', title: 'Goal and search time', show: { opt: true },
        text: 'Choose what "better" means (for example the least haulage) and how long to search. A longer search tries more plans.',
        tryIt: 'Set the search time to Quick.', done: 'fieldChanged:#opteffort',
        auto: [{ pick: '#optgoal', text: 'Lowest total tonne-km' }, { pick: '#opteffort', text: 'Quick' }] },
      { target: '#optgo', title: 'Run it', show: { opt: true },
        text: 'The search runs in the background, so you can keep using the page. Quick takes about 8 seconds.',
        tryIt: 'Press Start.', done: 'optimiserDone', auto: [{ click: '#optgo' }], autoOnNext: true },
      { target: '#optcmp', title: 'Before and after', show: { opt: true },
        text: 'Read the whole table, not just the goal. A plan that is best for one goal can cost more lorries or more haul distance on another.' },
      { target: '#optuse', title: 'Use the plan', show: { opt: true },
        text: 'Nothing changes until you choose. The optimiser never alters your inputs, only which cut feeds which fill and in what order.',
        tryIt: 'Press Use this plan.', done: 'planApplied', auto: [{ click: '#optuse' }] },
      { target: '#modbadge', title: 'Now it is optimised',
        text: 'The line now names the optimised plan and its goal. To go back to simple dispatch, use "Switch to nearest-available dispatch" in the optimiser panel. If you later change an input, the plan goes out of date and the page asks you to optimise again.' }
    ]
  });

  T.push({
    id: 'further', title: 'Going further', group: 'start', minutes: 4,
    blurb: 'The setup screen, the levels, switching a module on and off, and "vary by section".',
    scenario: { example: 'simple' },
    steps: [
      { target: '#btnSetup', title: 'The setup screen', show: { screen: 'main' },
        text: 'The model starts simple. Setup is where you choose how much detail you want.',
        tryIt: 'Press Setup.', done: 'screenIs:setup', auto: [{ click: '#btnSetup' }] },
      { target: '#screenSetup .cards', title: 'Levels', show: { screen: 'setup' },
        text: 'Simple is the core model only. Standard adds the modules most jobs need. Detailed switches everything on. Custom is whatever you tick.' },
      { target: 'level:standard', title: 'Pick a level', show: { screen: 'setup' },
        text: 'A level is a starting point. You can still tick or untick single modules afterwards.',
        tryIt: 'Choose Standard.', done: 'levelIs:standard', auto: [{ click: '#screenSetup [data-level="standard"]' }] },
      { target: '#screenSetup .delta', title: 'What it did', show: { screen: 'setup' },
        text: 'Setup tells you what the change did to the completion date, so you can see how much each level of detail matters.' },
      { target: 'mod:B3', title: 'Switch a module on', show: { screen: 'setup' },
        text: 'Each module adds one kind of detail. Switching one off only hides its inputs. It never deletes them, so they come back when you switch it on again.',
        tryIt: 'Tick B3, Loaded and empty speeds.', done: 'moduleOn:B3', auto: [{ check: '#screenSetup [data-mod="B3"] input', on: true }] },
      { target: '#setupneeds', title: 'Needs filling in', show: { screen: 'setup' },
        text: 'If an active module is waiting for something from you, it is listed here with a link that takes you straight to the field.' },
      { target: 'tab:fleet', title: 'Where the inputs went', show: { screen: 'main' }, ensure: ['B3'],
        text: 'Each module puts its inputs on a tab or in a column. B3 is on the Fleet & plant tab.',
        tryIt: 'Open the Fleet & plant tab.', done: 'tabIs:fleet', auto: [{ click: '#tabs [data-tab="fleet"]' }] },
      { target: '[data-card="B3"] label.check', title: 'Vary by section', show: { tab: 'fleet' }, ensure: ['B3'],
        text: 'Most modules have one value for the whole site. "Vary by section" lets you give each section its own value instead.',
        tryIt: 'Tick Vary by section.', done: 'valueChanged:modules.B3.mode', auto: [{ check: '[data-card="B3"] label.check input', on: true }] },
      { target: '#sectable', title: 'New columns', show: { tab: 'sections' }, ensure: ['B3'],
        text: 'With Vary by section ticked, the section table gains columns for a speed limit and gradient factors, one set for each section.' },
      { target: null, title: 'That is the tour',
        text: 'Every module has its own short tutorial. Open the Tutorials menu to see them all. Each is also offered the first time you switch that module on.' }
    ]
  });

  /* ------------------------------------------------------------------ one tutorial per module ---- */
  // Shorthand for the module tutorials, so each reads as a few lines. They are ordinary steps once built.
  const open = (tab) => ({ tab });
  const intro = (card, title, text, tab) => ({ target: 'card:' + card, title, text, show: open(tab) });
  const edit = (target, title, text, tryIt, done, value, tab, kind) => {
    const a = kind === 'pick' ? { pick: target, text: value } : kind === 'check' ? { check: target, on: true } : { set: target, value };
    return { target, title, text, tryIt, done, auto: [a], show: open(tab) };
  };
  const seeResult = (label, text, title) => ({ target: 'stat:' + label, title: title || 'See the effect', text, show: open('results') });
  const mod = (id, title, minutes, blurb, example, steps) =>
    T.push({ id: 'mod-' + id, module: id, title: id + ' ' + title, group: 'module', minutes, blurb, scenario: { example, modules: [id] }, steps });

  // ---- A. Materials and quantities (Materials demo) ----
  mod('A1', 'Bulking and compaction', 2, 'Volume dug, carried and placed differ correctly.', 'materials', [
    intro('A1', 'Bulking and compaction', 'Soil takes up more room when it is dug (bulking) and less when it is compacted in a fill. This module lets the volume in the ground, in the lorry and in the fill differ properly.', 'materials'),
    edit('[data-cell="mod:A1:bodyM3"]', 'The lorry body', 'A lorry is limited by the size of its body as well as its payload. A smaller body holds less loose soil, so it needs more trips.', 'Change the lorry body volume to 10.', 'valueChanged:modules.A1.bodyM3', '10', 'materials'),
    edit('[data-cell="mod:A1:rock:bulking"]', 'Bulking per soil type', 'Bulking is loose volume divided by bank volume. Rock bulks more than clay, so it fills a lorry body with less weight.', 'Change the bulking of Rock to 1.6.', 'valueChanged:materials', '1.6', 'materials'),
    seeResult('Overall completion', 'Compare the completion date with where it was. Every volume in the model now follows these factors.')
  ]);
  mod('A2', 'Material classes', 2, 'Several soil types, with rules for which class may go where.', 'materials', [
    intro('A2', 'Which soil may go where', 'Soil comes in types, such as topsoil, clay and rock. This table says which types a fill may take. A fill always accepts its own type.', 'materials'),
    { target: '#matpane .scroll', title: 'Your soil types', text: 'The soil types are listed here. You name them and give each a colour, which is also used on the time-chainage chart.', show: open('materials') },
    edit('[data-card="A2"] tbody tr:nth-child(2) td:nth-child(4) input', 'Allow a swap', 'Each row is a fill asking for a type. A tick lets a different type be used for it too. Soil that fits nowhere is reported on the Messages tab.', 'Let clay be placed in topsoil fill by ticking this box.', 'valueChanged:modules.A2.accept', null, 'materials', 'check'),
    { target: '[data-cell="s2:qty"]', title: 'Soil lines', text: 'In the section table, each section has one line per soil type, dug from the top down. Cut lines are positive and fill lines are negative.', show: open('sections') }
  ]);
  mod('A3', 'Volume and tonnage', 2, 'A density for each soil type.', 'materials', [
    intro('A3', 'Volume and tonnage', 'With this on, each soil type has its own density, so cubic metres convert to tonnes correctly. Without it the whole site uses one density.', 'materials'),
    edit('[data-cell="mod:A3:rock:density"]', 'A density for each type', 'Rock is heavier than topsoil, so a lorry carries fewer cubic metres of it for the same payload.', 'Change the density of Rock to 2.6.', 'valueChanged:materials', '2.6', 'materials'),
    seeResult('Soil moved', 'With A1 or A3 on, results are always shown in tonnes, because each soil type has its own density.')
  ]);
  mod('A4', 'Off-site import and export', 3, 'Named gates that supply or take soil, at a cost.', 'materials', [
    intro('A4', 'Off-site import and export', 'An export gate takes surplus soil nothing on site needs. An import gate supplies any shortfall. Each has a daily limit and a cost per tonne.', 'materials'),
    edit('[data-cell="mod:A4:exp1:dailyT"]', 'A daily limit', 'The spoil tip can only take so many tonnes a day. When it is full, surplus waits.', 'Change the Spoil tip daily limit to 500.', 'valueChanged:modules.A4.points', '500', 'materials'),
    { target: '[data-card="A4"] p:has([data-cell="mod:A4:add"])', title: 'Add a gate', text: 'These buttons add another export or import gate. Give each a chainage along the road, a cost and the time a lorry spends off site.', show: open('materials') },
    seeResult('Imported', 'The results list how much was imported and exported, and what it cost.')
  ]);
  mod('A5', 'Stockpiles', 2, 'Temporary storage when the destination is not open yet.', 'materials', [
    intro('A5', 'Stockpiles', 'When a fill is not open yet, soil can be tipped at a stockpile and hauled out again later. That costs a handling charge each time.', 'materials'),
    edit('[data-cell="mod:A5:stk1:capacityT"]', 'Capacity', 'A stockpile only takes soil while it has room. Soil that cannot be stored waits where it is.', 'Change the capacity to 5000.', 'valueChanged:modules.A5.stockpiles', '5000', 'materials'),
    seeResult('Stockpiles', 'The results show how much went into and out of the stockpile and what the handling cost.')
  ]);

  // ---- B. Fleet and plant ----
  mod('B1', 'Fleet size and empty return', 2, 'A fixed number of lorries that must drive back empty before loading again.', 'simple', [
    intro('B1', 'Fleet size and empty return', 'Without this the number of lorries is unlimited. With it you set a fleet, each lorry must drive back empty before loading again, and loads wait when every lorry is out.', 'fleet'),
    edit('[data-cell="mod:B1:fleet"]', 'The fleet', 'A small fleet makes the haul cycle the limit on the job.', 'Change the number of lorries to 15.', 'valueChanged:modules.B1.fleet', '15', 'fleet'),
    seeResult('Loading held up', 'This is the time loading waited for a lorry. A big number means the fleet is too small.')
  ]);
  mod('B2', 'Vehicle types', 3, 'Several lorry types with their own payload, speed and numbers.', 'modules', [
    intro('B2', 'Vehicle types', 'Different lorries carry different loads at different speeds. List each type here. The fleet is the total number of vehicles.', 'fleet'),
    edit('[data-cell="mod:B2:ty1:qty"]', 'How many of each', 'The dump trucks do most of the hauling here.', 'Change the number of articulated dump trucks to 10.', 'valueChanged:modules.B2.types', '10', 'fleet'),
    { target: '[data-card="B2"] p:has([data-cell="mod:B2:add"])', title: 'Add a type', text: 'Add a vehicle type with its own payload and speeds. Tick or untick whether it may use public roads, which matters for the public-road limits in C5.', show: open('fleet') },
    seeResult('Lorries in the fleet', 'The results report the fleet and how busy it was.')
  ]);
  mod('B3', 'Loaded and empty speeds', 2, 'Separate speeds loaded and empty, plus per-section speed limits.', 'modules', [
    intro('B3', 'Loaded and empty speeds', 'Lorries usually travel slower when loaded. This gives separate speeds, and optional speed limits and gradient factors for single sections.', 'fleet'),
    edit('[data-cell="mod:B3:loadedKph"]', 'Loaded speed', 'The empty speed only matters when the fleet is limited, because that is when the return trip delays the next load.', 'Change the loaded speed to 8.', 'valueChanged:modules.B3.loadedKph', '8', 'fleet'),
    { target: '[data-card="B3"] label.check', title: 'Vary by section', text: 'This is ticked in the example. It adds a speed limit and gradient factors to the section table, for a steep or slow stretch.', show: open('fleet') },
    edit('[data-cell="s6:b3limit"]', 'A section speed limit', 'A limit applies to trips through that section. A gradient factor of 0.5 means half speed.', 'Set a speed limit of 2 for the Rock cutting.', 'valueChanged:modules.B3.bySection', '2', 'sections')
  ]);
  mod('B4', 'Receiving rates', 3, 'A limit on how fast each fill section can tip, spread and compact.', 'modules', [
    intro('B4', 'Receiving rates', 'A fill can only tip, spread and compact so fast. Lorries that arrive when every bay is busy queue, and loading is held back rather than build a long queue.', 'fleet'),
    edit('[data-cell="mod:B4:rate"]', 'The site rate', 'This is tonnes per hour for each fill, shared between its tipping bays.', 'Change the receiving rate to 200.', 'valueChanged:modules.B4.rate', '200', 'fleet'),
    edit('[data-cell="s5:b4rate"]', 'A rate for one fill', 'With Vary by section ticked, each fill can have its own rate and bays. This valley embankment is a big one.', 'Change its rate to 100.', 'valueChanged:modules.B4.bySection', '100', 'sections'),
    seeResult('Lorry time queuing', 'Time spent queuing to tip is reported here.')
  ]);
  mod('B5', 'Excavators', 3, 'Loading machines with output rates, assigned to sections over time.', 'modules', [
    intro('B5', 'Excavators', 'Instead of a fixed loading time, each excavator loads at an output rate. Machines can be assigned to sections for set dates, and lose time when they move.', 'fleet'),
    edit('[data-cell="mod:B5:relocMin"]', 'Moving machines', 'When a machine moves to another section it loses this much time.', 'Change the relocation time to 120.', 'valueChanged:modules.B5.relocMin', '120', 'fleet'),
    { target: '[data-card="B5"] .machine', title: 'A machine and its jobs', text: 'Each machine has an output rate and a list of the sections it works at, with optional dates. A section loads as fast as the machines assigned to it that day.', show: open('fleet') }
  ]);
  mod('B6', 'Availability', 2, 'Percentage uptime per plant type, applied as lost time.', 'modules', [
    intro('B6', 'Availability', 'Plant is never available all the time. Uptime is applied as lost time: at 90% every trip, load and tip takes a ninth longer.', 'fleet'),
    edit('[data-cell="mod:B6:lorries"]', 'Lorry uptime', 'Lower uptime stretches every lorry trip.', 'Change the lorry uptime to 70.', 'valueChanged:modules.B6.lorries', '70', 'fleet'),
    seeResult('Overall completion', 'Compare the completion date with before. Random breakdowns are part of the risk module (D2).')
  ]);

  // ---- C. Site constraints (Site demo) ----
  mod('C1', 'Haul route blockages', 2, 'Points on the road nothing can pass until an opening date.', 'site', [
    intro('C1', 'Haul route blockages', 'A bridge, a river or a live road crossing may block the haul road until a set date. Soil can still move on either side, but nothing crosses.', 'site'),
    edit('[data-cell="mod:C1:bridge:openDate"]', 'An opening date', 'Nothing can pass the River bridge before this date.', 'Move the opening date to 1 April 2027.', 'valueChanged:modules.C1.blocks', '2027-04-01', 'site'),
    seeResult('Overall completion', 'Soil that can only reach its fill across the bridge has to wait, so the finish moves later.')
  ]);
  mod('C2', 'Single-lane stretches', 2, 'Road lengths that limit lorries per hour or allow one direction at a time.', 'site', [
    intro('C2', 'Single-lane stretches', 'A narrow stretch may limit how many lorries pass each hour, or let only one direction through at a time. Only loaded trips are delayed.', 'site'),
    edit('[data-cell="mod:C2:lane1:perHour"]', 'A limit per hour', 'A lorry that would be the next one over the limit waits for the next hour.', 'Change the limit to 10 lorries an hour.', 'valueChanged:modules.C2.stretches', '10', 'site'),
    seeResult('Overall completion', 'A tight limit on a busy stretch can set the pace of the whole job.')
  ]);
  mod('C3', 'Closing dates and closed periods', 2, 'Sections that close, or are shut for ecology windows or diversions.', 'site', [
    intro('C3', 'Closed periods', 'While a section is closed nothing loads from it and nothing tips into it. Use it for ecology windows, diversions and handover dates. Lorries can still drive through.', 'site'),
    edit('[data-cell="mod:C3:bats:to"]', 'A closed period', 'The rock cutting is closed for a bat survey. Soil from it waits until it reopens.', 'Extend the closure to 1 March 2027.', 'valueChanged:modules.C3.periods', '2027-03-01', 'site'),
    seeResult('Overall completion', 'A longer closure pushes work back, unless the soil can come from elsewhere.')
  ]);
  mod('C4', 'Layered fill', 3, 'Fill placed in layers, with a waiting period between them.', 'site', [
    intro('C4', 'Layered fill', 'Each fill takes its soil in equal layers. The next layer opens only after a waiting period, for example for settlement.', 'site'),
    edit('[data-cell="mod:C4:layers"]', 'Layers', 'More layers means more waiting. One layer with no wait is the same as having this module off.', 'Change the layers in each fill to 2.', 'valueChanged:modules.C4.layers', '2', 'site'),
    { target: '[data-card="C4"] label.check', title: 'Vary by section', text: 'This is ticked in the example, so the section table has layer and wait columns for the fills.', show: open('site') },
    edit('[data-cell="s5:c4layers"]', 'A fill of its own', 'The valley embankment is deep, so it takes more layers than the rest.', 'Change its layers to 6.', 'valueChanged:modules.C4.bySection', '6', 'sections')
  ]);
  mod('C5', 'Public and internal movements', 3, 'Separate daily limits, with the planning cap on public-road movements only.', 'site', [
    intro('C5', 'Public and internal movements', 'A planning condition often caps movements on public roads only. This counts public movements separately from internal ones.', 'site'),
    edit('[data-cell="mod:C5:publicLimit"]', 'The public-road cap', 'Only movements that use a public stretch count towards this cap. The site-wide limit still applies to all of them.', 'Change the public-road limit to 30.', 'valueChanged:modules.C5.publicLimit', '30', 'site'),
    { target: '[data-card="C5"] .scroll', title: 'Public stretches', text: 'A movement is public if its route overlaps one of these stretches of road.', show: open('site') },
    seeResult('Overall completion', 'A low public cap slows every haul that uses the public road.')
  ]);

  // ---- D. Programme and risk ----
  mod('D1', 'Weather', 2, 'Lost days per month, an optional winter shutdown and random rain days.', 'risk', [
    intro('D1', 'Weather', 'Enter the days you expect to lose to weather each month. They are spread through the month, or drawn at random if you choose random rain days.', 'risk'),
    edit('[data-cell="mod:D1:lost0"]', 'Lost days', 'A lost day is a day nothing loads anywhere on site.', 'Change January to 12 lost days.', 'valueChanged:modules.D1.lostDays', '12', 'risk'),
    seeResult('Overall completion', 'More lost days push the finish later.')
  ]);
  mod('D2', 'Probabilistic dates', 3, 'Many runs with random weather and breakdowns, giving 50% and 80% dates.', 'risk', [
    intro('D2', 'Probabilistic dates', 'The job is run many times, each with its own weather and breakdowns. You get the date half the runs finished by (50%) and the date four in five finished by (80%).', 'risk'),
    edit('[data-cell="mod:D2:runs"]', 'Number of runs', 'More runs give steadier answers but take longer. 50 is plenty for this tour.', 'Change the number of runs to 50.', 'valueChanged:modules.D2.runs', '50', 'risk'),
    { target: '#riskrun', title: 'Run it', text: 'The runs happen in the background, so you can keep using the page.', tryIt: 'Press Run the risk analysis.', done: 'riskDone', auto: [{ click: '#riskrun' }], autoOnNext: true, show: open('risk') },
    { target: '#riskresult .stats', title: 'The 50% and 80% dates', text: 'Plan to the 80% date if you want to be fairly sure. The chart below shows when the runs finished.', show: open('risk') }
  ]);
  mod('D3', 'Target dates', 2, 'A contract date per section, with late sections flagged.', 'site', [
    { target: '[data-row="s5"]', title: 'Target dates', text: 'With this on, each section has a target date column. Enter the date a section must reach finished level by.', show: open('sections') },
    edit('[data-cell="s5:d3target"]', 'Set a target', 'The valley embankment has a target of 28 February.', 'Change it to 1 February 2027.', 'valueChanged:modules.D3.targets', '2027-02-01', 'sections'),
    seeResult('Sections late', 'Sections that finish after their target are counted here, with a table of days late.')
  ]);
  mod('D4', 'Calendar', 3, 'Shifts, bank holidays and weekend working.', 'risk', [
    intro('D4', 'Calendar', 'Set the shifts, and whether weekends are worked. England and Wales bank holidays are worked out for you and treated as non-working days.', 'site'),
    edit('[data-cell="mod:D4:shift0"]', 'Shift times', 'A load may only start inside a shift. A shift cannot run past midnight, so use two shifts for nights.', 'Make the shift start at 06:00.', 'valueChanged:modules.D4.shifts', '06:00', 'site'),
    edit('[data-card="D4"] label.check:nth-of-type(2) input', 'Weekend work', 'Ticking Saturdays adds a sixth working day to every section.', 'Tick Work Saturdays.', 'valueChanged:modules.D4.weekendSat', null, 'site', 'check'),
    seeResult('Overall completion', 'More working days bring the finish forward.')
  ]);
  mod('D5', 'Scenario comparison', 2, 'Save named scenarios and compare two side by side.', 'simple', [
    { target: 'tab:scenarios', title: 'Scenarios', text: 'Saved scenarios live on this tab, next to the comparison.', tryIt: 'Open the Scenarios tab.', done: 'tabIs:scenarios', auto: [{ click: '#tabs [data-tab="scenarios"]' }] },
    { target: '#tabbody p:has(#savename)', title: 'Save a scenario', text: 'Saving takes a snapshot of everything: inputs, modules and any optimised plan.', tryIt: 'Press Save.', done: 'savedCount', auto: [{ click: '#savebtn' }], show: open('scenarios') },
    { target: '#tabbody .optrow', title: 'Compare two', text: 'Choose any two saved scenarios, or the live one, and read the differences below. The What-if tutorial walks through a full example.', show: open('scenarios') }
  ]);

  // ---- E. Commercial and reporting (Commercial demo) ----
  mod('E1', 'Cost', 3, 'Hire, fuel, labour, tip fees and purchase costs; total and per tonne.', 'commercial', [
    intro('E1', 'Cost', 'Cost comes from the hours each kind of plant works, plus fuel, labour, and the charges at off-site gates and stockpiles.', 'commercial'),
    edit('[data-cell="mod:E1:lorryRate"]', 'A hire rate', 'Lorry hire is charged for the busy hours of each lorry.', 'Change the lorry hire to 60 pounds an hour.', 'valueChanged:modules.E1.lorryRate', '60', 'commercial'),
    seeResult('Total cost', 'The total, and the cost per tonne placed, are in the Cost and carbon section of the results.'),
    { target: 'tab:rates', title: 'Default rates', text: 'Any rate you have not entered yourself is marked DEFAULT, and listed here. Results that depend on a default say so, until you confirm real figures.', show: open('results') }
  ]);
  mod('E2', 'Carbon', 2, 'Fuel burn and tonnes of CO2e per scenario.', 'commercial', [
    intro('E2', 'Carbon', 'Carbon is worked out from the fuel each kind of plant burns each hour, times the carbon factor for diesel.', 'commercial'),
    edit('[data-cell="mod:E2:lorryLPerHour"]', 'Fuel burn', 'A thirstier lorry burns more fuel in every busy hour.', 'Change the lorry fuel burn to 35 litres an hour.', 'valueChanged:modules.E2.lorryLPerHour', '35', 'commercial'),
    seeResult('Carbon', 'The carbon total and litres burned appear in the results. The optimiser can aim for the lowest carbon once this is on.')
  ]);
  mod('E3', 'Mass haul diagram', 3, 'Cumulative cut and fill along the chainage, updating as the sim runs.', 'commercial', [
    { target: 'tab:masshaul', title: 'Mass haul', text: 'The mass haul diagram has its own tab.', tryIt: 'Open the Mass haul tab.', done: 'tabIs:masshaul', auto: [{ click: '#tabs [data-tab="masshaul"]' }] },
    { target: '#mhcanvas', title: 'Reading the diagram', text: 'The curve is the running total of cut minus fill along the road. It rises over a cut and falls over a fill. Where it returns to the zero line, the soil balances within that stretch. The dashed line is the plan at the start.', show: open('masshaul') },
    { target: '#bPlay', title: 'Watch it change', text: 'The solid line is the soil still to move at the time shown. Press play and watch it flatten as fills are filled.', tryIt: 'Press play.', done: 'playing', auto: [{ click: '#bPlay' }] },
    { target: '#mhcanvas', title: 'Flatter as it goes', text: 'When every fill is full and every cut is dug, the solid line lies along the zero line.', show: open('masshaul') }
  ]);
  mod('E4', 'Programme export', 2, 'Section start and finish dates as CSV for P6 or MS Project.', 'commercial', [
    intro('E4', 'Programme export', 'This exports one row for each section with soil: activity ID, name, duration, start, finish and percent complete. P6 and MS Project can both import it.', 'commercial'),
    edit('[data-cell="mod:E4:idPrefix"]', 'Activity IDs', 'The prefix starts every activity ID, so they fit your own numbering.', 'Change the prefix to TL.', 'valueChanged:modules.E4.idPrefix', 'TL', 'commercial'),
    { target: '#tabbody p:has(> button)', title: 'Export it', text: 'The export buttons are at the top of the section dates on the Results tab. "Export programme CSV" saves the file.', show: open('results') }
  ]);
  mod('E5', 'Import', 2, 'Load the section table from CSV or pasted spreadsheet cells.', 'simple', [
    { target: '#imppanel', title: 'Import', text: 'This panel sits at the top of the Sections tab. It loads your section table from a CSV file, or from cells you paste from a spreadsheet.', show: open('sections') },
    { target: '#imppanel summary', title: 'Open the panel', text: 'It stays closed until you need it.', tryIt: 'Click to open the import panel.', done: 'exists:#imppanel[open]', auto: [{ click: '#imppanel summary' }], show: open('sections') },
    { target: '#impText', title: 'Paste or choose a file', text: 'Paste rows here, or choose a file. The template button gives the column layout. Press Check to see what will be imported, then replace the table or add to it.', show: { tab: 'sections', details: '#imppanel' } }
  ]);
  mod('E6', 'Planned versus actual', 3, 'Enter real tonnages moved per day and re-forecast the finish.', 'commercial', [
    { target: 'tab:actuals', title: 'Actual progress', text: 'Enter the tonnes really placed each day, and Earthmove compares them with the plan.', tryIt: 'Open the Actual progress tab.', done: 'tabIs:actuals', auto: [{ click: '#tabs [data-tab="actuals"]' }] },
    edit('[data-cell="mod:E6:actual4t"]', 'A day\'s figure', 'Each row is a day and the tonnes moved that day.', 'Change the last day to 6000 tonnes.', 'valueChanged:modules.E6.actuals', '6000', 'actuals'),
    { target: 'stat:Re-forecast finish', title: 'The re-forecast', text: 'From where the job has got to, Earthmove runs the remaining soil and gives a new finish date, with how far ahead or behind the plan you are.', show: open('actuals') }
  ]);
  mod('E7', 'Reporting', 2, 'A printable one-page summary and a client-meeting replay mode.', 'commercial', [
    { target: '#tabbody p:has(> button)', title: 'Print and replay', text: '"Print report" makes a one-page summary. "Replay mode" hides every editing control, so you can run the job in front of a client without changing anything by accident.', show: open('results') },
    { target: '#btnReplay', title: 'Replay mode', text: 'There is also a Replay mode button in the top bar. An Exit replay mode button stays in the corner. The tutorials are not available while you are in replay mode.' },
    { target: '#tabs [data-tab="results"]', title: 'The summary', text: 'The printed report carries the same figures as the Results tab, with the dispatch line so nobody mistakes an unoptimised plan for an optimised one.', show: open('results') }
  ]);
  mod('E8', 'Time-chainage chart', 4, 'A chart of the whole programme: chainage across, time down the page.', 'site', [
    { target: '#tcpanel', title: 'The time-chainage chart', text: 'Distance along the road runs across the page and time runs down it. Cuts and fills are shaded by how much soil moved each day, and each haul is a sloping band whose width shows the tonnage.', show: { tc: true } },
    { target: '#tcDir', title: 'Which way is time?', text: 'Time can run down the page like a programme, or up like a graph.', tryIt: 'Press the direction button.', done: 'valueChanged:ui.timeChainage.timeDown', auto: [{ click: '#tcDir' }], show: { tc: true } },
    { target: '#tcSpan', title: 'Zoom in time', text: 'Show the whole job, or just a few months, weeks or days. The plus and minus buttons beside it step through the same choices.', tryIt: 'Choose 1 month.', done: 'valueChanged:ui.timeChainage.spanDays', auto: [{ pick: '#tcSpan', text: '1 month' }], show: { tc: true } },
    { target: '#tcFollow', title: 'Follow now', text: 'With this ticked, the chart keeps the moving "now" line in view as the simulation plays.', tryIt: 'Untick Follow now.', done: 'valueChanged:ui.timeChainage.follow', auto: [{ check: '#tcFollow', on: false }], show: { tc: true } },
    { target: '#tcMin', title: 'Tuck it away', text: 'Minimise the chart to a thin bar when you need the room. It is saved with the scenario.', tryIt: 'Press the minimise button.', done: 'valueChanged:ui.timeChainage.minimised', auto: [{ click: '#tcMin' }], show: { tc: true } }
  ]);

  const byId = {}; T.forEach((t) => { byId[t.id] = t; });
  const byModule = {}; T.forEach((t) => { if (t.module) byModule[t.module] = t; });
  return { CHECKS, list: T, byId, byModule };
});
