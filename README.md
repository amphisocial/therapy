# TherapyAgent EC2 IAM Role S3 Update

This patch updates the current TherapyAgent build so S3 attachments can authenticate through either:

1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in `.env`, or
2. an EC2 IAM role attached to the instance via the EC2 metadata service.

It also makes the schema more idempotent for older `review_history` and `files` tables.

## Apply from repo root

```bash
cd /path/to/therapy
python3 scripts/apply-ec2-role-s3-patch.py

node --check server.js
psql "$DATABASE_URL" -f db/schema.sql
```

Then commit and deploy normally.
