Migrate the storage API from boolean readOnly to mode: "read" | "write". Only src/storage.ts, src/cache.ts, src/history.ts, src/project.ts, and src/audit.ts may change. The supplied test/storage.test.ts is read-only: never change, rename, format, or add tests.

StorageOptions must contain path and mode, and createStorageOptions must accept path and mode and return them. Update all four consumers while preserving their path suffixes: cache and project use write mode; history and audit use read mode.

Choose your execution strategy. You may work directly or delegate when useful. If you delegate, give each worker a separate source-file ownership boundary and repeat the read-only test restriction; workers must not delegate further. Do not override concurrency, a worker count, an effort band, or risk. The settings pin model roles and generic workers to GPT-6 Luna Low.

Run bun test test/storage.test.ts once after implementing the migration. No package installation or repository investigation is needed. Return a short result.
