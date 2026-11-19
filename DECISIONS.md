# Decisions (Phases 5-7 unattended run)

Each line: decision, then one-line reasoning. Newest at the bottom.

1. A1 default compaction is 1.0 (as instructed). Ticking A1 with defaults then changes no tonnage; `exampleMaterials` keeps its explicit 0.9/0.85 values so the demo still shows compaction.
2. Test 33 now sets compaction 0.9 explicitly: it checked the compaction/density formula, and the default it silently relied on changed to 1.0 (same numbers, same check).
