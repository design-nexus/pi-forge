# Observe normal development

Hosted benchmarks are paused. Keep the production prompts; the measured edit-recovery candidate was rejected. Use normal development to identify recurring problems before spending more on comparisons.

## Start a task

Use a separate session directory for each real task, outside the repository. From this checkout, launch:

```sh
pi-forge \
  --model openai-codex/gpt-6-luna \
  --smol openai-codex/gpt-6-luna \
  --slow openai-codex/gpt-6-luna \
  --plan openai-codex/gpt-6-luna \
  --thinking low \
  --config /home/ken/Projects/pi-forge/docs/real-work-observation.yml \
  --session-dir "$HOME/.local/state/pi-forge/observations/task-name"
```

Replace `task-name` for each task. The overlay explicitly selects Governor off for an ordinary-use baseline and does not change saved settings. All named model roles select Luna; start with Low and use Medium only when a task needs it. Record any effort or model changes. Continue the same task using the same flags plus `--continue`. Session persistence records usage and tool results without additional evaluation calls. Avoid `--no-session`.

Use `/prompt stats` to inspect the active profile and `/session info` for the session identity. For deliberate Governor evaluation, use a separate task and an overlay with `adaptive.mode: auto`; record that condition. Ordinary-use observations across different tasks are not matched A/B comparisons.

## Collect an offline usage summary

After the task finishes, from this checkout:

```sh
bun -e 'import { readRunTelemetry } from "./packages/coding-agent/bench/task-outcome-ab.ts"; const report = await readRunTelemetry(process.argv[1]); console.log(JSON.stringify(report, null, 2));' \
  "$HOME/.local/state/pi-forge/observations/task-name" \
  > "$HOME/.local/state/pi-forge/observations/task-name-summary.json"
```

This reuses the benchmark's persisted-session accounting, includes nested worker sessions, and does not run a model. It counts assistant usage and auxiliary model usage; worker-result summaries are not added again. Keep each directory dedicated to one task: forks or copied histories can otherwise repeat usage. The summary reports turns, tool calls, input/output/cache tokens, total tokens, and estimated cost. It does not determine correctness or measure subscription quota. `pi-forge stats --summary` is available for broader usage trends, but aggregates sessions rather than isolating this task.

## Record the outcome

Save a short `outcome.md` alongside the session files:

```markdown
Task:
Repository and starting revision:
Session ID:
Model / effort / prompt profile / Governor mode:
Active work start and finish (exclude idle breaks):
Acceptance commands and outcomes:
Reviewed change scope:
Finished correctly / incomplete / needed manual correction:
User interventions and effort changes:
Repeated tool errors or repair loops (with session references):
```

The session logs preserve tool errors, verification attempts, and retries for offline inspection. Acceptance comes from executable checks and reviewing the change. A final assistant message claiming success is insufficient. Record failures and abandoned tasks too. Active task time requires the start/finish notes; session timestamps alone include idle time.

## Decide what to fix

Review the next useful set of real tasks together. Prioritize a recurring failure, excessive repair loop, or costly behavior with identifiable session evidence. Reproduce it locally, fix it, and verify the observable contract. Run a focused hosted comparison only when the fix has a specific performance hypothesis; use Luna Low first, Medium only if necessary, and no harness token/time cutoffs. Keep product repair safeguards in place.

The existing results justify trying Pi Forge, not a claim that it consistently beats OMP. Successful tasks, failed tasks, and interventions matter alongside usage and time.
