# TherapyAgent HIPAA-conscious security checklist

This is not legal advice. Use this checklist with counsel and a HIPAA security officer.

## Required before PHI

- Business Associate Agreements / Healthcare Addenda with cloud, AI, email, logging, analytics, and voice vendors.
- MFA enforced for every user accessing PHI.
- TLS everywhere.
- Encryption at rest for database, file storage, backups, and logs.
- Separate production/staging/dev environments.
- Unique user IDs. No shared accounts.
- Role-based access and minimum-necessary permissions.
- Organization-level tenant isolation.
- Immutable audit logging for patient access, edits, exports, AI generation, admin actions.
- Incident response plan and breach workflow.
- Backup/restore test.
- Data retention and deletion policy.
- Workforce security training.
- Vendor/subprocessor inventory.

## AI specific controls

- Default ALLOW_PHI_TO_LLM=false.
- Redact obvious identifiers before external AI calls.
- Human review required before AI draft becomes signed record.
- Store prompts and outputs only when policy allows.
- Do not train models on PHI unless contract explicitly permits.
- Disable agent memory over PHI unless governed and deletable.
- Use task-scoped access for agents.
