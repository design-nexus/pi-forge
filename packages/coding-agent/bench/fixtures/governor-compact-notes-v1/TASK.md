Repair this standalone notes preview. The test file is read-only: neither you nor a worker may change, rename, format, or add tests. Only src/labels.ts and src/history.ts may be edited.

Use the task tool once with these two independent assignments. Copy the read-only test restriction into the shared context and each assignment:

1. Own and edit only src/labels.ts. Read test/notes.test.ts for requirements; never edit it. Implement normalizeLabels as specified below. Return a short result; do not delegate further or run tests.
2. Own and edit only src/history.ts. Read test/notes.test.ts for requirements; never edit it. Implement recentHistory as specified below. Return a short result; do not delegate further or run tests.

Use the generic task agent and effort "lo" when the schema exposes effort. The supplied settings pin parent model roles and generic workers to GPT-6 Luna Low.

normalizeLabels must trim and lowercase labels, remove empty labels, and deduplicate them in first-seen order without mutating its input.

recentHistory must return up to limit newest entries in original order, without mutating its input. Zero or negative limits return []; a limit larger than the history returns a copy of all entries. Limits are integers.

Keep src/preview.ts and the tests unchanged. Change only the two owned files. Integrate the results and run bun test test/notes.test.ts once. This fixture needs no repository investigation, package installation, or design plan.
