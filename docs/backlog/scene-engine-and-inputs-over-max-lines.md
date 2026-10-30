---
worth: later
added: 2026-10-25
---

# the scene engine and the scene inputs stay over the 400-line limit

`telegram-scene-engine.ts` has 618 lines and `telegram-scene-inputs.ts` has 488, over the `max-lines` limit of 400 in `apps/server/eslint.config.js`. We decided to keep them whole for now: a split is a refactor of the engine of its own, and it should not ride along with an unrelated change of a file that `AGENTS.md` asks to fix when touched.

`apps/server/eslint.config.js` raises `max-lines` for these two files only, to 640 and 510, so the warning stays quiet now and comes back when a file grows further. Remove the override in the commit that splits a file.

The value of the split is open until one of these happens: the engine moves into its own package, or a change has to grow a file past its raised limit. In `telegram-scene-engine.ts` the candidates are `sceneControl`, which builds the control object of a scene, and the blocking and handover checks (`handOver`, `canStart`, `rejectBlocked`, `blockedText`).
