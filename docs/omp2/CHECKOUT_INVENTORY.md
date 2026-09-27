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
