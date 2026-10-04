Migrate the storage API from the boolean `readOnly` option to the explicit `mode: "read" | "write"` contract.

Update the shared API in `src/storage.ts` and all three independent consumers in `src/cache.ts`, `src/history.ts`, and `src/project.ts`. Each consumer must preserve its existing path and access behavior. Do not leave a legacy `readOnly` call or field in the migrated files. Make the supplied tests pass and change only those four source files.
