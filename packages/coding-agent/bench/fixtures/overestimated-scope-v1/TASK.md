Several request paths intermittently retry responses that should fail immediately. Investigate the shared retry classification and make permanent client errors non-retryable while preserving retries for throttling and server errors.

The supplied tests cover the shared behavior used by all request paths. Make them pass and change only `src/retryable.ts`.
