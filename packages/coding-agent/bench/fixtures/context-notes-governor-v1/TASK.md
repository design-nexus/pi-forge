# Implement experimental context notes

Implement the experimental context-notes feature in the Pi coding agent. Users should be able to read and replace a branch-scoped notebook, store independently retained findings, cite earlier entries on the active branch, and recover cited context when needed. Notes must persist in the session journal, respect reset and compaction boundaries, enforce byte and model-token budgets, and appear in the built session context without double-counting message tokens. Expose the feature only for an enabled, live session owned by the tool caller; keep normal sessions unchanged.

The supplied tests define the observable contracts for storage, branch validity, retention across compaction, tool access, context assembly, and context usage reporting. Add static prompt files for any new instructions. Keep both support tests unchanged and run:

```sh
bun test packages/coding-agent/test/context-notes-bench.test.ts packages/tui/test/context-usage-bench.test.ts
```

This changes session-persisted user notes and may expose private context, so treat it as high risk. Use the coding agent's `task` tool once with exactly four independent implementation tasks, a shared `context`, and `highRisk: true` when the active schema supports that field. Assign the tasks by ownership:

1. Journal data model, branch/reset/compaction validity, and cited-entry recovery in `packages/coding-agent/src/session/context-notes.ts` and the related session types.
2. Tool schema, live-session ownership checks, and byte/model-token budget enforcement in `packages/coding-agent/src/tools/context-notes.ts`, settings, and tool registration.
3. Prompt and context assembly integration in `packages/coding-agent/src/system-prompt.ts` and static prompt files.
4. Context usage accounting and status-line reporting in `packages/coding-agent/src/session/context-usage-runtime.ts`, `packages/coding-agent/src/session/session-stats.ts`, and `packages/tui/src/status-line/context-usage.ts`.

Use the shared context to agree on the note representation, session API, and ownership boundaries before dispatch. Have each task return its changed paths and contract coverage. Integrate the results, resolve any interface mismatches, then run the supplied acceptance command once. Do not modify the supplied support tests. Keep production changes within the manifest's allowed file list.
