# TherapyAgent Compliance / Terms / BAA Update

Adds:
- `public/security-compliance.html`
- `public/terms.html`
- `public/business-associate-agreement.html`
- Visible homepage top-nav links
- Public registration Terms checkbox
- Admin user creation Terms attestation checkbox
- API enforcement for both checkboxes
- DB fields recording Terms acceptance / admin attestation
- Legal/compliance page styling

## Apply

From the TherapyAgent repo root:

```bash
python3 scripts/apply-compliance-terms-update.py
node --check server.js
node --check public/app.js
set -a
source .env
set +a
psql "$DATABASE_URL" -f db/schema.sql
pm2 restart therapyagent --update-env
```

Then test:
- Homepage top menu: Security & Compliance, BAA Template, Terms
- Create Account requires Terms checkbox
- Admin & Roles -> Add user requires admin attestation checkbox

## Counsel review

The Terms and BAA are strong starter templates, not a substitute for legal review before production commercial use.
