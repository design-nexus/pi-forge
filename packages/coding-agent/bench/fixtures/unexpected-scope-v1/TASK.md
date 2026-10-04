The retry timer sometimes schedules a delay above the configured maximum after a request fails. Fix the delay calculation so scheduled retries obey the configured exponential backoff and maximum.

The report points to `src/timer.ts`; inspect the shared delay behavior as well. Preserve the public functions. Make the supplied tests pass and change only `src/backoff.ts` and `src/timer.ts`.
