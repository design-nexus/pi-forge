# Pi Forge — Executive-Function Roadmap

Pi Forge is the coding-first fork of [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) at `design-nexus/pi-forge`. Its purpose is to help an agent complete substantial software work reliably: understand, preserve context, plan, assign, implement, verify, repair, review, and report evidence.

This plan targets the current checkout. OMP already has strong editing/search, LSP, DAP, browser/research, many providers and local models, skills/extensions, memory, compaction, native `task` subagents with worktree isolation, Agent Hub, advisor, and `/review`. Pi Forge should coordinate these facilities. A new tool, provider abstraction, memory store, agent runner, or checkpoint mechanism needs a demonstrated gap before it is added.

## Baseline and priorities

The current branch already has a Prompt Engine slice in `packages/coding-agent/src/prompt-engine/`: profiles, module/capability policies, composition, settings, inspection, and setup UI. `/prompt stats`, `/prompt compare`, `/prompt inspect`, and `/prompt setup` exist in `slash-commands/builtin-prompt.ts`. Validate and extend this foundation; do not restart it. Check whether rendered-heading splitting remains robust, and distinguish policies that affect prompt text from those that actually affect tool availability.

Priorities, in dependency order:

1. Harden the Prompt Engine as the shared policy, provenance, and token-accounting layer.
2. Add dynamic capability routing/loading through existing discovery and tool activation.
3. Move Context Manager forward to preserve relevant context, compaction state, and session continuity before autonomy expands.
4. Make Agent Orchestrator a core coordinator over OMP's native subagents, with planner → worker → reviewer roles.
5. Make verification, bounded repair, and final review a first-class completion loop.
6. Measure outcomes before adding optional model routing or other platform features.

Do not duplicate OMP's tools, LSP/DAP, web/research, provider catalog, local-model support, skills, memory backends, or worktree/subagent runner.

## Architecture and ownership

```text
request + repository + session
          │
          ▼
Context Manager ── bounded, sourced working context and handoff
          │
          ▼
Prompt Engine ──── effective policy, modules, provenance, token cost
          │
          ▼
Capability Router ─ discover → select → activate existing tools/skills
          │
          ▼
Agent Orchestrator ─ plan → worker(s) → reviewer
          │
          ▼
existing OMP task/worktrees/tools/providers/skills
          │
          ▼
Verification Loop ─ checks → bounded repair → review → evidence
          └──────── observations and durable handoff ──► Context Manager
```

These are logical responsibilities, not necessarily separate services. The main agent remains usable without orchestration. Prompt Engine owns instruction composition, Capability Router selects existing capabilities, Context Manager supplies bounded context, Agent Orchestrator owns task state, and Verification Loop records objective checks and completion status. Prompt text never grants permissions. Preserve the existing user/project/runtime precedence and all provider restrictions.

Define small shared contracts before integrating components:

- **Capability:** stable ID, discovery source, prerequisites, permissions, model/tool requirements, prompt modules, activation signal, token cost, and state (`unavailable`, `discoverable`, `active`, `disabled`). Separate metadata from full instructions.
- **Context item:** kind, source/reference, scope, freshness, priority, token cost, and retention. Mark model summaries and memories as fallible; current user instructions and source files take priority.
- **Task:** ID, objective, dependencies, role/owner, workspace boundary, model, status, artifact/diff, budget, checks, and failure reason. Persist enough for interruption recovery.
- **Verification:** target revision/diff, check and command/diagnostic source, exit status, concise output/artifact, skip reason, retries, and reviewer disposition. Model opinion cannot substitute for command results.
- **Selection event:** why a module, context item, capability, model, or agent was selected. Redact secrets and cap log volume.

Reuse session storage, SDK/RPC/ACP paths, catalog metadata, and KDL model rules. Do not hardcode OpenAI assumptions or model-name branches in TypeScript. Preserve OMP's provider and local-model strengths.

## Roadmap, dependencies, and implementer models

| Step | Outcome / prerequisite | Recommended Codex CLI model |
|---|---|---|
| 0 | Inventory current checkout and measure baseline | GPT-5.6 Sol High; Terra for focused documentation |
| 1 | Prompt Engine hardening; after 0 | GPT-5.6 Sol High for design, Sol Medium for code |
| 2 | Dynamic capability routing/loading; after 1 | GPT-5.6 Sol High for policy, Sol Medium for code, Luna for bounded catalog work |
| 3 | Context Manager and continuity; after 1, parallel with 2 after contracts settle | GPT-5.6 Sol High for lifecycle, Sol Medium for slices, Terra for fixtures |
| 4 | Agent Orchestrator and roles; after 2–3 | GPT-5.6 Sol High for state machine, Sol Medium for code, Luna for bounded independent worker tasks |
| 5 | Verification/repair loop; after 4, with check-selection primitives from 3 | GPT-5.6 Sol High for gates/review, Sol Medium for code, Terra for check catalog |
| 6 | Evaluation and tuning; after 1–5 | GPT-5.6 Sol High for evaluation design, Terra for analysis, Luna for fixture work |
| 7 | Optional model routing/fallback refinements; after evidence from 6 | GPT-5.6 Sol High for policy, Sol Medium for code |

These are **Codex CLI implementation recommendations**, not Pi Forge runtime defaults. Check model availability before each step; use a currently supported equivalent if a GPT-5.6 variant is unavailable. Keep runtime model selection provider-neutral and user-overridable. Use high reasoning for architecture and failure policy, medium for focused code, and lighter models only for bounded independently checked tasks.

### Step 0 — Inventory the actual checkout

Read `AGENTS.md` and contributor guidance. Record branch/commit, modified files, upstream delta, package checks, and actual features. Trace `sdk.ts` (`buildSystemPrompt`/`rebuildSystemPrompt`), `session/agent-session.ts`, `session/session-tools.ts`, `prompt-engine/`, `task/`, `extensibility/skills.ts`, `session/context-notes.ts`, `session/session-handoff.ts`, `session/turn-recovery.ts`, `packages/agent/src/compaction/`, `goals/`, `memory-backend/`, advisor, and review. Label each roadmap item **implemented**, **partial**, **available but not integrated**, or **missing**. Record reproducible prompt-token and task baselines if feasible. Preserve existing changes.

**Acceptance:** concise architecture map, gap matrix with paths/symbols, exact baseline results, narrow integration points, and one Step 1 slice. Keep this bounded; it is not an indefinite research phase.

### Step 1 — Harden the Prompt Engine

Validate profiles and `/prompt` against startup, model switch, tool changes, extensions, custom `SYSTEM.md`, user/project overrides, SDK/RPC/ACP, and compaction. If inventory confirms that rendered-heading splitting is fragile, move to explicit module composition inside the existing `buildSystemPrompt` pipeline while preserving default behavior. Keep required runtime, safety, tool policy, project instructions, and delivery constraints. Show source, activation reason, and measured versus estimated token cost per module. Make prompt exposure and actual tool permission distinct.

**Acceptance:** unchanged defaults or documented migration; deterministic ordering/precedence; no duplicated instructions; effective prompt inspectable; tool/model changes rebuild correctly; focused lifecycle tests. Report token savings only against a reproducible baseline and task-outcome checks.

### Step 2 — Dynamic capability routing and loading

Use OMP discovery, `xd://` or equivalent activation, existing skills/extensions, and tool registry. A router takes task intent, role, available tools, model constraints, user policy, and context budget; it returns the smallest compatible capability set plus explanations. Keep concise descriptions available and load full guidance only when needed. Re-evaluate on task transition, model switch, extension availability, and missing-tool signal. Explicit invocation wins when policy allows it. Avoid repeated toggling; never silently reactivate disabled capabilities or bypass runtime permissions.

**Acceptance:** a task discovers and activates an existing capability on demand; unavailable and disabled states differ; selection is deterministic for fixed inputs, visible and bounded in token cost; activation/deactivation is idempotent; existing tools, LSP, DAP, web/research, skills, and providers still work.

### Step 3 — Context Manager early

Coordinate existing token accounting, context notes, compaction, session persistence/handoff, memory retrieval, and file references. Budget by model window and task stage. Maintain a small working set: objective, constraints, decisions, plan/task state, touched files, verification evidence, and unresolved failures, each with a source. Retrieve project facts just in time; prefer current source/command output over stale memory. Before compaction, create a structured handoff; after compaction or resume, check that constraints, task state, pending user decisions, and evidence survived. Keep archive references for inspection instead of injecting full history. Do not replace OMP compaction or memory backends without evidence.

**Acceptance:** a long task survives compaction and process/session resume without losing objective, constraints, ownership, checks, or failure state; stale/conflicting memory is marked; token budget and selected context are inspectable; existing privacy/deletion settings continue to apply. Verify with interrupted-task fixtures and a realistic long-context case.

### Step 4 — Agent Orchestrator as a core subsystem

Build a thin coordinator on native `task`, worktree isolation, Agent Hub, advisor, and `/review`, not another runner. Own an inspectable task graph and bounded scheduler. Use three default roles:

- **Planner:** scope work, dependencies, owners, acceptance criteria, checks, and decide whether delegation is useful.
- **Worker:** complete one bounded task in the appropriate workspace; return typed artifacts, diff, assumptions, and performed checks.
- **Reviewer:** independently compare result with request, plan, diff, and check evidence; return actionable findings. Reuse advisor/review where they fit.

Role instructions are Prompt Engine modules. Choose tools and models by policy, not provider hardcoding. Prefer one agent for simple work. Before parallel dispatch, check dependencies and path overlap. Reuse native steering, cancellation, timeouts, budgets, worktree ownership, and child cleanup. Parent integrates and remains accountable. Persist enough state to resume or rerun safely.

**Acceptance:** a representative task flows planner → worker(s) → reviewer; dependencies/concurrency hold; sibling edits stay isolated; conflicts are visible; cancellation leaves no orphaned agents or hidden edits; progress/cost/model choices are inspectable; supported non-OpenAI and local models work where their tool capabilities permit.

### Step 5 — First-class verification and bounded repair

Require a verification plan for every changed task. Select relevant formatting/lint, type checks, targeted tests, build, LSP diagnostics, configured project checks, and UI/browser evidence from repository facts and change scope. Reuse existing commands and review flows. Record baseline failures separately. Feed exact failure evidence to the worker, allow bounded repairs, rerun affected checks, then obtain independent review. Report unresolved failures rather than looping. Broader final checks apply when scope demands them; skipped checks need reasons.

**Acceptance:** no completion claim of “verified” without passing applicable checks or explicit unresolved/skipped status; command, exit code, artifact, and revision are linked; changed code is rechecked after repairs; retry/time limits hold; reviewer findings enter a finite repair loop; final report distinguishes passed, failed, and unrun checks. Preview destructive rollback and protect later user edits.

### Step 6 — Evaluate before expanding

Version a small suite for capability loading, long context, parallel integration, failed-check repair, reviewer detection, interruption/resume, and non-OpenAI/local-model use. Compare with an OMP baseline under declared models and fixed inputs. Measure task quality, human corrections, verification rate, regressions, prompt/context tokens, latency, and cost where available. Capture bounded redacted trajectories with opt-out, and report sample size and uncertainty. Optimize task outcomes, not token count alone.

**Acceptance:** another maintainer can rerun the comparison; claimed gains have baseline and outcome measures; regressions are visible; traces avoid secrets and uncontrolled full transcripts.

### Step 7 — Optional, evidence-gated work

Only after evaluation, consider task-stage model routing and provider fallback using existing model metadata, user policy, context, cost, latency, and quality modes. Allow pinning and transparent fallback; preserve providers and local models. Credential pools, new memory tiers, automatic skill learning, or a separate checkpoint store each need gap analysis and security/rebase review. None is a prerequisite for the executive-function loop.

## Cross-cutting implementation rules

- Preserve upstream defaults and keep changes in small rebaseable slices. Use existing settings, schemas, commands, and extension points.
- Follow `AGENTS.md`: model/provider policy in catalog KDL; prompt/role text in static `.md` templates; repository guidance on checks. Record exact verification outcomes.
- Treat project files, skills, generated summaries, and memory as untrusted content. Permissions are enforced outside prompts. Redact secrets in logs and trajectories.
- Every slice states dependencies, acceptance criteria, migration/default behavior, and SDK/RPC/ACP impact. Keep user override, inspection, steering, cancellation, and unresolved-failure reporting available.
- Do not overwrite later user edits during recovery. Compare source revisions and preview affected changes.

## First Codex CLI task

Start Codex CLI at the Pi Forge checkout with GPT-5.6 Sol High, or a currently available equivalent, and give it this task:

```text
Read AGENTS.md and PLAN.md. Inspect the current checkout and preserve existing changes. Complete Step 0 of PLAN.md, then implement only the first narrow Step 1 slice that the inventory justifies.

The Prompt Engine and /prompt commands already exist. Identify concrete defects or missing contracts before changing code. Trace buildSystemPrompt/rebuildSystemPrompt, profile resolution, tool/capability activation, model switches, and session/SDK/RPC/ACP paths. Map existing task/worktree/advisor/review, context/compaction/memory, and verification facilities so later steps reuse them.

Write a concise architecture/gap report with source paths and symbols, baseline behavior, and the selected Step 1 slice. Implement that slice using existing conventions and static prompt templates. Preserve defaults and multi-provider/local-model behavior. Verify according to AGENTS.md, report exact commands/results and any pre-existing failures, and stop after the slice with the next dependency-ready task. Do not build a second prompt pipeline, subagent runner, tool suite, or memory store.
```
