Fix retry policy resolution in `src/client.ts`.

Provider descriptors now expose a retry default through `provider.retry`. The client must use that default when the caller does not provide `retry`, while preserving the existing built-in fallback when neither source specifies one. A caller-supplied retry policy must override the provider default field by field, so a caller can override only the attempt count and inherit the provider delay.

Keep the public API and descriptor contract unchanged. Make all supplied tests pass and change only `src/client.ts`.
