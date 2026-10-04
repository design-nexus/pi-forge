Migrate the storage API from boolean readOnly to mode: "read" | "write". Only src/storage.ts, src/cache.ts, src/history.ts, src/project.ts, and src/audit.ts may change. The supplied test/storage.test.ts is read-only: never change, rename, format, or add tests.

First update src/storage.ts yourself: StorageOptions has path and mode, and createStorageOptions accepts path and mode and returns them. Then use the generic task tool once with four independent items, one owning only src/cache.ts, one owning only src/history.ts, one owning only src/project.ts, and one owning only src/audit.ts. Each consumer must keep its path suffix, with cache/project using write mode and history/audit using read mode.

Copy the source ownership and read-only test restriction into shared context and each assignment. Give workers the new shared API contract so they need only their source file. Use effort "lo" when available. Workers must not delegate further, edit the shared API, or run checks; return short results. Do not set concurrency, a worker count, an effort band, or a risk override. Let the harness choose concurrency for the declared independent batch.

Integrate the results and run bun test test/storage.test.ts once. No package installation or repository investigation is needed. The settings pin model roles and generic workers to GPT-6 Luna Low.
