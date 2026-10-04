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

| Run | Result | Total tokens | Cost (USD) | Wall time (s) | Assistant turns |
| --- | --- | ---: | ---: | ---: | ---: |
| OMP first run | Pass; 43 tests; scoped after review | 7,163,604 | 5.405497 | 600.70 | 91 |
| Pi Forge first run | Pass; 43 tests; scoped after review | 2,862,785 | 2.227969 | 374.58 | 53 |
| OMP attempted repeat | Fail; 40/43 tests | 3,860,271 | 3.359850 | 308.71 | 67 |
| Pi Forge rerun | Pass; 43 tests; scoped | 3,212,514 | 3.034080 | 419.77 | 56 |

Comparing the latest passing Pi Forge run with OMP's passing first run, Pi Forge used 55% fewer tokens, cost 44% less, and finished 30% faster. The first passing Pi Forge run used 60% fewer tokens, cost 59% less, and finished 38% faster than that same OMP run. OMP reached the configured 10-minute limit; Pi Forge finished in about 6 minutes 15 seconds and 7 minutes. These are one successful OMP run and two successful Pi Forge runs, not repeated matched pairs, so they are suggestive rather than conclusive.

The original manifest required an exact 12-file set, which incorrectly marked the first runs out of scope: OMP touched two related session-statistics files omitted from that list, while Pi Forge changed only three files. We preserved the raw summary and revalidated both changed-file sets against the corrected `allowedChangedFiles` scope; all paths are allowed. The corrected scope behavior is covered by the runner integration test. The successful first-run artifacts and scope re-evaluation are under `/tmp/pi-forge-context-notes`; the failed OMP repeat is under `/tmp/pi-forge-context-notes-repeat`; the Pi Forge rerun is under `/tmp/pi-forge-context-notes-piforge-repeat`.

A separate matched-repeat attempt remained inconclusive. OMP failed three relevance-ordering tests. Pi Forge could not start because the provider returned `usage_limit_reached`; its acceptance command then reported unresolved workspace aliases, so it produced no code outcome. After the quota reset, the Pi Forge-only rerun above passed. OMP still needs a successful counterpart rerun before these newer results form a matched repeat.
