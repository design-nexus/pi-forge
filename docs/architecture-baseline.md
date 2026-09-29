# Pi Forge architecture and evaluation baseline

Checked on 2026-09-28 at `945dd4647f` (`feat/prompt-profiles`) against the locally pinned `upstream/main` at `7853b4e499`. This records the checkout, not a claim about the current upstream tip. The working tree also contains uncommitted Governor task-fact routing and user-edited plan documents. For the detailed source trace and earlier measurements, see [the Phase 0 analysis](omp2/ARCHITECTURE_ANALYSIS.md), [the current checkout inventory](omp2/CHECKOUT_INVENTORY.md), and [the Phase 1 report](omp2/PHASE1_REPORT.md).

## Existing execution path

| Area | Reusable OMP/Pi Forge primitive | Remaining adaptive integration |
| --- | --- | --- |
| Prompt and capabilities | `system-prompt.ts` renders static Markdown; `prompt-engine/compose.ts` attaches section identity and profile policy; `SessionTools` commits tool and prompt changes together. Skills and `xd://` provide discovery. | Route task evidence to capabilities beyond direct tool promotion; measure task outcomes. |
| Session and model control | `AgentSession`, layered `Settings`, catalog-backed model roles, effort ceilings, and model-switch listeners. | Connect a Governor decision to bounded execution choices while preserving user selections. |
| Governor | Opt-in pure policy, live preview, versioned persisted revisions, and a structured task-transition API. | Obtain authoritative task facts from a planner/runtime; reassess with progress and verification evidence. Current default is off. |
| Context | Context files, notes, memory backend, compaction, handoff, and turn recovery. | One sourced, budgeted working set with retention rules and provenance. |
| Orchestration | `task` agents, worktree isolation, workpool, advisor, and `/review`. | A coordinator, dependency graph, integration gate, and role dispatch bound by Governor limits. |
| Verification | Existing package checks, test runner, tool results, and review commands. | Typed check evidence, adaptive tiers, and finite repair state. |
| Telemetry and evaluation | Prompt inspection, local token estimates, provider usage on completed messages, offline prompt fixtures, and a prior authenticated first-turn comparison. | Matched OMP/Pi Forge task runs with correctness, latency, cost, intervention, and small-task regression metrics. |

The prompt path is discovery/settings → tool registry → `sdk.ts` prompt rebuild → `SessionTools` commit → `Agent` provider call. Provider adapters serialize ordered prompt blocks and tool schemas. The Governor currently observes resolved session/model/tool state; it does not choose a model, invoke a worker, or change verification. `routeGovernorTaskTransition()` can promote the existing `task` tool only when called with structured facts and an eligible parallel decision. No ordinary chat message supplies those facts.

## Baseline measurements

`bun packages/coding-agent/bench/prompt-profiles.ts` was rerun on this checkout with the bundled `openai/gpt-4o-mini` tokenizer. It uses seven synthetic workload/tool fixtures and reports prompt **text** tokens; provider input and task success are intentionally `null`. The initial Full/Coding/Agentic count is 1,809 tokens and Minimal is 1,667. The task-agent fixture peaks at 2,005 for Full/Coding/Agentic and 1,863 for Minimal. These values omit real project context and provider tool framing.

The earlier authenticated single-turn comparison in [the Phase 1 report](omp2/PHASE1_REPORT.md) reported provider input tokens of 12,896 Full, 12,079 Minimal, 12,284 Coding, and 12,916 Agentic on `openai-codex/gpt-5.5`. It was one fixed prompt in one environment, so it is an input-size observation, not a coding-performance baseline. No matched upstream/Pi Forge task-outcome result has been recorded yet.

## Phase status against the revised plan

| Phase | Status | Evidence and next dependency |
| --- | --- | --- |
| 0: inventory and baseline | **IN PROGRESS** | Architecture and prompt-token inventory exist. Freeze a task corpus and run a matched upstream/Pi Forge outcome baseline. |
| 1: Prompt Engine | **IN PROGRESS** | Profiles, overrides, commands, inspection, and lifecycle tests exist. Material token reduction and coding non-regression remain unproven. |
| 2: Capability Router | **IN PROGRESS** | Direct tool catalog and opt-in delegation routing exist. Browser/MCP runtime gates, automatic task signals, and lifecycle telemetry remain open. |
| 3: Adaptive Effort Governor | **IN PROGRESS** | Opt-in decisions, session snapshots, revision triggers, and bounded worker/context policy exist. Model-role selection is inspectable but not dispatched. Verification floors are provisional labels. |
| 3B–9 | **PLANNED / UPSTREAM REUSE** | The primitives above can be reused; adaptive feedback, working set, orchestration, integration, verification, repair, and matched evaluation remain to be connected. |

## Evaluation contract to establish next

Freeze the same repository snapshot, task prompt, model/provider, budgets, and acceptance checks for A (upstream OMP) and B (Pi Forge). Run each in a fresh isolated checkout and capture provider input/output/cache usage, elapsed time, tool calls, tests, diff, human intervention, and final acceptance. Include trivial tasks so overhead regressions are visible. Record failures and incomplete runs rather than discarding them. The existing prompt fixture is a setup-cost probe and cannot substitute for this task outcome baseline.
