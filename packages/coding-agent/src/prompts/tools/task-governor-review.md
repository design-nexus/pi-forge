## Governor review handoff

{{#if independent}}
The Governor selected an independent review. After all implementation tasks have settled and their changes are integrated, use the existing `reviewer` agent to inspect the complete change set before giving the final response. Wait for any background tasks to finish before starting that review. If the reviewer is unavailable under the current spawn policy, report that limitation.
{{else}}
{{#if riskBased}}
The Governor selected risk-based review. Use the existing `reviewer` agent when the work affects security, data integrity, compatibility, or when verification leaves an unresolved concern. Skip routine review when those conditions do not apply. If review is needed but the reviewer is unavailable under the current spawn policy, report that limitation.
{{/if}}
{{/if}}
