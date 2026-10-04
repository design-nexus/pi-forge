# Fix compiled Chromium wrapper reuse

`findReusableCdp` fails to detect an already-running Chromium when a Linux distro launches Chromium through a small compiled ELF wrapper. The wrapper sets `CHROME_WRAPPER` and execs the real browser binary, so the process command line does not expose the wrapper path.

Implement the smallest production change in `packages/coding-agent/src/tools/browser/attach.ts` that lets the attach flow recognize this process and reuse its remote debugging endpoint. Do not change unrelated browser behavior.

Run the focused regression test:

```sh
bun test packages/coding-agent/test/tools/browser-attach-bench.test.ts
```

The support test is supplied at that path. It skips outside Linux or when `cc` is unavailable. Keep it unchanged. The expected production change is only `packages/coding-agent/src/tools/browser/attach.ts`.
