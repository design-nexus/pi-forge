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

The separation audit verifies `git merge-base HEAD upstream/main` as `7853b4e499936f9dcc13c9b64adb55f6b342aabf`. No additional upstream merge is part of the app separation.
