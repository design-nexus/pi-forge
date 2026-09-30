# Phase 9 initial matched evaluation

## Scope

This is the first task-outcome comparison between upstream OMP and Pi Forge. It is a repeatability check for one frozen tiny-edit task, not a broad coding-quality result. The other categories in the [task corpus](benchmark-corpus.md) still need executable packets and evaluation.

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

The initial runner output and transcripts were kept under `/tmp/pi-forge-phase9/three-pairs` during validation. They are not committed because the report above records the reviewed aggregate and the provider transcript may contain task context. Future corpus packets should retain their raw run artifacts with the evaluation dataset.

## Phase 9 decision

No policy tuning was made from this sample. The task validates that the full run-and-check loop works and supplies a starting task-outcome baseline; it does not isolate a stable bottleneck in Governor, context, verification, or repair behavior. Broader evaluation across the corpus remains necessary before making system-wide performance claims or tuning those policies.
