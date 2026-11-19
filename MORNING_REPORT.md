# Morning report (Phases 5-7 unattended run)

STATUS: run in progress. This file is updated after every step, so it is valid even if the run is cut short.

## Green tags so far
- `step0-green`: compaction default 1.0, branch cleanup, dispatcher merge attempted and NOT adopted (see DECISIONS 3-4). Last known good before this run: `phase4-done`.

## Built
- Phase 5 engine, all seven modules, with validation and hand-checked tests (42-49): D4 calendar (`d4-green`), C3 closed periods (`c3-green`), C1 route blockages (`c1-green`), C4 layered fill (`c4-green`), C2 single-lane stretches and C5 public/internal caps (`c2c5-green`), D3 target dates and the Phase 5 sweep (`phase5-engine-green`). UI: the Site & calendar tab, Sections columns (target date, layers), road-view markers, results (target dates) and E8 overlays; Site demo example; test 50; browser script `tests/browser/drive_site.js` (21 checks).
- `phase5-green`: all of the above, merged-in gates passed.
- A1 default compaction 1.0 (test 41).
- `tests/perf.js`: speed harness for comparing an engine directory with `.baseline`.

- Phase 6: D1 weather (deterministic fractional lost days, winter shutdown that wraps the year end, seeded random rain days) and D2 probabilistic dates (`src/risk.js`: seeded runs with random weather and breakdowns, 50%/80% dates for the job and every section, histogram, progress and cancel, runs in the Web Worker with an on-page fallback), the Weather & risk tab, Risk demo example, tests 51-53, browser script `drive_risk.js` (16 checks). Tags `phase6-engine-green`, then `phase6-green`.
- Phase 7: E1 cost and E2 carbon (run counters, `Engine.costCarbon`, optimiser goals lowest cost / lowest carbon), E3 mass haul tab, E4 programme CSV, E5 section import with template and plain-English row errors, E6 planned-vs-actual with variance table and re-forecast, E7 printable report and replay mode, the m3 results-unit fix, material-coloured grains; Cost & carbon / Actual progress / Mass haul tabs, results blocks, Commercial demo example; tests 54-58; browser script `drive_commercial.js` (33 checks). Tags `e1e2-green`, `e4e5e6-green`, then `phase7-green`.

## Skipped or reverted
- **Single merged dispatcher: not adopted.** Best variant +22% (12 sections) / +7-12% (100 sections) against a 10% gate, after three attempts. Two-dispatcher rule kept. Nothing needed reverting (experiments ran on scratch copies).

## Test results per step
- Phase 7: tests/run.js all pass, tests/diff.js 181 scenarios 0 differences; browser: drive_commercial 33, drive_risk 16, drive_site 21, drive_materials 24, drive5 23, drive7 7 all pass; plain-job speed equal to baseline.
- Step 0: tests/run.js all pass (289 checks), tests/diff.js 0 differences over 109 scenarios.
- Phase 5 engine: tests/run.js all pass, tests/diff.js 0 differences over 181 scenarios (every new module ticked at neutral settings reproduces the original engine exactly); plain-job speed equal to baseline (S12 2.70-2.89 ms vs 2.73-2.80 ms).
- Phase 5 complete: tests/run.js 432 checks pass, tests/diff.js 181 scenarios 0 differences; browser: drive_site 21, drive_materials 24, drive5 23, drive7 7 all pass.

## Open items
- D2 breakdowns are per loading point per day, not per excavator when B5 is in 'individual machines' mode (simplification; B6 uptime is still applied separately, so a job with both counts both).
- The greedy nearest-fill dispatcher is not monotone: a constraint can occasionally improve the result (see DECISIONS 13). Not a bug, but the optimiser may find large gains on constrained jobs.

## Check by hand first
(none yet)

Decisions: see DECISIONS.md.
