Fix the session capability transition in `src/session.ts`.

When a turn is streaming, `activate()` and `deactivate()` must defer their changes. The current snapshot must remain unchanged until `endTurn()`; at that boundary, apply all pending changes together so the exposed tool list and prompt instructions always describe the same capability set. Outside a streaming turn, changes should still apply immediately.

Preserve the public API. Make the supplied tests pass, including repeated requests and a queued activation followed by deactivation of the same capability. Only change `src/session.ts`.
