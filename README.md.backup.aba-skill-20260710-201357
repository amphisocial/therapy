# TherapyAgent Angel Therapy Demo Seed

This package creates a complete demo organization for TherapyAgent.

## Demo organization

- Organization: **Angel Therapy Services**
- Admin login: **admin@angeltherapy.com**
- Password for all demo users: **mishratesting**

> Demo-only password intentionally matches the user's request. Do not use this password for production.

## Included demo users

| Email | Role | Password |
|---|---|---|
| admin@angeltherapy.com | org_admin | mishratesting |
| bcba@angeltherapy.com | bcba | mishratesting |
| supervisor@angeltherapy.com | supervisor | mishratesting |
| therapist1@angeltherapy.com | therapist | mishratesting |
| therapist2@angeltherapy.com | therapist | mishratesting |
| rbt1@angeltherapy.com | rbt | mishratesting |
| rbt2@angeltherapy.com | rbt | mishratesting |
| billing@angeltherapy.com | billing_auditor | mishratesting |

## What it loads

- 1 demo org
- 8 demo users
- 36 patients
- 132 session logs
- 128 behavior events
- 118 incidents
- 42 therapy plans
- 56 AI reports

Attachments are intentionally not seeded.

## Install / run

Upload/unzip this package into the TherapyAgent repo root on the server, usually:

```bash
cd /opt/apps/therapy
unzip therapyagent-angel-demo-seed.zip
```

Then run:

```bash
cd /opt/apps/therapy
bash demo-seed/run-import.sh
```

The script uses `.env` and `DATABASE_URL`, then inserts the demo data. It deletes and recreates only the `Angel Therapy Services` demo org, so it can be re-run safely.

## Optional cleanup

```bash
cd /opt/apps/therapy
set -a
source .env
set +a
psql "$DATABASE_URL" -f demo-seed/cleanup-angel-therapy-demo.sql
```

## Notes

- Uses existing app dependencies: `dotenv`, `pg`, `bcryptjs`.
- Works with the current TherapyAgent schema and optional compliance/terms columns when present.
- Does not create file attachments or S3 objects.
