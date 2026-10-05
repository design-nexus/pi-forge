# Reconcile OMP updates

Pi Forge application releases use their own version and repository. Internal package/native versions remain on the inherited compatibility line; do not reset or bulk-rename them when changing the application version.

The `upstream` remote points to `https://github.com/can1357/oh-my-pi.git`; `origin` points to `https://github.com/design-nexus/pi-forge.git`.

For each reconciliation:

1. Start from a clean Forge branch and fetch upstream.
2. Create a dedicated reconciliation branch and merge the chosen upstream revision, preserving Git ancestry.
3. Resolve conflicts while keeping the Forge identity, storage namespace, release targets, and additive features. Preserve upstream feature defaults and provider-required protocol identities.
4. Run `bun check`, focused contract tests, and source/compiled worker smoke probes. Inspect branding, settings/import compatibility, and updater destinations.
5. Record the integrated SHA in this guide after verification. Review the change before merging it into the Forge development branch.

Do not use `pi-forge update` to merge OMP: it installs only Pi Forge binary releases. Source installations update through the development checkout.

## Integrated baseline

Pi Forge 0.1.1 integrates OMP **18.6.2**, upstream commit `1c0993c3d1` (2026-10-04), through a merge preserving Git ancestry. The previous baseline was `7853b4e499936f9dcc13c9b64adb55f6b342aabf`.

Reconciliation preserves Forge application/storage/update identity (including native crash reports), profiles, capability routing, the adaptive governor, verification and integration gates, shared task concurrency, Catppuccin, and Follow Omarchy. Upstream streamed task launches are adopted once and respect dependent tasks; adaptive routing waits for the completed batch before deciding policy. Dynamic repository context is emitted once in the final system block, keeping the static prefix stable.

Verification covers workspace lint/types/Rust checks, task/governor/prompt/runtime contracts, updater integrity, settings/import/plugin discovery, themes and welcome layout, plus source and compiled worker smoke probes. Application version is independent of the internal 18.6.2 package/native compatibility version.

The Rust suite passes with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.mnemonicPrefix GIT_CONFIG_VALUE_0=false` applied only to the test process, since upstream VCS fixtures assume standard Git diff prefixes. Two inherited image-height assertions were reconciled with upstream’s new 64px minimum; coverage also checks tight geometry above that floor.
