# Repair two independent repository tool contracts

Implement both maintenance fixes below. Choose the execution strategy yourself; delegation is optional. All model roles are pinned to GPT-6 Luna Low. Keep production changes confined to the two listed files and keep the supplied tests unchanged.

1. In `packages/coding-agent/src/tools/browser/attach.ts`, make `findReusableCdp` recognize Chromium launched through a compiled Linux distro wrapper. The wrapper sets `CHROME_WRAPPER` and execs the actual browser binary, so the process command line does not contain the wrapper path. Reuse the matching remote debugging endpoint while preserving existing profile and process matching behavior.
2. In `packages/coding-agent/src/tools/bash.ts`, add an optional `verification` boolean. A verification command must report structured `details.verification: { passed: boolean }`: true only for a successful foreground command, false for nonzero exit or timeout. Reject verification combined with async execution or a named service with a clear foreground-related error. An explicit false verification option is an ordinary command; an explicit false async option remains foreground. Ordinary commands must retain their behavior and must not gain verification metadata, including auto-background enabled without a job manager.

The fixes have separate ownership and tests. No new feature design, dependency installation, unrelated investigation, or broad suite is needed. If delegating, provide exact ownership and these contracts to workers and keep their model effort Low. If an integration gate runs, wait for its final host job snapshot before finishing.

Run the focused combined acceptance command and report the actual result:

```sh
bun test packages/coding-agent/test/tools/browser-attach-bench.test.ts packages/coding-agent/test/bash-verification-bench.test.ts packages/coding-agent/test/bash-background-audit.test.ts packages/coding-agent/test/bash-verification-boundaries.test.ts
```
