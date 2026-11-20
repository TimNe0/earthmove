# Morning report: Phases 5, 6 and 7 (unattended run)

**Status: finished.** Every module in Phases 5, 6 and 7 is built, tested and in the live page. Nothing was reverted or left "not built yet". One planned piece was not done (merging the two dispatchers into one: three attempts failed the speed gate, so the two-dispatcher layout stays, as your fallback instruction said). All 29 modules are now tickable.

Work is on branch `phases567`; `master` is fast-forwarded to it at the end (see the last line of this report for the exact state).

## What was built

**Housekeeping (step 0).** A1 default compaction is now 1.0 (ticking A1 at defaults changes no quantity; test 41). `phase4-materials` branch deleted. `tests/perf.js` speed harness added. Dispatcher merge attempted three times and not adopted (below).

**Phase 5: site constraints and calendar.** C1 route blockages (checked at the moment a lorry passes the chainage, honoured by exports, stockpile parking and a fixed fleet's empty returns); C2 single-lane stretches (hourly cap, or alternating directions in phases); C3 closed periods per section or all sections; C4 layered fill (layers open after a wait counted from the latest tip, no load straddles a layer); C5 public vs internal movements (public cap, optional internal cap, vehicle types that may not use public roads); D3 target dates (late sections flagged with days late); D4 calendar (shift windows, UK bank holidays computed by rule with substitute days, weekend working). UI: Site & calendar tab, target-date and layer columns in the Sections table, road-view markers with dates, target-date results, E8 overlays (days off, blockages, closed periods, lane stretches, target diamonds), Site demo example.

**Phase 6: weather and risk.** D1 weather (monthly lost days spread over working days, winter shutdown that can wrap the year end, seeded random rain days); D2 probabilistic dates (`src/risk.js`: seeded runs with random weather and breakdowns, 50% and 80% dates for the job and every section, histogram, progress, cancel, runs in the Web Worker with an on-page fallback). UI: Weather & risk tab, Risk demo example.

**Phase 7: commercial and reporting.** E1 cost and E2 carbon (plant hours, fuel, labour, tip fees and purchases, cost per tonne, tCO2e; optimiser goals "lowest cost" and "lowest carbon"; before/after and scenario-comparison rows); E3 mass haul diagram (tab, live curve); E4 programme CSV for P6/MS Project; E5 section import from CSV or pasted spreadsheet cells with a downloadable template and plain-English row errors; E6 planned vs actual with a variance table and a re-forecast; E7 printable one-page report and replay mode (`#replay=1` link). Plus the **m3 results fix** (input units and results units are now separate) and **transit grains coloured by soil class** (the small Phase 4 gap from the brief). UI: Cost & carbon, Actual progress and Mass haul tabs, import panel, Commercial demo example.

**Last job: optimiser stockpile planning.** The engine accepts plan arcs section -> stockpile and stockpile -> fill; the optimiser has a "route via a stockpile" search move. Built and verified by hand; see open items for its honest limit.

## Skipped or reverted

- **Single merged dispatcher: not adopted.** Three serious attempts (inline source selection plus the original `pick` chosen once per run; selection as a function returning through a typed array; all material state bundled into one object). Best result was +22% on the 12-section job and +7-12% on the 100-section job against a 10% gate. Cause not found (both versions reach the top compiler tier; the merged function has a larger frame and more captured variables, and bundling did not fix it). Experiments ran on scratch copies, so nothing needed reverting. Consequence: every new dispatch-changing module lives only in `simulateFull`, the original `simulateCore` is frozen, and `tests/diff.js` keeps them honest (decisions 3-4).
- Nothing else was skipped or reverted. No module needed the three-strikes rule.

## Tags (last commit of each green step)

- `step0-green`
- `d4-green`
- `c3-green`
- `c1-green`
- `c4-green`
- `c2c5-green`
- `phase5-engine-green`
- `phase5-green`
- `phase6-engine-green`
- `phase6-green`
- `e1e2-green`
- `e4e5e6-green`
- `phase7-green`
- `stockplan-green`

## Test results per step

All gates run before moving on: `tests/run.js` (every hand-calculated check), `tests/diff.js` (byte-for-byte against `.baseline/`, never regenerated), speed against `.baseline`, and the browser scripts on a scratch build (port 8091, stopped each time).

| Step | tests/run.js | tests/diff.js | Browser |
|---|---|---|---|
| 0 housekeeping | 289 pass | 109 scenarios, 0 differ | n/a |
| Phase 5 engine (D4, C3, C1, C4, C2, C5, D3) | 432 pass | 181 scenarios, 0 differ (every new module ticked at neutral settings equals the original engine) | n/a |
| Phase 5 UI | 432 pass | 181, 0 differ | drive_site 21, drive_materials 24, drive5 23, drive7 7 |
| Phase 6 (D1, D2) | all pass | 181, 0 differ | drive_risk 16 + all earlier |
| Phase 7 (E1-E7, m3 fix) | all pass | 181, 0 differ | drive_commercial 33 + all earlier |
| Stockpile planning | 534 pass, 0 fail | 181, 0 differ | drive_optimiser 5 + all earlier |

Plain-job speed matched baseline at every step (12-section job 2.69-2.89 ms against 2.73-2.80 ms; 100-section job within noise).

Hand calculations are in the test files next to the simulated result (tests 41-59), e.g. D1: 7 lost days in a 21-working-day January loses every third working day (loads fall on days 0,1,3,4,8); C2: two lorries an hour gives tips 07:46, 07:56, 08:30, 08:30, 09:30; E1/E2: 170 lorry-minutes, 101.83 l, 0.2729 t CO2e, 463.83 total.

## Decisions (from DECISIONS.md, in order)

1. A1 default compaction is 1.0 (as instructed). Ticking A1 with defaults then changes no tonnage; `exampleMaterials` keeps its explicit 0.9/0.85 values so the demo still shows compaction.
2. Test 33 now sets compaction 0.9 explicitly: it checked the compaction/density formula, and the default it silently relied on changed to 1.0 (same numbers, same check).
3. Dispatcher merge NOT done; the two-dispatcher rule stays. Three serious attempts (inline source selection + original `pick` chosen once per run; selection as a function returning through a typed array; all material state bundled into one object) never got plain jobs inside the 10% gate. Best merged variant measured +22% on the 12-section job and +7-12% on the 100-section job (minimum of 15+ alternating runs, `tests/perf.js`); the others were worse. Cause not found: both versions reach the top compiler tier, block contexts match; what differs is a larger frame (1440 vs 1032 bytes) and 45 vs 23 captured slots, and bundling state did not fix it.
4. Because the dispatchers stay split, every Phase 5-7 module that changes dispatch lives only in `simulateFull`; the routing flag becomes `cfg.full = mat || constraints || calendar` so the frozen core never needs a change. Reasoning: no duplicated module code, and `tests/diff.js` keeps proving the core identical.
5. Test 42 shutdown expectation corrected from day 37 to day 36: the 35 off days are days 1-35 (12 Jan-15 Feb), so work resumes on day 36 (Tue 16 Feb). My hand count was wrong; the engine value was verified independently by recounting the calendar first.
6. D4: per-section hours and working days stay in the Sections table (already per section); D4 adds the site-wide shift windows, holiday list and weekend flags. 'Per section or site-wide' is covered by the two together. Shifts intersect each section's hours unless 'replace section hours' is ticked. Holidays default to the rule-based England and Wales list (editable; one-off days can be added to the list).
7. Test 47's internal-cap expectation corrected: when the internal cap is used up a load goes to the nearest destination still ALLOWED (here the public fill), so the days are 0,0,0,0,1, not 0,0,1,0,0. Engine behaviour was right; my first hand count assumed the load would wait.
8. C5 non-public lorry types (B2 publicRoad:false) are excluded for a source whenever every fill that STILL needs soil is only reachable by a public road, checked at each lorry choice (the review's static version would leave a dumper blocking the source all day). Cached lorry readiness is already refreshed after every dispatch, so the check is never stale.
9. C2: lane delays apply to LOADED trips only (empty returns are not constrained), are booked when the load is committed (not while choosing), and the opening/closure/layer checks use the undelayed arrival. Alternating mode: even phases carry rising chainage; a lorry that cannot clear the stretch before its phase ends waits for the next phase in its direction (a stretch longer than one phase is entered at any time in the right phase).
10. C5: movements to or from off-site gates (A4) count as public by definition when C5 is on. A public movement is one whose route (midpoint to midpoint) overlaps a listed public stretch, or any movement when 'all movements public' is ticked. The internal cap is blank (no extra limit) by default, so with no public stretches C5 is neutral.
11. C4: layers apply to the section total, on top of A2 line caps; the next layer opens (waitDays x 1440) minutes after the LATEST tip in the previous layer; a load never straddles layers (short loads at each boundary, like A2 line boundaries).
12. C1: the blockage check is made at the time the loaded lorry PASSES the chainage (departure + travel to it), not on the departure day; exports and stockpile parking use the same check; empty returns of a fixed fleet are delayed until the blockage opens (conservative: ready no earlier than the opening time).
13. Test 50: I first asserted that removing the bridge blockage can never make the Site demo later. The numbers refute it (finish 16 Mar 13:21 without the bridge vs 11:51 with it; tonne-km 228,960 vs 179,190), and even the bridge alone beats the plain road. Not an engine bug: the dispatcher is greedy nearest-fill, so a constraint can force a better global routing. The test now asserts the true thing (the blockage changes the routing) and the lateness of S7. Direction-of-effect checks stay on hand-derivable small scenarios (tests 42-47), where the expected direction is exact. Worth knowing for the optimiser: it may improve on greedy a lot.
14. Test 51 year-end expectation corrected (my day count was one day out: starting 15 Dec, 5 Jan is day 21 and 6 Jan day 22). While adding D1 I also broke engine.js once (a splice duplicated the old calendar function so the old D4-only version silently won); the D1 tests caught it, the duplicate block was removed, and the file structure was re-checked by listing every top-level function.
15. D1 deterministic weather: a day is lost when a running fraction (that month's expected lost days / that month's site working days, added once per site working day) reaches 1 (tolerance 1e-9). Working days exclude bank holidays and the winter shutdown. Part months are pro-rated automatically because the fraction only accumulates over days inside the programme. Random mode replaces the deterministic losses (each working day is lost with probability lost/working days).
16. D2: each run draws its own weather (when D1 is on) and its own breakdowns from a per-run seed (seed*1000003 + run*7919 + 1); the whole analysis is reproducible. A run counts as finished only if every fill is completely filled; job completion is the latest level time of any section that reached level (so the 16,000 t surplus on the example does not make runs 'never finish'). Runs that never finish count as later than any date (Infinity) in the percentiles. Breakdowns are per loading point per day (not per excavator in B5 individual-machine mode); B6 uptime still applies separately, so a job using both counts both.
17. D2 results are marked out of date (not discarded) when any dispatch-affecting input or D2 setting changes; the user re-runs to refresh.
18. Test 55: the 'unfinished sections' case inherited the ISO/RD options from the previous case because the test helper withMods mutates its argument (it does not clone). The engine output was right; the case now restates its E4 options. E6: a job whose actual tonnage equals the whole plan is reported finished (my first version only recognised 'more than planned').
19. E4 uses one CSV with P6-style headers (Activity ID, Activity Name, Original Duration) and the date style chosen in E4 (UK dd/mm/yyyy by default, ISO optional); P6 and MS Project both let you map the columns on import, so one file serves both. Sections with no soil are left out; an unfinished section has a start date, no finish date and a percentage.
20. E5 import accepts CSV or tab-separated pasted cells, comma/semicolon/tab delimiters, header aliases (Section, Quantity, Opens, Days...), dd/mm/yy or ISO dates, H:MM times, working days as Mon-Fri / Mon,Tue / 1111100. Quantities are taken in the scenario's current units. Rows with a mistake are skipped and listed in plain English with the row number; good rows are still imported.
21. E6 re-forecast: find the moment the plan's tipped tonnage first equals the actual tonnage, take every section's remaining soil at that moment (cut remaining counted by tips, so loads in transit are not lost), restart the day after the last actual with the ordinary dispatcher and no plan arcs. Forecast and plan end are compared by date.
22. m3 results fix (as instructed): input units and results units are now separate. With A1 or A3 on, results are ALWAYS shown in tonnes (exact, because each soil type has its own density) and the Results tab says so. With neither on, a selector on the Results tab picks tonnes or m3 (at the site density) independently of the units quantities are typed in; the default follows the input units, so nothing changes until the user picks. Only display changes: nothing in the engine, exports or saved files changes except the results labels and the CSV unit columns.
23. E1/E2 cost model: lorry hours = busy time from start of loading to back at the loader (loaded trip + loading + empty return, return assumed equal to the loaded trip); excavator hours = loading minutes; receiving plant hours = tonnes received / B4's rate (or 300 t/h); fuel = plant hours x litres per hour (E2 rates, or defaults 25/30/18 l/h when only E1 is on); labour = one operator per plant hour; tip fees and purchases = A4 gate charges + A5 handling. 'Standing' basis charges a fixed fleet (B1 or B2) for every working day of the programme x average shift length; without a fixed fleet it falls back to busy hours (flagged as a warning). Carbon factor 2.68 kg CO2e per litre of diesel.
24. E3 mass haul: a tab (not a panel under the road view) drawn on a canvas, dashed start curve plus the live curve at the playback time, in the results unit. The last value is the net surplus/shortage; in-transit soil is counted as not yet moved (so the live curve dips by the tonnes on the road).
25. E7: 'Print report' builds a hidden one-page report (title, scenario, the level and module list exactly as on exports, key results incl. cost/carbon/lateness when on, charts as images, section table) and calls the browser's print; 'Replay mode' hides every editing control (tabs, setup, save/load, optimise, examples, scenario name) and leaves playback and the charts; a fixed 'Exit replay mode' button brings them back; #replay=1 in the link opens straight into it. Replay mode is a view, not saved in the scenario file.
26. Road view: transit grains are coloured by soil class when A2 is on (the small Phase 4 gap from the brief).
27. Optimiser: the cost and carbon goals appear only when E1 / E2 are on; their before/after rows and the D5 comparison rows show cost (GBP) and carbon (tCO2e). The goals use the same cost/carbon function as the results.
28. Optimiser stockpile planning (the last job): the engine now accepts plan arcs section -> stockpile (a deliberate deposit) and stockpile -> fill (the haul out), limited by the pile's room; the optimiser has a 'route part of a flow via a stockpile' move (and its undo) that is only drawn when the job has stockpiles, so core optimiser sequences are unchanged. Stockpiles are no longer treated as ordinary sources inside the optimiser: previously it emitted a zero-tonne 'send nothing' arc for them, which the engine now honours, so they would have stopped hauling out (a regression found by test 40 and fixed). Verified by hand (a manual cut -> stockpile -> fill plan: 10 moves, tips 07:16-07:56 Monday and Tuesday, 200 handling cost) and by capacity checks. On the Materials example the optimiser improves the job (3 days earlier, or 14% less tonne-km) WITHOUT choosing a stockpile route, because the dispatcher's own fallback already covers the useful cases; I did not find a scenario where deliberate stockpiling beats it, so the benefit is unproven even though the capability is built and safe.

## Open items, in priority order

1. **Standard level now changes numbers.** Standard ticks B1, B4, A1, A3, D3, D4, E3 and E8, and D4 now makes UK bank holidays non-working days, so a Standard run finishes later than before around holidays. Intended by the registry, but it is a visible change for anyone who picks Standard.
2. **Two dispatchers remain.** Any future change to dispatch behaviour needs to go into `simulateFull` (and into `simulateCore` only if it should apply to jobs with no modules on). `tests/diff.js` is the guard.
3. **Stockpile planning is built but its usefulness is unproven.** On the Materials example the optimiser improves the job (3 days earlier, or 14% less tonne-km) without choosing any stockpile route, because the dispatcher's own fallback already covers the useful cases. I found no scenario where deliberate stockpiling wins.
4. **Greedy dispatch is not monotone.** Adding a constraint can occasionally improve a result (decision 13: the bridge blockage makes the Site demo finish 90 minutes earlier). Not a bug, but it means "more constraints = later" is not guaranteed on complex jobs.
5. **Simplifications to know about:** C2 delays loaded trips only; C1 delays a fixed fleet's empty returns conservatively; C5 non-public lorry types are excluded when every fill still needing soil is public; D2 breakdowns are per loading point (not per excavator) and B6 uptime still applies, so using both counts both; D4 shifts cannot cross midnight and holidays are England and Wales only (editable list for one-off days); E1 standing hire needs a fixed fleet (B1 or B2).
6. With A1 or A3 on, results are always shown in tonnes (exact); the tonnes/m3 selector only appears without them.
7. `tests/run.js` helper `withMods` mutates the scenario it is given (it does not clone). It caused one test bug; worth a clean-up.
8. `.baseline/` and `releases/` were left alone as instructed; the git identity is still unset (commits use a one-off name).

## Things to check by hand first

1. Open the live page and load each demo from the Examples menu: **Site demo**, **Risk demo**, **Commercial demo**. Look at the road view (blockage barrier with its date, lane marker, closed section), the E8 chart overlays, and the new tabs.
2. **Standard level**: Setup, pick Standard, and confirm you are happy with the numbers it now gives (bank holidays, fleet limit, receiving rates).
3. **Print report** (Results tab, Commercial demo): use your browser's print preview and check it reads as a one-page summary with the module list.
4. **Replay mode** (Results tab button or a link ending `#replay=1`): confirm the editing controls disappear and the exit button works.
5. **Import**: paste a real spreadsheet range into the E5 panel on the Sections tab and see whether the column names and date formats you actually use are understood.
6. **Risk analysis**: run it on a real job and judge whether the 50%/80% dates look sensible; the weather defaults are my UK guesses.
7. **Optimiser with cost or carbon goal** on the Commercial demo.
8. Cost rates and fuel burn defaults (E1/E2) are placeholders, not your rates.

---
**Final state:** `master` was fast-forwarded to `phases567` (tag `phases567-done`), everything green. The live page at http://192.168.1.15:8090/earthmove.html was rebuilt from it and returns 200. Only my own scratch servers (port 8091) were ever started and stopped; the live server on 8090 was never touched except by rebuilding `dist/`. The `step2-scaffold` branch and the `phases567` branch are left in place (nothing deleted except `phase4-materials`, as instructed).


---
# Follow-ups (branch `followups`, for your review; `master` and `dist/` not touched)

1. **Non-monotone dispatch: fixed and tested.** `tests/monotone.js` (28 constraint removals across all 7 examples, 3 seeds): 4 failures before, 0 after. Fix: warm start from the previous plan, plus "voluntary holds" (a plan may keep a constraint you removed, and says so). The label "Simple dispatch, not optimised" now appears on the header, Results, printed report, CSV exports and Scenarios; comparing two scenarios warns when either is not optimised. Decisions 29-31.
2. **Stockpile planning: proved against "no stockpile", not against plain dispatch.** New Stockpile demo, hand-checked (test 60). The optimiser now plans cut -> pile -> fill and beats the no-stockpile result (nothing moves without the pile), but plain dispatch does the same by itself. Decision 32 has the detail and what I changed to make the optimiser choose the route.
3. **Placeholder rates.** 21 values are flagged (5 cost, 3 fuel burn, 12 monthly weather, 1 breakdown). "Using default rates" shows beside cost, carbon and risk results, on the printed report and in the CSVs. One tab, "Default rates", lists them all. Decision 33.

Tests: `tests/run.js` all pass (new tests 60, 61, 62), `tests/diff.js` 181 scenarios 0 differ, `tests/monotone.js` 0 failures, speed within noise of baseline (S12 2.70-2.73 ms vs 2.73-2.79; S100 130.9-132.2 vs 130.9-131.5), browser: new `drive_followups.js` (26 checks) plus drive5, drive7, drive_commercial, drive_materials, drive_site, drive_risk, drive_optimiser all pass. Limits are in decision 34.
