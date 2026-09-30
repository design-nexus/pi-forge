# Pi Forge checkout inventory and first hardening slice

Checked on 2026-09-26 against `feat/prompt-profiles` at `997c8df369` (`upstream/main` at `7853b4e499`). The branch is two commits ahead of upstream and its committed delta spans 25 files, chiefly the Prompt Engine. The root `PLAN.md` has user edits and `docs/omp2/PLAN.md` is untracked; neither was changed for this inventory. This report scopes the current checkout rather than treating the earlier Phase 0 report as current implementation evidence.

## Architecture map

| Responsibility | Current path and integration point |
| --- | --- |
| Settings and precedence | `config/settings.ts` `Settings.getProvenance()` and `setProjectValue()` resolve/report project and user layers; `prompt-engine/settings.ts` registers prompt settings. `sdk.ts` `cfgSystemPromptInputs.listen()` refreshes a live session. |
| Prompt construction | `sdk.ts` `rebuildSystemPrompt()` projects the current tool set and calls `system-prompt.ts` `buildSystemPrompt()`. That renders the existing Markdown template, then `prompt-engine/compose.ts` `composePrompt()` selects sections. `PROMPT_MODULES` and policies are in `profiles.ts`. |
| Session/model/tool lifecycle | `session/agent-session.ts` owns session overrides, `setModel()`, and `refreshBaseSystemPrompt()`. `session/session-tools.ts` stages/commits rebuilt prompts with tool registry changes, keeps composition history, and handles the prefix-bound model freeze. `tools/index.ts` `createTools()` and the tool registry enforce actual availability; prompt policy alone grants no tool. |
| SDK/RPC/ACP | All modes use the SDK session construction path. RPC exposes `session.systemPrompt` and calls `refreshRpcHostTools()` for host tool changes (`modes/rpc/rpc-mode.ts`); ACP reads the same effective session prompt (`modes/acp/acp-agent.ts`). Mode-specific prompt lifecycle coverage remains thin. |
| Skills/capabilities | `extensibility/skills.ts` `loadSkills()` uses capability discovery, exposes concise listings and `skill://` content, and resolves authored/managed names. `tools/xdev.ts` and `session-tools.ts` mount discoverable tools through `xd://`. |
| Context and continuity | `session/context-notes.ts` renders retained notes; `session/session-handoff.ts` generates handoffs; `session/turn-recovery.ts` handles retries/failures; `packages/agent/src/compaction/` budgets and summarizes history. `memory-backend/resolve.ts` chooses an existing memory backend. |
| Delegation and review | `task/index.ts` `TaskTool` dispatches native subagents; `task/worktree.ts` captures baselines and applies isolated changes; `task/workpool.ts` manages batches. `advisor/` provides passive review; `extensibility/custom-commands/bundled/review/` supplies `/review`. |

The provider-facing prompt remains `string[]`. A composition snapshot explains the committed base prompt; extension turn overrides can make the effective `session.systemPrompt` differ. Session tool mutations commit through `SessionTools` so inspection must use the committed snapshot and the effective prompt separately.

## Gap matrix

| Roadmap item | State in this checkout | Next integration need |
| --- | --- | --- |
| Prompt Engine | **Partial.** Profiles, module metadata, settings, session overrides, `/prompt` commands, and token accounting exist. The heading collision documented below is fixed with explicit render markers. | Extend lifecycle coverage across model/tool/extension/override changes and distinguish prompt guidance changes from callable-tool policy. |
| Dynamic capability routing | **Partial.** Tool gates, `xd://`, skill discovery, and lazy activation exist. | One deterministic task/role selection contract with explanations and budget, using those existing routes. |
| Context Manager | **Partial.** Notes, handoff, compaction, recovery, and memory retrieval exist. Rebuilt model context now restores a compact reminder for todo state hidden by compaction. | A sourced bounded working set and retention checks across compaction/resume. |
| Agent Orchestrator | **Available but not integrated.** Native subagents, worktree isolation, workpool, advisor, and review exist. | A thin task graph and coordinator after capability and context contracts settle. |
| Verification loop | **Partial.** Checks and review can be invoked, but there is no unified check evidence and finite repair state for changed tasks. | Link commands, results, revisions, repair attempts, and reviewer findings. |
| Evaluation | **Partial.** Offline prompt fixtures and the prior live token comparison exist. | Matched task outcomes, quality, regressions, latency, and cost before claiming a performance gain. |

## Reproducible baseline

`bun packages/coding-agent/bench/prompt-profiles.ts` completed with bundled `openai/gpt-4o-mini` and seven offline fixtures. For the simple-question fixture, initial/peak prompt text tokens were Full 1,809/1,809, Minimal 1,667/1,667, Coding 1,809/1,809, Agentic 1,809/1,809. For task-agent-workflow, they were Full 1,809/2,005, Minimal 1,667/1,863, Coding 1,809/2,005, Agentic 1,809/2,005. The script records `providerInputTokens: null` and `executionSuccess: null`; it is no task-quality baseline. `PHASE1_REPORT.md` documents the earlier authenticated input-token comparison, which was not rerun here.

Before the slice, `bun test packages/coding-agent/test/prompt-engine.test.ts` had eight passing tests. Adding a live-session regression test reproduced an existing `/prompt compare` error for a prefix-bound Anthropic model with its model module disabled: comparison showed 4,169 Full system tokens while the committed composition had 4,043. `bun check` stopped on formatting in six Prompt Engine-related files. A separate package `bun run check:types` found that `PromptSection.source` could be inferred as undefined. These were baseline failures, not evidence of a provider or task execution regression.

## First Step 1 slice

`prompt-engine/inspection.ts` now reconstructs comparison inputs using `PromptSection.source`: bundled sections form the base, optional project/safety blocks stay separate, and model sections remain model modules. `compose.ts` gives bundled sections an explicit source fallback for TypeScript. The same live-session test now verifies that the Full row's system token count equals the committed Full composition with the module disabled. This changes inspection accounting only; prompt bytes, runtime permissions, model routing, SDK/RPC/ACP signatures, and provider behavior are unchanged.

After the slice, the focused test passes (9/9), and `bun run check:types` in `packages/coding-agent` passes. `bun check` still stops on formatting in three untouched files: `prompt-engine/profiles.ts`, `sdk.ts`, and `slash-commands/builtin-prompt.ts`. This should be resolved in a separate formatting cleanup or a later touched-file change so the Step 1 behavior slice stays reviewable.

## Second Step 1 slice: stable section ownership

A Minimal prompt with a runtime rule containing a line `§ Workflow` lost the remainder of that rule. `splitBundledPrompt()` found the injected heading before the real Workflow boundary, assigned the rule tail to Workflow, and disabled it. A regression test reproduced the missing rule before the change.

The bundled static template now emits unique temporary section markers when rendered by `buildSystemPrompt()`. The builder removes them and passes ordered sections to `composePrompt()`. `/prompt compare` reuses those section identities rather than parsing headings again. Custom `SYSTEM.md` and `SYSTEM_TEMPLATE.md` remain opaque. The Full prompt is byte-identical to rendering the same template without markers, including in the collision fixture; the offline benchmark token counts above are unchanged.

Focused verification: `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 10/10, and `bun test packages/coding-agent/test/system-prompt-template.test.ts` passed 21/21.

## Third Step 1 slice: model and tool lifecycle

With `includeModelInPrompt` disabled, switching a live session from bundled `anthropic/claude-fable-5` to `anthropic/claude-fable-5-1` left the `prefix-bound-tools` module inactive. Both models have the same delegation bias, so `SessionTools.#currentPromptModelKey()` did not see a change. The live regression test failed before the fix.

`applicablePromptModelModuleIds()` now resolves selectors from catalog model facts once for composition and for the model refresh key. The live test confirms module activation and `/prompt stats` history after switching to the prefix-bound model, confirms that disabling subagents removes the callable `task` tool without removing the applicable model module, and confirms module removal after switching back. No provider request or credential refresh was needed for the fixture.

Focused verification: `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 11/11, package `bun run check:types` passed, and touched-file formatting passed. Root `bun check` still stops on pre-existing formatting in `sdk.ts` and `slash-commands/builtin-prompt.ts`. The next dependency-ready Step 1 task is to exercise extension and RPC/ACP tool refresh against prompt composition and effective prompt inspection, then decide whether a capability-router contract can reuse those activation events unchanged.

## Fourth Step 1 slice: live tool refresh inspection

The SDK's late extension registration serializes tool activation through `session.runToolRegistryMutation()` and `setActiveToolPresentation()` in `sdk.ts`. RPC host tool refresh enters the same session tool mutation path through `refreshRpcHostTools()` in `session-tools.ts`; RPC `get_state` and ACP extension context both read `session.systemPrompt`. No separate mode-specific prompt builder was found.

Live-session checks now verify that a late extension tool appears in the active composition and `/prompt inspect` without a false override label. An RPC host tool add/remove updates the provider tool schema estimate in `/prompt compare`, and inspection remains aligned with the base prompt after each change. These checks found no prompt mismatch requiring a production change. The provider tool schema estimate is distinct from text guidance: a direct host tool can change schema cost without changing a bundled prompt section.

Verification: `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 12/12; `bun test packages/coding-agent/test/sdk-tool-activation.test.ts` passed 59/59; package `bun run check:types` passed. ACP's effective-prompt accessor was traced but not exercised as a separate provider request. The next Step 1 slice should test per-turn extension prompt overrides and compaction, where the effective prompt can intentionally differ from the base composition, before deciding on capability-router events.

## Fifth Step 1 slice: settled override state

`before_agent_start` can replace the effective system prompt for one turn. The existing rebuild-in-window regression verifies that the provider receives this replacement even when a base refresh lands just before the request; that refresh path also covers the prompt ownership risk from compaction and memory promotion. At turn completion, `clearTurnSystemPromptOverride()` dropped the override flag but left `Agent.state.systemPrompt` on the old replacement. RPC/ACP readers and `/prompt inspect` therefore reported a completed turn's override until another rebuild or turn began.

`SessionTools.clearTurnSystemPromptOverride()` now restores the latest committed base when clearing an active override. The regression asserts both the provider-visible override during the turn and the settled base afterward, including when a base rebuild occurred in the prompt window. No prompt text or provider request format changed. The next slice can examine compaction's actual continuation path and measured module accounting, then settle Step 1 before starting capability routing.

Verification: `bun test packages/coding-agent/test/agent-session-before-agent-start-prompt-override.test.ts` passed 3/3; `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 12/12; `bun test packages/coding-agent/test/agent-session-plan-compact-hook-instructions.test.ts` passed 3/3; package `bun run check:types` and touched-file formatting passed. These checks do not send an authenticated provider request.

## Sixth Step 1 slice: manual compaction prompt handoff

Restoring the base prompt after an overridden turn exposed a manual compaction edge: `SessionMaintenance.compact()` aborts the live turn before passing `agent.state.systemPrompt` to provider-native summarization. Abort cleanup could replace the override with the base, so the compaction request lost the cached prefix of the interrupted provider call. A regression test reproduced this at the maintenance abort seam.

Manual compaction now snapshots the effective prompt before abort and carries it into provider-native compaction, including nested method fallbacks. The settled session can still expose its current base prompt. The focused compaction suite passed 27/27, the override suite passed 3/3, package type checking passed, and touched-file formatting passed. Automatic and speculative compaction still read their own live prompt paths; verify the actual automatic continuation with a turn override before declaring prompt lifecycle coverage complete.

## Seventh Step 1 slice: automatic compaction continuation

A real provider-call fixture showed that automatic threshold compaction reissued the base prompt after a completed turn whose `before_agent_start` hook had sent an override. The resumed provider call could legitimately use the base prompt, but the compaction request must reissue the earlier provider call's prefix. `Agent` now records the system prompt at the stream call boundary, after prompt and tool synchronization, and clears that record on reset or model switch. Automatic provider-native compaction uses the recorded prompt when available; sessions without a recorded call retain the live-prompt fallback. A regression test checks the first provider call, compaction request, and continuation separately.

Verification: `bun test packages/coding-agent/test/agent-session-eager-compaction.test.ts` passed 10/10; `bun test packages/coding-agent/test/compaction-speculation.test.ts` passed 27/27; both `packages/agent` and `packages/coding-agent` type checks passed. The next dependency-ready task is to review remaining measured-versus-estimated module reporting and close Step 1 before capability routing.

## Eighth Step 1 slice: honest prompt cost reporting

`/prompt stats` previously presented module and history tokenizer counts as plain token totals. Those are local estimates of prompt text; provider usage is reported for the whole request and cannot be attributed to individual modules. Stats now label base, effective override, history, full-profile, and module text counts as local estimates. When a response exists, it separately shows the last provider-reported prompt total with input, cache-read, and cache-write components and states that this aggregate includes conversation, tool schemas, and provider framing. No synthetic per-module provider measurement is claimed.

A live-session regression checks the distinct outputs from a provider usage fixture and a current effective-prompt override. `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 13/13; package type checking and touched-file formatting passed. Step 1 now has focused coverage for rendered section ownership, model/tool changes, extension overrides, manual and automatic compaction, and cost labeling. RPC and ACP both read the session's effective prompt; ACP access was traced but not exercised in a separate provider request. The next implementation step is Step 2's capability router, using the existing tool registry and activation paths.

## First Step 2 slice: explicit delegation routing

Dependency: Step 1's effective policy, composition metadata, and `SessionTools` registry mutation path. `prompt-engine/capability-router.ts` adds a narrow structured-intent contract for the existing `task` capability. Selection reports disabled, unavailable, discoverable, or active; its explanation includes source and local estimates for incremental delegation guidance, the promoted tool schema, and their combined activation cost. The router checks the combined estimate against a caller-supplied context budget. These are local text/schema estimates and exclude provider framing. It honors session capability overrides, model tool support, and prefix-bound roster constraints. An explicit request can override the budget or a single-task intent, but never a disabled policy or model constraint.

Activation is opt-in through `AgentSession.routeDelegationCapability()`. It promotes the registered `task` tool using `setActiveToolPresentation()`, so the existing registry, prompt rebuild, tool gating, and rollback remain authoritative. Repeated routing is idempotent. No startup defaults, provider routing, SDK/RPC/ACP wire shape, or existing tool activation changes. A live-session test covers mounted discovery, budget deferral, explicit activation, effective policy, model incompatibility, and idempotence. The next Step 2 slice should generalize the capability catalog and connect structured task transitions and missing-tool results to capabilities they can actually activate.

Verification: `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 14/14, `bun test packages/agent/test/agent-loop.test.ts` passed 139/139, both package type checks passed, touched-file `oxfmt --check` passed, and `git diff --check` passed. The test confirms that a budget covering guidance but not the promoted schema defers activation, and that an automatic task-transition signal leaves a user-deselected tool inactive while a later explicit request can reactivate it. No provider call or natural-language task classifier is included in this slice. Agent-loop now marks genuine unknown-tool results with `details.errorCode = "tool_not_found"`, preserving their provider-visible message. Existing `xd://` fallback already executes a mounted `task` call by name, so automatic routing on a missing `task` result would only see a tool that was absent or deselected; no automatic activation was added for that signal.

## Updated-plan checkout audit and Governor prerequisite

The updated root `PLAN.md` makes a pure Adaptive Effort Governor contract the next narrow task before adaptive orchestration. Current HEAD remains `d34caebdea9cd0e99182a75c7eaa6e1a6d93dbca` on `feat/prompt-profiles`, five commits ahead of pinned `upstream/main` at `7853b4e499936f9dcc13c9b64adb55f6b342aabf`. The working tree retains the user's modified `PLAN.md` and untracked `docs/omp2/PLAN.md` and `docs/omp2/PLAN-old.md`. This inventory, agent-loop, Prompt Engine/session files, and tests are also dirty; `governor/decision.ts`, `prompt-engine/capability-catalog.ts`, `prompt-engine/capability-router.ts`, and the Governor test are untracked. No files were staged, committed, or pushed.

Current status: Prompt Engine foundation is **COMPLETED** with lifecycle integration still **IN PROGRESS**. The capability router is **IN PROGRESS**: a shared catalog now maps existing prompt capability IDs to canonical tool names, and explicit routing can promote `task` or another single registered direct tool such as `debug`; browser/MCP runtime activation and automatic task-transition wiring remain **PLANNED**. The Governor is **IN PROGRESS**: `governor/decision.ts` is a typed, side-effect-free, opt-in policy contract with four task bands, low-confidence fallback, an inspectable versioned decision, selected capability IDs, and bounded model/effort/worker/context choices. There is no session adapter, settings UI, persistence, dispatcher, or automatic execution. Context Manager, Orchestrator, Verification Loop, and A/B harness integration remain **PLANNED** over existing OMP primitives.

The Governor ceiling map uses resolved model candidates supplied by the caller; `AgentSession.resolveRoleModelWithThinking()` (`session/agent-session.ts`) and `ModelControls.resolveRoleModelWithThinking()` (`session/model-controls.ts`) are the existing role-resolution seam. Supported effort comes from `@oh-my-pi/pi-catalog/model-thinking`, not model-ID matching. `SessionModels.thinkingLevelCeiling` is set from SDK `thinkingLevelCeiling`; `task.maxEffort` and `task.maxConcurrency` are registered in `task/settings.ts` and enforced by the existing task executor/workpool. The decision accepts those resolved ceiling values, clamps without raising a requested effort to an unsupported higher tier, treats OMP's concurrency value `0` as unlimited under its own four-worker policy cap, and returns zero workers when subagents or model tools are unavailable. The `subagents` capability ID is shared with the Step 2 catalog, but the decision does not activate a tool or start a worker.

Default/migration: `decideGovernor({ enabled: false, ... })` returns no decision, and no existing startup path calls it. SDK/RPC/ACP tool and wire behavior remain unchanged. The next slice should read live settings/role assignments into this contract, register validated opt-in thresholds, expose the decision for inspection and handoff, and re-evaluate on material steering or availability changes before any dispatcher uses it. The model object stays an input only; the output stores a small provider/ID reference suitable for later persistence.

Current focused verification: `bun test packages/coding-agent/test/governor-decision.test.ts packages/coding-agent/test/prompt-engine.test.ts` passed 24/24; `bun test packages/agent/test/agent-loop.test.ts` passed 139/139; package `bun run check:types` passed for coding-agent and agent; touched-file `oxfmt --check`, targeted `oxlint`, and `git diff --check` passed. These are offline contract tests, not authenticated task-outcome or A/B results. The first task's current-checkout baseline is therefore the committed Prompt Engine plus these uncommitted Step 2 and Governor contracts, with no adaptive runtime behavior enabled.

## Second Governor slice: live read-only preview

The session adapter now reads effective settings and resolved model roles into the pure decision. `adaptive.mode` defaults to `off`; `inspect` allows `AgentSession.previewGovernorDecision()` and its text inspection method to produce a decision from caller-supplied structured scope signals. `adaptive.thresholds` permits validated file-count and confidence overrides. The adapter applies the session effort ceiling, task effort and concurrency settings, effective subagent policy, actual task tool availability, and resolved role thinking suffixes. An explicit role ending in `:off` suppresses inherited effort. Preview never activates a tool, changes a model, or starts a worker. SDK/RPC/ACP wire formats and execution defaults remain unchanged.

This is still a preview contract: no task classifier, material-change revision policy, persistence across handoff, or dispatcher is connected. The next dependency-ready slice is a versioned decision snapshot in the existing session/handoff path with deterministic revision rules, followed by an opt-in execution consumer. Step 2's automatic task-transition routing and browser/MCP activation remain open separately.

Verification: `bun test packages/coding-agent/test/governor-session.test.ts packages/coding-agent/test/governor-decision.test.ts packages/coding-agent/test/prompt-engine.test.ts` passed 25/25; `bun --cwd=packages/coding-agent run check:types` and `bun --cwd=packages/agent run check:types` passed; targeted `oxlint`, touched-file `oxfmt --check`, and `git diff --check` passed. The live-session test verifies the default-off mode, inspect output, role resolution, effort and worker ceilings, disabled subagent policy, threshold override, invalid threshold rejection, and unchanged active tool list.

## Third Governor slice: durable revisions

The preceding implementation and inventory were committed as `1b5ecf9fe8` (`feat(coding-agent): add capability routing and governor preview`). The user's plan files remained outside the commit. This slice adds a versioned Governor snapshot to the existing session custom-entry stream, with a trigger and monotonic revision number. A new `recordGovernorDecision()` session method records only changed policy decisions; `getGovernorSnapshot()` reads the current branch, including after session reopen. The plain preview remains read-only. A one-file scope threshold crossing is suppressed when task count, dependencies, and risk are otherwise unchanged; explicit steering or a material scope change can revise immediately. This is a caller-driven revision contract, not automatic signal collection or execution routing. Normal lazy session-file materialization still applies: a fresh session without an assistant message is not written unless OMP explicitly materializes it.

Verification: the Governor, Prompt Engine, and live-session tests passed 26/26; the coding-agent type check, targeted lint and formatting, and diff check passed. A persisted-session test records an initial decision, explicit steering, and a material scope revision; it closes and reopens the session, then reads the latest decision. The next integration need is a structured source of task facts and a bounded automatic trigger path; the Governor still does not alter model, tool, prompt, or worker execution.

## Fourth Governor slice: model availability revision

Recorded snapshots now retain explicit overrides. A later record call that omits overrides keeps them; passing an empty override object clears them. After OMP completes a model switch and its tool synchronization, the session re-evaluates any existing Governor snapshot against the new model and records an `availability` revision if the policy changes. This uses the saved structured signals and remains inactive until `adaptive.mode` is `inspect` and a decision has been recorded. A malformed custom entry is skipped when the latest valid snapshot is read. The model change itself still follows OMP's existing selection and tool paths; Governor does not change it.

Verification: the focused Governor and Prompt Engine tests passed 26/26, the coding-agent type check passed, and targeted lint, formatting, and diff checks passed. The live-session fixture verifies retained steering, explicit override clearing, automatic model-switch revision, session reopen, and malformed-entry fallback. Other material triggers (tool availability, failed checks, budget changes) and automatic scope fact collection remain unconnected.

## Fifth Governor slice: task-tool availability revision

`SessionTools.runToolRegistryMutation()` now compares `task` availability before and after a successful serialized registry mutation. Only an actual change calls the session's availability listener; a failed mutation does not publish a Governor revision. An inspected session with a recorded decision re-evaluates its saved facts after the committed tool state changes. Removing `task` records zero allowed workers, and restoring it records the bounded worker count. This observes OMP's existing registry and presentation state; it does not activate or deactivate a tool itself.

Verification: 29 focused tests passed across Governor, Prompt Engine, and active-tool update coverage; coding-agent type checking, targeted lint, touched-file formatting, and diff checks passed. The remaining automatic revision triggers are failed verification and budget changes; structured scope facts still come from the caller.

## Sixth Governor slice: live budget and prompt policy

A coalesced settings listener now revises an existing decision when `task.maxConcurrency`, `task.maxEffort`, adaptive thresholds, or adaptive mode changes. The decision still respects `off`: edits while disabled do not record revisions, and re-enabling inspect mode reconciles the current settings against the saved facts. After a successful session prompt refresh, capability policy changes also re-evaluate the snapshot. A session override disabling subagents records zero workers; removing it restores the bounded count. Automatic reconciliation is best-effort and cannot turn a successful model, tool, or prompt mutation into a failure. The session-owned listeners are disposed with the session.

Verification: 29 focused tests passed across Governor, Prompt Engine, and active-tool updates; coding-agent type checking, targeted lint, touched-file formatting, and diff checks passed. Failed verification and automatic scope-fact collection remain unconnected; no Governor decision drives execution.

## Seventh Governor slice: configurable band budgets

`adaptive.bands` now accepts per-band `maxWorkers` and `contextShare` overrides. Validation rejects unknown bands or fields, non-integer or above-cap worker counts, and context shares outside 0–1. The pure decision also clamps direct caller input to each band's fixed worker cap and the model context window. A live settings edit revises a recorded decision through the existing budget listener. Default values preserve the earlier four-band policy.

Verification: 30 focused tests passed across Governor, Prompt Engine, and active-tool updates; coding-agent type checking, targeted lint, touched-file formatting, and diff checks passed. OMP has no existing event that distinguishes a failed planned verification check from an ordinary command failure, so this slice does not treat generic shell exits as verification evidence. A typed check-result contract belongs with the later Verification Loop.

## Second Step 2 slice: structured Governor task transition

`AgentSession.routeGovernorTaskTransition()` now accepts structured task facts, records the Governor decision, and routes an eligible parallel task through the existing delegation router inside one serialized tool-registry mutation. It passes the committed decision's context budget to routing. With adaptive mode off, it records no decision and leaves tools unchanged. A zero context budget defers activation; a later structured transition with enough budget promotes a mounted `task` tool. If the user deselects `task`, the Governor revises to zero workers and the next transition does not reactivate it. Explicit tool invocation still uses the existing policy-gated route. No ordinary chat message is classified or routed automatically, and no worker starts from this method.

Verification: 27 focused tests passed across Governor and Prompt Engine; coding-agent type checking, targeted lint, touched-file formatting, and diff checks passed. The next Step 2 need is a reliable structured source of task transitions and compatible activation for other discovery surfaces, including browser/MCP where their runtime gates require more than tool promotion.

## Third Step 2 slice: concrete task scope facts

The task-transition API now accepts distinct file references and task IDs with dependency edges. A deterministic adapter derives file count, total task count, dependency edge count, and the widest runnable task wave; it rejects duplicate IDs, unknown dependencies, and cycles before recording a decision or changing tools. Total task count is separate from parallel width, so a long dependency chain can enter the massive band without inventing parallel capacity. Task-count thresholds are configurable alongside file thresholds. Snapshots retain only the bounded derived counts, not file paths or task IDs. The facts still come from a caller; ordinary chat and todo prose are not treated as an authoritative task graph.

Verification: 30 focused Governor and Prompt Engine tests passed; coding-agent type checking, targeted lint, touched-file formatting, and diff checks passed. The session-level regression confirms that a cyclic graph leaves the prior decision and active tool set intact. No runtime planner or orchestrator currently supplies this graph automatically.

## Fourth Step 2 slice: observed todo scope

Successful structured todo updates now give the opt-in Governor a task-count scope signal through the existing `AgentSession.setTodoPhases()` path. Todo items have no dependency contract, so this source always reports zero independent tasks and cannot request parallel workers. The snapshot records its signal source; an explicit task graph or manually supplied scope supersedes todo observation and cannot be overwritten by a later todo edit. Task-count changes can cross band boundaries without being suppressed by the one-file hysteresis rule. Adaptive mode remains off by default, and the off path returns before scanning session history.

Verification: 32 focused Governor and Prompt Engine tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. The live-session regression covers off mode, todo scope growth and shrinkage, zero workers, graph precedence, and manual-scope precedence. Todo count is one scope observation, not a complete complexity score or an execution dispatcher. Runtime search, errors, and verification outcomes remain future Governor inputs.

## First Phase 3B slice: recent runtime pressure

After each persisted tool result, an inspected session with an existing Governor snapshot counts at most 16 recent non-todo tool results on the current branch, stopping at the latest user message. Exploration calls and tool errors jointly contribute to a bounded pressure score; call volume has a small additional weight. Configurable normal/complex pressure thresholds can raise the band, and the rolling window can later lower it again. An explicit band override remains authoritative. The snapshot records only aggregate counts, not tool output, arguments, or paths. Generic shell exits are not interpreted as verification failures.

Verification: 33 focused Governor and Prompt Engine tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. The live-session fixture covers escalation, de-escalation, source precedence, and request-boundary reset. This is still inspect-mode decision feedback; no model, worker, or verifier is dispatched from the revised band.

## Fifth Step 2 slice: explicit automatic routing mode

`adaptive.mode` now separates `off`, `inspect`, and `auto`. `inspect` records and revises decisions without promoting tools. `auto` retains the same decision visibility and lets an eligible structured task-graph transition promote the existing `task` capability through the router, subject to capability policy, model roster restrictions, and context budget. The default remains `off`. This makes tool activation an explicit opt-in rather than a side effect of inspection.

Verification: 33 focused Governor and Prompt Engine tests passed; coding-agent type checking and touched-file formatting passed. The live transition fixture checks that `inspect` leaves `task` mounted, `auto` defers activation at zero budget, and `auto` promotes it once budget permits. OMP's task executor already enforces `task.maxConcurrency` with its session semaphore; a Governor graph snapshot is not yet bound to a specific task batch, so this slice does not apply its worker count to that semaphore.

## First bounded batch execution slice

The concrete `task.batch` call now supplies its item count to the Governor after spawn preflight. In `auto` mode, the resulting decision is recorded with a `task_batch` source. When it selects more than one worker and `task.maxConcurrency` still comes from the default layer, a batch-local semaphore caps only that call's inline and background spawns. OMP's session semaphore remains the outer limit and live `task.maxConcurrency` changes still apply. An explicitly configured concurrency value keeps OMP's existing behavior. Single task calls, non-auto modes, failed preflights, and batches for which the Governor selects no parallel limit keep the existing path.

Verification: 39 focused Prompt Engine, Governor, and task-spawn tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. Live Governor tests check the default cap and an explicit concurrency setting. Task-spawn tests show a four-item background batch and a four-item inline batch each run two bodies at a time when the batch callback returns two, without changing the session setting. Worker verification and integration gating remain separate later phases.

## Automatic task capability release

An `auto` task transition now remembers whether `task` was mounted before the Governor promoted it. A later structured transition whose decision is not parallel restores that mount, or removes the tool if it was previously absent. Explicit delegation and later tool-presentation changes take ownership of the selection, so the Governor does not demote them. Release waits for an idle turn and honors models whose tool roster is bound after the first assistant response. `inspect` remains read-only.

Verification: the focused Prompt Engine and Governor session tests passed 16/16, and coding-agent type checking passed. The live transition test covers promotion, release, renewed promotion, and preservation of an explicit active selection. This remains limited to structured task transitions; ordinary chat does not trigger task-graph routing.

## Bounded workpool dispatch

The existing workpool now reports its current queued and running item count through the same opt-in Governor batch route used by `task.batch`. When `auto` selects a worker cap, workpool dispatch limits agent spawning to that cap. The live `task.maxConcurrency` setting remains an outer limit; an explicit setting takes precedence over the automatic cap. No additional worker type or task classifier is introduced.

Verification: the focused workpool tests passed 11/11 and coding-agent type checking passed. A dispatch regression shows four independent items using two agents, then an explicit concurrency change allowing a third agent on a later push. Workpool item count remains an execution signal, not a full dependency graph.

## Runtime adaptive-mode release

Changing `adaptive.mode` from `auto` to `inspect` or `off` now releases a Governor-owned `task` promotion through the serialized tool mutation path. If a turn is streaming, release waits for idle. A later explicit delegation choice or presentation change still takes ownership, so mode changes leave that choice intact. Returning to `auto` can promote `task` again on a later structured transition.

Verification: the focused Prompt Engine test covers auto-to-inspect and auto-to-off release, renewed promotion, and explicit-selection preservation. The test waits for the queued settings mutation before inspecting the active tool list.

## Recent edit breadth as runtime scope

The Governor's recent tool-result window now counts distinct paths from successful `edit` and `write` results, including both sides of a move. It stores only the aggregate file count in the decision snapshot. Crossing the configured file-count thresholds can raise a trivial or normal decision to complex, or raise a lower band to massive; as edits leave the bounded window, that pressure can fall again. Failed edits, reads, and pre-existing working-tree changes do not contribute. This measures edits made through these tools, not the full VCS diff or shell-driven changes.

Verification: the focused Governor tests passed 17/17 and coding-agent type checking passed. The live session fixture covers multi-file edit details, a move, a write, exclusion of a failed edit, escalation, and de-escalation after the window moves past those results.

## Runtime pressure at execution decisions

Structured task-graph transitions and concrete task batches now sample the current turn's recent tool-result signals when they ask the Governor for a decision. This carries edit breadth, exploration, and tool failures into the worker decision instead of dropping them when a new graph or batch replaces the snapshot. Off mode still skips the session-history scan. A batch of three independent items can therefore receive a two-worker cap after recent edits raise its band; the same batch returns to its default path when those edits leave the bounded window.

Verification: the focused Governor session and Prompt Engine tests passed 16/16 and coding-agent type checking passed. The live fixture covers runtime signals in a structured graph and a batch cap that appears and then disappears as the recent window changes. Exact Governor effort is not applied to task workers here: the task tool's `lo`/`med`/`hi` hints are relative to each resolved worker model and do not encode the Governor's concrete effort level.

## Declared foreground verification results

The `bash` tool now accepts `verification: true` for a foreground command that checks the current work. Completed results carry a typed pass/fail marker, including timeouts as failures; ordinary shell commands carry no marker. Declared checks cannot use async or service mode, and automatic backgrounding is bypassed so the check result remains attached to the call. Recent failed checks contribute a separate Governor signal: one can raise trivial to normal, and repeated failures can raise a lower band to complex. The persisted revision uses the `verification_failure` trigger. Generic shell failures are not classified as failed checks.

Verification: the focused Bash, Governor session, and Prompt Engine tests passed 27/27; coding-agent and TUI type checks, targeted lint, formatting, and diff checks passed. The live shell test exercises pass, nonzero exit, timeout, and ordinary-failure result shapes. The Governor fixture exercises one and two declared check failures. This supplies evidence to the Governor; a check scheduler and bounded repair loop remain later work.

## Context headroom in Governor budgets

The live Governor preview now reads the session's existing context-usage estimate and caps its selected context allocation to the remaining model window. An assistant response re-evaluates an existing snapshot, so growing context can lower the budget and compaction can restore it. This affects the context budget used by automatic task capability routing; it does not change OMP's compaction thresholds or claim that a separate Context Manager is complete.

Verification: 30 focused Governor and Prompt Engine tests passed, and coding-agent type checking passed. The pure decision test covers a crowded window, recovered headroom, and an exhausted window.

## Failed task workers as runtime feedback

The Governor now inspects settled `task` result details and counts individual workers with a nonzero exit code, an abort, or an error. This catches a failed worker in a mixed batch even when the aggregate tool result succeeds. One recent worker failure can raise a trivial decision to normal; repeated failures can raise a lower band to complex. The count uses the existing 16-result, current-turn window and falls when those results leave it. It records only the count in the snapshot.

Verification: 16 focused Governor tests and coding-agent type checking passed. The live-session fixture covers mixed successful and failed workers, one-count-per-worker behavior when both exit code and error are set, and escalation across two settled batches.

## Background task failure feedback

Owned background jobs now put their settled status in the persisted `async-result` delivery details. The Governor counts failed `task` jobs there, while ignoring successful tasks and failures from other job types. It revises the decision when the delivery enters the session, using the same current-turn, 16-result window as foreground feedback. Cancelled jobs are not treated as failures.

Verification: 19 focused Governor and async-delivery tests passed, including an end-to-end failed owned task delivery; coding-agent type checking passed. This covers delivered jobs, not jobs whose result was suppressed or dropped during a session transition.

## Repeated edit and write failure feedback

Recent failed `edit` and `write` calls now provide a separate mutation-failure count. Two failures can raise a trivial decision to normal; three can raise a lower band to complex. The signal uses the current-turn, 16-result window, so successful subsequent work can let the decision return to its scope-based band. One failed edit alone does not change the band, and unrelated shell errors do not count as failed mutations.

Verification: 16 focused Governor tests and coding-agent type checking passed. The live-session fixture covers escalation after two failed edits and a failed write, then recovery after those failures leave the window. This is decision feedback; it does not schedule a repair attempt.

## Todo progress de-escalation

The Governor's todo scope now counts remaining items: pending, in-progress, and blocked tasks. Completed and abandoned items no longer keep the task in a higher band. A change in the remaining count records a todo revision even when both counts map to the same band, so inspection and later budget revisions use current scope. Todo status still does not establish dependency or parallelism facts.

Verification: four focused Governor session and revision tests passed, and coding-agent type checking passed. The live-session fixture covers a four-item complex todo becoming one remaining item, then zero remaining items while the band stays trivial.

## Thinking-level reconciliation

A session thinking-level change now revises an existing inspected Governor decision after the model's effort changes. The revision uses the `budget` trigger; a model switch still uses its existing `availability` path after tool and prompt synchronization. Off mode does no Governor lookup. This keeps the recorded effort aligned with an operator selection or an auto-thinking resolution, within the existing effort ceilings. It does not make the task band choose or apply a new reasoning level.

Verification: the focused Governor session test covers low-to-high selection and the existing model-switch availability transition. Coding-agent type checking passed.

## Workpool batch failure feedback

A drained workpool previously completed its aggregate background job while one or more worker batches failed. It reports the failed-batch count in the job's settled details. The existing async-result delivery persists that typed count, and the Governor combines it with other recent task-worker failures without double-counting an aggregate job that itself failed. The count is bounded before it enters the runtime signal. The per-item result text remains available to callers. A later slice below changes the aggregate job status when items fail.

Verification: 33 focused workpool, async-delivery, and Governor session tests passed; coding-agent type checking passed. The tests cover the actual workpool job delivery, the persisted delivery field, and escalation from a completed aggregate with two failed batches.

## Todo continuity after compaction

When a compaction removes the latest unfinished todo snapshot from the model's rebuilt context, the context builder adds a hidden reminder with the remaining and blocked counts, the next actionable task when its label is short, and a pointer to `todo view` for the complete list. This derives from the canonical branch snapshot; it is not persisted as a new todo update or displayed in transcripts. Completed lists, retained todo tool results, and a later `/clear` boundary produce no reminder. Todo phases still provide no task dependency graph, so this does not change Governor parallelism.

Verification: 41 focused context-builder tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. The new cases cover compacted unfinished work, transcript isolation, a completed list, a reset boundary, a retained tool result, and an oversized task label.

## Recorded execution stagnation

The opt-in Governor now tracks bounded foreground `bash` wall time and exploration calls since the last successful edit, write, completed todo item, or declared passing check in the current turn's recent result window. Four exploratory calls and at least 120 seconds of recorded shell execution without those progress events can raise a trivial task to normal. A later progress event resets the stagnation signal so the task can de-escalate. The threshold is configurable through `adaptive.thresholds.runtimeStagnationMs`; invalid or missing timing data is ignored. This uses recorded tool execution time, not idle wall-clock time or an inferred failure from command output.

Verification: 19 focused Governor decision and session tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. The new cases cover bounded duration, the progress reset, exploration predating that reset, reversible policy routing, and rejection of a zero-duration threshold.

## Sourced context notebook entries

The experimental `context_notes` tool can now save up to 16 active-branch entry IDs alongside a notebook revision. The IDs are validated before the write, stored in a backward-compatible revision format, and shown in both the rebuilt model context and a later notebook read. The notebook directs the agent to `history://current/full` to inspect the referenced raw entries. Text-only revisions remain unchanged; empty text clears the notebook and cannot retain references. Invalid or foreign source IDs are rejected, and a stored source reference that no longer resolves on the branch is ignored when read. These links identify supporting history, not proof that a notebook claim is correct.

Verification: 18 focused notebook and experimental rollover tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. Tests cover foreign and duplicate IDs, resume, three rollover boundaries, readback, clear behavior, and a malformed persisted reference.

## Direct recovery of cited history

`history://current/entry/<id>` now renders one entry from the caller's live active branch, including entries before compaction. It uses the same experimental context-management gate and live-branch binding as `history://current/full`; unknown or off-branch IDs fail instead of falling back to a named agent's transcript. Notebook source links point to the direct route, so recovering one cited finding no longer requires loading the entire raw branch into context. The full-history route and named-agent `history://current` behavior remain available.

Verification: 41 focused history, notebook, and experimental rollover tests passed; coding-agent type checking, targeted lint, formatting, and diff checks passed. The tests cover direct reads after three rollovers, route isolation, disabled and unbound sessions, malformed paths, and existing named-agent behavior.

## Snapcompact budget for rebuilt context

The snapcompact frame cap now charges notebook and todo continuity messages from a synthetic context rebuild before choosing how many frames to archive. The same charge applies when shrinking an oversized archive during dead-end recovery. If those messages already exhaust the window, snapcompact is skipped before rendering frames. The pre-commit fit check charges them alongside the kept tail and compares that sum with a synthetic post-compaction rebuild, using the larger value. This covers a notebook update during local rendering before a compaction entry is committed. Focused regressions cover a reduced frame cap, an over-budget notebook skipping rendering, and a notebook arriving during rendering that causes the result to be rejected.

Verification: 18 focused snapcompact budget, frame-rescue, and no-reduction tests passed; coding-agent type checking and targeted formatting/lint checks passed. The broader auto-compaction progress suite passed 43/43 before this frame-cap adjustment.

## Retained-context telemetry

The live context breakdown now measures notebook and todo continuity messages separately. `/context` displays each as a subset of message tokens while preserving the same used-token total, so a large retained notebook is visible without presenting it as extra provider cost. The categories use the active agent messages after context rebuild; an authored notebook revision that has not entered the current model context is not charged as active context. A live compaction regression also exposed an oversized notebook fixture that exceeded the existing 16 KiB validation limit; the fixture now uses a valid revision and proves the retained-note count is nonzero.

Verification: 19 focused coding-agent budget and context-consolidation tests and 20 TUI context-usage tests passed; coding-agent and TUI type checks, targeted formatting/lint checks, and diff checks passed. No matched provider token measurement was run for these local categories.

## Model-window notebook budget

An experimental `context_notes` replacement now checks the complete rendered notebook message, including its source links and instructions, against the active model window before persisting it. The allowance is 10% of the window with a 512-token floor and 4,096-token ceiling, never exceeding the window itself; the existing 16 KiB UTF-8 storage bound still applies. A rejected replacement leaves the previous revision intact. The tool checks again after disk preparation so a model switch to a smaller window cannot save a now-oversized notebook. Sessions without a resolved model retain only the byte bound until a model is selected. If an existing notebook exceeds a newly selected model's allowance, the TUI and ACP `/context` reports flag the measured excess while OMP's normal model-switch and next-prompt recovery behavior stays in charge.

Verification: 20 focused notebook and experimental rollover tests, 8 snapcompact budget tests, and 21 TUI context-usage tests passed; coding-agent and TUI type checking, targeted formatting/lint checks, and diff checks passed. The new cases cover rejection below the byte limit, acceptance after selecting a larger model, a smaller model selected during an in-flight write, and the context warning for a retained note after the active model window shrinks.

## Workpool terminal reporting

The workpool's final card and delivered result now report failed or cancelled items instead of saying the pool completed when only its queue drained. A mixed outcome prioritizes the failure state and names both counts. When an item fails, the aggregate async job also settles as failed, so `/wait` and job listings agree with the delivered result. Its failed-batch detail remains available to Governor feedback; that consumer already avoids double-counting the failed aggregate and its batches.

Verification: 12 focused workpool tests passed; coding-agent type checking, targeted lint/formatting, and diff checks passed. The tests cover failed worker delivery and closing a pool with queued work.

## Window-scoped context notes

The experimental notebook now accepts `retention: "window"` for a temporary revision. It remains available during the current context window, then expires at the next compaction boundary; an older pinned revision cannot reappear after expiry. Existing revisions and the default `retention: "pinned"` continue across compaction. Source links and the model-window token budget apply to both modes. This is notebook-level retention, not per-finding ranking or automatic relevance scoring.

Verification: 30 focused notebook, rollover, and snapcompact tests passed; coding-agent type checking and targeted formatting/lint checks passed. The new tests cover window expiry, readback, no restoration of an older pinned revision, resume, and a later pinned revision surviving another compaction.

## Per-finding notebook retention

`context_notes` also accepts a structured `findings` replacement. Each finding carries its own pinned or window retention and optional history citations. A mixed revision retains pinned findings across compaction while dropping only window findings; the filtered revision is what the model sees and what later reads return. Existing text-only revisions remain readable. The full rendered set shares the notebook's byte, source-reference, and model-token limits, and the new journal format survives resume. This supplies explicit per-finding retention, not automatic relevance scoring.

Verification: 84 focused notebook, rollover, snapcompact, context-builder, and context-usage tests passed; coding-agent type checking and targeted formatting/lint checks passed. New checks cover mixed retention in rebuilt model context, resume, and rejection of a structured replacement above the active model's notebook budget.

## Bounded eval agent handles

Eval `agent()` handles now queue under the session's `task.maxConcurrency` setting. When the opt-in Governor supplies a worker cap for the current number of outstanding eval handles, the bridge narrows that queue to the smaller limit. Handles still return immediately; a job is marked running only after it acquires a slot. Cancelling a queued handle removes its wait without occupying a slot.

Verification: focused eval bridge tests cover an explicit one-worker limit, a two-worker Governor cap over four handles, and cancellation followed by another handle. The existing eval bridge suites, coding-agent type check, and targeted lint/formatting checks passed.

## Shared session subagent concurrency

`task`, eval `agent()`, and workpool turns now acquire the same session semaphore for `task.maxConcurrency`. Each still honors its narrower batch, Governor, or pool limit. Workpool turns wait as queued jobs and release their slot when execution ends. Changing the setting resizes the shared gate in place, preserving in-flight accounting. A cross-entry-point regression holds a task while an eval handle queues; another holds a session slot while a workpool turn queues.

Verification: 81 focused task, eval bridge, and workpool tests passed; coding-agent type checking, targeted lint/formatting, and diff checks passed.

## Current-turn notebook evidence

When structured notebook findings cite an entry from the current user turn, the context renderer moves those findings ahead of older ones. It preserves every finding, citation, and retention setting; the stored order returns on a later turn with no matching citations. This is a recency signal for explicit evidence, not semantic relevance or a reason to discard pinned findings.

Verification: 15 focused notebook tests passed, including a rebuilt-context ordering regression; coding-agent type checking and targeted lint/formatting checks passed.

## Notebook priority from touched files

The same context renderer now also moves a finding forward when its cited successful `read`, `edit`, or `write` result names a file changed by a successful `edit` or `write` in the current turn. It compares exact persisted paths and ignores failed results. Current-turn citations take priority over path matches; neither signal removes a finding or changes the stored order. The Governor's edited-file count now uses the same central path extractor.

Verification: 20 focused notebook and Governor session tests passed; coding-agent type checking and targeted lint/formatting checks passed. The notebook regression covers an earlier read, a current multi-file edit result, and a later failed edit that must not affect priority.

## Explicit file-reference notebook priority

The context renderer now also considers `@file` mentions in the current user request. A finding backed by a successful file tool result moves forward when its cited path is the unique exact or relative-suffix match among the notebook's sourced paths. Ambiguous basename mentions do not change priority. Current-turn citations remain stronger, and no finding is removed or rewritten. The existing mention parser was split into a lightweight module shared with auto-read.

Verification: 23 focused notebook and file-mention tests passed; coding-agent type checking and targeted lint/formatting checks passed. The regression covers a unique relative mention and an ambiguous basename.

## Active todo file-reference priority

The notebook renderer also reads the latest canonical todo state and gives priority to findings whose cited file uniquely matches an `@file` mention in the active todo task. When that task is completed and the next task becomes active, the priority follows it. A context-reset boundary hides older todo state. This uses only explicit file references in todo text; todo items still have no stable IDs or dependency graph linking them to findings.

Verification: 18 focused notebook tests passed; coding-agent type checking and targeted lint/formatting checks passed. The new case advances between two todo items and observes the finding order move with the active item.

## Notebook task-term priority

Notebook findings now receive a lower-priority relevance score from meaningful words shared with the current user request or active todo item and each finding's cited history text. Cited text is bounded before tokenization. When no task-term match exists, source recency provides a weaker tie-breaker. This is deterministic local matching with a small stop-word filter; it makes no embedding/model call, does not alter stored finding order, and never removes findings. Explicit current-turn citations, user file mentions, active-todo file references, and files touched in the turn retain higher priority. Dependency-aware relevance remains open because todo items do not carry stable IDs or dependency edges, and Governor graph snapshots intentionally retain only aggregate counts.

Verification: Not run in this continuation.

## Browser capability runtime gate

Prompt capability status no longer treats the general `eval` tool as proof that browser is active. Browser availability comes from the dedicated runtime check. An explicit browser route now promotes the shared `eval` surface and enables browser policy as a session override; disabled policy and unavailable browser runtime still block activation. Automatic task routing remains unavailable because ordinary turns do not supply an authoritative browser task signal.

Verification: Not run in this continuation.

## Targeted MCP capability routing

The capability router now accepts an explicit MCP route only when the caller names one exact registered MCP tool. It promotes that tool from its mounted `xd://` presentation to the direct tool surface, leaving other connected MCP tools untouched. Capability policy still gates routing, and automatic MCP selection remains off until a task source can identify the needed server/tool reliably.

Verification: Not run in this continuation.

## Structured task capability requirements

Structured Governor task facts may now name required routeable capabilities. In adaptive mode the task-transition handler attempts only those named capabilities, applies capability policy and tool availability checks, and enforces the selected context budget. The router does not infer required tools from natural-language text. Existing task-graph callers that omit the field retain their previous behavior; no ordinary-chat task source supplies these requirements yet.

Verification: Not run in this continuation.

## Automatic capability route release

Task-transition capability promotions now retain session-scoped ownership records. On a later structured transition, the Governor releases routes it introduced when the new task no longer requires them, restoring their prior enabled/mounted presentation. An explicit route can take ownership of an automatically promoted tool, and a presentation changed while the automatic route was active is left intact. Release waits while the session is streaming; a later transition can retry cleanup. No ordinary chat task source supplies requirements yet.

Verification: `bun check` passed, including coding-agent type checks, lint, and formatting. No tests were run in this continuation.

## Task-tool capability declarations

In adaptive auto mode, the task tool now advertises an optional `capabilities` list at the call level and per batch item. The handler validates names against the direct-routeable capability catalog, preserves item-level requirements in task facts, and sends the aggregate requirements through the Governor transition. Transitions invoked while the agent is streaming are deferred to the post-prompt queue so the in-flight provider request never sees a mutated tool roster. The next transition can release routes that are no longer required. Calls without declarations retain existing behavior; natural-language task text is not parsed for tool needs.

Verification: `bun check` passed, including coding-agent type checks, lint, and formatting. No tests were run in this continuation.

## Workpool capability declarations and effort binding

Eval workpool `.push(...items, { capabilities })` can now declare routeable direct-tool needs for the batch. The bridge validates capability names and records them on independent Governor task facts; calls that omit the option preserve the current behavior. New pooled workers also receive the batch's Governor-selected coarse effort through structured subagent preflight. Effort is stored per pushed item, so later pushes do not overwrite the selection for already queued work; retained workers keep the thinking level chosen at their original spawn.

## Runtime task-duration escalation

The Governor runtime collector now reads the longest duration from completed task tool results and delivered async task jobs. At the configured stagnation duration it raises a trivial decision to normal; at twice that duration it can raise normal to complex. The revised metric is validated in stored snapshots and the decision includes evidence when duration changes the band. This reacts on subsequent decisions after work settles; it does not interrupt an active worker.

Verification: `bun check` passed, including coding-agent type checks, lint, and formatting. No tests were run in this continuation.

## Latest focused test run

After task-duration escalation, workpool effort and capability routing, and task effort compatibility fixes, seven focused suites passed: Governor decision/revision/session/task-facts, workpool bridge, task spawning, and workpool dispatch. The run reported 69 passed and 0 failed, including regressions for duration escalation/collection, workpool effort propagation, explicit workpool capabilities, and compatibility with existing concurrency routing. `bun check` and `git diff --check` also passed. This was a focused run, not the full repository suite.

## User-facing explicit capability routing

`/prompt route` exposes explicit routing for `lsp`, `subagents`, `debugger`, `github`, `images`, and `browser`; `mcp` requires one exact `mcp__…` tool name. `/prompt unroute` restores the pre-route top-level versus mounted presentation and removes the browser policy override introduced by that route. It reports activation state, routing reason, and estimated token cost when available. Capability policy and each runtime gate remain enforced by the session router. Automatic task inference and MCP/browser auto-selection are not added.

Verification: Not run in this continuation.

## Governor effort binding for independent task batches

The Governor applies effort selection by band when dispatching independent `tasks[]` batches in auto mode. Trivial and normal work preserve the current operator effort, complex work may step up one supported level, and massive work selects the highest supported effort; model support and session/task ceilings still clamp the result. Explicit effort on an individual task and an explicitly selected role effort take precedence. The resulting coarse task effort is injected before task preflight so the executor resolves it against each target model. Batch concurrency continues to use the same recorded decision. Single tasks and non-auto modes retain their previous routing behavior.

Verification: `bun check` passed, including coding-agent type checks, lint, and formatting. No tests were run in this continuation.

## Queued workpool turn lifecycle

A workpool turn waiting for the shared session semaphore now remains queued in both its internal job and pool item/batch status. It becomes running only after acquiring the slot. Closing the pool cancels a waiting turn and reports its item as dropped; cancelling the aggregate also settles the queued batch without starting a worker or retaining a semaphore waiter. Active turns still finish under the existing close behavior.

Verification: 15 focused workpool tests passed; coding-agent type checking, targeted lint/formatting, and diff checks passed. The new regressions cover queued status, explicit close, aggregate cancellation, and subsequent slot acquisition.

## Recorded Governor inspection

`/prompt governor` now displays the latest persisted Governor revision, including its trigger, signal source, selected execution/verification/reviewer policy, model/effort, context allocation, scope counts, evidence, and clamps. It has both terminal and TUI output paths; a session without a recorded decision reports that state without synthesizing a preview. This makes automatic reassessment visible without mutating the session.

## Context-note evidence matching and stable fallback

Context-note task-term scoring now includes bounded text from cited successful tool results as well as cited user requests. Failed tool output is excluded. File mentions are removed from natural-language term matching because exact, unique path matching already handles those references; ambiguous `@file` names therefore cannot bias lexical relevance. When task terms match, newer cited evidence ranks higher; when no task, file, citation, or active-todo signal distinguishes findings, the renderer preserves authored order. Equal lexical scores also preserve authored order.

Verification: `bun check` passed, and the Governor session plus context-note suites passed. The focused behavior tests cover persisted decision inspection, empty state, tool-evidence matching, stable unmatched ordering, equal lexical scores, and existing file/citation/todo priority.

## Governor verification budget selection

Each effort band now has a configurable verification floor and ceiling from V0 through V4. High-risk scope raises the floor by one, and recent declared check failures raise it by their count, both bounded by the selected ceiling. Invalid reversed or unknown ranges are rejected by settings validation. These fields are stored with the Governor decision and displayed by `/prompt governor`; no check scheduler or repair loop is implied. Legacy persisted snapshots without the new fields remain readable.

Verification: 22 Governor decision and session tests passed, covering defaults, risk escalation, repeated failures, ceiling clamping, configuration validation, and session persistence. Expanded verification below also includes legacy snapshot reading.

## Structured graph failure diagnostics

When a structured Governor task graph cannot be topologically scheduled, the error now names every task left in the blocked chain. Duplicate dependency references continue to count as one graph edge and one prerequisite.

Verification: the task-facts contract suite passed with cycle IDs and duplicate dependency coverage.

## Expanded verification for this continuation

Final focused verification passed 69 tests across context notes, file mentions, Governor decisions/revisions/session/task facts, and Prompt Engine routing. `bun check` and `git diff --check` passed. Coverage includes failed-source exclusion, matching-source age decay, keeping `@file` terms out of ambiguous lexical matches, verification floor/ceiling selection and persistence, and structured graph diagnostics.

## Structured task requirements for browser and MCP

With `adaptive.mode=auto`, task calls and workpool pushes can declare `browser` and an exact `mcp__server__tool` alongside the existing direct-tool capabilities. The shared capability validator accepts only registered capability names, the browser route still checks browser runtime availability, and MCP routing looks up the exact connected tool instead of silently dropping it. Governor-owned routes are released when a later task transition no longer requires them; explicit routes retain ownership. Python `WorkPool.push(..., capabilities=[...])` forwards the same declarations through the eval bridge. Workpool dispatch waits for the serialized capability transition before starting a worker, so a worker cannot begin before its declared route is resolved.

Verification: 72 focused Prompt Engine, task schema/spawn, workpool, eval bridge, and Python prelude tests passed. Coverage includes task schema acceptance, disabled-field stripping, browser runtime gating, unavailable exact MCP reporting, Python forwarding, Governor route release and explicit ownership, and route-before-worker ordering. Coding-agent type checking and `git diff --check` passed; repository-wide checks are pending.

## Governor-owned capability cleanup

Switching `adaptive.mode` from `auto` to `inspect` or `off` now releases all Governor-owned direct-tool routes as well as the `task` promotion. Explicitly claimed routes have moved into the user-owned lease set and remain active. A task call that declares no capabilities also clears stale Governor-owned routes; if the provider turn is still active, cleanup runs in the post-prompt queue. This keeps automatic route lifetime aligned with the current structured task scope and operator mode.

Verification: Prompt Engine and Governor session suites passed 20/20 for mode-change release, and Prompt Engine plus task-spawn suites passed 39/39 for release-only cleanup and adjacent routing. Repository `bun check` passed after both changes. The route release remains limited to Governor-owned leases; explicit user routes are preserved.

## High-risk task declarations

When the Governor is enabled, the task tool accepts `highRisk: true` for a whole call or an individual batch item. A call-level or item-level declaration marks the structured task facts high risk, raising the selected verification floor within the configured band ceiling. The same risk flag reaches the batch execution decision, so worker planning does not replace it with a lower-risk snapshot. The flag is omitted from the task schema when adaptive mode is off; non-boolean internal/stale calls are rejected. This makes the existing risk policy usable from real task calls without inferring risk from task prose.

Verification: 39 focused task schema/spawn and Governor session tests passed; coding-agent type checking and `git diff --check` passed. The task-spawn regression confirms an item-level declaration reaches both task facts and batch planning, the schema checks both scopes and disabled-mode stripping, and Governor session coverage confirms the resulting floor is ceiling-bounded. No verification commands are scheduled automatically.

## High-risk eval workpool declarations

Python `WorkPool.push(..., high_risk=True)` and JavaScript `.push(..., { highRisk: true })` can mark an eval pool high risk alongside its direct-tool requirements. Capability requirements accumulate across later pushes, and once any push marks the pool high risk, subsequent worker planning keeps that risk signal. The bridge rejects non-boolean values. This matches the pool's live queue lifetime without treating a later low-risk push as permission to lower verification for earlier work.

Verification: 34 focused workpool, bridge, and Python/JavaScript prelude tests passed; repository `bun check` and `git diff --check` passed. Coverage checks cumulative pool facts and plan inputs, wrapper serialization, and bridge validation.

## Deferred capability transition handling

Task calls now stop before spawning when a required capability transition is deferred until the active provider turn settles, and return a retry-after-turn response. Workpool dispatch retains that deferred state, waits for session idle, retries the transition, and starts workers only after all required capability routes are active. Missing routes fail the task or batch before worker execution. The session does not apply a queued copy of a deferred transition behind the caller, so a task rejected for retry cannot leave tool routes activated as a side effect.

Verification: 63 focused Prompt Engine, task-spawn, and workpool tests passed; repository `bun check` and `git diff --check` passed. Regression coverage confirms no task or workpool worker starts while routing is deferred or unavailable.

## Deferred task transitions have no abandoned side effects

When task facts arrive during an active provider turn, `routeGovernorTaskTransition` now reports the deferred state without scheduling an automatic post-turn mutation. Direct task calls return a retry response for any deferred Governor transition, including risk-only declarations. Workpool dispatch waits for idle and retries from its retained task facts before launching workers. This prevents a rejected direct call from activating tools later without a corresponding task execution.

Verification: 15 focused Prompt Engine tests and 63 Prompt Engine, task-spawn, and workpool tests passed; repository `bun check` and `git diff --check` passed. The session regression confirms a deferred route does not appear after idle, task-spawn coverage includes a deferred high-risk-only transition, and workpool coverage verifies idle wait/retry and route-before-worker behavior.

## Task Governor preflight fails closed

If applying structured task facts throws, the task tool now returns a preflight error instead of logging the failure and continuing without the declared capability or risk policy. Calls without Governor facts retain their existing path.

Verification: 28 focused task-spawn tests passed; repository `bun check` and `git diff --check` passed. The regression makes the transition fail after a task declares `debugger` and verifies the worker executor is never called.

## Already-active capabilities satisfy task requirements

Task and workpool preflight now treat `state: "active"` as the success condition even when the router reports `selected: false` because the capability was already active. Unavailable, disabled, or merely discoverable routes still block worker startup.

Verification: 51 focused task-spawn and workpool tests passed; repository `bun check` and `git diff --check` passed. Both task tool and eval workpool regressions confirm that an already-active declared capability allows execution.

## Multi-capability routing preflights as a set

Structured task transitions now inspect every required capability before activating any of them. If one requirement is unavailable, disabled, or over budget, the decision returns the full set of preflight results and does not leave earlier capabilities newly promoted for a task that cannot start.

Verification: 66 focused Prompt Engine, task-spawn, and workpool tests passed; repository `bun check` and `git diff --check` passed. The session regression declares an available debugger plus an unavailable exact MCP tool and verifies that the debugger remains inactive.

## Workpool waits for the latest capability transition

Before dispatching a queued item, the workpool now waits until the most recently queued capability transition settles. If another push adds requirements while an earlier transition is in flight, workers stay queued until the accumulated requirement set has been routed.

Verification: all 23 focused workpool tests passed; repository `bun check` and `git diff --check` passed. The regression gates two overlapping capability pushes independently and verifies neither worker starts until the second transition resolves.

## Task Governor planning fails closed

When a task call declares Governor facts and batch plan selection throws, the task tool now returns a planning error instead of starting the batch with default execution settings. Calls without declared Governor facts retain the previous fallback behavior.

Verification: 30 focused task-spawn tests passed; repository `bun check` and `git diff --check` passed. A high-risk two-item batch with a failing Governor planner returns the error and never invokes the worker executor.

## Eval workpool Governor planning fails closed

When a workpool has accumulated a high-risk declaration or required capabilities, a thrown Governor plan is retained as a pool error. Queued items fail before worker startup rather than dispatching with an unbounded default plan. Undeclared pools keep the fallback behavior.

Verification: all 24 focused workpool tests passed; repository `bun check` and `git diff --check` passed. The high-risk pool regression confirms the worker is not started and the queued item settles as failed.

## High-risk workpool transitions fail closed

A thrown Governor task transition now blocks high-risk-only eval workpools as well as pools with capability requirements. The prior catch path treated errors as fatal only when a capability was declared, which could otherwise drop the risk signal and launch work.

Verification: all 25 focused workpool tests passed; repository `bun check` and `git diff --check` passed. The high-risk-only regression makes task-fact routing throw and verifies no worker starts.

## Structured Governor facts require a transition hook

Task calls and eval workpools that declare high risk or required capabilities now fail before execution if their session does not provide Governor task-transition routing. This closes the optional-hook path where high-risk-only work could otherwise proceed without recording or applying the declared policy.

Verification: 57 focused task-spawn and workpool tests passed; repository `bun check` and `git diff --check` passed. High-risk-only task and workpool cases both verify that no executor or worker starts when the hook is absent.

## Structured task batches require a Governor plan

Multi-item task calls with declared risk or capability facts now fail before worker startup when the session cannot provide either the full Governor plan or the legacy worker-count plan. A missing plan can no longer silently fall back to default batch execution for a declared Governor scope.

Verification: 32 focused task-spawn tests passed; repository `bun check` and `git diff --check` passed. The high-risk batch regression removes both planner hooks and confirms no subprocess starts.

## Workpool deferral state follows the latest transition

The workpool now replaces its deferred flag with each serialized transition result. A later successful route for the accumulated requirements clears an earlier deferred state, avoiding an unnecessary idle wait and duplicate Governor decision.

Verification: all 27 focused workpool tests passed; repository `bun check` and `git diff --check` passed. A deferred first push followed by a successful second transition starts both workers without calling `waitForIdle`.

## Workpool close interrupts deferred idle waits

When deferred capability routing makes dispatch wait for session idle, closing the pool now interrupts that wait. Queued work is reported as cancelled and the worker is not started even if the provider session remains busy.

Verification: all 28 focused workpool tests passed; repository `bun check` and `git diff --check` passed. The regression leaves `waitForIdle` unresolved, closes the pool, and verifies the aggregate settles with the item cancelled.

## Workpool close interrupts capability routing waits

Pool dispatch now races its pending capability-routing promise against the pool close signal. Closing a pool can settle queued work even if the session's route transition has not returned; late routing completion cannot start the cancelled item.

Verification: all 29 focused workpool tests passed; repository `bun check` and `git diff --check` passed. The regression leaves the transition unresolved, closes the pool, and verifies the aggregate settles without starting a worker.

## Empty Governor declarations do not defer task execution

Task and eval workpool calls now invoke Governor routing only for `highRisk: true` or a non-empty capability list. Explicit `highRisk: false` and `capabilities: []` are treated as no-op declarations, so they do not defer ordinary work behind the provider turn.

Verification: 63 focused task-spawn and workpool tests passed; repository `bun check` and `git diff --check` passed. Both entry points verify an empty/low-risk declaration skips transition routing and still executes the task.
