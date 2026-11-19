# Decisions (Phases 5-7 unattended run)

Each line: decision, then one-line reasoning. Newest at the bottom.

1. A1 default compaction is 1.0 (as instructed). Ticking A1 with defaults then changes no tonnage; `exampleMaterials` keeps its explicit 0.9/0.85 values so the demo still shows compaction.
2. Test 33 now sets compaction 0.9 explicitly: it checked the compaction/density formula, and the default it silently relied on changed to 1.0 (same numbers, same check).
3. Dispatcher merge NOT done; the two-dispatcher rule stays. Three serious attempts (inline source selection + original `pick` chosen once per run; selection as a function returning through a typed array; all material state bundled into one object) never got plain jobs inside the 10% gate. Best merged variant measured +22% on the 12-section job and +7-12% on the 100-section job (minimum of 15+ alternating runs, `tests/perf.js`); the others were worse. Cause not found: both versions reach the top compiler tier, block contexts match; what differs is a larger frame (1440 vs 1032 bytes) and 45 vs 23 captured slots, and bundling state did not fix it.
4. Because the dispatchers stay split, every Phase 5-7 module that changes dispatch lives only in `simulateFull`; the routing flag becomes `cfg.full = mat || constraints || calendar` so the frozen core never needs a change. Reasoning: no duplicated module code, and `tests/diff.js` keeps proving the core identical.
