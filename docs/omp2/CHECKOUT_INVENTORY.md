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

Focused verification: `bun test packages/coding-agent/test/prompt-engine.test.ts` passed 10/10, and `bun test packages/coding-agent/test/system-prompt-template.test.ts` passed 21/21. The remaining dependency-ready Step 1 task is a live model-switch/tool-change lifecycle check: verify model module activation, prompt composition and stats, and callable tool state across both directions of a switch before building a task-intent capability router.
