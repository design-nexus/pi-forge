# Proposed Phase 1: Modular prompt engine

Status: Phase 0 proposal. The implemented behavior and measured fixture results are recorded in [the Phase 1 report](PHASE1_REPORT.md). The [Phase 0 analysis](ARCHITECTURE_ANALYSIS.md) records the original behavior and measurement limits.

## Design goals and invariants

1. Preserve current Full behavior for the same session inputs, including tool wire names, SDK overrides, `SYSTEM.md` and `SYSTEM_TEMPLATE.md`, extension hooks, context files, and model/provider serialization.
2. A module may be rendered only when its prerequisites are active and the required capability is reachable. Disabled must never be advertised as callable. Automatic must remain discoverable through small metadata or an existing activation path.
3. Keep `SessionTools` responsible for serializing live tool and prompt changes; `Agent` continues to receive ordered `string[]` blocks. Do not introduce a second tool registry or a separate provider request path.
4. Preserve stable prefix order and distinguish stable base, project/context, and volatile turn blocks for prompt caching.
5. Token savings are claims only after measuring successful task executions and cache behavior.

## Proposed implementation sequence

### 1. Composition and accounting with no policy change

Define internal `PromptModule`/`RenderedPromptSection` types with a stable ID, category, source, order, activation reason, content, and token count. Keep dependencies/applicability in the module definition only where a real resolver needs them; do not make every conceptual schema field mandatory. Add a composer that returns both ordered sections and the legacy `systemPrompt: string[]`. Preserve current block boundaries and rendered bytes in Full mode. Count rendered sections using `packages/agent/src/tokenizer.ts::Tokenizer` in strict mode, with the active model's catalog tokenizer when available; label text-only counts separately from provider wire overhead. Record non-owned/custom prompt blocks as opaque sections.

Likely files:

- New `packages/coding-agent/src/prompt-engine/{types,compose,accounting,profiles}.ts` (exact split should follow code size).
- `packages/coding-agent/src/system-prompt.ts` and `src/prompts/system/*.md` for section extraction and rendered metadata.
- `packages/coding-agent/src/sdk.ts` to carry the composition result through its existing rebuild closure.
- `packages/coding-agent/src/session/session-tools.ts` to keep the latest committed inspection snapshot alongside `baseSystemPrompt`; never publish an uncommitted render.

First prove Full output equivalence before enabling a smaller profile. Do not change native provider adapters solely for this layer.

### 2. Profile/policy resolution

Add typed settings via `config/registry.ts` declarations (probably in a new prompt-engine settings file imported by `config/all-settings.ts`). Resolve `Minimal`, `Coding`, `Agentic`, `Full`, and `Custom` into `always`/`automatic`/`disabled` policies with explicit user/project overrides. Use existing setting precedence. Make the default Full initially, to avoid a silent change for existing users. An explicit SDK `toolNames` list and subagent spawn restrictions remain hard ceilings. Capability availability (e.g. LSP installed or MCP connected) is separate from policy; `always` cannot conjure a missing or unauthorized tool.

The existing settings registry is leaf-oriented; it needs a deliberate representation for per-capability overrides. Candidate: a validated record under `prompt.capabilities` plus an enum `prompt.profile`. The wizard's user-level write can use registered setting handles, but project-level saving requires an established project-config writer or a small extension to the central settings API. Avoid hand-editing YAML in the UI controller.

### 3. Automatic activation through existing runtime paths

Map each automatic module to one of: (a) already active tool predicate, (b) `xd://` discoverable device, (c) skill/rule URI, or (d) lightweight capability descriptor plus explicit activation action. Prefer activation on a concrete tool/device/command request over keyword classification of the user's message. Stage tool activation, module inclusion, and prompt rebuild within `SessionTools` mutation. Define the pre-call handoff: if a capability is activated during a turn, wait for the committed prompt/tool snapshot before the next provider call. Respect prefix-bound thinking models' frozen-prompt path; capabilities that require immediate instructions may need to remain in a stable minimal block or be activated only at a safe turn boundary. A disabled policy should remove both module and activation route where appropriate, while a hidden but still callable bridge tool needs its guidance in the correct place.

Likely files: `src/session/session-tools.ts`, `src/tools/index.ts`, `src/tools/xdev.ts`, `src/internal-urls/router.ts`, `src/sdk.ts`, and the prompt engine resolver. Touch `src/task/executor.ts` only if profile inheritance cannot be represented through existing child settings/session options.

### 4. Inspection and setup UI

Add `/prompt stats`, `/prompt inspect`, and `/prompt setup` to `src/slash-commands/builtin-registry.ts` through an appropriate builtin command group, using the existing controller and TUI overlay conventions (`src/modes/controllers/selector-controller.ts`, `src/config/settings-ui.ts`, `packages/tui/src/overlays/*`). Stats should show profile, committed sections, policy, reason, text tokens, available lazy modules, and a Full comparison **computed from the same inputs**. Inspect should present the exact assembled base prompt with boundaries, and separately identify a current turn override if one exists. Setup should preview base tokens and save to user or project scope, then observe the same live setting/rebuild path as other UI edits. Do not claim estimated savings when an opaque override prevents a meaningful comparison.

### 5. Compatibility tests, smoke, benchmarks

Relevant existing tests include `test/system-prompt-*.test.ts`, `test/sdk-system-prompt-template.test.ts`, `test/sdk-tool-activation.test.ts`, `test/agent-session-context-file-reload.test.ts`, `test/config/settings-registry.test.ts`, and extension/MCP tests. Add consumer-facing tests for:

- Exact Full prompt blocks with a deterministic fixture; literal/template and explicit SDK override precedence.
- Profile resolution and user/project/runtime precedence; malformed policy rejection.
- Deterministic ordering and dependency activation; no advertisement of disabled or unavailable tools.
- Lazy activation resulting in both a callable tool and its required prompt guidance at the next provider call; rollback on rebuild failure; prefix-binding behavior.
- Context file/rule/skill updates after refresh; extension/MCP additions and turn-only override visibility.
- Token counts against a rendered fixture with `Tokenizer`, plus honest accounting when the active tokenizer is unknown or a custom prompt is opaque.

Test only distinct external outcomes, not static module metadata copied from fixtures. Run package-local tests and `bun check`, then a CLI/TUI smoke that inspects the effective prompt. The current checkout needs workspace links/native addon restored before those runtime checks can execute reliably.

Create a small repeatable benchmark harness under `packages/coding-agent/bench/` or `scripts/` only after the first profile is functional. Run representative question, one-file edit, multi-file edit, debugging, Git, browser, and task-agent workloads. Record initial/peak prompt text tokens, provider-reported input/cache tokens and latency when available, capability activation, and pass/fail against task-specific success criteria. Compare current Full with Minimal/Coding/Agentic on identical model, repo state, tool availability, and inputs. Do not present template-only savings as end-to-end savings.

## Migration and backward compatibility

- Default Full. No config migration required until a non-Full default is deliberately approved.
- Keep the public SDK `buildSystemPrompt()` return shape and `Agent.state.systemPrompt: string[]`; add optional metadata via an internal or additive field.
- Treat literal `SYSTEM.md`, arbitrary `SYSTEM_TEMPLATE.md`, fixed/callback SDK prompts, and extension turn overrides as opaque when section attribution is impossible. Preserve precedence and emitted text.
- Preserve current user/project discovery order, append heading, paragraph deduplication, workspaces, skills, rules, and tool inventory dialects.
- Reuse model catalog facts and settings handles; no TypeScript string matching on provider/model IDs.
- Profile changes must not widen restricted sessions or bypass tool gates, approvals, or security policies.

## Open architectural questions for review

1. What is the smallest always-visible activation interface for an automatic capability that has no existing `xd://`, tool, skill, or slash-command route? A generic capability catalog is possible, but should not be built until such a capability needs it.
2. Should `automatic` activate only after an explicit model request, or also from deterministic context such as an already-connected MCP server or a browser tool selected by the host? Define observable triggers per capability.
3. How should the profile resolver report a module as unavailable versus disabled versus automatic-but-idle? The distinction matters in `/prompt stats`.
4. How should a profile interact with a raw user template that omits the default tool catalog? The safe default is to preserve the template and label inspection/Full comparison accordingly.
5. For prefix-bound thinking models, which modules must be part of the stable prompt from turn start, and which can use a roster-delta notice or wait for a new turn?
6. Should project-level setup write only `.omp/config.yml`, or support the full set of imported settings sources? The current generic setting setter persists globally, while project model roles have a special writer.
7. What is the authoritative measurement for “total system prompt tokens” in UI: rendered text only, or provider-specific serialized request including schemas? Expose both only if both can be measured accurately enough.

Stop for review before implementing Phase 1.
