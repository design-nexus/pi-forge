# Phase 9 initial matched evaluation

## Scope

This report records matched task-outcome comparisons between upstream OMP and Pi Forge across six frozen synthetic task packets. Each packet ran three times per system with alternating order. All 36 runs passed their independent tests and changed only the permitted files. These results are useful for repeatability and task-shape coverage, but they are not a broad real-repository coding-quality result.

| Setting | Value |
| --- | --- |
| Upstream OMP | `7853b4e499936f9dcc13c9b64adb55f6b342aabf` |
| Pi Forge | `39d676b3c5d5646713005c2671ce6268ac501c78` |
| Model | `openai-codex/gpt-5.5` |
| Packet | `prompt-profile-retry-delay-v1` from `04be5042c836ff72df1149653c0bd9097393ce8a` |
| Runs | Three per system; execution order alternated |
| Conditions | Auto-approve, no session persistence, 10-minute limit |
| Acceptance | `bun test`; only `src/retry-delay.ts` may change |

## Results

All six runs exited successfully, passed the same two tests (nine assertions), and changed only the permitted file. No human intervention was needed.

| Pair | System | Total tokens | Cost (USD) | Wall time (s) |
| --- | --- | ---: | ---: | ---: |
| 1 | OMP | 34,007 | 0.071193 | 18.60 |
| 1 | Pi Forge | 35,036 | 0.077138 | 19.58 |
| 2 | OMP | 34,849 | 0.050759 | 19.24 |
| 2 | Pi Forge | 35,418 | 0.103917 | 18.11 |
| 3 | OMP | 34,941 | 0.082221 | 23.65 |
| 3 | Pi Forge | 34,480 | 0.077891 | 17.84 |
| **Mean** | **OMP** | **34,599** | **0.068058** | **20.50** |
| **Mean** | **Pi Forge** | **34,978** | **0.086315** | **18.51** |

Across these three tiny-edit pairs, Pi Forge averaged 1.1% more total tokens, 26.8% more provider-reported cost, and 9.7% less elapsed time. The per-run costs vary substantially, and three repetitions of one task are too little evidence to attribute those differences to a feature or to claim a general performance change. Input, output, cache-read, and cache-write fields are retained in each raw JSONL transcript for re-analysis.

## Evaluation tooling

Run `bun packages/coding-agent/bench/task-outcome-ab.ts` with `--omp-cli`, `--piforge-cli`, and `--out`. The packet manifest freezes its task, acceptance command, allowed changed files, source fixture commit, and repeat count. The runner starts a clean directory for each attempt, alternates which system runs first, captures provider usage and tool calls, executes acceptance independently, and rejects runs that modify files outside the declared scope. Pass `--omp-revision` and `--piforge-revision` to include checkout revisions in the generated summary.

The initial runner output and transcripts were kept under `/tmp/pi-forge-phase9/three-pairs` during validation. They are not committed because the report above records the reviewed aggregate and the provider transcript may contain task context. Future matched runs should retain their raw run artifacts with the evaluation dataset.

## Phase 9 decision

The tiny-edit packet validates that the full run-and-check loop works and supplies a starting outcome baseline; it does not isolate a stable bottleneck in Governor, context, verification, or repair behavior. The other five packets broaden task-shape coverage, but small synthetic fixtures do not establish long-horizon or real-repository performance. No policy tuning or system-wide performance claim is justified by this corpus.

## Additional matched packets (2026-09-30)

The five additional packets used `openai-codex/gpt-5.5`, three runs per system, alternating execution order, auto-approval, a fresh workspace and session directory for each run, and a 10-minute limit. The OMP revision was `7853b4e499936f9dcc13c9b64adb55f6b342aabf`; Pi Forge was `f5f794e24790ae2e100a45b9d4771e1cf483158e`. All runs exited successfully, passed their acceptance tests, and changed exactly the files listed in each manifest.

| Packet | System | Mean total tokens | Mean cost (USD) | Mean wall time (s) | Passes |
| --- | --- | ---: | ---: | ---: | ---: |
| `session-lifecycle-v1` | OMP | 85,290 | 0.134362 | 48.61 | 3/3 |
|  | Pi Forge | 72,389 | 0.127599 | 44.43 | 3/3 |
| `cross-package-contract-v1` | OMP | 53,011 | 0.083147 | 21.73 | 3/3 |
|  | Pi Forge | 60,873 | 0.092830 | 25.23 | 3/3 |
| `decomposable-migration-v1` | OMP | 81,604 | 0.133812 | 49.44 | 3/3 |
|  | Pi Forge | 88,697 | 0.127343 | 41.32 | 3/3 |
| `unexpected-scope-v1` | OMP | 38,532 | 0.078682 | 21.12 | 3/3 |
|  | Pi Forge | 38,652 | 0.078155 | 24.23 | 3/3 |
| `overestimated-scope-v1` | OMP | 52,519 | 0.090663 | 25.67 | 3/3 |
|  | Pi Forge | 55,988 | 0.082176 | 25.64 | 3/3 |

On session lifecycle, Pi Forge averaged 15.1% fewer total tokens, 5.0% lower reported cost, and 8.6% less wall time. On the cross-module contract, it averaged 14.8% more tokens, 11.6% higher cost, and 16.1% more time. On the four-file migration, it averaged 8.7% more tokens, 4.8% lower cost, and 16.4% less time. On unexpected scope, token use and cost were effectively even (+0.3% tokens, -0.7% cost), while Pi Forge took 14.7% longer. On overestimated scope, Pi Forge used 6.6% more tokens, 9.4% lower cost, and essentially the same time. Combined with the tiny-edit result above, the six task shapes produce mixed tradeoffs rather than a consistent winner. Three repetitions of each synthetic task are too few to establish a stable system advantage.

Raw runner summaries and transcripts are in `/tmp/pi-forge-phase9/<packet-id>` for local re-analysis. They are not committed because transcripts contain task context.

## Real repository smoke pair (2026-09-30)

The new repository mode created isolated VCS worktrees from the same upstream commit, linked the checkout dependencies and native addon, overlaid a fixed task and regression test, removed those support files before scope checking, and saved each final patch before removing its worktree. The task fixed compiled Linux Chromium wrapper discovery in `packages/coding-agent/src/tools/browser/attach.ts`. Both implementations passed the same focused regression test and changed only that production file.

| System | Total tokens | Cost (USD) | Wall time (s) | Assistant turns | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| OMP | 558,418 | 0.544533 | 95.86 | 20 | Pass; one expected file |
| Pi Forge | 486,601 | 0.480629 | 67.72 | 19 | Pass; one expected file |

This is one paired run of one narrow regression task. It demonstrates that the runner can evaluate a real repository patch and verify its scope; it does not establish a general performance advantage. Raw artifacts, including the final diffs, are under `/tmp/pi-forge-real-repo-verified` and are not committed.

The repository mode is selected with `--repository <git-checkout>`; the manifest `sourceCommit` pins each worktree. `supportFiles` maps worktree-relative overlay paths to files in the packet. The runner removes these overlays before collecting tracked and untracked changed paths, captures `final.diff`, and removes the worktree.

For focused bug packets, `expectedChangedFiles` requires the exact changed-file set. Larger features may use `allowedChangedFiles`, which permits any nonempty subset while rejecting paths outside the declared scope. This keeps the check useful when several implementation layouts satisfy the same tests.

## Second real repository task: three matched pairs (2026-10-03)

The Bash verification task added an opt-in `verification` result to foreground Bash commands, covering successful exit, nonzero exit, ordinary-command compatibility, and rejection of async or service mode. Both systems passed the same two focused tests and changed only `packages/coding-agent/src/tools/bash.ts`.

| Pair | System | Total tokens | Cost (USD) | Wall time (s) | Result |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | OMP | 845,166 | 0.766407 | 95.48 | Pass; one expected file |
| 1 | Pi Forge | 739,114 | 0.645870 | 81.45 | Pass; one expected file |
| 2 | OMP | 502,039 | 0.507481 | 65.05 | Pass; one expected file |
| 2 | Pi Forge | 420,452 | 0.451616 | 33.71 | Pass; one expected file |
| 3 | OMP | 478,256 | 0.477080 | 57.84 | Pass; one expected file |
| 3 | Pi Forge | 565,022 | 0.530705 | 63.42 | Pass; one expected file |
| **Mean** | **OMP** | **608,487** | **0.583656** | **72.79** | **3/3** |
| **Mean** | **Pi Forge** | **574,863** | **0.542730** | **59.53** | **3/3** |

Pi Forge averaged about 5.5% fewer tokens, 7.0% lower reported cost, and 18.2% less elapsed time. The third pair went the other way on all three measures, so the spread across runs remains substantial. Together with the single Chromium wrapper pair, this confirms the runner on two production areas but is still too little task diversity for general claims or policy tuning. Raw artifacts and final diffs are under `/tmp/pi-forge-bash-verification-repeat`.

## Long autonomous feature task (2026-10-03 to 2026-10-04)

The context-notes feature task exercised session-journal persistence, branch and compaction behavior, context assembly, tool permissions and results, and context usage reporting across coding-agent and TUI. Each system had a 10-minute limit and received the same frozen suite: 43 tests and 121 assertions across the two packages.

| Run | Result | Input + output | Cache read | Reported total tokens | Cost (USD) | Wall time (s) | Assistant turns |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OMP first run | Pass; 43 tests; scoped after review | 258,260 | 6,905,344 | 7,163,604 | 5.405497 | 600.70 | 91 |
| Pi Forge first run | Pass; 43 tests; scoped after review | 116,417 | 2,746,368 | 2,862,785 | 2.227969 | 374.58 | 53 |
| OMP attempted repeat | Fail; 40/43 tests | 214,831 | 3,645,440 | 3,860,271 | 3.359850 | 308.71 | 67 |
| Pi Forge rerun | Pass; 43 tests; scoped | 212,194 | 3,000,320 | 3,212,514 | 3.034080 | 419.77 | 56 |
| OMP successful repeat | Pass; 43 tests; scoped | 261,632 | 3,913,728 | 4,175,360 | 3.710949 | 433.72 | 74 |

The latest successful repeat pair compares OMP's successful repeat with the Pi Forge rerun: both passed 43 tests and stayed in scope. Pi Forge used 23% fewer reported total tokens, 19% fewer input-plus-output tokens, cost 18% less, and finished 3% faster. In the first successful pair, Pi Forge used 60% fewer reported total tokens, cost 59% less, and finished 38% faster than OMP. OMP's first run came close to its 10-minute limit; later successful runs finished in about 7 minutes. Cache reads account for most of the reported total in every run, so the table shows input-plus-output and cache-read tokens separately. These two pairs favor Pi Forge on this packet, but are too few to establish a general advantage.

The original manifest required an exact 12-file set, which incorrectly marked the first runs out of scope: OMP touched two related session-statistics files omitted from that list, while Pi Forge changed only three files. We preserved the raw summary and revalidated both changed-file sets against the corrected `allowedChangedFiles` scope; all paths are allowed. The corrected scope behavior is covered by the runner integration test. The successful first-run artifacts and scope re-evaluation are under `/tmp/pi-forge-context-notes`; the failed OMP repeat is under `/tmp/pi-forge-context-notes-repeat`; the Pi Forge rerun is under `/tmp/pi-forge-context-notes-piforge-repeat`.

A separate matched-repeat attempt remained inconclusive. OMP failed three relevance-ordering tests. Pi Forge could not start because the provider returned `usage_limit_reached`; its acceptance command then reported unresolved workspace aliases, so it produced no code outcome. After quota was restored, Pi Forge passed the task, followed by the successful OMP counterpart reported above.

## Bounded Governor calibration first pass (2026-10-04)

This first pass compares the same Pi Forge revision (`9b60b27931`) with `adaptive.mode=off` and `adaptive.mode=auto` on three frozen synthetic tasks: a tiny edit, a normal session lifecycle change, and a four-file migration. Each condition ran once using `openai-codex/gpt-5.5`. Each run had a 180-second wall-time cap and a 250,000 reported-token cap. None reached either cap. The six runs used 390,197 reported tokens, cost $0.671483, and took 183.42 seconds in total.

| Task | Mode | Result | Governor decisions | Reported tokens | Cost (USD) | Wall time (s) |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Tiny retry-delay edit | Off | Pass; 2 tests; scoped | None | 35,866 | 0.071418 | 19.56 |
| Tiny retry-delay edit | Auto | Pass; 2 tests; scoped | None | 43,097 | 0.086391 | 18.04 |
| Session lifecycle | Off | Pass; 4 tests; scoped | None | 60,762 | 0.096098 | 31.06 |
| Session lifecycle | Auto | Pass; 4 tests; scoped | None | 78,227 | 0.148405 | 39.59 |
| Four-file migration | Off | Pass; 2 tests; scoped | None | 75,859 | 0.121961 | 39.10 |
| Four-file migration | Auto | Pass; 2 tests; scoped | Initial complex decision, later scope revisions; zero workers | 96,386 | 0.147210 | 36.08 |

All six runs passed their acceptance tests and changed only the expected files. Auto mode used more tokens and cost more in all three pairs. It was faster on the tiny edit and migration, and slower on the lifecycle task. The migration recorded a complex decision with a V2 verification floor, then later scope revisions; every decision selected zero workers. No run invoked the task tool, so this pass did not exercise adaptive delegation, reviewer dispatch, or worker verification. These small synthetic tasks show the Governor settings are read and decisions are recorded, but do not show a quality benefit. Raw summaries are under `/tmp/pi-forge-governor-calibration`.

The benchmark runner now accepts `--adaptive-mode`, `--token-cap`, `--time-cap-seconds`, and `--repeat-count`, and records Governor decision snapshots plus cap termination. Its focused tests verify that the temporary settings overlay is applied and removed, and that a run stops when accumulated persisted token usage reaches its cap.

## Real-repository Governor delegation attempt (2026-10-04)

This attempt reused the frozen 43-test context-notes feature task and asked for four ownership-scoped implementation tasks. The task described journal persistence and private notes as high risk and set `highRisk: true` when the field was available. Both Pi Forge runs used `openai-codex/gpt-5.5`, the same pinned source commit (`7853b4e499936f9dcc13c9b64adb55f6b342aabf`), and 250,000 reported-token / 180-second caps.

| Mode | Outcome | Governor decision | Reported tokens | Cost (USD) | Wall time (s) |
| --- | --- | --- | ---: | ---: | ---: |
| Off | Stopped at token cap before implementation; acceptance could not resolve workspace aliases | None | 272,500 | 0.744993 | 52.28 |
| Auto | Stopped at token cap; high-risk task call was deferred, no worker results or code changes | Normal, 0 workers, V1 floor | 284,671 | 0.487147 | 97.75 |

The auto transcript shows the four-item batch and high-risk flag reached the task tool. The task call returned “Task routing is waiting for the current provider turn to finish” and produced no worker results. This is a concrete blocker to measuring Governor-selected delegation in this path. The token cap was exceeded by 9–14% because persisted usage arrives in model-response chunks and the runner can only stop after the next usage record is written.

The acceptance failures exposed a separate runner setup bug: `Bun.file(...).exists()` did not detect the repository's `node_modules` directory, so the pinned worktree received no dependency links. The runner now builds worktree-local package links and its focused four-test suite passes, including a runtime import check from a pinned worktree. The two model runs above predate that fix, so their acceptance results are invalid and are retained only as bounded orchestration telemetry. No code-quality or cost comparison can be drawn from this attempt. Raw run artifacts are under `/tmp/pi-forge-governor-real-context-notes-off` and `/tmp/pi-forge-governor-real-context-notes-auto`.

The deferred route transition was traced to a timing gap: the session could still report provider streaming after the response had settled and an ordinary tool had begun executing, before the corresponding session state event updated pending tool-call state. The agent loop now reports ordinary tool execution synchronously, and the session permits routing during that execution window. The regression and related Prompt Engine, task-spawn, workpool, runner, and context-notes suites pass together (284 tests). A completed provider run has not yet verified the fix.

### Uncapped LM Studio attempts (2026-10-04)

These exploratory runs do not count as implementation or outcome results. The Ternary Bonsai `off` run and Qwopus `off` run were manually stopped while model generation was still active; neither reached acceptance testing. Gemma 4 12B `off` and `auto` attempts, and the Qwopus `auto` attempt, failed before tool use because LM Studio's `llama-server` aborted while loading the model. The harness then ran the acceptance command against the unchanged starting worktree, where 17 of 43 tests fail by design. No code-quality or Governor comparison can be drawn. The current checkout's supplied acceptance suite passes independently (43/43). Run artifacts are under `/tmp/pi-forge-governor-local-context-notes-off`, `/tmp/pi-forge-governor-gemma-context-notes-off`, `/tmp/pi-forge-governor-gemma-context-notes-auto`, `/tmp/pi-forge-governor-qwopus-context-notes-off`, and `/tmp/pi-forge-governor-qwopus-context-notes-auto`.

### Hosted Governor retry after routing fix (2026-10-04)

The same real-repository packet was retried with `openai-codex/gpt-5.5`, a 10-minute wall-time ceiling, and a 5-million-token ceiling. Governor `auto` advanced from its initial normal/zero-worker decision to massive/four-worker decisions at V3 and then V2. This confirms the task transition was no longer deferred and the high-risk batch reached worker dispatch. The run stopped at the token ceiling after 220.07 seconds with 5,077,321 reported tokens and $5.192157 in reported cost; it had made no workspace changes when stopped. The harness ran the acceptance command on the unchanged starting snapshot, where 17 of 43 tests fail. This is routing telemetry only, not a coding outcome. An `off` attempt with a 1-million-token ceiling also stopped before edits (1,029,527 reported tokens, 70.01 seconds, $1.634030). A larger `off` attempt was started, but its summary was not retained, so no figures are reported for it. The auto run summary is under `/tmp/pi-forge-governor-hosted-context-notes-auto-full`; the first off run is under `/tmp/pi-forge-governor-hosted-context-notes-off`.

### Compact Luna Low Governor check (2026-10-04)

The `governor-compact-notes-v1` packet tests two independent source fixes and their existing integration consumer in a standalone fixture. Both matched runs used the same clarified task, GPT-6 Luna Low, one repetition, and no token or time cutoff. Persisted parent and both worker sessions show only `openai-codex/gpt-6-luna` and Low thinking. The harness ran from working HEAD `9b60b27931c03553a4f2fa29e3e8d89b13949a54` with the uncommitted routing fix; this was not a pinned clean harness revision. Source and packet hashes and all three attempt summaries are retained in [the evidence file](benchmark-results/governor-compact-notes-2026-10-04.json).

| Mode | Acceptance / scope | Actual worker sessions | Reported tokens | Cached input tokens | Cost (USD) | Wall time (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Off | 6/6; only two allowed source files changed | 2 | 117,418 | 90,112 | 0.004044 | 34.20 |
| Auto | 6/6; only two allowed source files changed | 2 | 140,844 | 99,328 | 0.005638 | 31.54 |

Auto recorded initial and scope decisions at Normal, zero suggested workers, and V1. The explicit two-item delegation was still honored and both workers completed; suggested worker count is not actual dispatch count. No deferred-routing error occurred. This verifies successful execution through the repaired task-routing path, including worker results and final integration. It does not demonstrate Governor-selected parallelism or large-task calibration.

In this single pair, auto used 20.0% more reported tokens and 39.4% more reported cost, while finishing 7.8% sooner. Most reported tokens were cached input; totals include root and worker usage. These rates are telemetry reported by the harness, not measurements of subscription quota consumption. One small pair is insufficient to conclude that auto improves performance.

The first exploratory off run is excluded because a worker changed the protected acceptance test, even though the modified suite passed. It used 141,385 reported tokens, $0.005821, and 37.59 seconds. The read-only test restriction was repeated in each worker assignment before both matched runs. All three attempts together used 399,647 reported tokens and $0.015502. The two matched workspace artifacts are under `/tmp/pi-forge-compact-notes-off-reviewed` and `/tmp/pi-forge-compact-notes-auto-reviewed`; the excluded attempt is under `/tmp/pi-forge-compact-notes-off`.

### Optional delegation and de-escalation check (2026-10-04)

The next packet retains the same starting source files and six acceptance checks, but removes the required delegation batch. It asks for the two fixes and leaves execution strategy open. A Low attempt streamed a malformed custom tool call beginning with `*** Begin Patch`, followed by 20,314 repeated section-sign characters, without completing a single assistant response or executing a tool. It was manually interrupted. No session usage record was produced, so its token count and cost are unknown, not zero. The partial stream remains under `/tmp/pi-forge-autonomous-notes-off/piforge-1-k1SUog/transcript.jsonl` and its diagnostic counts are retained with the results.

Both matched conditions then used the identical `governor-autonomous-notes-medium-v1` task and settings at **GPT-6 Luna Medium**, with one repetition and no token or time cutoff. All persisted assistant messages identify that model; the persisted thinking selector is Medium in both sessions. The runner now writes stdout to the transcript file while the child is active, allowing malformed streams to be inspected before completion. Its regression test requires the child to read its own emitted progress from the artifact before exiting. All six runner tests and `bun check` pass.

| Mode | Acceptance / scope | Actual workers | Reported tokens | Cached input tokens | Cost (USD) | Wall time (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Off | 6/6; only two allowed source files changed | 0 | 58,359 | 45,568 | 0.001943 | 25.26 |
| Auto | 6/6; only two allowed source files changed | 0 | 63,388 | 49,664 | 0.002090 | 21.44 |

Auto recorded Normal/V1, then de-escalated to Trivial/V0 as the todo scope shrank; every decision suggested zero workers, and none were dispatched. Off also completed directly. This demonstrates the conservative zero-worker policy and a scope-based de-escalation on a completed task. It does not prove the Governor caused the choice to avoid delegation, because the baseline made the same choice, or measure Governor-selected parallelism.

Auto used 8.6% more reported tokens and 7.6% more reported cost, while finishing 15.1% sooner. Off had one rejected edit using an invented file hash and then recovered by reading the file; auto had no error tool results. That difference and ordinary run variance prevent attributing the timing difference to the Governor. The matched pair totals 121,747 reported tokens and $0.004033, excluding the interrupted Low attempt whose usage is unavailable. The cost figures are harness telemetry, not subscription quota measurements.

The source remained working HEAD `9b60b27931c03553a4f2fa29e3e8d89b13949a54` plus uncommitted changes, including the live-transcript runner fix. [The evidence file](benchmark-results/governor-autonomous-notes-2026-10-04.json) records source/packet hashes, both summaries, and the excluded Low diagnostic. Raw matched artifacts are under `/tmp/pi-forge-autonomous-notes-medium-off` and `/tmp/pi-forge-autonomous-notes-medium-auto`. At the time of these runs, the Codex degeneracy guard handled whitespace loops but did not interrupt this repeated non-whitespace sequence.

### Repeated-character stream recovery (2026-10-04)

The transport guard now also detects a consecutive run of one non-whitespace character across at least 256 tool-input delta events and 1,024 UTF-16 code units. Both conditions must hold; a large repeated payload in one frame is allowed. A change of character, tool item, output index, or ordinary mixed-content delta resets the run. This is a malformed-stream safeguard, not a total token or time cutoff. Intentionally homogeneous content streamed in hundreds of tiny frames can also reach this boundary and be interrupted.

The existing recovery path drops the incomplete tool call, clears stale response state, and retries at most twice. It refuses replay when completed tool calls or visible text have already been delivered, preserving completed calls and surfacing the error instead of executing them again. The implementation uses the existing centralized loop-error class.

Four additional local regressions verify recovery from the malformed custom-tool prefix and section-sign flood seen in the Low attempt over SSE, bounded exhaustion for function arguments over WebSocket, successful delivery of a large single-frame payload followed by varied characters, and refusal to replay a later custom-tool flood after a completed tool call. The streaming and usage suites pass together (132 tests), and `bun check` passes. These checks use synthetic transport frames and zero provider requests; no new hosted benchmark result or subscription usage measurement is claimed.

### Default four-worker policy check (2026-10-04)

The frozen `governor-four-consumer-migration-medium-v1` packet changes a shared storage API and four independent consumers. It explicitly requests a four-item implementation batch, while leaving Governor thresholds, worker ceilings, verification bands, risk, and task concurrency at their defaults. Both matched conditions use GPT-6 Luna Medium, one repetition, and no token or time cutoff. The parent, implementation workers, and reviewer all record that model and effort.

| Mode | Acceptance / scope | Implementation workers / peak running | Review sessions | Reported tokens | Cost (USD) | Wall time (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Off | 3/3; five allowed source files | 4 / 4 | 0 | 212,025 | 0.007829 | 43.61 |
| Auto | 3/3; five allowed source files | 4 / 4 | 1 | 228,735 | 0.009378 | 48.96 |

Auto transitions from Normal/zero suggested workers/V1 to Massive/four suggested workers/V2. Worker progress marks a task running only after acquiring its concurrency slot; the recorded peak of four demonstrates concurrent execution. Auto also dispatches the independent Governor reviewer. Both conditions complete the migration within scope and pass the unchanged acceptance tests. This validates the default Governor parallel policy and review path on completed work. Because the task requests delegation and off also runs four workers, it does not demonstrate autonomous delegation or a performance improvement caused by parallelism.

Auto uses 7.9% more reported tokens, costs 19.8% more, and takes 12.3% longer in this single pair. The extra review is part of its overhead. The pair totals 440,760 reported tokens and $0.017207 in harness-reported cost; these figures do not measure subscription quota consumption. Larger repository calibration and repeat measurements remain open.

Two earlier Low attempts are retained separately. A three-consumer exploratory off run passes 2/2 checks but does not exercise the default four-independent-task threshold. The four-consumer Low attempt produces an unfinished custom tool input repeating ` **.**` across thousands of frames and is manually interrupted. It has no persisted usage record, so tokens and cost are unknown. Source and packet hashes, matched summaries, execution telemetry, and both exploratory diagnostics are in [the evidence file](benchmark-results/governor-four-consumer-2026-10-04.json). Matched raw artifacts are under `/tmp/pi-forge-four-consumer-medium-off` and `/tmp/pi-forge-four-consumer-medium-auto`.

### Periodic custom-tool stream recovery (2026-10-04)

The newly observed punctuation cycle extends the malformed-stream fix. Custom tool input now uses the existing exact-cycle detector with a maximum 32-character cycle, at least 1,024 repeated UTF-16 code units, and at least 256 input frames for the same tool item. Punctuation cycles are included. Function-call JSON retains the narrower repeated-character guard. This safeguard uses the existing two-retry recovery and refuses unsafe replay after completed tools or visible text; it imposes no total token or time cutoff.

Local SSE and WebSocket regressions verify recovery and bounded exhaustion for the periodic sequence. A valid large single-frame patch followed by hundreds of distinct lines is delivered intact. The streaming, usage, and existing thinking-loop suites pass together (176 tests). All transport frames are synthetic and make no provider requests. Intentionally repetitive custom input streamed in many small frames can reach this guard; the matched hosted results above predate this extension and do not verify its recovery against the live provider.

### Optional migration strategy at Luna Low (2026-10-04)

The `governor-autonomous-migration-v1` packet keeps the four-consumer source and three acceptance checks but leaves execution strategy open. Both modes use GPT-6 Luna Low, one repetition, and no token or time cutoff. The settings pin workers to Low if invoked; neither run invokes them. Every persisted assistant message identifies Luna, and both session thinking selectors remain Low.

| Mode | Acceptance / scope | Workers | Reported tokens | Cached input tokens | Cost (USD) | Wall time (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Off | 3/3; five allowed source files | 0 | 82,432 | 58,368 | 0.003354 | 31.43 |
| Auto | 3/3; five allowed source files | 0 | 53,383 | 41,984 | 0.001805 | 30.11 |

Auto starts Normal/V1, then reassesses to Complex/V2 after five files have been edited. Its evidence records that edits widened the task scope; it still suggests zero workers because no independent batch is declared. The explicit Low effort ceiling remains authoritative. Both runs execute directly, pass the unchanged checks, stay in scope, and finish with no human intervention or error tool results. Neither exhibits the malformed stream from the earlier Low attempts.

Auto uses 35.2% fewer reported tokens, costs 46.2% less, and finishes 4.2% sooner in this single pair. Off uses ten assistant turns and thirteen tool calls; auto uses seven turns and ten tool calls. This is a successful Low comparison and observed runtime reassessment, not proof of a causal Governor benefit or autonomous delegation. These tiny migrations can be completed directly, so further forced or optional variants of the same task would add little evidence. Autonomous delegation on representative repository work remains unmeasured.

The pair totals 135,815 reported tokens and $0.005159 in harness-reported cost. Cost is not subscription quota usage. [The evidence file](benchmark-results/governor-autonomous-migration-2026-10-04.json) retains source/packet hashes, both summaries, resolved model/effort, and complete Governor records. Raw artifacts are under `/tmp/pi-forge-autonomous-migration-low-off` and `/tmp/pi-forge-autonomous-migration-low-auto`. Runtime hashes describe the implementation before the subsequent guard boundary correction.

### Complete-delta boundary for periodic recovery

A local regression exposed a false interruption: after hundreds of ordinary custom-input frames, one large repeated payload could satisfy the total frame count. The exact-cycle detector now requires its repeated suffix to cover the last 256 complete nonempty deltas, as well as the 1,024-character minimum. Ordinary earlier frames cannot qualify a later single-frame payload. The regression first failed with three requests instead of one; after correction, a valid patch with its large payload either before or after 600 distinct streamed lines is delivered byte-for-byte with one request. Persistent periodic floods still recover or exhaust their bounded retry allowance. The combined streaming, usage, and thinking-loop suites pass (177 tests); these checks use synthetic transports without provider requests.

### Repository Bash contract at Luna Low (2026-10-04)

The first completed repository Governor pair uses `governor-bash-verification-v1` against frozen upstream revision `7853b4e499936f9dcc13c9b64adb55f6b342aabf`. The executing CLI and harness are committed Pi Forge revision `8600f17c9f1a64ed041f6e846cd3a44939a77a29`. Both conditions run once with GPT-6 Luna Low, pin all model roles and generic workers to Low, and have no token or time cutoff. Only `packages/coding-agent/src/tools/bash.ts` may change. Both conditions complete without workers; persisted messages and thinking selectors confirm Luna Low.

| Mode | Original acceptance / scope | Supplemental audit | Reported tokens | Cached input tokens | Cost (USD) | Wall time (s) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Off | 2/2; one allowed source file | 1/2; ordinary commands regress | 271,708 | 234,496 | 0.006732 | 49.21 |
| Auto | 2/2; one allowed source file | 2/2 | 557,513 | 508,928 | 0.010931 | 76.66 |

The original support tests verify foreground success/failure metadata, absence of metadata on ordinary commands, and rejection of explicit async/service verification requests. Diff review found that off removed the `autoBgManager` declaration while retaining references in the ordinary auto-background path. A local audit replays each recorded patch through the existing isolated-worktree runner and invokes an ordinary command with auto-background enabled and no job manager. Off throws `ReferenceError: autoBgManager is not defined`; auto preserves that behavior. A second audit verifies timeout failure metadata and passes in both conditions. These audits make no model requests. Off's original acceptance pass is therefore incomplete, and this pair must not be described as two fully successful implementations.

Auto initially selects Normal/V1, de-escalates to Trivial/V0 as scope shrinks, then records a verification failure and returns to Normal/V2. Its first acceptance command fails, and it fixes the result before the final check passes. The explicit Low ceiling remains authoritative throughout. This provides completed repository evidence of failure-driven verification reassessment and recovery, but does not exercise the isolated-batch integration gate or bounded repair scheduler.

Auto uses 105.2% more reported tokens, costs 62.4% more, and takes 55.8% longer in this single pair. The pair totals 829,221 reported tokens and $0.017663 in reported cost; most tokens are cached input. Auto's implementation survives the additional regression audit, while off's does not. These results do not establish that the Governor caused the quality difference or a general performance advantage. Reported cost does not measure subscription quota usage.

The packet now includes both audit checks in its support files and acceptance command, so future runs use four tests. Local patch replay with the combined four-test command confirms off passes 3/4 and auto passes 4/4. The hosted pair used the original two-test manifest; both original manifests, packet hashes, summaries, final diffs, resolved model/effort, Governor snapshots, and local audit outcomes are retained in [the evidence file](benchmark-results/governor-bash-verification-2026-10-04.json). Original artifacts are under `/tmp/pi-forge-governor-bash-low-off` and `/tmp/pi-forge-governor-bash-low-auto`; local patch audits are under `/tmp/pi-forge-bash-audit`. The generated off patch is a benchmark artifact and has not been applied to the development checkout.

### Integration evidence and stagnation hardening

Local review found that a passing check followed by a null check entry could be accepted: the malformed-entry lookup returned null, which was then treated as no invalid evidence. The gate now tests whether any malformed entry exists and rejects that report. The regression fails before the correction and passes afterward.

The task-batch contract also exercises persistent identical integration failures through the actual gate scheduler and result mapping. With four attempts permitted and stagnation set to two, it invokes the integration worker only twice and returns structured unresolved status plus the repeated-failure budget error. The existing convergence case still retries and returns reconciled status with accumulated usage. The integration-gate and task-batch suites pass together (37 tests). Worker outcomes are supplied by local spies, so this verifies host scheduling and termination contracts with zero model calls; it does not establish model-driven repair convergence or actual patch integration quality.

### Real isolated patch integration with deterministic workers

The next local contract test runs the full task-batch pipeline in a detached repository worktree. Two deterministic worker executors write to real isolated copies; the production isolation runner captures their patches and the production merger applies them. Beta finishes and captures its patch before Alpha. A check of the parent files immediately before Beta merges proves Alpha's change is already present, demonstrating that completion order cannot override integration order.

After both patches merge, the integration worker invokes the fixture's real executable assertions. The first combined check fails because the consumer adds instead of multiplies. On the next gate attempt, the deterministic executor repairs the consumer, runs the same assertions, and reports success. The task returns reconciled status with one repair attempt. An independent final invocation confirms the parent files satisfy both positive and negative input contracts.

The task-batch, integration-gate, structured-subagent, and worktree suites pass together (121 tests). The test restores spies and removes its detached worktree. It uses the `integration-repair-local-v1` fixture and makes zero model calls. This closes local coverage of actual isolated patch capture, ordered application, combined verification, retry scheduling, and repaired filesystem state. Model-generated patches, model-driven repair decisions, and broader repository convergence rates remain unmeasured.

### Live isolated integration at Luna Low (2026-10-04)

The `governor-isolated-notes-v1` packet runs the compact labels/history fixes inside a detached repository checkout at `8600f17c9f1a64ed041f6e846cd3a44939a77a29`. It explicitly requests two independent isolated workers, enables patch application, and uses the rcopy backend with generic commit messages. All model roles, workers, and the integration gate are pinned to GPT-6 Luna Low. One auto-mode run uses no harness token or time cutoff; the product's default bounded repair policy remains unchanged.

The run passes all six unchanged acceptance tests, edits only the two allowed source files, and completes without human intervention. Both implementation workers produce applied patches. The integration gate executes the focused suite and returns a strict valid `verified` outcome at V1 with `repairAttempts: 0`. Persisted parent, two worker, and gate sessions all identify Luna and Low. Auto selects Normal/V1 with zero suggested workers; explicit delegation is honored.

The run reports 230,856 tokens (53,050 input, 1,678 output, 176,128 cached input), $0.007905 in cost, and 68.56 seconds. These figures include the parent, implementation workers, and gate. They are not a performance comparison or subscription quota measurement. The gate completes successfully on its first attempt, so live repair convergence remains unmeasured.

The executing CLI and harness use HEAD `8600f17c9f` plus the uncommitted integration-evidence validation correction. [The evidence file](benchmark-results/governor-isolated-notes-2026-10-04.json) retains source/packet hashes, the full summary, per-session usage and model/effort, task arguments, merge notices, gate outcome, and final diff. Raw artifacts are under `/tmp/pi-forge-isolated-notes-low-auto`. This verifies actual model-generated isolated patch integration and gate verification for one small synthetic contract in a repository checkout; autonomous delegation and broader repository repair calibration remain open.

### Controlled live repair exposed gate-report and retry failures

The `governor-isolated-repair-v1` variant deliberately asks the isolated History worker to inject a non-positive-limit defect. Shared context requires the gate to run the six unchanged checks before editing, repair history, and rerun the same suite. The parent may not repair source files. One auto-only Luna Low run keeps the default product repair budgets and uses no harness token or time cutoff.

The gate's actual first command reports four passes and two failures. It edits history and reruns the suite, which passes all six checks. It submits a strict valid reconciled report with one repair and both check outcomes. However, the host's outcome validator treats any historical failed check as still unresolved. The subsequent host retry hits `Agent "Integration gate" is already owned by another session generation` because the previous internal gate session remains alive. The gate background job therefore fails. Final independent source acceptance still passes 6/6 within scope; the harness's `passed` flag measures those source checks and scope, and must not be interpreted as successful repair orchestration.

This diagnostic run reports 267,417 tokens, $0.009997 in cost, and 78.95 seconds. [The retained evidence](benchmark-results/governor-isolated-repair-2026-10-04.json) includes original runtime/packet hashes, gate commands and results, submitted repair report, failed job result, final diff, and per-session model/effort/usage. All model sessions use Luna Low. Raw artifacts are under `/tmp/pi-forge-isolated-repair-low-auto`. This is controlled fault injection, not a natural failure-rate measurement or performance comparison.

The local fixes use the latest executed outcome for each exact command. A successful rerun resolves an earlier failure; an unrelated success or skipped rerun cannot hide it. Repair-budget failure accounting uses the same rule. The static gate prompt now requires exact command text, placing phase annotations in result descriptions, so reruns can be matched without guessing command equivalence. Internal gate workers are one-shot sessions and release their registry ownership before a fresh attempt; ordinary task workers retain their existing lifecycle.

Regressions reproduce the original validator rejection and task-level generation collision, then verify successful recovery and persistent-failure termination. An executor-level test also runs two one-shot generations under the same id and verifies the second can complete. The six related suites pass together (142 tests), and `bun check` passes.

### Corrected controlled repair succeeds at Luna Low

The corrected runtime and static prompt were then tested on the same controlled defect, with an explicit requirement to put phase annotations in result descriptions and repeat exact command text. One auto-only Luna Low run retains the default product repair budgets and has no harness token or time cutoff.

The gate's initial command again reports four passes and two failures. It repairs history and reruns the same command, which passes all six checks. This time the host accepts the strict valid reconciled outcome at V1 with one repair and preserves both check records. The background gate job completes successfully. Independent final acceptance also passes 6/6, and only the two allowed files change. Parent, both isolated workers, and gate use Luna Low; the parent performs no source edits.

The run reports 174,951 tokens (50,411 input, 1,660 output, 122,880 cached input), $0.007100 in reported cost, and 67.79 seconds. [Corrected-run evidence](benchmark-results/governor-isolated-repair-fixed-2026-10-04.json) retains runtime/packet hashes, the exact task, gate command output and repair, host-accepted job result, per-session usage/model/effort, and final diff. Raw artifacts are under `/tmp/pi-forge-isolated-repair-low-auto-fixed`. The original failed orchestration attempt remains separate.

This confirms live model-driven detection, focused repair, successful rerun, and host acceptance for one deliberately injected defect. The repair happens within the first gate invocation, so the live run does not exercise a second gate generation; that ownership regression is covered locally. Natural repair convergence rates, broader repository failures, and autonomous delegation remain unmeasured. No efficiency advantage is inferred from the diagnostic and corrected runs, and reported cost is not subscription quota usage.

### Benchmark acceptance now includes required orchestration

The isolated integration and repair packets now require a final parent `wait` snapshot with a completed host-accepted structured gate outcome. Repair additionally requires reconciled status and at least one repair. Independent source checks and scope remain required; passing them cannot mask a failed or missing gate. Reports expose `orchestrationPassed` and `orchestrationFailure`. These requirements are opt-in, so other packets retain their acceptance contracts.

An offline audit of retained parent sessions rejects the original failed repair run and accepts the corrected run. No model requests were made, and the original reports and packet hashes remain unchanged. See [the audit](benchmark-results/governor-integration-acceptance-audit-2026-10-04.json). Local harness regressions exercise failed jobs, missing parent completion, wrong status, insufficient repair count, and a successful retry following failure, while source acceptance passes in every case.

### Optional strategy on repository maintenance (2026-10-04)

The `governor-repository-maintenance-v1` packet combines two independent real repository fixes at frozen upstream revision `7853b4e499936f9dcc13c9b64adb55f6b342aabf`: compiled Chromium wrapper reuse and structured Bash verification. Execution strategy is optional; no worker count or task call is required. One auto-only run uses Luna Low for every role and has no harness token or time cutoff. Local baseline acceptance first records one pass and four failures; the Linux Chromium test runs without skipping.

The agent completes directly without workers, changes only the two permitted files, and passes the original five checks. Its first combined test command fails the browser check (4/5); it corrects the browser implementation and passes 5/5. Governor evidence records runtime pressure and repeated edit failures, reassessing Normal/V1 to Complex/V2 and then V3 after the declared verification failure, while preserving the Low ceiling. No independent reviewer or integration gate runs. This records adaptive reassessment and direct recovery, not autonomous delegation.

The run reports 1,895,178 tokens: 94,206 input, 5,388 output, and 1,795,584 cached input (94.7% of the total). Reported cost is $0.030070 and wall time is 181.55 seconds. It makes 45 assistant turns and 47 tool calls, including repeated edit-anchor retries and a failed API-source lookup. These figures show substantial interaction overhead for two small production changes; there is no off comparison or evidence that reassessment reduces spending. Reported cost does not measure subscription quota usage.

Patch review finds two untested Bash boundaries: explicit `verification: false` gains verification metadata, and explicit `async: false` rejects a foreground verification command. Offline replay with two additional contract checks confirms the generated implementation passes 5/7. The current development implementation passes the same seven checks as a positive control. The generated benchmark patch has not been applied to this checkout. Future packet acceptance includes all seven checks, and the task clarifies the explicit-false contract. No additional model calls were made for the audit or control.

[Retained evidence](benchmark-results/governor-repository-maintenance-2026-10-04.json) includes original and strengthened packet hashes, original report, full final diff, per-session model/effort/usage, Governor records, tool failures and check output, offline audit, and production control. Raw artifacts are under `/tmp/pi-forge-repository-maintenance-low-auto`, `/tmp/pi-forge-maintenance-audit`, and `/tmp/pi-forge-maintenance-control`. This is a mixed-quality calibration outcome, not a fully correct implementation or matched performance result. Autonomous delegation and broader natural repair convergence remain open.

### Edit retry audit and recovery guidance

An offline audit of the maintenance transcript counts eight failed tool results across 47 tool calls: five unseen-anchor refusals, one stale-tag refusal, one missing-path read, and one failed verification command. [The audit](benchmark-results/governor-edit-retry-audit-2026-10-04.json) classifies recorded errors; it does not attribute tokens causally to them. The edit refusals enforce intended safety contracts.

The compact edit prompt required a reread after every edit, while the full prompt already allowed response reuse. The candidate revision made both static prompts explain the existing safe recovery paths: take the latest response header and displayed numbers, use exact ranged reads for hidden anchors, retry a fully revealed unseen-anchor rejection only after checking its content, and reread truncated or unexpected content. No guard, snapshot validation, or edit policy is weakened. The full prompt is compiled into the native addon; the compact prompt is imported by the coding agent. Luna uses the full variant, so aligning the compact variant alone would not explain a future Luna improvement. At this preparation stage, hosted performance had not been measured. The completed comparison below rejects the candidate and restores the previous instructions.

The native addon rebuild succeeds with the repository-pinned nightly on PATH. All 23 focused edit and prompt-selection checks pass against the rebuilt addon. The first rebuild attempt selected Arch stable Rust and failed at the nightly-only `portable_simd` dependency; using the installed rustup shims fixes the toolchain selection without repository configuration changes.

### Matched edit-instruction measurement: revision rejected (2026-10-04)

A completed original/revised pair measures the proposed edit-recovery instructions on `governor-repository-maintenance-v1` using the same strengthened seven checks. Both use runtime commit `0fce7a9bbf`, the same native addon, a frozen source checkout, Luna Low for all roles, auto mode, and no harness token/time cutoff. Both conditions deliver their full edit descriptions through the same temporary static Markdown adapter; rendered bytes are verified before each run. Only that full prompt differs. Compact model policy remains unchanged. The original runs first, so provider caching and latency can affect comparison.

| Measurement | Original instructions | Revised instructions |
| --- | ---: | ---: |
| Acceptance / scope | 7/7; two allowed files | 7/7; two allowed files |
| Assistant turns | 79 | 116 |
| Tool calls | 78 | 113 |
| Unseen-anchor refusals | 7 | 6 |
| Total edit failures | 8 | 8 |
| Failed declared verification commands | 3 | 11 |
| Total failed tool results | 14 | 22 |
| Reported total tokens | 3,251,474 | 7,033,755 |
| Uncached input / output tokens | 103,338 / 7,528 | 213,934 / 12,269 |
| Cached input tokens | 3,140,608 | 6,807,552 |
| Reported cost (USD) | 0.045504 | 0.095603 |
| Wall time (seconds) | 259.30 | 639.72 |

The revision uses 116.3% more reported tokens, costs 110.1% more, and takes 146.7% longer. It reduces unseen-anchor refusals by only one and leaves total edit failures unchanged. Both runs complete directly without workers or human intervention. Both spend substantial effort implementing and repairing Chromium wrapper matching, with more failed verification commands in the revised run. These observations do not prove the prompt caused the additional coding failures, but provide no measured reason to adopt the change. The proposed full and compact recovery expansion is therefore reverted to the committed instructions.

[Retained pair evidence](benchmark-results/edit-recovery-prompt-pair-2026-10-04.json) includes both prompt texts and hashes, identical native-addon hash, frozen packet hashes, runtime revision, reproduction driver, both summaries, per-session model/effort/usage, Governor records, failed tool outputs, verification output, final diffs, and the rejection decision. Raw artifacts are under `/tmp/pi-forge-edit-measurements`. One pair is an observed result, not a statistically reliable general claim. Reported cost and cached tokens do not measure subscription quota usage. The old production instructions are retained.

### Evaluation decision

Pause hosted benchmarks and use Pi Forge during normal development. Earlier repository comparisons favor Pi Forge in several tasks, but small-task and Governor outcomes are mixed. The revised edit prompt is rejected. Collect task outcomes and persisted telemetry using [the real-work workflow](real-work-observation.md), then prioritize recurring problems and focused comparisons for concrete fixes. No consistent overall performance advantage is claimed.
