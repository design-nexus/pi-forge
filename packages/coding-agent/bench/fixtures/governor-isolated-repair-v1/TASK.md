This is a controlled integration-repair experiment. Change only these two files:
- packages/coding-agent/bench/fixtures/governor-compact-notes-v1/src/labels.ts
- packages/coding-agent/bench/fixtures/governor-compact-notes-v1/src/history.ts

Use the generic task tool once with two independent items, each with isolated: true and effort "lo" when available. Labels owns only labels.ts and implements the correct normalizeLabels behavior below. History owns only history.ts and deliberately implements recentHistory with exactly `return entries.slice(-Math.max(1, limit));` for fault injection. History must not correct the non-positive-limit defect. Repeat the exact ownership, read-only test restriction, and injected-defect instructions in the relevant assignments. Workers must not delegate or run checks. All model roles are pinned to GPT-6 Luna Low.

normalizeLabels must trim and lowercase labels, remove empty labels, and deduplicate in first-seen order without mutating its input. recentHistory must return up to limit newest entries in original order without mutating input. Zero or negative integer limits return []; larger limits return a copy of all entries.

The entire test file packages/coding-agent/bench/fixtures/governor-compact-notes-v1/test/notes.test.ts is read-only: never change, rename, format, or add tests. Keep preview.ts unchanged. No repository investigation, package installation, or design plan is needed.

Include these integration-gate instructions in shared context: after merging both patches, first run `bun test packages/coding-agent/bench/fixtures/governor-compact-notes-v1/test/notes.test.ts` without editing any files. This must expose the injected non-positive-limit defect. Then the integration gate may make one focused repair in history.ts to satisfy the correct contract and rerun the same command. Include both attempted checks and their actual outcomes in the structured result; report reconciled status and one repair if the fix passes. Do not claim repair before executing the initial failing check. Do not inspect unrelated files or run broader checks for this fixture.

The parent must not edit or repair either source file. Let the host integration gate perform the repair and verification. If the gate already reports success, do not repeat checks yourself. Return a short result stating whether the controlled repair succeeded.

In shared context, also require the gate to use exactly `bun test packages/coding-agent/bench/fixtures/governor-compact-notes-v1/test/notes.test.ts` in both check records' command fields. Put “initial before edits” and “after repair” in the corresponding result descriptions. Do not append phase annotations to command text.

Before finishing, use wait to obtain the final Integration gate job snapshot. The benchmark requires the host completion record; a worker yield alone does not satisfy acceptance.
