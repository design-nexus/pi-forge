# Pi Forge — Adaptive Executive-Function Roadmap

Pi Forge is the coding-first fork of [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) at `design-nexus/pi-forge`. Its purpose is to help an agent complete substantial software work reliably: understand, preserve context, plan, assign, implement, verify, repair, review, and report evidence.

This plan targets the current checkout. OMP already has strong editing/search, LSP, DAP, browser/research, many providers and local models, skills/extensions, memory, compaction, native `task` subagents with worktree isolation, Agent Hub, advisor, and `/review`. Pi Forge should coordinate these facilities. A new tool, provider abstraction, memory store, agent runner, or checkpoint mechanism needs a demonstrated gap before it is added.

## Baseline and priorities

The current branch already has a Prompt Engine slice in `packages/coding-agent/src/prompt-engine/`: profiles, module/capability policies, composition, settings, inspection, and setup UI. `/prompt stats`, `/prompt compare`, `/prompt inspect`, and `/prompt setup` exist in `slash-commands/builtin-prompt.ts`. Validate and extend this foundation; do not restart it. Check whether rendered-heading splitting remains robust, and distinguish policies that affect prompt text from those that actually affect tool availability.

Status here is grounded in the current `feat/prompt-profiles` checkout at `d34caebdea`. `PLAN.md`, `docs/omp2/CHECKOUT_INVENTORY.md`, and Prompt Engine/session/agent files have uncommitted edits; `prompt-engine/capability-router.ts` is untracked. Preserve those changes. The inventory records earlier slices and tests, but its old commit and test results are not current-checkout verification. **COMPLETED** means a capability is present in cited source; **IN PROGRESS** means a partial implementation exists; **PLANNED** means no integrated implementation is evidenced. Do not promote a design or untracked slice to completed without current checks.

| Capability | Evidence and status |
|---|---|
| Prompt Engine | **COMPLETED foundation, IN PROGRESS integration:** `prompt-engine/{profiles,compose,inspection,settings}.ts`, `sdk.ts`, `session/session-tools.ts`, and `/prompt`; commits `65012e69fe`–`d34caebdea`. |
| Lazy capability routing | **COMPLETED OMP primitives, IN PROGRESS routing:** `capability/`, `extensibility/skills.ts`, `tools/xdev.ts`; untracked `prompt-engine/capability-router.ts` currently handles only `task`. |
| Subagents, roles, ceilings | **COMPLETED OMP primitives:** `task/{index,workpool,parallel,worktree,settings}.ts`, `config/model-roles.ts`, `session/turn-recovery.ts`; native concurrency, model role, per-spawn effort, and session effort limits. |
| Plan/review/context/tools | **COMPLETED OMP primitives:** `plan-mode/` including plan-mode subagent prompt, `advisor/`, bundled `/review`, `tools/checkpoint.ts`, `session/{context-notes,session-handoff,turn-recovery}.ts`, `memory-backend/`, `packages/agent/src/compaction/`, LSP/DAP and rich tool registry. |
| Adaptive Effort Governor | **PLANNED:** no integrated complexity/confidence decision controlling all requested dimensions is evidenced. |
| Adaptive orchestration and A/B harness | **PLANNED:** existing worker/review facilities lack an evidenced governor-driven task graph and comparative outcome harness. |

Priorities, in dependency order:

1. Harden the Prompt Engine as the shared policy, provenance, and token-accounting layer.
2. Add dynamic capability routing/loading through existing discovery and tool activation.
3. Add the **Adaptive Effort Governor** as a core policy subsystem before adaptive orchestration.
4. Move Context Manager forward to preserve relevant context, compaction state, and session continuity before autonomy expands.
5. Make Agent Orchestrator a core coordinator over OMP's native subagents, activated by governor decisions.
6. Make verification, bounded repair, and final review a first-class completion loop.
7. Measure outcomes against current and upstream OMP before broad default changes.

Do not duplicate OMP's tools, LSP/DAP, web/research, provider catalog, local-model support, skills, memory backends, or worktree/subagent runner.

## Architecture and ownership

```text
request + repository + session + explicit user policy
          │
          ▼
Adaptive Effort Governor ─ complexity/confidence + hard ceilings
          ├──── planning / checks / agents / model role / effort
          └──── context budget / active prompt + tool surface
          │
          ▼
Prompt Engine + Capability Router + Context Manager
          │
          ▼
Adaptive Orchestrator ─ direct OR plan → worker(s) → reviewer
          │
          ▼
existing OMP task/worktrees/tools/providers/skills
          │
          ▼
Verification Loop ─ checks → bounded repair → review → evidence
          └──────── observations and durable handoff ──► Context Manager / evaluation
```

These are logical responsibilities, not necessarily separate services. The main agent remains usable without orchestration. Governor emits constrained decisions; Prompt Engine owns instruction composition; Capability Router selects existing capabilities; Context Manager supplies bounded context; Agent Orchestrator owns task state; Verification Loop records objective checks. Prompt text never grants permissions. Preserve user/project/runtime precedence and provider restrictions.

Define small shared contracts before integrating components:

- **Capability:** stable ID, discovery source, prerequisites, permissions, model/tool requirements, prompt modules, activation signal, token cost, and state (`unavailable`, `discoverable`, `active`, `disabled`). Separate metadata from full instructions.
- **Context item:** kind, source/reference, scope, freshness, priority, token cost, and retention. Mark model summaries and memories as fallible; current user instructions and source files take priority.
- **Task:** ID, objective, dependencies, role/owner, workspace boundary, model, status, artifact/diff, budget, checks, and failure reason. Persist enough for interruption recovery.
- **Verification:** target revision/diff, check and command/diagnostic source, exit status, concise output/artifact, skip reason, retries, and reviewer disposition. Model opinion cannot substitute for command results.
- **Selection event:** why a module, context item, capability, model, or agent was selected. Redact secrets and cap log volume.
- **Governor decision:** task band (`trivial | normal | complex | massive`), classification confidence and evidence, execution mode, planning depth, verification/reviewer policy, agent count/parallelism, model role/tier, reasoning effort, context budget, active prompt/tool/capability set, applied ceiling/override, fallback reason, and decision version. Make this inspectable and durable across handoff.

Reuse session storage, SDK/RPC/ACP paths, catalog metadata, and KDL model rules. Do not hardcode OpenAI assumptions or model-name branches in TypeScript. Preserve OMP's provider and local-model strengths.

## Adaptive Effort Governor policy

Use configurable task-complexity thresholds and a separate confidence score. Start with cheap deterministic signals: scope, dependency structure, file/test risk, user intent, and repository facts. Consider model classification only when it improves calibration enough to justify latency and cost. Persist evidence and expose the decision to inspection. Reclassify on explicit steering, material scope change, failed verification, model/tool availability change, or budget change; use hysteresis to avoid prompt/tool thrash.

| Band | Execution and planning | Verification and reviewer | Agents, model/effort, context and surface |
|---|---|---|---|
| **Trivial** | Direct single-agent work; no formal plan. | Fast relevant check when code changes. | Zero subagents; current/pinned or allowed low-cost role, low effort, small context and essential prompt/tools. |
| **Normal** | Direct work with a brief checklist. | Appropriate targeted tests, lint/diagnostics; review only when risk calls for it. | Usually zero subagents; standard allowed role/effort, nearby context, capabilities activated as needed. |
| **Complex** | Plan → execute → verify with milestones. | Explicit check plan, independent review when risk/uncertainty warrants, bounded repair. | Bounded independent delegation only when useful; eligible stronger role/effort, sourced working set and relevant tools. |
| **Massive** | Decompose into a dependency graph; plan, integrate and report. | Integration checks, independent review, final verification. | Parallel workers only for separable tasks; cap count/concurrency by user, OMP and provider limits; allocate model/effort and context per task. |

**Authority and ceilings:** explicit user instructions and existing settings win. Resolve eligible configured model roles and available provider/local models first. Clamp requested effort to the session `thinkingLevelCeiling` and `task.maxEffort`; clamp worker count to `task.maxConcurrency`, any configured agent/provider/async/budget ceiling, and user maxima. Respect disabled agents/capabilities, deselected tools, read-only/plan mode, permissions, model tool support, pinned model/role/effort, and project policy. Enforce ceilings at the execution boundary as well as decision time. Never silently escalate cost, model tier, effort, agent count, or active capability beyond these limits. Explain an unavailable choice and use the strongest permitted direct workflow. Keep existing OMP behavior as the default until an opt-in or A/B evidence supports changing it.

**Low confidence fallback:** take a reversible middle path: short plan/checklist, narrow discovery, one-agent execution and targeted checks. Neither a long prompt nor a short prompt alone proves complexity. Escalate only from concrete scope/risk evidence and within ceilings; downgrade when the actual change is small. Log the confidence, reason, applied clamp and later correction without sensitive content.

## Roadmap, dependencies, and implementer models

| Step | Outcome / prerequisite | Recommended Codex CLI model |
|---|---|---|
| 0 | Inventory current checkout and measure baseline | GPT-5.6 Sol High; Terra for focused documentation |
| 1 | Prompt Engine hardening; after 0 | GPT-5.6 Sol High for design, Sol Medium for code |
| 2 | Dynamic capability routing/loading; after 1 | GPT-5.6 Sol High for policy, Sol Medium for code, Luna for bounded catalog work |
| 3 | **Adaptive Effort Governor; after 1–2 contracts, before orchestration** | GPT-5.6 Sol High for policy, Sol Medium for code |
| 4 | Context Manager and continuity; after 1 and governor budget contract, parallel with 2–3 | GPT-5.6 Sol High for lifecycle, Sol Medium for slices, Terra for fixtures |
| 5 | Adaptive Agent Orchestrator; after 2–4 | GPT-5.6 Sol High for state machine, Sol Medium for code, Luna for bounded independent worker tasks |
| 6 | Verification/repair loop; primitives from 3–4, full loop after 5 | GPT-5.6 Sol High for gates/review, Sol Medium for code, Terra for check catalog |
| 7 | A/B evaluation and tuning; instrument from 0, compare each integrated phase | GPT-5.6 Sol High for evaluation design, Terra for analysis, Luna for fixture work |
| 8 | Optional routing/fallback refinements; after evidence from 7 | GPT-5.6 Sol High for policy, Sol Medium for code |

These are **Codex CLI implementation recommendations**, not Pi Forge runtime defaults. Check model availability before each step; use a currently supported equivalent if a GPT-5.6 variant is unavailable. Keep runtime model selection provider-neutral and user-overridable. Use high reasoning for architecture and failure policy, medium for focused code, and lighter models only for bounded independently checked tasks.

### Step 0 — Inventory the actual checkout

Read `AGENTS.md`, this plan, contributor guidance, and the existing inventory. Record branch/commit, modified and untracked files, upstream delta, package checks, and actual features. Trace `sdk.ts` (`buildSystemPrompt`/`rebuildSystemPrompt`), `session/agent-session.ts`, `session/session-tools.ts`, `prompt-engine/` including the untracked router, `task/`, plan mode, `extensibility/skills.ts`, `session/context-notes.ts`, `session/session-handoff.ts`, `session/turn-recovery.ts`, `packages/agent/src/compaction/`, `goals/`, `memory-backend/`, advisor, and review. Label each item **COMPLETED**, **IN PROGRESS**, or **PLANNED** from current source and checks. Pin both current and upstream OMP revisions for repeatable small/normal/complex/massive task baselines; mark unauthenticated/offline outcomes separately. Preserve existing changes.

**Acceptance:** concise architecture map, gap matrix with paths/symbols, exact baseline results, narrow integration points, and one dependency-ready Governor slice. Keep this bounded; it is not an indefinite research phase.

### Step 1 — Harden the Prompt Engine

Validate profiles and `/prompt` against startup, model switch, tool changes, extensions, custom `SYSTEM.md`, user/project overrides, SDK/RPC/ACP, and compaction. If inventory confirms that rendered-heading splitting is fragile, move to explicit module composition inside the existing `buildSystemPrompt` pipeline while preserving default behavior. Keep required runtime, safety, tool policy, project instructions, and delivery constraints. Show source, activation reason, and measured versus estimated token cost per module. Make prompt exposure and actual tool permission distinct.

**Acceptance:** unchanged defaults or documented migration; deterministic ordering/precedence; no duplicated instructions; effective prompt inspectable; tool/model changes rebuild correctly; focused lifecycle tests. Report token savings only against a reproducible baseline and task-outcome checks.

### Step 2 — Dynamic capability routing and loading

Review and build on the untracked `prompt-engine/capability-router.ts` delegation slice before generalizing it. Use OMP discovery, `xd://` or equivalent activation, existing skills/extensions, and tool registry. A router takes task intent, role, available tools, model constraints, user policy, and governor context budget; it returns the smallest compatible capability set plus explanations. Keep concise descriptions available and load full guidance only when needed. Re-evaluate on task transition, model switch, extension availability, and missing-tool signal. Explicit invocation wins when policy allows it. Avoid repeated toggling; never silently reactivate disabled capabilities or bypass runtime permissions.

**Acceptance:** a task discovers and activates an existing capability on demand; unavailable and disabled states differ; selection is deterministic for fixed inputs, visible and bounded in token cost; activation/deactivation is idempotent; existing tools, LSP, DAP, web/research, skills, and providers still work.

### Step 3 — Adaptive Effort Governor core subsystem

Add a typed, side-effect-free decision function and settings for thresholds, confidence, per-band defaults and opt-in mode. Route planning depth, checks/reviewer policy, worker count/parallelism, role/tier, effort, context allocation and active prompt/tool set through existing Prompt Engine, Capability Router and Context Manager contracts. Resolve OMP model roles and supported effort through catalog metadata and configured selectors; do not branch on provider/model names in TypeScript. Respect explicit overrides and hard ceilings at selection and dispatch. Show why the decision was made and when it changed. Keep trivial work direct and cheap; do not make a planner or reviewer call mandatory for it.

**Acceptance:** table-driven tests cover four bands, low confidence, explicit overrides, unavailable models/tools, disabled capabilities, pinned choices, effort/agent caps, and no silent escalation. Fixed inputs yield reproducible decisions; a material scope change can revise the decision without thrashing; SDK/RPC/ACP behavior and defaults remain intact unless adaptive mode is enabled.

### Step 4 — Context Manager early

Coordinate existing token accounting, context notes, compaction, session persistence/handoff, memory retrieval, and file references. Budget by model window, governor decision, and task stage. Maintain a small working set: objective, constraints, decisions, plan/task state, touched files, verification evidence, and unresolved failures, each with a source. Retrieve project facts just in time; prefer current source/command output over stale memory. Before compaction, create a structured handoff; after compaction or resume, check that constraints, task state, pending user decisions, and evidence survived. Keep archive references for inspection instead of injecting full history. Do not replace OMP compaction or memory backends without evidence.

**Acceptance:** a long task survives compaction and process/session resume without losing objective, constraints, ownership, checks, or failure state; stale/conflicting memory is marked; token budget and selected context are inspectable; existing privacy/deletion settings continue to apply. Verify with interrupted-task fixtures and a realistic long-context case.

### Step 5 — Adaptive Agent Orchestrator as a core subsystem

Build a thin coordinator on native `task`, worktree isolation, Agent Hub, advisor, and `/review`, not another runner. The governor selects direct execution for trivial/normal tasks, planned single-agent work for complex tasks unless delegation helps, and bounded parallel work for massive decomposable tasks. Own an inspectable task graph and bounded scheduler. Use three roles when needed:

- **Planner:** scope work, dependencies, owners, acceptance criteria, checks, and decide whether delegation is useful.
- **Worker:** complete one bounded task in the appropriate workspace; return typed artifacts, diff, assumptions, and performed checks.
- **Reviewer:** independently compare result with request, plan, diff, and check evidence; return actionable findings. Reuse advisor/review where they fit.

Role instructions are Prompt Engine modules. Choose tools and models by policy, not provider hardcoding. Prefer one agent for simple work. Before parallel dispatch, check dependencies and path overlap. Reuse native steering, cancellation, timeouts, budgets, worktree ownership, and child cleanup. Parent integrates and remains accountable. Persist enough state to resume or rerun safely.

**Acceptance:** a representative task flows planner → worker(s) → reviewer; dependencies/concurrency hold; sibling edits stay isolated; conflicts are visible; cancellation leaves no orphaned agents or hidden edits; progress/cost/model choices are inspectable; supported non-OpenAI and local models work where their tool capabilities permit.

### Step 6 — First-class verification and bounded repair

Require a verification plan for every changed task. Select relevant formatting/lint, type checks, targeted tests, build, LSP diagnostics, configured project checks, and UI/browser evidence from repository facts and change scope. Reuse existing commands and review flows. Record baseline failures separately. Feed exact failure evidence to the worker, allow bounded repairs, rerun affected checks, then obtain independent review. Report unresolved failures rather than looping. Broader final checks apply when scope demands them; skipped checks need reasons.

**Acceptance:** no completion claim of “verified” without passing applicable checks or explicit unresolved/skipped status; command, exit code, artifact, and revision are linked; changed code is rechecked after repairs; retry/time limits hold; reviewer findings enter a finite repair loop; final report distinguishes passed, failed, and unrun checks. Preview destructive rollback and protect later user edits.

### Step 7 — A/B evaluation against current and upstream OMP

Version a suite of trivial, normal, complex, massive decomposable, ambiguous, failed-check, long-context/resume, and non-OpenAI/local-model tasks. Compare adaptive Pi Forge with **both** the current fork without adaptive mode and pinned upstream OMP using identical task inputs, repository snapshots, available models/providers, budgets, and scoring rules. Capture bounded redacted trajectories with opt-out, declared sample size and uncertainty. Prefer blind outcome grading where feasible. Keep offline policy/fixture tests distinct from authenticated task results.

| Metric | Operational definition |
|---|---|
| Classification/routing accuracy | Adjudicated complexity band and required capability/role match; confusion matrix and confidence calibration. |
| Token/context overhead | Prompt text, tool schema, retrieved context, and provider input/cache tokens per stage, reported separately. |
| Time-to-first-edit and total latency | Monotonic request-to-first-file-change and request-to-final-verified-response intervals. |
| Model/reasoning cost | Per-call role/model/effort and input/output/cache usage, billed or estimated cost, and missing-price flag. |
| Unnecessary-subagent rate | Spawned tasks whose adjudicated single-agent counterfactual met quality at lower cost/latency; report denominator and adjudication rule. |
| Verification catch rate | Seeded or independently adjudicated defects caught before final, plus false positives and misses. |
| Autonomous completion/survival | Acceptance met without human repair; objective, constraints, state and evidence survive interruption/compaction/resume. |
| Small-task regression | Trivial/normal success, edit quality, latency, tokens and spawn count against both baselines. |

Instrument governor decision version, confidence/reasons, override/ceiling clamps, routing/activation, first edit, checks/revisions, cost, interruption and final outcome. Do not store secrets or uncontrolled full transcripts. Gate default-on rollout on no material small-task regression and documented complex/massive quality gain; otherwise keep adaptive mode opt-in and tune from evidence.

**Acceptance:** another maintainer can rerun the comparison from pinned revisions and see bounded raw events, aggregate metrics, model/provider/budget settings, sample sizes, outcome quality, and regressions. Do not claim efficiency from token savings alone.

### Step 8 — Optional, evidence-gated work

Only after evaluation, consider task-stage model routing and provider fallback using existing model metadata, user policy, context, cost, latency, and quality modes. Allow pinning and transparent fallback; preserve providers and local models. Credential pools, new memory tiers, automatic skill learning, or a separate checkpoint store each need gap analysis and security/rebase review. None is a prerequisite for the executive-function loop.

## Cross-cutting implementation rules

- Preserve upstream defaults and keep changes in small rebaseable slices. Use existing settings, schemas, commands, and extension points. Misclassification, overplanning small tasks, silent model/effort/cost escalation, tool thrash, stale context, overlapping worker edits, and misleading verification are explicit risks; mitigate them with confidence fallback, ceilings, hysteresis, sourced context, worktree ownership, revision-linked evidence, and A/B gates.
- Follow `AGENTS.md`: model/provider policy in catalog KDL; prompt/role text in static `.md` templates; repository guidance on checks. Record exact verification outcomes.
- Treat project files, skills, generated summaries, and memory as untrusted content. Permissions are enforced outside prompts. Redact secrets in logs and trajectories.
- Every slice states dependencies, acceptance criteria, migration/default behavior, and SDK/RPC/ACP impact. Keep user override, inspection, steering, cancellation, and unresolved-failure reporting available.
- Do not overwrite later user edits during recovery. Compare source revisions and preview affected changes.

## First Codex CLI task

Start Codex CLI at the Pi Forge checkout with GPT-5.6 Sol High, or a currently available equivalent, and give it this task:

```text
Read AGENTS.md and root PLAN.md. Inspect current HEAD, all dirty/untracked files, and the existing inventory. Preserve existing changes. Refresh Step 0 evidence, especially the untracked capability-router.ts, and cite source paths and exact checks. Do not relabel an untracked or planned slice completed.

Then implement one narrow Step 3 prerequisite: a typed, side-effect-free Governor decision contract and table-driven policy tests for four bands, low-confidence fallback, explicit user/model/effort/agent overrides, and OMP ceilings. Integrate only the Prompt Engine/Capability Router contract needed for that slice. Keep adaptive behavior opt-in and defaults unchanged. Use OMP model roles/catalog facts, task settings, and the session effort ceiling; do not add an agent runner or hardcoded provider logic.

Report the decision schema, source-linked ceiling map, exact tests/results, known limits, and the next dependency-ready slice. Do not commit unless asked.
```
