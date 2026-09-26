# OMP 2.0 Phase 0: Architecture analysis

Scope: the current `packages/coding-agent` implementation, inspected without changing production behavior. The companion [Phase 1 implementation plan](PHASE1_IMPLEMENTATION_PLAN.md) is a proposal, not an implemented design.

## Executive finding

OMP already has most of the mechanics needed for conditional prompt composition: capability discovery, layered settings, a live tool registry, prompt rendering from static Markdown templates, and serialized mid-session prompt rebuilding. The important gap is **ownership and traceability of prompt sections**. Today `system-prompt.md` is one Handlebars template with many conditionals, and `buildSystemPrompt()` returns rendered strings without section IDs, activation reasons, or per-section token accounting. A Phase 1 engine should compose the existing content while preserving the existing prompt/tool consistency path, rather than inventing a second session or discovery pipeline.

## End-to-end path

```text
CLI/main.ts or SDK caller
  -> Settings.init() + layered capability discovery
  -> createAgentSession() resolves model, skills, rules, context, extensions, MCP
  -> createTools() + extension/MCP/custom registrations -> tool registry
  -> initial active/mounted tool selection
  -> sdk.ts rebuildSystemPrompt() -> system-prompt.ts buildSystemPrompt()
  -> Agent(state.systemPrompt, state.tools) -> AgentSession/SessionTools
  -> Agent loop syncContextBeforeModelCall()
  -> normalize/transform context, optional in-band tool catalog
  -> provider adapter serializes system blocks and tool schemas
```

Important files:

| Area | Source | Role |
| --- | --- | --- |
| CLI input | `packages/coding-agent/src/main.ts` | Resolves `--system-prompt`, `--system-prompt-template`, append prompt, cwd, and session options. |
| Session factory | `packages/coding-agent/src/sdk.ts` | Runs startup discovery; registers tools; selects active set; owns the `rebuildSystemPrompt` closure and listeners. Also exposes a simpler public `buildSystemPrompt()` wrapper. |
| Prompt builder | `packages/coding-agent/src/system-prompt.ts` | Resolves overrides/context/skills, projects tool metadata, renders templates, and returns ordered `string[]` blocks. |
| Templates | `packages/coding-agent/src/prompts/system/{system-prompt,custom-system-prompt,project-prompt,active-repo-context,computer-safety}.md` | Bundled prompt bodies and optional blocks. |
| Discovery | `packages/coding-agent/src/capability/*`, `src/discovery/*` | Capability registry, provider priority, scope metadata, deduplication, and foreign configuration import. |
| Settings | `packages/coding-agent/src/config/{settings,registry,all-settings}.ts` | Typed, layered settings and live change listeners. |
| Tool creation | `packages/coding-agent/src/tools/index.ts` | Built-in tool gates and `createTools()`; individual tool descriptions mostly live in `prompts/tools/*.md`. |
| Live tools/prompt | `packages/coding-agent/src/session/session-tools.ts` | Active registry mutation, mounted `xd://` tools, prompt signatures, transactional rebuild/commit, cache invalidation. |
| Session | `packages/coding-agent/src/session/agent-session.ts` | Turn preparation, memory injection, extension `before_agent_start` overrides, context refresh. |
| Agent/runtime | `packages/agent/src/{agent,agent-loop,tokenizer}.ts` | Holds prompt/tool state; refreshes it before model calls; prepares provider context; model-aware token counting. |
| Provider serialization | `packages/ai/src/providers/{anthropic,openai-responses,amazon-bedrock}.ts` | Converts ordered prompt blocks to provider wire shape and applies cache policy. |

### Discovery and configuration lifecycle

`discovery/index.ts` imports capability definitions and provider modules for side-effect registration. `loadCapability()` merges providers by priority, attaches `_source` (provider, path, scope), validates, deduplicates, and honors disabled providers/extensions. Capabilities here are *discoverable configuration kinds* (skills, context files, system prompts, rules, tools, MCP servers, etc.); they are not yet a set of prompt modules or a scheduler for lazy activation.

`Settings` loads global config, project capability sources, CLI `--config` overlays, and runtime overrides. Effective precedence is environment when a setting declares one, then runtime override, config overlay, project, global, default; `getProvenance()` reports the winning layer. Project settings can be imported from `.omp` and foreign tool formats. The registry defines typed handles beside each domain and gathers them through `config/all-settings.ts`; `cfgSystemPromptInputs` combines prompt-sensitive settings so one coalesced listener in `sdk.ts` refreshes the base prompt. Other listeners reconcile tool gates, skills/commands, extensions, browser/computer preludes, MCP, and workspace changes. Disk config watches reload persisted settings. A setup wizard should save through this existing storage path; generic setting `.set()` writes the global layer, so project writes need the existing project-config editing conventions rather than pretending `.set()` is project scoped.

`createAgentSession()` initializes settings/model registry, starts some discovery concurrently, loads skills/rules/context, creates tools and extension/MCP integration, chooses the initial active set, builds the system prompt, then constructs `AgentSession`. The model registry obtains bundled/catalog models and dynamic provider models; catalog policy supplies model facts such as delegation bias and tool compatibility. Model-specific prompt decisions visible here include the session's model label, catalog delegation bias, tool dialect, and inline descriptor mode. They are driven by structured model/config facts, not a separate prompt-profile registry.

### `SYSTEM.md`, `SYSTEM_TEMPLATE.md`, and context files

`discoverSystemPromptOverride()` uses the `system-prompt` capability across built-in and foreign providers. It chooses project before user and, within a scope, literal `SYSTEM.md` before `SYSTEM_TEMPLATE.md`. An explicit CLI or SDK prompt takes precedence. Literal text renders through `custom-system-prompt.md`; a template is raw Handlebars rendered against the live default prompt data. An explicit empty/invalid template errors; a discovered empty/invalid template is ignored with fallback. Fixed SDK `options.systemPrompt` (`string`/`string[]`) bypasses generated prompt rendering entirely; a callback can replace the generated result. These are compatibility boundaries: a module engine cannot silently impose modules on an opaque override.

Context files (`AGENTS.md`, `CLAUDE.md`, and other provider formats) are a distinct `context-files` capability. `loadProjectContextFiles()` expands `@` imports, orders ancestor rules before closer ones, and removes exact contained paragraph sequences; additional workspace roots contribute their own files. `project-prompt.md` places them in a separate project block, along with workstation facts, optional workspace tree and an index of deeper `AGENTS.md` files. User `PERSONALITY.md` can replace a bundled personality; `APPEND_SYSTEM.md` or CLI append text is combined after generated memory/MCP guidance with an explicit user-instruction heading. Rule discovery buckets rules into TTSR, rulebook metadata, or full always-apply text; skills are advertised by descriptions, with full content read later through `skill://` when a capable reader is active. These are existing examples of lightweight discovery plus demand loading.

### Prompt assembly and provider lifecycle

`system-prompt.ts::buildSystemPrompt()` starts with a null-prompt escape, resolves the effective literal/template override, then prepares custom/append text, context files, skills, workspace tree, repo context, and personality concurrently under a five-second deadline. Failed/timed-out steps get documented fallbacks. It projects active tools to names, wire names, labels, descriptions and optionally full schemas/examples. Native tool calling with `inlineToolDescriptors=false` renders a compact inventory; owned/in-band tool dialects or explicit inline descriptors render the full catalog. The same active list drives Handlebars `{{#has tools ...}}` sections; `xd://` mounts count as reachable tools but are not misrepresented as direct functions. Code Mode distinguishes bridge-reachable tools from the direct provider-callable subset.

The builder renders block 0 from the bundled `system-prompt.md`, a literal wrapper, or a user template. It then appends optional `computer-safety.md`, `project-prompt.md`, and active repo context as separate ordered strings. The SDK's rebuild closure adds memory backend instructions, auto-learn, mounted MCP route guidance, connected server instructions, and user append text before calling the builder. It can return an opaque SDK override instead. During a turn, the memory backend may append a recall block, and extensions can replace the turn's prompt through `before_agent_start`. Extension `context` handlers transform messages separately; custom and extension tools register into the tool registry, and file/custom/MCP slash commands can alter the submitted user prompt. Slash commands are not system-prompt modules by default.

`Agent` stores `state.systemPrompt` and `state.tools`. Before **each model call**, its loop's `syncContextBeforeModelCall` hook refreshes the pending context from current agent state, so changes after the start of a run can reach the next provider request. `prepareProviderCall()` normalizes messages and tool schemas, applies provider-context transforms, and appends an in-band tool prompt when the selected dialect requires it. The provider adapter then serializes the `string[]`: Anthropic keeps text blocks and anchors caching on stable system/tool heads; OpenAI Responses may send joined `instructions` or separate developer messages according to policy; Bedrock likewise builds provider-specific system blocks. Thus `string[]` boundaries matter even if a provider ultimately joins them.

Task agents reuse `createAgentSession()` through `task/executor.ts`, with inherited context files/skills, their own settings and model selection, agent-specific tool allowlists/spawn policy, and a `systemPrompt` callback that can tailor the generated result. The `task` tool's description comes from `prompts/tools/task*.md`, while the bundled system template adds delegation guidance only when `task` is reachable. A profile applied to child sessions must therefore resolve after the child's explicit tool restrictions and preserve its prompt callback.

### When the base prompt changes

- Initially, after active/mounted tools are selected and before `AgentSession` construction.
- On coalesced prompt-input setting changes; tool-gate changes; skill/command/extension reconciliation; context or rule refresh at session boundaries; workspace/cwd changes; model/tool-dialect changes; memory backend changes; and connected MCP tool/instruction updates. Not every file edit automatically triggers a rebuild; a relevant refresh/reload path must run.
- On active tool changes, `SessionTools` serializes registry mutations, stages the candidate active/mounted set, computes a signature, rebuilds if needed, and commits tools plus prompt together. It rolls back state if rebuilding fails. Explicit `refreshBaseSystemPrompt()` handles changes outside the tool signature.
- At `before_agent_start`, memory can add a separate block and an extension can install a turn-only override. This is distinct from the stable base prompt.

One critical exception: for a model with `thinking.prefixBinding`, a mid-conversation implicit tool-roster change can freeze prompt refresh and send a roster-delta notice instead. Phase 1 must respect that provider compatibility rule and cannot assume every activation immediately rewrites block 0. `SessionTools` also clears an inherited provider prompt cache key when a committed base changes. Its signature covers active names/order, descriptions/wire names/skill-read capability, bounded MCP route projection, server instructions, and mounted skill readers. Schemas and some other inputs are not in that signature; callers explicitly refresh for those changes.

## Prompt-content classification

| Source/category | Current inclusion rule |
| --- | --- |
| Role, engineering, general tool policy, workflow, delivery, critical contract | Bundled template core; rendered unconditionally unless overridden or null prompt. |
| Tool-specific policy | `{{#has tools ...}}` for read/edit/write/find/grep/glob/lsp/task/AST/etc.; active tool set and wire names determine text. Individual tool descriptions/schemas travel separately on native tool APIs, or in the full in-band catalog. |
| Dynamic runtime | Tool inventory, `xd://` catalog/docs, internal URL descriptions, intent field, secrets, browser/computer availability, memory/MCP guidance, task concurrency/bias. |
| Model-specific | Model label, delegation bias, inline descriptors, native/in-band dialect, provider-specific wire serialization/cache handling. |
| Project-specific | Context files, workspace roots/tree, repo context, project settings/rules/skills. |
| User-specific | `SYSTEM.md`/template, personality override, append prompt, global settings, discovered user-level context/skills/rules. |
| Turn-specific | Memory recall and extension `before_agent_start` prompt replacement; can differ from `baseSystemPrompt`. |

The default template also has tool-independent text about specialized tools and workflow. Splitting it into modules requires retaining essential safety/authorization instructions while ensuring an inactive tool is never mentioned as callable. Conversely, hiding a capability's only discovery clue would make automatic activation impossible.

## Token breakdown (reproducible template fixture)

The checkout cannot currently import the full builder: workspace `@oh-my-pi/pi-tui/*` links are absent, and the normal `pi-natives` package loader cannot find its addon. For a bounded measurement I rendered the actual bundled Markdown templates through `packages/utils/src/prompt.ts` with a fixed fixture, then counted rendered text using the available `pi_natives` addon and `O200kBase` encoding. Fixture: `/tmp` cwd, no skills/rules/context/MCP/memory/repo block, default personality, native compact inventory with `read`, `bash`, `edit`, `write`, Linux/x64 workstation. This is **not a live OMP session or provider-billed count**. It excludes provider tool schemas, message history, wrapper overhead, and model-specific tokenization. The throwaway measurement script was outside the repository.

| Rendered section | Tokens |
| --- | ---: |
| Preface before `§ Role` | ~69 |
| `§ Role` (includes default personality) | 350 |
| `§ Runtime` (compact four-tool inventory) | 50 |
| `§ Tool Policy` | 149 |
| `§ Workflow` | 387 |
| `§ Delivery` | 330 |
| `§ Critical` | 84 |
| Project block (workstation + critical footer) | 83 |
| **Total, separately counted blocks** | **1,502** |

Section counts are approximate contributions: tokenizing section slices separately does not exactly sum to tokenizing the entire block because tokenizer boundaries change. The actual rendered block 0 was 1,419 tokens and the project block 83. In this same fixture, adding `task` increased the two-block count by 159 tokens; enabling `computer` increased the two templates by 145 tokens, and its separate static safety block counts 182 more; one short context file added 87, one short advertised skill 40, a rulebook item 34, one always-apply rule 19, and one tiny `xd://` device/doc 39. A fixture with `find`, `grep`, `glob`, `lsp`, `task`, `todo`, and `think` alongside the four base tools rendered 1,892 tokens. These deltas describe the chosen text fixtures, not projected savings for a real profile. Real project instructions, verbose tool inventories, MCP instructions, memory, and provider schemas can dominate; Phase 1 benchmarks must measure assembled request inputs under representative sessions.

## Architectural risks and constraints

1. **Prompt/tool mismatch.** Tool availability is conditional on settings, model, subagent restrictions, Code Mode, extensions, MCP connections, and `xd://` transport. Policies must use the *committed callable/bridge-reachable set*, never a stale profile guess.
2. **Lost discoverability.** Skills already show a workable description-to-`skill://` pattern. Automatic capabilities need a bounded, always-visible path to discover/activate them; otherwise the model cannot request them. Automatic activation based solely on user-text keywords would be brittle.
3. **Cache churn.** Reordering or mutating stable block 0 invalidates provider prefixes. Preserve deterministic order and stable early blocks; append volatile context late. Measure cache reads/writes and total input tokens, not just prompt size.
4. **Opaque overrides.** Fixed `systemPrompt`, `SYSTEM.md`, arbitrary `SYSTEM_TEMPLATE.md`, and extension turn overrides may bypass or replace the bundled structure. Inspection must report what actually reaches `Agent`, including unattributed custom portions, without silently rewriting user content.
5. **Rebuild races.** Discovery/MCP/extension changes can arrive asynchronously. Reuse `SessionTools` serialized mutation and commit guards. Preserve its prefix-binding freeze behavior, rollback, and per-turn override ownership.
6. **Scoped policy.** Project/global settings and subagent tool grants differ. A profile must never widen an explicit host-provided tool list or override a disabled built-in. Distinguish policy selection from tool registry creation and authorization.
7. **Accounting fidelity.** `Tokenizer.countTokens(..., "strict")` gives an exact native family count when available and an o200k fallback otherwise; provider serialization and native tool schemas add overhead beyond a text-block sum. Expose both text-only module counts and an explicit request-total estimate if computed.

## Recommended Phase 1 direction

Keep the current discovery, settings, SDK, and `SessionTools` ownership. Introduce an internal composition result containing ordered prompt blocks with IDs, source, activation policy/reason, and measured count; derive the existing `string[]` from it so the provider path remains unchanged. Start by extracting bundled-template sections without changing default output, then layer profiles and automatic activation on the existing active-tool/`xd://` machinery. Use a Full/default compatibility mode as the byte-for-byte reference wherever current inputs are deterministic. The full sequence and open decisions are in the companion plan.
