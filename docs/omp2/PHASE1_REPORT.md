# Phase 1 prompt engine

## Behavior

`prompt.profile` defaults to `full`. The bundled prompt is rendered once through the existing Handlebars path, then split into ordered sections. `full` rejoins the sections without changing the provider prompt blocks. The other profiles select sections by policy. Project instructions, computer safety, and core tool policy remain required. Literal `SYSTEM.md`, user `SYSTEM_TEMPLATE.md`, and SDK prompt replacements remain opaque so their text is never split on headings that might belong to the user.

The module catalog is separate from module content and provides stable IDs, descriptions, required status, and optional model-applicability selectors. The cleanup guidance has its own `workflow-cleanup` ID so it no longer collides with Workflow. The sections are Core, Runtime, Tool Policy, Delegation, Workflow, Testing, Workflow Cleanup, Delivery, Project, Computer Safety, Repository Context, and applicable model modules. Testing is split from Workflow so Minimal can keep verification and browser instructions. Delegation loads when `task` is active. Repository Context follows the Git policy. Other capability guidance already embedded in Runtime or Tool Policy follows the live tool and prelude inventory; it is not duplicated into a second prompt.

Policies are `always`, `automatic`, and `disabled`. `prompt.modules` controls optional sections; `prompt.capabilities` controls LSP, Git context, testing guidance, subagents, browser, debugger, GitHub, image generation, and MCP. Tool-backed disabled policies reconcile with the existing registry. Automatic keeps the existing tool or `xd://` discovery route. In Minimal and Coding, an automatic task tool mounts under `xd://` when that transport is available; the first mounted task call commits its detailed delegation section before execution. For prefix-bound thinking models, task stays direct with its guidance loaded from the start. Verification guidance loads with a bash or browser runtime. A capability policy cannot override an SDK tool whitelist, a missing tool, or host restrictions.

Use `/prompt stats` for the committed base prompt's profile, section policies, activation reasons, text token counts, configuration source, and startup-to-current token changes. `/prompt inspect` shows section boundaries, applicable model modules, configuration sources, and the current turn prompt if it differs from the base; `--redact` requires an active configured secret redactor. `/prompt setup` uses the existing overlay and SelectList controls and saves temporary session, user, or project settings. Session overrides only affect prompt composition; they do not change tool authorization. Project saves go through the Settings writer for `.omp/config.yml`.

Token counts use the active model's catalog tokenizer through `Tokenizer` in strict mode, or its built-in fallback when the model has no tokenizer mapping. They count prompt text blocks. Provider serialization, tool schemas, cache reads, and image billing are outside this number. Custom prompts have no meaningful Full comparison.

## Lifecycle and cache

The SDK passes profile and policy settings into the existing `buildSystemPrompt` closure. `SessionTools` owns the committed composition snapshot alongside the committed base prompt. Tool reconciliation and prompt rebuild use the same serialized mutation path; a failed preparation does not publish section metadata. Settings changes reconcile affected tools and refresh the base prompt. Existing provider cache invalidation runs when prompt blocks change. With prefix-bound thinking models, implicit tool roster changes can remain frozen under the existing tool-signature rule; explicit prompt refresh applies a new base at a safe mutation boundary. Automatic routes therefore retain the lightweight tool or `xd://` catalog until the next committed prompt can include detailed guidance.

## Offline benchmark

Run `bun packages/coding-agent/bench/prompt-profiles.ts` from the repo root. It renders seven representative tool and context fixtures for Full, Minimal, Coding, and Agentic with `openai/gpt-4o-mini` token accounting. It records initial and peak **prompt text** tokens and the reachable capabilities. The fixtures omit the live repository's discovered rules, skills, and `xd://` catalog, so their absolute counts are smaller than an interactive session. The fixture benchmark does not call a model, so `providerInputTokens` and `executionSuccess` are `null`; it does not prove task success or cache savings.

| Fixture | Full initial / peak | Minimal initial / peak | Coding initial / peak | Agentic initial / peak |
| --- | ---: | ---: | ---: | ---: |
| Simple question | 1,809 / 1,809 | 1,667 / 1,667 | 1,809 / 1,809 | 1,809 / 1,809 |
| Browser task | 1,809 / 1,850 | 1,667 / 1,708 | 1,809 / 1,850 | 1,809 / 1,850 |
| Task-agent workflow | 1,809 / 2,005 | 1,667 / 1,863 | 1,809 / 2,005 | 1,809 / 2,005 |

The small reduction is deliberate: required policy, project rules, and capability discovery stay loaded. A separate authenticated live comparison was run with `openai-codex/gpt-5.5` using the same first-turn task and session context for each profile. Provider-reported input tokens were Full 12,896, Minimal 12,079, Coding 12,284, and Agentic 12,916. Locally counted prompt text plus tool schemas for that run was Full 11,756 (9,389 + 2,367), Minimal 10,973 (9,041 + 1,932), Coding 11,178 (9,246 + 1,932), and Agentic 11,776 (9,409 + 2,367). The gap between local and provider counts reflects provider framing and request serialization; this single run measures input size, not task success, cache savings, or a general model-independent reduction. Re-run matched tasks and repository state before making broader performance claims.
