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
| Context Manager | **Available but not integrated.** Notes, handoff, compaction, recovery, and memory retrieval exist independently. | A sourced bounded working set and retention checks across compaction/resume. |
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
