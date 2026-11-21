# Earthmove

An offline earth-movement simulator and optimiser for a linear road (cut to fill by lorry). Plain JavaScript in `src/`, bundled by `python3 build.py` into one self-contained `dist/earthmove.html` (no build tools, no external libraries). The live page is `dist/` served on the LAN by `serve.py` (port 8090); it reads files per request, so rebuilding updates it.

## Status

**All 29 modules in all 7 phases are built** (A1-A5, B1-B6, C1-C5, D1-D5, E1-E8). Last full run: `tests/run.js` 578 checks pass, `tests/diff.js` 181 scenarios 0 differences. `master` = tag `phases567-done`.

Follow-ups on branch `followups` (not yet merged): optimiser monotone fix with voluntary holds, Stockpile demo, placeholder-rate flags (decisions 29-34).

Known limits and open items are in `MORNING_REPORT.md`; every design decision with its reasoning is in `DECISIONS.md` (read it before changing behaviour). Highlights: stockpile planning in the optimiser is built but not shown to help; greedy dispatch is not monotone (a constraint can occasionally improve a result); D2 breakdowns are per loading point.

## Layout

- The page also runs as separate files (no inline script) on the Intelligent Planning website; see decision 35 before changing `worker.js`, `makeWorker` or `csvCell`.
- `src/engine.js` the simulation: `prepare` (flat arrays, calendar, constraints), `buildCfg`, `simulate`, results helpers (`chartData`, `costCarbon`, `lateness`, `massHaul`, ...).
- `src/model.js` scenario defaults, `normalise`, validation (`moduleIssues`, plain-English with a cell link), examples, E4/E5/E6 pure functions.
- `src/optimiser.js` annealing over flows; `src/risk.js` D2 runs; `src/worker.js` glue for both; `src/modules.js` the registry; `src/ui.js`, `src/index.html`, `src/style.css`.
- `tests/run.js` hand-checked tests (numbered, each with the hand calculation in a comment); `tests/diff.js` differential test; `tests/perf.js` speed; `tests/monotone.js` (about 40 s; optimised finish with a constraint removed must be no worse; `SEED=n` varies the search); `tests/browser/*.js` Chrome scripts.
- `README.md` and `docs/*.md` are the public help (plain UK English, no em dashes); keep them in step when behaviour or labels change. Screenshots in `docs/images/` are 1600 px wide, taken from `dist/earthmove.html` with headless Chrome (start-up hash options such as `#example=site&t=30000`).
- `.baseline/` the pre-Phase-4 engine (made with `git archive pre-step2 src | tar -x -C .baseline/`). **Never regenerate or edit it.** `releases/` is an old page backup. Both are gitignored.

## How to run things (no Node on the host)

- Tests: `docker run --rm --entrypoint node -v /home/timneo/earthmove:/w -w /w docker.n8n.io/n8nio/n8n:2.48.5 tests/run.js` (expect `ALL PASSED`, snapshot hash `b3d068476047`). Same command with `tests/diff.js` (expect 0 differ) and `tests/perf.js .baseline/src` vs `tests/perf.js src`.
- Speed: judge by the minimum of several alternating runs; this machine swings about 2x run to run. Gate: plain jobs no more than 10% over baseline.
- Browser: scripts run inside `zenika/alpine-chrome:with-node` (Chrome on 9222, the `ws` module). Build into a scratch copy and serve it on port 8091; **never overwrite `dist/` mid-work**. Stop only your own server, by its pid. Keep each command under the 120 s limit (run scripts in batches of two or three).
- The Chrome image has no `ws`: `npm i ws` once into a scratch folder and mount it with `-e NODE_PATH=/nm/node_modules`; run Chrome with `--network host` so it can reach the scratch server on the host.
- Git has no identity configured: `git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit ...`. Tags mark every green step.

## Rules that matter

1. **Two dispatchers.** `simulate` routes to `simulateCore` (the original, frozen) when no module needs the full one, else `simulateFull` (`cfg.full`). A merge was tried three times and was 7-22% slower, so it stays split. New dispatch-changing behaviour goes in `simulateFull`.
2. **With every module off, results must match `.baseline` byte for byte.** Each new module adds a neutral entry to `NEUTRAL` in `tests/diff.js`. Never weaken or skip a test to make it pass.
3. New engine results go in separate objects (`msum`, `mlog`, `clog`, `csum`, `levels`), never in `summary`, so the differential test stays identical.
4. Each module needs: a hand-checked example, an audit that no constraint is broken (extend `audit()` in `tests/run.js`), a neutral-identity entry, a direction-of-effect check, a defaults-only run, and an off/on restore check.
5. Inputs for modules that are off are hidden, never deleted. Validation messages are plain English and link to the field (`data-cell`).

## Traps I hit

- Native `Element.append()` prints `null` as text and arrays as `[object ...]`; use the `h()` helper or filter children first. Browser tests check for stray `null`/`undefined`/`NaN`.
- `withMods` in `tests/run.js` mutates its argument (it does not clone); restate options when reusing a scenario.
- When editing `engine.js` by script, list every top-level `function` afterwards: a bad splice once left a duplicate `applyCalendar` that silently won.
- Input units and results units are separate in the UI (`UL()` vs `RL()`/`UF()`); with A1 or A3 on, results are always tonnes.
- Don't assume "more constraints = later": hand-check small cases instead.
