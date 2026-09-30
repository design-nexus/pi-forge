Implement `retryDelay(attempt, baseDelayMs, maxDelayMs)` in `src/retry-delay.ts`.

For a non-negative integer attempt, return `min(baseDelayMs * 2 ** attempt, maxDelayMs)`. Require `attempt` to be a non-negative integer. Require both delay values to be finite positive numbers and `maxDelayMs >= baseDelayMs`. Throw `RangeError` for invalid inputs. Keep the change scoped to this fixture, run `bun test`, and report the command and result.
