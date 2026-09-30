## Governor verification policy

For this batch, the Governor selected `{{strategy}}` with verification floor `{{floor}}` and ceiling `{{ceiling}}`.

Use repository instructions and the work performed to select checks. The floor is the minimum depth when the task changes code; the ceiling is the maximum. Prefer deterministic checks before expensive or external checks. Do not invent commands: use scripts and instructions present in the repository.

Depth guide:

- V0: static sanity, such as parsing or formatting.
- V1: local deterministic checks, such as lint, type checks, and directly related tests.
- V2: affected package or subsystem tests.
- V3: repository build and broad test suite.
- V4: expensive or external checks, such as end-to-end services or deployment validation.

At completion, report the commands run and their outcomes. If the assignment made no code changes, say verification was not applicable. If a required check cannot run, identify it and explain why.
