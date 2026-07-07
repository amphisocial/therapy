-- TherapyAgent database schema
-- Multi-tenant org isolation, RBAC, audit trails, clinical documentation primitives.
-- Run this once as postgres if this is a fresh database:
--   sudo -u postgres psql -d therapyagent -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  legal_name TEXT,
  npi TEXT,
  tax_id TEXT,
  address TEXT,
  contact_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('org_admin','bcba','supervisor','therapist','rbt','billing_auditor','read_only')),
  mfa_secret TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  external_id TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  guardian_email TEXT,
  diagnosis TEXT,
  insurance TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, patient_id, user_id)
);

CREATE TABLE IF NOT EXISTS therapy_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'behavior_support',
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  interventions JSONB NOT NULL DEFAULT '[]'::jsonb,
  restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_from DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE therapy_plans ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE therapy_plans ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS session_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_time TIME,
  end_time TIME,
  location TEXT,
  service_code TEXT,
  participants TEXT,
  activities TEXT,
  interventions_used TEXT,
  response_to_intervention TEXT,
  progress_notes TEXT,
  ai_summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id);
ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS behavior_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  antecedent TEXT,
  behavior TEXT NOT NULL,
  consequence TEXT,
  intensity INTEGER CHECK (intensity BETWEEN 1 AND 5),
  duration_seconds INTEGER,
  location TEXT,
  suspected_function TEXT,
  deescalation TEXT,
  injury BOOLEAN NOT NULL DEFAULT FALSE,
  restraint BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES users(id),
  incident_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low',
  description TEXT NOT NULL,
  immediate_actions TEXT,
  notifications TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ai_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  report_type TEXT NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id);
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS role_permissions (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role)
);

CREATE TABLE IF NOT EXISTS field_audit_log (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES users(id),
  category TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  original_filename TEXT NOT NULL,
  s3_bucket TEXT,
  s3_key TEXT,
  s3_version_id TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  kms_key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_patients_org ON patients(org_id);
CREATE INDEX IF NOT EXISTS idx_patient_assignments_user ON patient_assignments(org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_session_logs_org_patient ON session_logs(org_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_behavior_events_org_patient ON behavior_events(org_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_incidents_org_patient ON incidents(org_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_files_org_patient ON files(org_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log(org_id, created_at DESC);
