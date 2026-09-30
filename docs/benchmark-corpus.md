# Pi Forge task corpus v0

This is the initial matched-task specification for upstream OMP (A) and Pi Forge (B). It is **not** a set of completed runs. The prompt-only fixtures in `packages/coding-agent/bench/prompt-profiles.ts` measure setup text, not task success.

## Run contract

Each case starts from the same pinned Git snapshot in separate clean worktrees. Use the same provider, model, allowed tools, turn limit, and wall-time limit for both systems. Save the exact starting commit, harness configuration, full provider usage (including cache read/write), elapsed time, tool calls, final diff, test results, and whether a person had to intervene. Do not count a run as successful merely because the agent says it finished.

The acceptance command and task text must be frozen before either run. A human reviewer checks requirements that cannot be expressed by the command. Repeat each case across seeds when the provider supports them; otherwise record that the run is nondeterministic. Keep failed and timed-out runs in the dataset.

## Initial cases

| ID | Size | Frozen task shape | Observable acceptance | Why it is included |
| --- | --- | --- | --- | --- |
| `small-local-edit` | Trivial | Correct one specified localized behavior in `packages/coding-agent`, with the failing focused test supplied in the task packet. | Focused test passes; diff stays scoped; existing behavior passes. | Detect unnecessary planning, workers, and latency. |
| `session-lifecycle` | Normal | Fix a prompt/tool state transition that reproduces in a live-session test, including a model or active-tool change. | Reproducer passes after the change; adjacent session tests and package type check pass. | Detect state and prompt/tool consistency regressions. |
| `cross-package-contract` | Complex | Change a coding-agent feature that depends on a contract in `packages/agent` or `packages/catalog`, with two independently stated acceptance checks. | Both package checks and targeted tests pass; consumer-visible behavior is correct. | Measure architecture search and integration quality. |
| `decomposable-migration` | Massive | Apply the same documented API migration across independent modules plus one shared integration point. | All affected package checks pass; no stale callsite remains; integration behavior passes. | Measure whether parallel work helps after integration cost. |
| `unexpected-scope` | Escalation | Begin with a localized bug report whose supplied reproducer exposes a dependency in another module. | Reproducer and dependency contract pass; transition evidence is recorded. | Measure justified escalation without restarting. |
| `overestimated-scope` | De-escalation | Begin with a broad symptom report whose actual defect is one localized conditional. | Focused regression passes; no unrelated edits; transition evidence is recorded. | Measure removal of unnecessary orchestration. |

These are initial benchmark scenarios; only the tiny-edit case currently has a frozen executable packet. Each remaining slot still needs a pinned starting commit, exact task prompt, failing reproducer, acceptance commands, and immutable fixture ID before it can be run. This keeps task selection from being adjusted after seeing results. Use real repository regressions or fresh task packets that fail at the pinned start and pass only when the requested behavior is implemented. Avoid tests that merely assert prompt wording or an internal field was assigned. The Phase 0 paired first-turn prompt baseline is recorded in [the architecture baseline](architecture-baseline.md); it does not count as a coding-outcome run.

The frozen tiny-edit packet is `packages/coding-agent/bench/fixtures/prompt-profile-retry-delay-v1/`. Its three matched runs are summarized in [the Phase 9 evaluation](phase9-evaluation.md).

## Baseline state

Three upstream/Pi Forge task-outcome pairs have been run for the frozen tiny-edit packet. Their outcomes and limits are documented in [the Phase 9 evaluation](phase9-evaluation.md). Correctness for larger tasks, autonomous survival, Governor precision, and small-task performance across task types remain unmeasured. The offline prompt fixtures and paired authenticated first-turn input comparison documented in [the architecture baseline](architecture-baseline.md) measure setup input, not task completion.

The repeatable first-turn fixture is `packages/coding-agent/bench/fixtures/phase0-first-turn.md`. Run it with `bun packages/coding-agent/bench/prompt-baseline-live.ts` in a clean checkout with provider access. The script records local prompt/schema counts and provider-reported input, cache, output, and stop-reason fields. The Phase 0 run used one request per checkout; repeat runs and broader coding-task measurements remain follow-up evaluation.
