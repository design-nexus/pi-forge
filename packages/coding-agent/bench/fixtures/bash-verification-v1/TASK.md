# Add explicit Bash verification results

Add an optional `verification` boolean to the Bash tool. When a caller sets it, the tool must report a structured `{ passed: boolean }` outcome: true only for a successful foreground command, and false for a nonzero exit or timeout. Ordinary commands must not gain verification metadata. Verification commands must not run as async jobs or named services; reject those combinations with a clear foreground-related error. Keep existing Bash behavior unchanged when the option is absent.

The supplied support test exercises these contracts. Implement the production change in `packages/coding-agent/src/tools/bash.ts` and run:

```sh
bun test packages/coding-agent/test/bash-verification-bench.test.ts
```

Keep the support test unchanged. The expected production change is only `packages/coding-agent/src/tools/bash.ts`.
