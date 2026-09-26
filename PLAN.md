# OMP 2.0 Development Project

We are building an experimental enhancement/fork of oh-my-pi (OMP) Called Pi-Forge. I have already forked the repo can1357/oh-my-pi to my github as design-nexus/pi-forge and cloned it to this directory.

The objective is not to rewrite OMP. Preserve upstream architecture wherever practical and implement features through existing abstractions, capabilities, extensions, configuration systems, and APIs.

The long-term goal is to evolve OMP into a more token-efficient autonomous software-engineering runtime.

## Core Principles

1. Preserve compatibility with upstream OMP whenever practical.
2. Prefer extending existing abstractions over introducing parallel systems.
3. Keep changes modular and independently testable.
4. Do not make large architectural changes without first documenting why the existing architecture cannot support the requirement.
5. Maintain backward compatibility unless explicitly approved otherwise.
6. Every major feature must include tests.
7. Measure performance and token usage rather than assuming an optimization works.
8. Optimize for maintainability and future upstream rebasing.
9. Never reduce agent capability merely to reduce token usage.
10. Pay complexity and token costs only when a task requires the corresponding capability.

# Phase 0: Repository Analysis

DO NOT IMPLEMENT FEATURES YET.

First inspect the current OMP repository thoroughly.

Study at minimum:

- system prompt construction
- prompt templates
- buildSystemPrompt()
- AgentSession
- createAgentSession()
- capability discovery
- configuration discovery
- SYSTEM.md / SYSTEM\_TEMPLATE.md behavior
- context files
- tool registration
- runtime tool activation
- extensions
- slash commands
- task agents
- model registry
- settings
- existing tests for these systems

Identify exactly how the final system prompt is assembled and when it is rebuilt.

Trace the path:

configuration/discovery\
→ capabilities\
→ tools\
→ prompt construction\
→ AgentSession\
→ provider request

Also determine which parts of the system prompt are:

- unconditional
- conditional
- generated dynamically
- tool-specific
- model-specific
- project-specific
- user-specific

Measure the approximate token contribution of each major section using the tokenizer or token-counting facilities already available in the repository where possible.

Produce:

docs/omp2/ARCHITECTURE\_ANALYSIS.md

Include:

- current architecture
- important source files
- prompt assembly lifecycle
- extension points
- configuration lifecycle
- system-prompt token breakdown
- architectural risks
- recommended implementation strategy

Do not modify production behavior during Phase 0.

STOP after Phase 0 and present the findings before beginning Phase 1.

---

# Phase 1: Modular Prompt Engine

After Phase 0 has been reviewed, design a modular Prompt Engine.

Goal:

OMP should send the model only the instructions required for the current task while retaining full functionality when those capabilities are needed.

Do NOT simply shorten the existing system prompt.

Instead, decompose it into composable modules.

Conceptual structure:

PromptEngine\
├── Core\
├── Coding\
├── Tools\
├── Agent Behavior\
├── Project\
├── User\
└── Model-specific modules

A prompt module should have metadata approximately equivalent to:

- id
- name
- description
- content/template
- category
- activation policy
- dependencies
- priority/order
- estimated token cost
- applicable models/providers

Do not blindly implement this schema if existing OMP abstractions provide a cleaner solution.

## Activation Policies

Support three conceptual states:

ALWAYS\
AUTOMATIC\
DISABLED

ALWAYS:\
Include the module in every applicable request.

AUTOMATIC:\
Load/include the module only when relevant.

DISABLED:\
Do not include the module.

Determine the safest mechanism for AUTOMATIC activation based on OMP's current architecture.

Avoid requiring the model to know instructions that have not yet been loaded.

Capabilities must therefore expose enough lightweight metadata for the agent/runtime to discover their existence safely.

---

# Prompt Profiles

Implement profiles:

Minimal\
Coding\
Agentic\
Full\
Custom

Profiles define sensible module activation defaults.

Full should preserve behavior as close as practical to existing OMP.

Minimal should target simple questions and edits.

Coding should target normal software development.

Agentic should enable planning, task agents, verification, and related autonomous capabilities.

Custom should use explicit user configuration.

---

# Configuration

Integrate with OMP's existing configuration system.

Support user-level and project-level configuration using the same precedence conventions OMP already uses.

Do not introduce a completely independent configuration mechanism unless necessary.

A conceptual configuration might resemble:

profile = "coding"

capabilities:\
lsp = always\
git = always\
testing = automatic\
subagents = automatic\
browser = automatic\
debugger = automatic\
github = automatic\
images = disabled\
mcp = automatic

The actual representation should follow existing OMP conventions.

---

# Prompt Inspection

Implement:

/prompt stats

Display:

- active profile
- currently loaded modules
- activation policy
- token count per module
- total system-prompt tokens
- available lazy modules
- estimated tokens saved relative to Full

Implement:

/prompt inspect

Display the assembled system prompt in a readable form with module boundaries.

Provide a way to inspect why a module was activated.

Example:

browser\
Activation: AUTOMATIC\
Reason: browser tool activated\
Tokens: 1,284

---

# Prompt Setup Wizard

Implement:

/prompt setup

Create an interactive TUI configuration wizard using OMP's existing UI infrastructure.

The wizard should allow selection of:

Profile

and individual capability policies:

Always\
Automatic\
Disabled

Show estimated base system-prompt token usage while configuration changes.

Allow saving to:

User configuration

or

Project configuration

Do not hand-build a second UI framework.

Use OMP's existing TUI primitives.

---

# Lazy Capability Loading

Investigate whether OMP's existing runtime tool activation and system-prompt rebuild mechanism can serve as the basis for lazy prompt loading.

Prefer integrating with that mechanism.

A capability in AUTOMATIC mode should initially expose only enough information to allow OMP to determine when it is required.

When activated:

1. activate capability
2. activate required tools if necessary
3. inject its prompt module
4. rebuild/update system prompt safely
5. continue execution

Avoid unnecessary context duplication.

Document how this interacts with prompt caching.

---

# Token Accounting

Create a reusable token accounting facility for prompt construction.

It should be possible to determine:

Total system prompt tokens

and approximately:

Core            X\
Coding          X\
Git             X\
LSP             X\
Browser         X\
Task agents     X\
Project rules   X\
User rules      X

Token measurement must use an appropriate tokenizer when available.

Do not estimate tokens using character count unless no better mechanism exists.

---

# Tests

Add comprehensive tests for:

- module composition
- deterministic ordering
- activation policies
- dependencies
- profile resolution
- user/project overrides
- lazy activation
- prompt rebuilding
- token accounting
- backward compatibility
- SYSTEM.md behavior
- SYSTEM\_TEMPLATE.md behavior
- context files
- extensions
- active tool changes

Create regression tests comparing Full profile behavior with current OMP behavior where appropriate.

---

# Benchmarks

Create a small benchmark suite.

Representative tasks:

1. simple question
2. one-file code edit
3. multi-file coding task
4. debugging task
5. Git operation
6. browser task
7. task-agent workflow

For each record:

- initial system prompt tokens
- peak system prompt tokens
- total input tokens where measurable
- capabilities activated
- execution success

Compare:

Current OMP / Full

against:

Minimal\
Coding\
Agentic

Primary metric:

system prompt token reduction without loss of required functionality.

---

# Phase 2: Guardian

After the Prompt Engine is stable, implement continuous verification.

Conceptual loop:

edit\
→ LSP diagnostics\
→ formatter\
→ typecheck/build\
→ affected tests\
→ static analysis\
→ AI review

Do not run expensive verification unnecessarily.

Determine affected validation based on changed files/project structure.

---

# Phase 3: Autopilot

Implement a higher-level autonomous workflow:

request\
→ inspect\
→ plan\
→ task graph\
→ implement\
→ Guardian verification\
→ repair failures\
→ review\
→ final verification

Reuse OMP's existing task-agent system rather than replacing it.

Require explicit confirmation before destructive or high-impact actions.

---

# Phase 4: Automatic Model Router

Create task-aware model routing.

Model requirements may include:

fast\
cheap\
coding\
reasoning\
vision\
large-context

Profiles:

economy\
balanced\
quality\
max

Routing should occur at the task/subtask level rather than requiring one model for an entire session.

Track model usage, tokens, cost where available, latency, and success/failure.

---

# Phase 5: Project Brain

Create structured persistent project knowledge.

Store concepts such as:

architecture\
decisions\
coding conventions\
important components\
dependencies\
known bugs\
failed approaches\
project roadmap

Architectural decisions should preserve rationale.

Example:

Decision:\
Use SQLite.

Reason:\
Application is local-first and does not require a database server.

Avoid treating all project memory as undifferentiated embeddings.

Use semantic retrieval as an index over structured knowledge where useful.

---

# Phase 6: Visual Verification

For GUI applications support:

build\
→ launch\
→ screenshot\
→ inspect\
→ compare against requirement/design\
→ modify\
→ repeat

Design this so visual verification is optional and capability-driven.

---

# Phase 7: Advanced Agent Orchestration

Build dependency-aware multi-agent execution on top of OMP's existing task-agent infrastructure.

Potential roles:

Planner\
Researcher\
Architect\
Implementer\
Tester\
Reviewer\
UI Reviewer

Agents should only be created when useful.

Simple tasks should remain simple.

---

# Development Workflow

For every phase:

1. inspect relevant existing implementation
2. document proposed architecture
3. identify reusable OMP components
4. write/update tests
5. implement smallest viable version
6. run tests
7. run static/type checks
8. review diff
9. benchmark when applicable
10. document behavior
11. stop for review before beginning the next major phase

Do not automatically proceed through every phase.

Treat each phase as a separately reviewable milestone.

# FIRST TASK

Begin ONLY with Phase 0.

Analyze the repository.

Do not implement the Prompt Engine yet.

Produce:

docs/omp2/ARCHITECTURE\_ANALYSIS.md

Also produce a proposed Phase 1 implementation plan containing likely files to modify, new files if necessary, tests required, migration/backward-compatibility concerns, and open architectural questions.

Then stop and present the findings.
