Repair the two functions used by this standalone notes preview. Choose an appropriate execution strategy for this small task.

- src/labels.ts: normalizeLabels must trim and lowercase labels, remove empty labels, and deduplicate them in first-seen order without mutating its input.
- src/history.ts: recentHistory must return up to limit newest entries in original order without mutating its input. Zero or negative limits return []; a limit larger than the history returns a copy of all entries. Limits are integers.

Only src/labels.ts and src/history.ts may change. src/preview.ts and test/notes.test.ts are read-only; never change, rename, format, or add tests. Run bun test test/notes.test.ts to verify the result. No repository investigation, package installation, or design plan is needed.

If you choose to delegate, use the generic task agent with effort "med" when available. Each worker may edit only its owned source file, must keep tests read-only, and must not delegate further. The supplied settings pin model roles and generic workers to GPT-6 Luna Medium. Delegation is optional; no worker count or task-tool call is required.
