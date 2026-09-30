# Pi Forge Development Plan

> **Project:** Pi Forge
> **Upstream:** Oh My Pi (OMP)
> **Repository:** `design-nexus/pi-forge`
> **Primary goal:** Build an adaptive, efficient, provider-neutral agentic coding harness on top of OMP's existing strengths.

---

# 1. Vision

Pi Forge should not attempt to replace Oh My Pi's existing strengths.

OMP already provides a sophisticated coding-agent foundation, including tooling, model/provider support, subagents, orchestration primitives, LSP/DAP integration, memory/context facilities, worktrees, model roles, effort controls, and extensibility.

Pi Forge should concentrate on the layer above those capabilities:

> **Make the harness dynamically decide what intelligence, context, tools, capabilities, verification, and orchestration a task actually needs.**

The primary differentiator should therefore be:

## Adaptive Agentic Execution

Pi Forge should dynamically control:

- prompt composition
- capability activation
- context allocation
- model selection
- reasoning effort
- planning depth
- subagent use
- parallelism
- verification depth
- repair effort

based on the evolving requirements of the task.

The system should optimize for:

1. correctness
2. autonomous task completion
3. context efficiency
4. latency
5. token/model cost
6. minimal unnecessary orchestration

A five-line edit should remain fast.

A repository-wide migration should be allowed to become sophisticated.

---

# 2. Core Design Principle

Pi Forge should behave as a **feedback-controlled coding agent**.

The harness must not make all orchestration decisions once at task start.

Instead:

```text
User Task
    │
    ▼
Prompt Engine
    │
    ▼
Capability Router
    │
    ▼
Adaptive Effort Governor
    │
    ▼
Execution Strategy
    │
    ▼
Agent / Orchestrator
    │
    ├───────────────┐
    │               │
    ▼               ▼
Execution       Context Manager
    │               │
    ├───────────────┤
    │               │
    ▼               ▼
Integration     Runtime Telemetry
    │               │
    ▼               │
Verification        │
    │               │
    ▼               │
Bounded Repair      │
    │               │
    └───────────────┘
            │
            ▼
   Adaptive Reassessment
            │
     ┌──────┼──────┐
     ▼      ▼      ▼
 Escalate Maintain De-escalate
```

Execution continuously generates evidence about the true difficulty of the task.

The Governor should react to that evidence.

---

# 3. Architecture

## 3.1 Prompt Engine

**Priority: Foundational**

The Prompt Engine dynamically assembles the system prompt instead of loading the complete instruction surface for every request.

### Prompt Profiles

Initial profiles:

- Minimal
- Coding
- Agentic
- Full
- Custom

### Capability States

Each capability can be:

- Always
- Automatic
- Disabled

Automatic capabilities are activated only when required.

### Commands

Planned interfaces:

```text
/prompt setup
/prompt profile
/prompt stats
/prompt capabilities
```

### Responsibilities

The Prompt Engine should:

- maintain a minimal stable core prompt
- lazily load capability instructions
- activate tool-specific instructions only when needed
- cooperate with the Capability Router
- cooperate with Context Manager budgets
- expose token usage statistics
- support provider/model-specific prompt adaptations without coupling the architecture to a provider

### Goal

Reduce instruction overhead and instruction interference while preserving model effectiveness.

---

# 4. Capability Router

The Capability Router determines what capabilities the current task requires.

Examples:

```text
coding
debugging
testing
git
research
browser
LSP
DAP
subagents
planning
review
documentation
```

Instead of:

```text
load everything
    ↓
ask model what it needs
```

Pi Forge should prefer:

```text
classify task
    ↓
activate likely capabilities
    ↓
execute
    ↓
activate additional capabilities if evidence requires them
```

Capability activation must remain reversible.

Unused capabilities should eventually be demoted or unloaded where possible.

---

# 5. Adaptive Effort Governor

## 5.1 Purpose

The Adaptive Effort Governor is the central control system for Pi Forge.

It decides **how much machinery a task deserves**.

It should coordinate existing OMP mechanisms rather than recreate them.

Conceptual effort bands:

```text
TRIVIAL
NORMAL
COMPLEX
MASSIVE
```

These are policy concepts, not hardcoded implementation assumptions.

Users and configuration should be able to modify them.

---

## 5.2 Initial Routing

### Trivial

Examples:

- rename
- typo
- tiny configuration change
- obvious localized fix

Default strategy:

```text
direct execution
↓
minimal verification
↓
done
```

Avoid:

- planning agents
- reviewers
- parallel workers
- expensive models unless explicitly requested

### Normal

Examples:

- ordinary bug fix
- localized feature
- small multi-file modification

Strategy:

```text
direct execution
↓
targeted verification
↓
repair if necessary
```

### Complex

Examples:

- architectural change
- significant refactor
- difficult bug
- broad feature

Strategy:

```text
short plan
↓
execute
↓
review where justified
↓
verification
↓
bounded repair
```

### Massive

Examples:

- repository-wide migration
- major subsystem
- large decomposable implementation

Strategy:

```text
plan
↓
decompose
↓
parallel workers
↓
worker verification
↓
integration gate
↓
review
↓
final verification
↓
bounded repair
```

---

# 6. Continuous Effort Reassessment

**Critical addition**

Task classification must NOT be permanent.

The Governor should continuously evaluate whether the assigned effort band still reflects reality.

## Runtime Signals

Potential signals include:

- files searched
- files read
- files modified
- search breadth
- dependency depth
- diff size
- tool-call count
- build failures
- test failures
- repeated failures
- unexpected architectural complexity
- elapsed execution time
- token consumption
- context pressure
- number of discovered subtasks
- uncertainty/confidence
- progress trajectory

Do not implement a simplistic rule such as:

```text
files_read > 3 → Complex
```

Instead calculate a configurable **effort pressure / complexity score** from multiple signals.

---

## 6.1 Escalation

Example:

```text
TRIVIAL

Agent searches broadly
Agent reads 9 related files
Unexpected dependency discovered
No edit yet

↓

NORMAL

Additional architectural coupling discovered

↓

COMPLEX
```

Escalation may enable:

- planning
- additional context
- stronger model
- increased reasoning effort
- additional tools
- reviewer
- subagents
- broader verification

subject to operator limits.

---

## 6.2 De-escalation

The reverse must also be possible.

Example:

```text
COMPLEX predicted

↓

inspection reveals single incorrect conditional

↓

NORMAL or TRIVIAL
```

This prevents wasting:

- tokens
- latency
- expensive models
- subagents
- reviewer calls

---

## 6.3 Operator Authority

The Governor must respect:

- user-selected model
- user-selected effort
- maximum effort
- model-role settings
- subagent limits
- token/cost budgets
- provider restrictions

The Governor may operate **within** those limits.

It must never silently exceed them.

---

# 7. Context Manager

Context quality is expected to be one of the largest determinants of long-horizon coding performance.

Pi Forge should explicitly manage the model's working set.

---

# 8. Tiered Working-Set Management

Context should have semantic priority tiers.

## PINNED

Information that normally cannot be evicted during the task:

- user objective
- user constraints
- project instructions
- AGENTS.md rules
- acceptance criteria
- critical diagnostics
- architectural invariants
- operator limits

## HOT

Information directly involved in current execution:

- active diff
- files currently being modified
- immediate dependencies
- current test failures
- current implementation plan

## WARM

Relevant supporting information:

- architecture discovered during exploration
- recently referenced files
- related interfaces
- useful historical observations

## COLD

Potentially disposable information:

- speculative searches
- stale grep output
- old directory listings
- resolved diagnostics
- rejected hypotheses
- previously inspected but currently irrelevant files

## EVICTED / SUMMARIZED

Raw information removed from active context.

Useful information should normally be compressed before eviction.

Example:

```text
8,000 tokens exploration
        ↓
semantic compression
        ↓
150-token finding
```

Example compressed finding:

```text
Investigated token.ts and provider.ts.
Neither causes refresh race.

Race originates around SessionManager.refresh()
lock acquisition.

Relevant files:
- session.ts
- auth.ts
- auth.test.ts
```

---

# 9. Relevance Decay

Context should not become cold simply because a fixed number of turns elapsed.

Relevance should consider:

- recency
- current diff relationship
- dependency relationship
- references by current plan
- test/error relationship
- unresolved questions
- semantic similarity to current subtask

A read-only architecture file may remain important for an entire task.

A huge grep result may become useless immediately.

Context policy should behave more like an intelligent cache than a FIFO queue.

---

# 10. Agent Orchestrator

Pi Forge should build on OMP's existing agent/subagent infrastructure.

The goal is **adaptive orchestration**, not merely "support subagents."

The Governor determines whether orchestration is justified.

Possible execution modes:

```text
DIRECT
DIRECT + VERIFY
PLAN + EXECUTE
PLAN + WORKER + VERIFY
PLAN + PARALLEL WORKERS + INTEGRATE + REVIEW
```

---

# 11. Subagent Roles

Logical roles may include:

## Planner

Produces:

- task decomposition
- dependencies
- risk areas
- acceptance criteria

## Worker

Owns an isolated implementation task.

## Reviewer

Examines completed work independently.

Focus:

- correctness
- missed requirements
- regressions
- architecture violations
- suspicious shortcuts

## Reconciliation Worker

Created when independently successful worker changes conflict after integration.

Its scope should be narrow and diagnostic.

---

# 12. Integration Gate

**Required whenever independent worker changes are combined.**

Worker-level success does not imply repository-level success.

Example:

```text
Worker A
✓ tests

Worker B
✓ tests

Worker C
✓ tests

Combined
💥
```

Therefore parallel execution must include:

```text
Workers
   ↓
Worker Verification
   ↓
Integration Gate
   ↓
Reviewer
   ↓
Final Verification
```

---

## 12.1 Integration Process

1. Start with a clean integration worktree/state.
2. Apply worker changes in deterministic order.
3. Detect merge/conflict problems.
4. Build/typecheck the unified result.
5. Run appropriate tests against the unified diff.
6. Diagnose cross-worker incompatibilities.
7. Generate targeted reconciliation work when needed.
8. Re-run integration checks.
9. Continue only within Repair Budget.

Do not immediately discard all worker output when integration fails.

---

# 13. Adaptive Verification

Verification depth should match task scope and risk.

Define conceptual verification levels.

## V0: Static Sanity

Examples:

- syntax
- formatting
- parse validity

## V1: Local Deterministic

Examples:

- lint
- typecheck
- touched unit tests
- directly related tests

## V2: Subsystem

Examples:

- package tests
- module tests
- affected component tests

## V3: Project

Examples:

- full build
- full unit suite
- repository-wide checks

## V4: External / Expensive

Examples:

- E2E
- network-dependent integration
- external services
- deployment validation
- expensive integration infrastructure

The Governor determines an appropriate:

```text
verification floor
verification ceiling
```

based on:

- task risk
- affected surface
- operator policy
- available infrastructure
- cost
- deterministic vs nondeterministic checks

---

# 14. Bounded Repair

Verification must never create an uncontrolled autonomous repair loop.

Use a multidimensional **Repair Budget**.

Potential dimensions:

```text
attempt count
token budget
model cost
wall-clock time
same-error repetitions
verification level
progress trajectory
```

---

## 14.1 Progress Detection

Pi Forge should distinguish:

```text
Attempt 1: 18 failures
Attempt 2: 5 failures
Attempt 3: 1 failure
```

from:

```text
Attempt 1: error X
Attempt 2: error X
Attempt 3: error X
```

The first demonstrates meaningful convergence.

The second indicates stagnation.

Repeated identical failures should exhaust the repair budget much faster.

---

## 14.2 Budget Exhaustion

When repair limits are reached:

Pi Forge must NOT pretend the task succeeded.

Return an explicit state such as:

```text
PARTIALLY COMPLETE

Implementation completed.

Verification unresolved:
integration/auth-refresh.test.ts

Failure:
timeout waiting for refresh lock

Automatic repair budget exhausted.

Recommended next action:
inspect locking behavior under concurrent refresh.
```

Preserve useful work and diagnostics.

---

# 15. Telemetry

Adaptive behavior cannot be improved without measurement.

Collect structured telemetry for:

- initial effort classification
- confidence
- effort reclassification
- escalation
- de-escalation
- capability activation
- capability unloading
- context tier movement
- context compression
- token usage
- time-to-first-edit
- total task latency
- model usage
- reasoning effort
- subagent count
- unnecessary subagent invocation
- verification level
- verification failures
- repair attempts
- integration failures
- reconciliation success
- final outcome

Telemetry should support privacy-conscious local operation.

---

# 16. Evaluation Harness

Pi Forge needs measurable evidence that its additional machinery improves OMP.

Maintain an A/B benchmark:

```text
A = current/upstream OMP behavior
B = Pi Forge adaptive behavior
```

Run identical tasks against both where practical.

---

## 16.1 Metrics

Measure:

### Correctness

- task completion rate
- tests passing
- requirement satisfaction

### Autonomous Task Survival

Measure how long the harness continues making correct progress before human intervention is required.

This should be a major Pi Forge metric.

### Efficiency

- input tokens
- output tokens
- total model cost
- context utilization
- latency
- tool calls

### Governor Quality

- initial classification accuracy
- escalation precision
- escalation recall
- de-escalation precision
- unnecessary orchestration rate

### Context Quality

- useful-context retention
- compression effectiveness
- erroneous eviction rate
- context-budget compliance

### Orchestration

- useful subagent rate
- unnecessary subagent rate
- parallel speedup
- integration failure rate
- reconciliation success

### Verification

- verification catch rate
- verification tier appropriateness
- false alarm rate
- repair convergence
- stagnation detection accuracy

### Small-Task Regression

Critical metric.

Pi Forge must not make trivial coding significantly slower than OMP.

---

# 17. Architecture Overview

```text
                       USER
                        │
                        ▼
                 ┌─────────────┐
                 │Prompt Engine│
                 └──────┬──────┘
                        │
                        ▼
                ┌────────────────┐
                │Capability Router│
                └───────┬────────┘
                        │
                        ▼
              ┌────────────────────┐
        ┌────►│Adaptive Effort     │◄────┐
        │     │Governor            │     │
        │     └─────────┬──────────┘     │
        │               │                │
        │               ▼                │
        │        ┌──────────────┐        │
        │        │ Orchestrator │        │
        │        └──────┬───────┘        │
        │               │                │
        │       ┌───────┼───────┐        │
        │       ▼       ▼       ▼        │
        │    Direct   Worker   Workers    │
        │               │       │        │
        │               └───┬───┘        │
        │                   ▼            │
        │           Worker Verification  │
        │                   │            │
        │                   ▼            │
        │          ┌────────────────┐    │
        │          │Integration Gate│    │
        │          └───────┬────────┘    │
        │                  ▼             │
        │               Reviewer         │
        │                  │             │
        │                  ▼             │
        │        Adaptive Verification   │
        │                  │             │
        │                  ▼             │
        │           Bounded Repair       │
        │                  │             │
        │                  ▼             │
        │               RESULT           │
        │                                │
        └──────── Runtime Telemetry ─────┘

             ┌─────────────────────┐
             │   Context Manager   │
             │                     │
             │ Pinned / Hot / Warm │
             │ Cold / Summarized   │
             └─────────────────────┘

Context Manager spans the entire execution lifecycle.
```

---

# 18. Implementation Roadmap

Repository state should be checked before implementation.

Do not redo functionality already implemented in Pi Forge or upstream OMP.

Mark each task:

```text
[COMPLETED]
[IN PROGRESS]
[PLANNED]
[UPSTREAM / REUSE]
```

based on actual repository evidence.

---

# Phase 0: Baseline and Inventory

## Objective

Understand exactly what Pi Forge and current OMP already provide.

### Tasks

- inventory current OMP agent architecture
- inventory subagent functionality
- inventory orchestration
- inventory model roles
- inventory effort controls
- inventory context/memory
- inventory worktrees
- inventory reviewer/advisor mechanisms
- inventory verification behavior
- inventory Prompt Engine work already completed in Pi Forge
- establish upstream OMP baseline
- create initial benchmark corpus

### Deliverable

```text
docs/architecture-baseline.md
```

plus benchmark fixtures.

### Recommended implementation model

**GPT-5.6 Sol**

Use high reasoning for architecture analysis.

---

# Phase 1: Prompt Engine

## Objective

Implement modular prompt composition and lazy capability loading.

### Tasks

- define prompt-module interface
- extract monolithic instructions into modules
- implement Prompt Profiles
- implement capability states
- implement `/prompt setup`
- implement `/prompt stats`
- measure prompt token reduction
- ensure compatibility with major provider families

### Acceptance Criteria

- minimal profile materially reduces baseline system tokens
- coding behavior does not regress materially
- capability modules can activate dynamically
- users can override automatic behavior
- provider-neutral interfaces

### Recommended model

**GPT-5.6 Sol** for architecture/refactor.

**GPT-5.6 Luna** for repetitive migrations/tests where appropriate.

---

# Phase 2: Capability Router

## Objective

Determine which prompt/tool/capability surfaces a task requires.

### Tasks

- capability registry
- task-to-capability classification
- confidence score
- activation/deactivation lifecycle
- Prompt Engine integration
- telemetry

### Acceptance Criteria

- irrelevant capabilities remain unloaded on simple tasks
- required capabilities reliably activate
- user override always wins
- capability activation can occur during execution

---

# Phase 3: Adaptive Effort Governor

## Objective

Select the cheapest execution strategy likely to complete the task correctly.

### Implement

- effort-band model
- configurable policy
- confidence
- orchestration strategy selection
- model-role selection
- reasoning-effort selection
- context-budget selection
- verification-floor/ceiling selection
- operator ceilings
- telemetry

### Initial Policy

```text
Trivial → direct + V0/V1
Normal → direct + V1/V2
Complex → plan + execute + V2/V3
Massive → decompose + workers + integration + review + V2/V3/V4 as appropriate
```

This is a default policy, not immutable behavior.

---

# Phase 3B: Continuous Effort Reassessment

Implement runtime feedback into the Governor.

### Signals

- exploration growth
- dependency discovery
- diff growth
- tool usage
- errors
- context pressure
- execution duration
- task decomposition
- progress/stagnation

### Requirements

Support:

```text
escalation
maintenance
de-escalation
```

without violating operator limits.

### Acceptance Criteria

Simple tasks incorrectly classified as complex can de-escalate.

Unexpectedly difficult tasks can escalate without restarting.

---

# Phase 4: Context Manager

## Objective

Maintain high-information-density context over long tasks.

### Implement

- Pinned
- Hot
- Warm
- Cold
- Summarized/Evicted

### Add

- relevance scoring
- relevance decay
- semantic compression
- context budgets
- context telemetry
- recovery of summarized findings where possible

### Acceptance Criteria

Long tasks retain objectives and critical architectural information.

Speculative exploration does not indefinitely consume active context.

Compressed context preserves materially useful findings.

---

# Phase 5: Adaptive Orchestration

## Objective

Use existing OMP subagent capabilities intelligently.

Do NOT recreate subagents merely for Pi Forge branding.

### Implement

Governor-driven decisions for:

- direct execution
- planning
- worker spawning
- parallelism
- reviewer invocation
- reconciliation agents

### Acceptance Criteria

Simple tasks rarely spawn subagents.

Parallelizable large tasks use workers where beneficial.

Subagent count remains bounded.

---

# Phase 6: Integration Gate

## Objective

Make parallel-agent output safe to combine.

### Implement

```text
worker outputs
↓
clean integration state
↓
deterministic merge/application
↓
unified build
↓
unified tests
↓
diagnosis
↓
targeted reconciliation
```

### Acceptance Criteria

Cross-worker incompatibilities are detected before final review.

Reconciliation targets the conflict rather than restarting the entire task.

Integration loops obey Repair Budget.

---

# Phase 7: Adaptive Verification

## Objective

Match verification effort to task risk.

### Implement

```text
V0
V1
V2
V3
V4
```

Separate deterministic checks from expensive/nondeterministic checks.

Governor selects verification floor and ceiling.

Operator can override.

---

# Phase 8: Bounded Repair

## Objective

Prevent runaway repair loops.

### Implement Repair Budget

Track:

- attempts
- tokens
- cost
- wall time
- repeated errors
- progress
- verification level

Implement failure fingerprinting.

Implement progress detection.

### Acceptance Criteria

Repeated identical failures terminate early.

Converging repairs may continue within budget.

Budget exhaustion produces explicit unresolved status.

No infinite repair loops.

---

# Phase 9: Evaluation and Optimization

Run A/B comparisons against OMP.

Benchmark categories:

```text
tiny edit
localized bug
multi-file feature
large refactor
debugging
repository migration
parallelizable feature
long autonomous task
```

Optimize for:

```text
correctness
autonomous survival
cost
latency
context efficiency
```

Do not optimize one metric at the expense of catastrophic regression elsewhere.

---

# 19. Effort Governor Configuration

Provide sane defaults but expose policy.

Possible configuration shape:

```yaml
governor:
  enabled: true

  reassessment:
    enabled: true

  limits:
    max_effort: high
    max_subagents: 4

  verification:
    max_level: V3

  repair:
    max_attempts: 3
    stagnation_limit: 2

  context:
    working_set: adaptive
```

Exact schema should follow existing OMP configuration conventions.

Do not introduce a second configuration philosophy unnecessarily.

---

# 20. Manual Overrides

Automation must remain subordinate to user intent.

Potential commands/options:

```text
--effort trivial
--effort normal
--effort complex
--effort massive

--no-subagents
--max-subagents N

--verify V2
--max-verify V3

--repair-budget N

--no-governor
```

Names should be reconciled with existing OMP CLI conventions before implementation.

---

# 21. Model Strategy

Runtime architecture must remain provider-neutral.

The Governor should reason in terms of capabilities:

```text
fast
cheap
strong-reasoning
coding-specialist
large-context
local
vision
```

not:

```text
if OpenAI → ...
```

Provider/model adapters translate capabilities into available models.

---

# 22. Development Model Recommendations

For building Pi Forge itself:

## Architecture

Use **GPT-5.6 Sol**, preferably higher reasoning, for:

- Governor architecture
- Context Manager
- Prompt Engine
- orchestration
- integration semantics
- major refactors

## Medium-complexity implementation

Use **GPT-5.6 Terra** where available for:

- isolated feature implementation
- tests
- CLI/config integration
- telemetry plumbing

## Mechanical / inexpensive work

Use **GPT-5.6 Luna** for:

- repetitive migrations
- straightforward test generation
- documentation synchronization
- mechanical refactors

Use stronger models when failures or architectural uncertainty indicate escalation is worthwhile.

This development workflow should itself mirror Pi Forge's eventual philosophy.

---

# 23. Safety and Reliability Invariants

Pi Forge must maintain the following invariants:

1. User instructions outrank Governor policy.
2. Governor cannot silently exceed configured effort ceilings.
3. Governor cannot silently select forbidden providers/models.
4. Context eviction must never intentionally remove mandatory project instructions.
5. Parallel workers cannot bypass integration verification.
6. Verification failure cannot be reported as success.
7. Repair loops must always be bounded.
8. Nondeterministic checks must not create infinite repair cycles.
9. De-escalation must not bypass required verification.
10. Adaptive behavior must be observable through telemetry/debug output.

---

# 24. Definition of Success

Pi Forge succeeds if it can take increasingly large coding tasks and maintain useful, correct progress longer than baseline OMP without making ordinary coding substantially slower or more expensive.

The desired curve is:

```text
Agent quality

100 ┤──────────── Pi Forge ─────────────╲
    │
 80 ┤────── OMP ──────╲
    │                  ╲
 60 ┤                   ╲
    │
 40 ┤
    │
    └─────────────────────────────────────
       tiny   10m   30m   1h   multi-hour

                task complexity/runtime
```

This diagram represents the target behavior, not measured performance.

The benchmark suite must determine whether Pi Forge actually achieves it.

---

# 25. Immediate Implementation Order

Codex should proceed in this order unless repository inspection shows that a step already exists:

```text
1. Audit current Pi Forge + upstream OMP
            ↓
2. Establish benchmark baseline
            ↓
3. Complete Prompt Engine foundation
            ↓
4. Capability Router
            ↓
5. Adaptive Effort Governor
            ↓
6. Continuous Effort Reassessment
            ↓
7. Context Manager / Working Set
            ↓
8. Adaptive Orchestration
            ↓
9. Integration Gate
            ↓
10. Adaptive Verification
            ↓
11. Bounded Repair
            ↓
12. Full evaluation harness
            ↓
13. Tune policy from measured results
```

Do not begin a subsystem by assuming upstream OMP lacks the necessary primitive.

Inspect first.

Reuse whenever practical.

Extend when necessary.

Replace only when there is measurable justification.

---

# 26. Codex Implementation Protocol

For every phase:

1. Inspect relevant existing OMP/Pi Forge implementation.
2. Document reusable primitives.
3. Identify the smallest architectural extension.
4. Write/update tests before broad refactoring where practical.
5. Implement incrementally.
6. Run targeted verification.
7. Run broader verification appropriate to risk.
8. Record benchmark/telemetry impact.
9. Compare against baseline.
10. Update this plan's status.

Each completed phase should record:

```text
Status:
Implementation:
Tests:
Benchmarks:
Known limitations:
Next dependencies:
```

Do not mark a phase complete merely because code exists.

Completion requires its acceptance criteria to pass.

---

# 27. Guiding Principle

Pi Forge should not win by having the largest prompt, the most agents, the most tools, or the longest reasoning traces.

It should win by applying **the right amount of intelligence at the right time**.

OMP provides the hands.

Pi Forge should provide the executive control system.

---

# 28. Current implementation status (2026-09-29)

Repository evidence: [architecture baseline](docs/architecture-baseline.md), [initial task corpus](docs/benchmark-corpus.md), and [checkout inventory](docs/omp2/CHECKOUT_INVENTORY.md). These statuses describe the local branch; they are not benchmark results.

| Phase | Status | Next dependency |
| --- | --- | --- |
| 0: Baseline and inventory | [IN PROGRESS] | Freeze executable task packets and run matched upstream/Pi Forge baselines. |
| 1: Prompt Engine | [IN PROGRESS] | Establish task-quality non-regression and material token impact in representative live sessions. |
| 2: Capability Router | [IN PROGRESS] | Connect task sources beyond task-tool and eval workpool declarations; evaluate natural-language selection and cleanup after deferred task transitions. |
| 3: Adaptive Effort Governor | [IN PROGRESS] | Bind more decisions to execution and verification while honoring operator ceilings. |
| 3B: Continuous Effort Reassessment | [IN PROGRESS] | Add progress and duration signals, then evaluate escalation and de-escalation on real tasks. |
| 4: Context Manager | [IN PROGRESS] | Add dependency-aware relevance from structured task graphs; evaluate local relevance against semantic matching. |
| 5: Adaptive Orchestration | [IN PROGRESS] | Bind reviewer decisions and graph dependencies where existing handles cannot. |
| 6–9 | [PLANNED] | Extend the OMP primitives identified in the architecture baseline. |

Status: Phase 0 baseline documented; outcome baseline pending.
Implementation: Prompt Engine, direct-tool routing, an opt-in Governor, structured task-fact routing, bounded task batches, workpool dispatch, and eval agent handles are present in the local working tree. Task graph facts can declare required direct-tool capabilities. In auto mode, the ordinary task tool accepts explicit capability requirements for a whole call or individual batch items; eval workpool batches can declare the same requirements in `.push(...)`. Transitions route only named capabilities subject to policy, availability, enabled tools, and context budget, then release Governor-owned routes omitted by the next structured transition. When invoked during streaming, task-driven routes apply after the current turn settles. A later explicit route takes ownership of an automatically promoted tool; a user-changed presentation is preserved during automatic release. Ordinary chat and task sources without structured declarations still do not provide capability requirements. Browser has an explicit session-scoped route gated by browser runtime availability, MCP routing can promote one exact registered tool, and `/prompt route` plus `/prompt unroute` expose explicit activation and restoration; automatic browser/MCP routing remains open. The Governor applies band-based effort selection to independent task batches and new workpool workers while preserving the current operator effort for trivial/normal scope, stepping complex work up one supported level, and selecting the highest available level for massive work, within configured ceilings. Explicit per-task effort and explicitly selected role effort retain priority. Each band also configures a verification floor and ceiling (V0–V4); high risk and recent check failures raise the selected floor within that ceiling. These are recommendations and do not schedule checks. Recent task and async-job duration now informs runtime escalation, and `/prompt governor` shows the latest persisted decision and its evidence. The three execution entry points share session concurrency accounting and retain their narrower local caps; workpool turns waiting for that slot report queued and cancel cleanly. Failed workpool items fail the aggregate background job after its queue drains. Context headroom limits Governor budgets; experimental sourced notebook recovery, current-turn citation, touched-file, explicit `@file`, active-todo file, and bounded local lexical relevance over cited user and successful tool text are present. Matching task terms receive age decay; `@file` paths are excluded from lexical matching to preserve ambiguity handling, and unmatched notes retain authored order. Per-finding pinned/window retention, todo continuity, and retained-context telemetry are also present. Semantic embeddings and dependency-aware relevance remain open.
Tests: Focused Prompt Engine and Governor contract suites exist; latest verification belongs to the checkout inventory.
Benchmarks: Offline prompt-text counts were rerun; no matched coding-outcome A/B data exists.
Known limitations: The task corpus is a scenario specification until each case has a frozen executable packet. Adaptive execution remains off by default; ordinary chat has no authoritative task graph, workpool items are independent, and no automatic verification or repair loop runs.
Next dependencies: Continue Capability Router runtime integration, bind more Governor decisions to orchestration, and add dependency-aware context relevance from structured task graphs. Evaluate whether semantic matching adds value beyond bounded local lexical scoring. Freeze benchmark packets before making performance claims.
