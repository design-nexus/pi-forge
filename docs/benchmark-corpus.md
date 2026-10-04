# Pi Forge task corpus v0

This is the initial matched-task specification for upstream OMP (A) and Pi Forge (B). Matched-run results are recorded in [the Phase 9 evaluation](phase9-evaluation.md). The prompt-only fixtures in `packages/coding-agent/bench/prompt-profiles.ts` measure setup text, not task success.

## Run contract

Each case starts from the same pinned Git snapshot in separate clean worktrees. Use the same provider, model, allowed tools, turn limit, and wall-time limit for both systems. Save the exact starting commit, harness configuration, full provider usage (including cache read/write), elapsed time, tool calls, final diff, test results, and whether a person had to intervene. Do not count a run as successful merely because the agent says it finished.

The acceptance command and task text must be frozen before either run. A human reviewer checks requirements that cannot be expressed by the command. Repeat each case across seeds when the provider supports them; otherwise record that the run is nondeterministic. Keep failed and timed-out runs in the dataset.

## Initial cases

| ID | Size | Frozen task shape | Observable acceptance | Why it is included |
| --- | --- | --- | --- | --- |
| `small-local-edit` | Trivial | Correct one specified localized behavior in `packages/coding-agent`, with the failing focused test supplied in the task packet. | Focused test passes; diff stays scoped; existing behavior passes. | Detect unnecessary planning, workers, and latency. |
| `session-lifecycle` | Normal | Fix a prompt/tool state transition that reproduces in a live-session test, including a model or active-tool change. | Reproducer passes after the change; adjacent session tests and package type check pass. | Detect state and prompt/tool consistency regressions. |
| `cross-package-contract` | Complex | Change consumer behavior that depends on a provider contract in another module, with independent default and override checks. | Provider defaults and caller precedence produce the required consumer behavior. | Proxy a contract-boundary change and measure integration quality. |
| `decomposable-migration` | Massive | Apply the same documented API migration across independent modules plus one shared integration point. | All affected package checks pass; no stale callsite remains; integration behavior passes. | Measure whether parallel work helps after integration cost. |
| `unexpected-scope` | Escalation | Begin with a localized bug report whose supplied reproducer exposes a dependency in another module. | Reproducer and dependency contract pass; transition evidence is recorded. | Measure justified escalation without restarting. |
| `overestimated-scope` | De-escalation | Begin with a broad symptom report whose actual defect is one localized conditional. | Focused regression passes; no unrelated edits; transition evidence is recorded. | Measure removal of unnecessary orchestration. |

All six cases now have frozen executable packets. They use isolated TypeScript fixtures with concrete behavior tests, exact task text, acceptance commands, permitted changed-file lists, and pinned source commits. Each requested behavior fails on its frozen starting state while an unaffected baseline behavior passes. These are synthetic packets; they approximate the listed task shapes and do not yet substitute for real repository-scale tasks. Avoid tests that merely assert prompt wording or an internal field was assigned. The Phase 0 paired first-turn prompt baseline is recorded in [the architecture baseline](architecture-baseline.md); it does not count as a coding-outcome run.

The frozen packets are `packages/coding-agent/bench/fixtures/prompt-profile-retry-delay-v1/`, `packages/coding-agent/bench/fixtures/session-lifecycle-v1/`, `packages/coding-agent/bench/fixtures/cross-package-contract-v1/`, `packages/coding-agent/bench/fixtures/decomposable-migration-v1/`, `packages/coding-agent/bench/fixtures/unexpected-scope-v1/`, `packages/coding-agent/bench/fixtures/overestimated-scope-v1/`, and the real-repository tasks `packages/coding-agent/bench/fixtures/chromium-wrapper-reuse-v1/`, `packages/coding-agent/bench/fixtures/bash-verification-v1/`, and `packages/coding-agent/bench/fixtures/context-notes-feature-v1/`. Each synthetic packet has three matched provider pairs; Chromium wrapper has one, Bash verification has three, and context notes has two successful long-run pairs. Results are summarized in [the Phase 9 evaluation](phase9-evaluation.md).

## Baseline state

Three upstream/Pi Forge task-outcome pairs have been run for each of the six synthetic packets, and all 36 runs passed the independent tests and changed-file scope check. Three real-repository tasks passed six matched pairs total; each passed its tests and stayed within its reviewed file scope. The context-notes task has two successful long-run pairs. An earlier attempted pair was invalid: OMP failed three acceptance tests, while Pi Forge was blocked before implementation by a provider usage limit. That failed attempt is excluded from matched outcome totals. Outcomes and limits are documented in [the Phase 9 evaluation](phase9-evaluation.md). Governor calibration and performance across representative user tasks remain unmeasured. The offline prompt fixtures and paired authenticated first-turn input comparison documented in [the architecture baseline](architecture-baseline.md) measure setup input, not task completion.

The repeatable first-turn fixture is `packages/coding-agent/bench/fixtures/phase0-first-turn.md`. Run it with `bun packages/coding-agent/bench/prompt-baseline-live.ts` in a clean checkout with provider access. The script records local prompt/schema counts and provider-reported input, cache, output, and stop-reason fields. The Phase 0 run used one request per checkout; repeat runs and broader coding-task measurements remain follow-up evaluation.
