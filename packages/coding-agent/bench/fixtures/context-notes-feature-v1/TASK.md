# Implement experimental context notes

Implement the experimental context-notes feature in the Pi coding agent. Users should be able to read and replace a branch-scoped notebook, store independently retained findings, cite earlier entries on the active branch, and recover cited context when needed. Notes must persist in the session journal, respect reset and compaction boundaries, enforce byte and model-token budgets, and appear in the built session context without double-counting message tokens. Expose the feature only for an enabled, live session owned by the tool caller; keep normal sessions unchanged.

The supplied tests define the observable contracts for storage, branch validity, retention across compaction, tool access, context assembly, and context usage reporting. Add static prompt files for any new instructions. Run:

```sh
bun test packages/coding-agent/test/context-notes-bench.test.ts packages/tui/test/context-usage-bench.test.ts
```

Keep both support tests unchanged. The expected production changes are limited to the context-notes and context-usage implementation paths represented by those tests.
