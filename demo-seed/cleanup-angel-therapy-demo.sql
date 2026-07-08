-- Removes only the Angel Therapy demo organization and all org-scoped demo data.
-- Run from /opt/apps/therapy after sourcing .env:
--   psql "$DATABASE_URL" -f demo-seed/cleanup-angel-therapy-demo.sql

DELETE FROM organizations
WHERE lower(name) = lower('Angel Therapy Services')
   OR lower(legal_name) = lower('Angel Therapy Services LLC')
   OR lower(contact_email) = lower('admin@angeltherapy.com');
