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

## Compact Governor check

Use `governor-compact-notes-v1` for the next routing and integration check. It contains three short source files, two independent fixes, and six acceptance tests. Its task asks for one batch of two workers and forbids further delegation. Workers need only their owned file and the tests. This replaces the large context-notes implementation as the initial Governor probe; it does not establish production feature quality or savings on large tasks.

The runner defaults to `openai-codex/gpt-6-luna`, `--thinking low`, one repeat, and no token or time cutoff. Existing capped mode remains opt-in. The packet's `benchmark.yml` pins the generic task agent and model roles to Luna Low and limits per-spawn effort to Low, avoiding inherited expensive worker choices. Medium should be tried only if Low fails: change the effort in both the CLI and a separately saved copy of the packet settings, keeping the Low result for comparison. Each report records the requested model, effort, usage from root and worker sessions, routing decisions, acceptance results, and changed-file scope. `thinkingLevel` records the parent's starting setting; inspect worker sessions to confirm resolved settings.

Run the two conditions separately, inspecting the first result before starting the second:

```sh
bun packages/coding-agent/bench/task-outcome-ab.ts \
  --packet packages/coding-agent/bench/fixtures/governor-compact-notes-v1 \
  --out /tmp/pi-forge-compact-notes-off \
  --omp-cli packages/coding-agent/src/cli.ts \
  --piforge-cli packages/coding-agent/src/cli.ts \
  --system piforge --adaptive-mode off \
  --model openai-codex/gpt-6-luna --thinking low --budget unbounded
```

For the second condition, change `--adaptive-mode off` to `auto` and use `/tmp/pi-forge-compact-notes-auto` for `--out`. Both paths use the same Pi Forge checkout; the unused OMP path does not represent an upstream comparison. Omit `--repository` so the model sees only the small fixture. The acceptance tests intentionally fail on the supplied starting state. Run them in the isolated benchmark workspace, not as part of the project's general test suite. Preparation and harness verification use local stubs with zero provider calls.

The first matched Luna Low pair completed on 2026-10-04: both conditions passed 6/6 unchanged acceptance tests, edited only the two allowed files, and completed two worker sessions. Auto selected Normal/V1 rather than recommending extra workers. It used more tokens and reported cost, and less elapsed time, in this single pair. An initial attempt that edited a protected test is excluded. Full counts and limitations are in [the evaluation](phase9-evaluation.md#compact-luna-low-governor-check-2026-10-04).

### Optional delegation variant

`governor-autonomous-notes-v1` has the same source and acceptance contract but no required task call or worker count. Its Low attempt streamed a malformed, repetitive tool call and was interrupted with no completed usage record. The matched retry uses `governor-autonomous-notes-medium-v1` and Medium settings in both conditions. Both runs pass 6/6, stay in scope, and complete without workers. Auto de-escalates Normal/V1 to Trivial/V0. This verifies conservative policy and de-escalation, without demonstrating a causal advantage or Governor-selected parallelism. See [the results and excluded attempt](phase9-evaluation.md#optional-delegation-and-de-escalation-check-2026-10-04).

To repeat the Medium packet, use the command above with `--packet packages/coding-agent/bench/fixtures/governor-autonomous-notes-medium-v1`, `--thinking medium`, and fresh output directories for the off and auto conditions. Keep `--budget unbounded`. The Medium settings overlay also pins generic workers and model roles to Medium. The runner writes the live transcript into each artifact directory before process completion so stalled or malformed streams can be inspected while active.

### Default parallel-policy variant

`governor-four-consumer-migration-medium-v1` requests a shared API migration and a four-item consumer batch. It pins only model and effort, leaving Governor policy and concurrency defaults intact. Low was tried first; its four-consumer attempt stalled on a malformed periodic tool stream, with usage unavailable. The matched Medium off/auto pair passes 3/3 unchanged checks within the five-file scope. Auto selects Massive/four workers/V2 and dispatches one independent reviewer; both conditions record four implementation workers running concurrently. Auto is slower and uses more reported tokens and cost in this pair. See [the results](phase9-evaluation.md#default-four-worker-policy-check-2026-10-04).

Repeat with the standalone command above, this packet path, `--thinking medium`, fresh output directories, and `--budget unbounded`. The retained `governor-parallel-migration-v1` three-consumer exploratory fixture and `governor-four-consumer-migration-v1` Low fixture are diagnostics, not additional matched comparisons.

The optional-strategy variant, `governor-autonomous-migration-v1`, keeps the four consumers and three checks but leaves delegation open. Both matched Luna Low runs pass within scope and complete directly. Auto reassesses Normal/V1 to Complex/V2 after five edits, while respecting the Low ceiling and suggesting zero workers. This packet demonstrates a completed Low migration and runtime reassessment, with no autonomous delegation observed. Use `--thinking low` to repeat it. [Results and limits](phase9-evaluation.md#optional-migration-strategy-at-luna-low-2026-10-04) are retained; subsequent delegation evaluation should use representative repository work rather than further variants of this tiny migration.

## Baseline state

Three upstream/Pi Forge task-outcome pairs have been run for each of the six synthetic packets, and all 36 runs passed the independent tests and changed-file scope check. Three real-repository tasks passed six matched pairs total; each passed its tests and stayed within its reviewed file scope. The context-notes task has two successful long-run pairs. An earlier attempted pair was invalid: OMP failed three acceptance tests, while Pi Forge was blocked before implementation by a provider usage limit. That failed attempt is excluded from matched outcome totals. A bounded Pi Forge-only Governor comparison also ran three synthetic tasks once in `off` and `auto` modes under per-run token and time caps; it recorded decisions only on the migration and never dispatched workers. A later real-repository attempt declared four tasks and high risk, but auto routing deferred the task call and both capped runs ended before implementation. Its acceptance results were invalid because the runner failed to link workspace dependencies; the runner fix is verified, but the model runs have not been repeated. These attempts are harness and orchestration telemetry, not Governor performance results. Outcomes and limits are documented in [the Phase 9 evaluation](phase9-evaluation.md). Real-repository Governor calibration remains open. The offline prompt fixtures and paired authenticated first-turn input comparison documented in [the architecture baseline](architecture-baseline.md) measure setup input, not task completion.

The repeatable first-turn fixture is `packages/coding-agent/bench/fixtures/phase0-first-turn.md`. Run it with `bun packages/coding-agent/bench/prompt-baseline-live.ts` in a clean checkout with provider access. The script records local prompt/schema counts and provider-reported input, cache, output, and stop-reason fields. The Phase 0 run used one request per checkout; repeat runs and broader coding-task measurements remain follow-up evaluation.
