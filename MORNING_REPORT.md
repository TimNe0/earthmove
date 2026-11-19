# Morning report (Phases 5-7 unattended run)

STATUS: run in progress. This file is updated after every step, so it is valid even if the run is cut short.

## Green tags so far
- `step0-green`: compaction default 1.0, branch cleanup, dispatcher merge attempted and NOT adopted (see DECISIONS 3-4). Last known good before this run: `phase4-done`.

## Built
- Phase 5 engine, all seven modules, with validation and hand-checked tests (42-49): D4 calendar (`d4-green`), C3 closed periods (`c3-green`), C1 route blockages (`c1-green`), C4 layered fill (`c4-green`), C2 single-lane stretches and C5 public/internal caps (`c2c5-green`), D3 target dates and the Phase 5 sweep (`phase5-engine-green`). UI comes next.
- A1 default compaction 1.0 (test 41).
- `tests/perf.js`: speed harness for comparing an engine directory with `.baseline`.

## Skipped or reverted
- **Single merged dispatcher: not adopted.** Best variant +22% (12 sections) / +7-12% (100 sections) against a 10% gate, after three attempts. Two-dispatcher rule kept. Nothing needed reverting (experiments ran on scratch copies).

## Test results per step
- Step 0: tests/run.js all pass (289 checks), tests/diff.js 0 differences over 109 scenarios.
- Phase 5 engine: tests/run.js all pass, tests/diff.js 0 differences over 181 scenarios (every new module ticked at neutral settings reproduces the original engine exactly); plain-job speed equal to baseline (S12 2.70-2.89 ms vs 2.73-2.80 ms).

## Open items
(none yet)

## Check by hand first
(none yet)

Decisions: see DECISIONS.md.
