Repair only these two files:
- packages/coding-agent/bench/fixtures/governor-compact-notes-v1/src/labels.ts
- packages/coding-agent/bench/fixtures/governor-compact-notes-v1/src/history.ts

Use the generic task tool once with two independent items, each with isolated: true and effort "lo" when available. One worker owns only labels.ts; the other owns only history.ts. Repeat the exact file ownership and read-only test restriction in shared context and each assignment. Workers must not delegate or run checks. All model roles are pinned to GPT-6 Luna Low.

normalizeLabels must trim and lowercase labels, remove empty labels, and deduplicate in first-seen order without mutating its input. recentHistory must return up to limit newest entries in original order without mutating input. Zero or negative integer limits return []; larger limits return a copy of all entries.

The entire test file packages/coding-agent/bench/fixtures/governor-compact-notes-v1/test/notes.test.ts is read-only: never change, rename, format, or add tests. Keep preview.ts unchanged. No repository investigation, package installation, or design plan is needed.

Allow the host integration gate to verify the merged work with bun test packages/coding-agent/bench/fixtures/governor-compact-notes-v1/test/notes.test.ts and report its structured outcome. If integration verification already passed, do not repeat the check yourself. Return a short result.

Before finishing, use wait to obtain the final Integration gate job snapshot. The benchmark requires the host completion record; a worker yield alone does not satisfy acceptance.
