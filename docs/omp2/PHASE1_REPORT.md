# Phase 1 prompt engine

## Behavior

`prompt.profile` defaults to `full`. The bundled prompt is rendered once through the existing Handlebars path with temporary section markers; the markers are removed before its ordered sections are composed. `full` rejoins the sections without changing the provider prompt blocks. The other profiles select sections by policy. Project instructions, computer safety, and core tool policy remain required. Literal `SYSTEM.md`, user `SYSTEM_TEMPLATE.md`, and SDK prompt replacements remain opaque. Headings inside rendered rule text no longer change section ownership or remove the rule under a smaller profile.

The module catalog is separate from module content and provides stable IDs, descriptions, required status, and optional model-applicability selectors. The cleanup guidance has its own `workflow-cleanup` ID so it no longer collides with Workflow. The sections are Core, Runtime, Tool Policy, Delegation, Workflow, Testing, Workflow Cleanup, Delivery, Project, Computer Safety, Repository Context, and applicable model modules. Testing is split from Workflow so Minimal can keep verification and browser instructions. Delegation loads when `task` is active. Repository Context follows the Git policy. Other capability guidance already embedded in Runtime or Tool Policy follows the live tool and prelude inventory; it is not duplicated into a second prompt.

Policies are `always`, `automatic`, and `disabled`. `prompt.modules` controls optional sections; `prompt.capabilities` controls LSP, Git context, testing guidance, subagents, browser, debugger, GitHub, image generation, and MCP. Tool-backed disabled policies reconcile with the existing registry. Automatic keeps the existing tool or `xd://` discovery route. In Minimal and Coding, an automatic task tool mounts under `xd://` when that transport is available; the first mounted task call commits its detailed delegation section before execution. For prefix-bound thinking models, task stays direct with its guidance loaded from the start. Verification guidance loads with a bash or browser runtime. A capability policy cannot override an SDK tool whitelist, a missing tool, or host restrictions.

Use `/prompt stats` for the committed base prompt's profile, section policies, activation reasons, text token counts, configuration source, and startup-to-current token changes. `/prompt inspect` shows section boundaries, applicable model modules, configuration sources, and the current turn prompt if it differs from the base; `--redact` requires an active configured secret redactor. `/prompt setup` uses the existing overlay and SelectList controls and saves temporary session, user, or project settings. Session overrides only affect prompt composition; they do not change tool authorization. Project saves go through the Settings writer for `.omp/config.yml`.

Token counts use the active model's catalog tokenizer through `Tokenizer` in strict mode, or its built-in fallback when the model has no tokenizer mapping. They count prompt text blocks. Provider serialization, tool schemas, cache reads, and image billing are outside this number. Custom prompts have no meaningful Full comparison.

## Lifecycle and cache

The SDK passes profile and policy settings into the existing `buildSystemPrompt` closure. `SessionTools` owns the committed composition snapshot alongside the committed base prompt. Tool reconciliation and prompt rebuild use the same serialized mutation path; a failed preparation does not publish section metadata. Settings changes reconcile affected tools and refresh the base prompt. Existing provider cache invalidation runs when prompt blocks change. With prefix-bound thinking models, implicit tool roster changes can remain frozen under the existing tool-signature rule; explicit prompt refresh applies a new base at a safe mutation boundary. Automatic routes therefore retain the lightweight tool or `xd://` catalog until the next committed prompt can include detailed guidance.

The model-switch refresh key includes the model-specific modules selected by structured catalog metadata. This keeps module activation current even when `includeModelInPrompt` hides the model name and two models share the same delegation bias. A switch in either direction records the loaded or unloaded module in `/prompt stats` history; capability policy changes still reconcile callable tools separately.

## Offline benchmark

Run `bun packages/coding-agent/bench/prompt-profiles.ts` from the repo root. It renders seven representative tool and context fixtures for Full, Minimal, Coding, and Agentic with `openai/gpt-4o-mini` token accounting. It records initial and peak **prompt text** tokens and the reachable capabilities. The fixtures omit the live repository's discovered rules, skills, and `xd://` catalog, so their absolute counts are smaller than an interactive session. The fixture benchmark does not call a model, so `providerInputTokens` and `executionSuccess` are `null`; it does not prove task success or cache savings.

| Fixture | Full initial / peak | Minimal initial / peak | Coding initial / peak | Agentic initial / peak |
| --- | ---: | ---: | ---: | ---: |
| Simple question | 1,846 / 1,846 | 1,704 / 1,704 | 1,846 / 1,846 | 1,846 / 1,846 |
| Browser task | 1,846 / 1,887 | 1,704 / 1,745 | 1,846 / 1,887 | 1,846 / 1,887 |
| Task-agent workflow | 1,846 / 2,042 | 1,704 / 1,900 | 1,846 / 2,042 | 1,846 / 2,042 |

The small reduction is deliberate: required policy, project rules, and capability discovery stay loaded. The latest paired live first-turn measurement uses upstream OMP and Pi Forge with `openai-codex/gpt-5.5`; the complete table, pinned revisions, and limitations are recorded in [the architecture baseline](../architecture-baseline.md). Provider-reported input was 12,916 for upstream OMP, 13,027 for Pi Forge Full, 12,174 for Minimal, 12,373 for Coding, and 13,027 for Agentic. Minimal saves 742 tokens (5.7%) against that single upstream observation; this measures request size, not task success or cache savings.

## Coding behavior spot check

The frozen fixture `packages/coding-agent/bench/fixtures/prompt-profile-retry-delay-v1/TASK.md` was run once each under Full, Minimal, and Coding on `openai-codex/gpt-5.5`, in three clean copies with the same tools and acceptance tests. All three runs implemented the required bounded exponential retry delay, reported `bun test`, and passed both tests (9 assertions). Full and Minimal produced identical implementation bytes; Coding differed only in the RangeError message while satisfying the same observable contract. This is a small-task smoke check, not a broad task-quality benchmark; the Phase 9 corpus remains necessary for general non-regression claims.

## Verification and status

The prompt-engine, model-module, template, and dynamic tool-activation suites passed 101 tests (474 assertions). Coverage includes explicit user overrides, live profile reconciliation, capability activation and unload, and model changes across provider families. `bun check` and the live first-turn runner passed. Phase 1 is complete as an implementation and initial acceptance gate; broader coding quality and task-cost calibration remain in Phase 9.
