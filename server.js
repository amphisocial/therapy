import dotenv from "dotenv";
dotenv.config({ override: true });

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import speakeasy from "speakeasy";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3060);
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://therapyagent.athenabot.ai";
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const ALLOW_PHI_TO_LLM = String(process.env.ALLOW_PHI_TO_LLM || "false").toLowerCase() === "true";
const ROLES = ["org_admin", "bcba", "supervisor", "therapist", "rbt", "billing_auditor", "read_only"];

const DEFAULT_PERMISSIONS = {
  org_admin: {
    view_patients: true, edit_patients: true, record_sessions: true, record_behavior_events: true,
    create_therapy_plans: true, approve_plans: true, create_incidents: true, generate_reports: true,
    sign_records: true, manage_users: true, manage_roles: true, view_audit: true
  },
  bcba: {
    view_patients: true, edit_patients: true, record_sessions: true, record_behavior_events: true,
    create_therapy_plans: true, approve_plans: true, create_incidents: true, generate_reports: true,
    sign_records: true, manage_users: false, manage_roles: false, view_audit: false
  },
  supervisor: {
    view_patients: true, edit_patients: true, record_sessions: true, record_behavior_events: true,
    create_therapy_plans: true, approve_plans: false, create_incidents: true, generate_reports: true,
    sign_records: false, manage_users: false, manage_roles: false, view_audit: false
  },
  therapist: {
    view_patients: true, edit_patients: false, record_sessions: true, record_behavior_events: true,
    create_therapy_plans: false, approve_plans: false, create_incidents: true, generate_reports: true,
    sign_records: false, manage_users: false, manage_roles: false, view_audit: false
  },
  rbt: {
    view_patients: true, edit_patients: false, record_sessions: true, record_behavior_events: true,
    create_therapy_plans: false, approve_plans: false, create_incidents: true, generate_reports: false,
    sign_records: false, manage_users: false, manage_roles: false, view_audit: false
  },
  billing_auditor: {
    view_patients: true, edit_patients: false, record_sessions: false, record_behavior_events: false,
    create_therapy_plans: false, approve_plans: false, create_incidents: false, generate_reports: false,
    sign_records: false, manage_users: false, manage_roles: false, view_audit: true
  },
  read_only: {
    view_patients: true, edit_patients: false, record_sessions: false, record_behavior_events: false,
    create_therapy_plans: false, approve_plans: false, create_incidents: false, generate_reports: false,
    sign_records: false, manage_users: false, manage_roles: false, view_audit: false
  }
};

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (JWT_SECRET === "dev-only-change-me" && process.env.NODE_ENV === "production") {
  console.error("JWT_SECRET must be set in production.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: String(process.env.PGSSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : false,
  max: 10
});

const app = express();
app.set("trust proxy", true);
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: SITE_ORIGIN.split(",").map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());
app.use(express.static(join(__dirname, "public")));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

function sign(user) {
  return jwt.sign({
    id: user.id,
    org_id: user.org_id,
    role: user.role,
    email: user.email,
    name: user.full_name,
    mfa_enabled: Boolean(user.mfa_enabled),
    active: user.active !== false
  }, JWT_SECRET, { expiresIn: "8h" });
}

function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : req.cookies?.ta_token;
  if (!token) return res.status(401).json({ error: "missing_token", message: "Please login first." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token", message: "Your session expired. Please login again." });
  }
}

function requireMfa(req, res, next) {
  if (req.user?.mfa_enabled) return next();
  return res.status(403).json({ error: "mfa_not_enabled", message: "MFA must be enabled before accessing patient records." });
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden", message: "You do not have permission for this action." });
    next();
  };
}

function safeUser(user) {
  return {
    id: user.id,
    org_id: user.org_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    mfa_enabled: Boolean(user.mfa_enabled),
    active: user.active !== false,
    last_login_at: user.last_login_at || null
  };
}

async function audit(req, action, entity_type, entity_id, details = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, ip_address, user_agent, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.user?.org_id || null, req.user?.id || null, action, entity_type, entity_id || null, req.ip, req.get("user-agent") || "", details]
    );
  } catch (e) {
    console.warn("[audit]", e.message);
  }
}

async function initSchema() {
  const sql = readFileSync(join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schema ready.");
}

function patientWhere() { return "org_id = $1"; }

async function assertPatient(req, id) {
  const row = (await pool.query(`SELECT id FROM patients WHERE id=$1 AND org_id=$2`, [id, req.user.org_id])).rows[0];
  return Boolean(row);
}

function validationMessage(result) {
  const issues = result.error?.issues || [];
  return issues.map(i => i.message).join(" ") || "Please complete all required fields.";
}

function makeTempPassword() {
  return crypto.randomBytes(9).toString("base64url") + "A1!";
}

function makeMfaSetup(email, secretBase32) {
  const otpauth_url = speakeasy.otpauthURL({ secret: secretBase32, label: `TherapyAgent:${email}`, issuer: "TherapyAgent", encoding: "base32" });
  return { secret: secretBase32, otpauth_url, qrDataUrl: "" };
}

async function getRolePermissions(orgId) {
  const rows = (await pool.query(`SELECT role, permissions FROM role_permissions WHERE org_id=$1`, [orgId])).rows;
  const overrides = Object.fromEntries(rows.map(r => [r.role, r.permissions || {}]));
  const out = {};
  for (const role of ROLES) out[role] = { ...(DEFAULT_PERMISSIONS[role] || {}), ...(overrides[role] || {}) };
  return out;
}

function redactPhi(text = "") {
  return String(text)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]")
    .replace(/\b\d{10,}\b/g, "[NUMBER]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE]");
}

async function callOpenAI(prompt, jsonMode = false) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const body = {
    model,
    messages: [
      { role: "system", content: "You are a careful clinical documentation assistant. Do not diagnose. Extract only facts stated by the user. Return clinician-reviewable drafts. Highlight uncertainty." },
      { role: "user", content: prompt }
    ],
    temperature: 0.1
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`AI provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

function toDateIsoFromText(text) {
  const now = new Date();
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return now.toISOString().slice(0, 10);
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
  }
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  return "";
}

function extractAfter(text, labels) {
  const escaped = labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:${escaped})\\s*(?:was|were|is|included|include|:)?\\s*([^.;\\n]+)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function heuristicExtract(form, text) {
  const lower = text.toLowerCase();
  const fields = {};
  const raw = String(text || "").trim();
  const location = extractAfter(raw, ["location", "at", "in room", "in the room", "place"]);
  const intensity = raw.match(/\bintensity\s*(?:was|is|:)?\s*([1-5])\b/i)?.[1] || raw.match(/\b([1-5])\s*out of\s*5\b/i)?.[1] || "";
  const duration = raw.match(/\b(\d+)\s*(seconds|second|minutes|minute|min)\b/i);

  if (form === "session") {
    fields.session_date = toDateIsoFromText(raw);
    fields.location = location;
    fields.activities = extractAfter(raw, ["activities", "activity", "worked on", "completed", "performed", "tasks"]);
    fields.interventions_used = extractAfter(raw, ["interventions", "intervention", "used", "prompting", "supports"]);
    fields.response_to_intervention = extractAfter(raw, ["response", "client response", "responded", "result"]);
    fields.progress_notes = raw;
  } else if (form === "behavior") {
    fields.location = location;
    fields.intensity = intensity;
    if (duration) fields.duration_seconds = duration[2].toLowerCase().startsWith("min") ? String(Number(duration[1]) * 60) : duration[1];
    fields.antecedent = extractAfter(raw, ["antecedent", "before", "trigger", "after demand", "during transition"]);
    fields.behavior = extractAfter(raw, ["behavior", "observed", "client did", "incident"]);
    fields.consequence = extractAfter(raw, ["consequence", "after", "staff responded", "response"]);
    fields.suspected_function = extractAfter(raw, ["function", "suspected function", "purpose"]);
    fields.deescalation = extractAfter(raw, ["deescalation", "de-escalation", "calmed", "redirected"]);
    fields.notes = raw;
  } else if (form === "incident") {
    fields.incident_date = fields.incident_date || new Date().toISOString().slice(0, 16);
    fields.category = lower.includes("injur") ? "injury" : lower.includes("medication") ? "medication" : lower.includes("elop") ? "elopement" : "general";
    fields.severity = lower.includes("severe") || lower.includes("911") ? "high" : lower.includes("moderate") ? "medium" : "low";
    fields.description = raw;
    fields.immediate_actions = extractAfter(raw, ["immediate actions", "staff", "responded", "action taken"]);
    fields.notifications = extractAfter(raw, ["notified", "notification", "called"]);
  } else if (form === "plan") {
    fields.goals = JSON.stringify([{ name: "Draft goal", description: raw }], null, 2);
    fields.interventions = JSON.stringify([{ name: "Draft intervention", description: extractAfter(raw, ["intervention", "interventions", "use", "strategy"]) || raw }], null, 2);
  } else if (form === "report") {
    fields.note = raw;
  }
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== "" && v !== null && v !== undefined));
}

const registerSchema = z.object({
  organizationId: z.string().uuid().optional().or(z.literal("")),
  organizationName: z.string().trim().min(2, "Organization name is required."),
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.string().trim().email("A valid login/email is required."),
  password: z.string().min(10, "Password must be at least 10 characters.")
});

const loginSchema = z.object({
  email: z.string().trim().email("Enter your login/email."),
  password: z.string().min(1, "Enter your password."),
  totp: z.string().optional().or(z.literal(""))
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "therapyagent" }));

app.get("/api/organizations", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ organizations: [] });
  const rows = (await pool.query(`SELECT id, name FROM organizations WHERE name ILIKE $1 ORDER BY name ASC LIMIT 12`, [`%${q}%`])).rows;
  res.json({ organizations: rows });
});

app.post("/api/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", message: validationMessage(parsed) });
  const { organizationId, organizationName, firstName, lastName, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let org;
    let createdNewOrg = false;
    if (organizationId) {
      org = (await client.query(`SELECT id, name FROM organizations WHERE id=$1`, [organizationId])).rows[0];
      if (!org) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "organization_not_found", message: "We could not find that organization. Select an existing organization or enter a new organization name." });
      }
    } else {
      org = (await client.query(`SELECT id, name FROM organizations WHERE lower(name) = lower($1) LIMIT 1`, [organizationName])).rows[0];
      if (!org) {
        org = (await client.query(`INSERT INTO organizations (name, contact_email) VALUES ($1,$2) RETURNING id, name`, [organizationName, normalizedEmail])).rows[0];
        createdNewOrg = true;
      }
    }
    const existing = (await client.query(`SELECT id FROM users WHERE org_id=$1 AND lower(email)=lower($2) LIMIT 1`, [org.id, normalizedEmail])).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "account_exists", message: "An account with this email already exists for that organization. Go to Login or use Forgot Password." });
    }
    const hash = await bcrypt.hash(password, 12);
    const secret = speakeasy.generateSecret({ name: `TherapyAgent:${normalizedEmail}`, issuer: "TherapyAgent" });
    const user = (await client.query(
      `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7)
       RETURNING id, org_id, email, full_name, role, mfa_enabled, active`,
      [org.id, normalizedEmail, fullName, hash, createdNewOrg ? "org_admin" : "read_only", secret.base32, createdNewOrg]
    )).rows[0];
    await client.query("COMMIT");
    const message = createdNewOrg
      ? "Account created. Manually enter the MFA setup key in your Authenticator app, verify MFA, then login. You are the organization admin."
      : "Account request created. Verify MFA now; an organization admin must activate your account before patient records are available.";
    res.json({
      token: sign(user), user: safeUser(user), organization: org, status: createdNewOrg ? "registered" : "pending_approval", message,
      mfaSetup: makeMfaSetup(normalizedEmail, secret.base32)
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[register]", e.message);
    res.status(500).json({ error: "could_not_register", message: "Registration could not be completed. Please check the fields and try again." });
  } finally {
    client.release();
  }
});

app.post("/api/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "validation_error", message: validationMessage(parsed) });
  const { email, password, totp } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const users = (await pool.query(
    `SELECT id, org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active, last_login_at
     FROM users WHERE lower(email) = lower($1)`,
    [normalizedEmail]
  )).rows;
  if (users.length > 1) return res.status(409).json({ error: "multiple_accounts", message: "This email is associated with more than one organization. Ask your administrator to confirm the correct login path." });
  const user = users[0];
  if (!user || !(await bcrypt.compare(String(password || ""), user.password_hash))) {
    return res.status(401).json({ error: "invalid_login", message: "Email or password is incorrect." });
  }
  if (!user.active) return res.status(403).json({ error: "account_pending", message: "Your account exists, but it is not active yet. Ask your organization admin to approve access." });
  if (!user.mfa_enabled) {
    return res.json({
      token: sign(user),
      user: safeUser(user),
      mfaSetupRequired: true,
      mfaSetup: makeMfaSetup(user.email, user.mfa_secret),
      message: "Password accepted. MFA is not enabled yet. Enter the setup key in your Authenticator app, verify the 6-digit code, then login again."
    });
  }
  const ok = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: "base32", token: String(totp || ""), window: 1 });
  if (!ok) return res.status(401).json({ error: "mfa_required", message: "Enter a valid 6-digit MFA code from your authenticator app." });
  const updated = (await pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1 RETURNING id, org_id, email, full_name, role, mfa_enabled, active, last_login_at`, [user.id])).rows[0];
  res.json({ token: sign(updated), user: safeUser(updated), permissions: (await getRolePermissions(updated.org_id))[updated.role], message: `Welcome back, ${updated.full_name}.` });
});

app.post("/api/password/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "email_required", message: "Enter your login/email to start password recovery." });
  res.json({ ok: true, message: "If an account exists for that email, reset instructions will be sent. Contact your organization admin if you do not receive them." });
});

app.post("/api/mfa/enable", requireAuth, async (req, res) => {
  const { totp } = req.body || {};
  const u = (await pool.query(`SELECT mfa_secret FROM users WHERE id=$1 AND org_id=$2`, [req.user.id, req.user.org_id])).rows[0];
  const ok = u && speakeasy.totp.verify({ secret: u.mfa_secret, encoding: "base32", token: String(totp || ""), window: 1 });
  if (!ok) return res.status(400).json({ error: "invalid_totp", message: "Enter a valid 6-digit MFA code from your authenticator app." });
  const updated = (await pool.query(
    `UPDATE users SET mfa_enabled=true WHERE id=$1 AND org_id=$2 RETURNING id, org_id, email, full_name, role, mfa_enabled, active`,
    [req.user.id, req.user.org_id]
  )).rows[0];
  await audit(req, "mfa_enabled", "user", req.user.id);
  const message = updated.active ? "MFA enabled successfully. You can now go to Login and enter with your MFA code." : "MFA enabled successfully. Your account still needs organization admin approval before login.";
  res.json({ ok: true, token: sign(updated), user: safeUser(updated), message });
});

app.get("/api/me", requireAuth, async (req, res) => {
  const user = (await pool.query(`SELECT id, org_id, email, full_name, role, mfa_enabled, active, last_login_at FROM users WHERE id=$1 AND org_id=$2`, [req.user.id, req.user.org_id])).rows[0];
  res.json({ user: safeUser(user || req.user), permissions: (await getRolePermissions(req.user.org_id))[req.user.role] || {} });
});

app.get("/api/patients", requireAuth, requireMfa, async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM patients WHERE ${patientWhere()} ORDER BY created_at DESC LIMIT 200`, [req.user.org_id])).rows;
  res.json({ patients: rows });
});

app.post("/api/patients", requireAuth, requireMfa, allow("org_admin", "bcba", "supervisor"), async (req, res) => {
  const { first_name, last_name, date_of_birth, external_id, guardian_name, guardian_phone, guardian_email, diagnosis, insurance } = req.body || {};
  if (!first_name || !last_name) return res.status(400).json({ error: "first_name_last_name_required", message: "Patient first name and last name are required." });
  const row = (await pool.query(
    `INSERT INTO patients (org_id, first_name, last_name, date_of_birth, external_id, guardian_name, guardian_phone, guardian_email, diagnosis, insurance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.user.org_id, first_name, last_name, date_of_birth || null, external_id || null, guardian_name || null, guardian_phone || null, guardian_email || null, diagnosis || null, insurance || null]
  )).rows[0];
  await audit(req, "patient_created", "patient", row.id);
  res.json({ patient: row });
});

app.post("/api/session-logs", requireAuth, requireMfa, allow("org_admin", "bcba", "supervisor", "therapist", "rbt"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found", message: "Select a valid patient." });
  const row = (await pool.query(
    `INSERT INTO session_logs
     (org_id, patient_id, user_id, session_date, start_time, end_time, location, service_code, participants, activities, interventions_used, response_to_intervention, progress_notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.user.org_id, b.patient_id, req.user.id, b.session_date || null, b.start_time || null, b.end_time || null, b.location || null, b.service_code || null, b.participants || null, b.activities || null, b.interventions_used || null, b.response_to_intervention || null, b.progress_notes || null, b.status || "draft"]
  )).rows[0];
  await audit(req, "session_log_created", "session_log", row.id, { patient_id: b.patient_id });
  res.json({ session_log: row, message: "Session log saved." });
});

app.post("/api/behavior-events", requireAuth, requireMfa, allow("org_admin", "bcba", "supervisor", "therapist", "rbt"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found", message: "Select a valid patient." });
  if (!b.behavior) return res.status(400).json({ error: "behavior_required", message: "Behavior observed is required." });
  const row = (await pool.query(
    `INSERT INTO behavior_events
     (org_id, patient_id, user_id, event_time, antecedent, behavior, consequence, intensity, duration_seconds, location, suspected_function, deescalation, injury, restraint, notes)
     VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [req.user.org_id, b.patient_id, req.user.id, b.event_time || null, b.antecedent || null, b.behavior, b.consequence || null, b.intensity || null, b.duration_seconds || null, b.location || null, b.suspected_function || null, b.deescalation || null, !!b.injury, !!b.restraint, b.notes || null]
  )).rows[0];
  await audit(req, "behavior_event_created", "behavior_event", row.id, { patient_id: b.patient_id });
  res.json({ behavior_event: row, message: "Behavior event saved." });
});

app.post("/api/incidents", requireAuth, requireMfa, allow("org_admin", "bcba", "supervisor", "therapist", "rbt"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found", message: "Select a valid patient." });
  if (!b.description) return res.status(400).json({ error: "description_required", message: "Incident description is required." });
  const row = (await pool.query(
    `INSERT INTO incidents (org_id, patient_id, reported_by, incident_date, category, severity, description, immediate_actions, notifications, status)
     VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.user.org_id, b.patient_id, req.user.id, b.incident_date || null, b.category || "general", b.severity || "low", b.description, b.immediate_actions || null, b.notifications || null, b.status || "open"]
  )).rows[0];
  await audit(req, "incident_created", "incident", row.id, { patient_id: b.patient_id });
  res.json({ incident: row, message: "Incident saved." });
});

app.post("/api/therapy-plans", requireAuth, requireMfa, allow("org_admin", "bcba", "supervisor"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found", message: "Select a valid patient." });
  const row = (await pool.query(
    `INSERT INTO therapy_plans (org_id, patient_id, title, plan_type, goals, interventions, restrictions, effective_from, effective_to, status, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING *`,
    [req.user.org_id, b.patient_id, b.title || "Therapy plan", b.plan_type || "behavior_support", JSON.stringify(b.goals || []), JSON.stringify(b.interventions || []), JSON.stringify(b.restrictions || []), b.effective_from || null, b.effective_to || null, b.status || "draft", req.user.id]
  )).rows[0];
  await audit(req, "therapy_plan_created", "therapy_plan", row.id, { patient_id: b.patient_id });
  res.json({ therapy_plan: row, message: "Therapy plan saved." });
});

app.post("/api/ai/extract-fields", requireAuth, requireMfa, async (req, res) => {
  const { form, text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text_required", message: "Record or enter notes before asking AI to map fields." });
  const allowedForms = ["session", "behavior", "incident", "plan", "report"];
  if (!allowedForms.includes(form)) return res.status(400).json({ error: "invalid_form", message: "Unknown form type." });
  if (ALLOW_PHI_TO_LLM && process.env.OPENAI_API_KEY) {
    try {
      const prompt = `Extract structured fields from the raw voice note for form type ${form}. Return JSON only. Use only fields that are clearly supported by the note. If uncertain, omit the field. Do not invent facts.\n\nRaw note:\n${text}`;
      const json = await callOpenAI(prompt, true);
      const fields = JSON.parse(json);
      await audit(req, "ai_fields_extracted", form, null, { method: "openai", allowPhiToLlm: true });
      return res.json({ fields, method: "openai" });
    } catch (e) {
      console.warn("[ai/extract-fields] falling back", e.message);
    }
  }
  const fields = heuristicExtract(form, text);
  await audit(req, "fields_extracted", form, null, { method: "local_heuristic", allowPhiToLlm: ALLOW_PHI_TO_LLM });
  res.json({ fields, method: "local_heuristic", message: "Mapped available fields locally. Review before saving." });
});

app.post("/api/ai/session-summary", requireAuth, requireMfa, allow("org_admin", "bcba", "supervisor", "therapist"), async (req, res) => {
  const { patient_id, note } = req.body || {};
  if (!patient_id || !(await assertPatient(req, patient_id))) return res.status(404).json({ error: "patient_not_found", message: "Select a valid patient." });
  const safeNote = ALLOW_PHI_TO_LLM ? String(note || "") : redactPhi(note || "");
  const prompt = `Draft a structured ABA/I-DD session note from this raw staff note. Sections: session focus, interventions used, client response, progress toward goals, risks/incidents, follow-ups. Keep it factual and mark as clinician-review required.\n\nRaw note:\n${safeNote}`;
  try {
    const output = await callOpenAI(prompt);
    const row = (await pool.query(
      `INSERT INTO ai_reports (org_id, patient_id, created_by, report_type, prompt, output, status)
       VALUES ($1,$2,$3,'session_summary',$4,$5,'draft') RETURNING *`,
      [req.user.org_id, patient_id, req.user.id, ALLOW_PHI_TO_LLM ? "[PHI prompt stored by policy]" : prompt, output]
    )).rows[0];
    await audit(req, "ai_report_created", "ai_report", row.id, { patient_id, allowPhiToLlm: ALLOW_PHI_TO_LLM });
    res.json({ report: row, output });
  } catch (e) {
    console.error("[ai/session-summary]", e.message);
    res.status(502).json({ error: "ai_provider_error", message: "AI report generation failed.", detail: e.message });
  }
});

app.get("/api/admin/users", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const rows = (await pool.query(
    `SELECT id, email, full_name, role, mfa_enabled, active, created_at, last_login_at
     FROM users WHERE org_id=$1 ORDER BY created_at DESC`,
    [req.user.org_id]
  )).rows;
  res.json({ users: rows });
});

app.post("/api/admin/users", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const b = req.body || {};
  const first = String(b.firstName || "").trim();
  const last = String(b.lastName || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const role = ROLES.includes(b.role) ? b.role : "read_only";
  const tempPassword = String(b.initialPassword || "").trim() || makeTempPassword();
  if (!first || !last || !email.includes("@")) return res.status(400).json({ error: "missing_fields", message: "First name, last name, and valid email are required." });
  const hash = await bcrypt.hash(tempPassword, 12);
  const secret = speakeasy.generateSecret({ name: `TherapyAgent:${email}`, issuer: "TherapyAgent" });
  try {
    const user = (await pool.query(
      `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active, invited_by)
       VALUES ($1,$2,$3,$4,$5,$6,false,true,$7)
       RETURNING id, org_id, email, full_name, role, mfa_enabled, active, created_at`,
      [req.user.org_id, email, `${first} ${last}`, hash, role, secret.base32, req.user.id]
    )).rows[0];
    await audit(req, "admin_user_created", "user", user.id, { role });
    res.json({
      user: safeUser(user),
      invite: {
        email,
        temporaryPassword: tempPassword,
        mfaSetup: makeMfaSetup(email, secret.base32),
        message: "Invite email sending is not enabled yet. Copy these temporary credentials to the user through your approved workflow. User must enable MFA on first login."
      }
    });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "account_exists", message: "A user with this email already exists in this organization." });
    console.error("[admin/users]", e.message);
    res.status(500).json({ error: "user_create_failed", message: "Could not create user." });
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const { role, active, full_name } = req.body || {};
  const current = (await pool.query(`SELECT id FROM users WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id])).rows[0];
  if (!current) return res.status(404).json({ error: "user_not_found", message: "User not found." });
  const updates = [];
  const values = [];
  if (role && ROLES.includes(role)) { values.push(role); updates.push(`role=$${values.length}`); }
  if (typeof active === "boolean") { values.push(active); updates.push(`active=$${values.length}`); }
  if (full_name && String(full_name).trim()) { values.push(String(full_name).trim()); updates.push(`full_name=$${values.length}`); }
  if (!updates.length) return res.status(400).json({ error: "no_changes", message: "No valid changes supplied." });
  values.push(req.params.id, req.user.org_id);
  const user = (await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id=$${values.length - 1} AND org_id=$${values.length}
     RETURNING id, org_id, email, full_name, role, mfa_enabled, active, last_login_at`,
    values
  )).rows[0];
  await audit(req, "admin_user_updated", "user", user.id, { role: user.role, active: user.active });
  res.json({ user: safeUser(user), message: "User updated." });
});

app.post("/api/admin/users/:id/reset-password", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const tempPassword = String(req.body?.temporaryPassword || "").trim() || makeTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  const secret = speakeasy.generateSecret({ issuer: "TherapyAgent" });
  const user = (await pool.query(
    `UPDATE users SET password_hash=$1, mfa_secret=$2, mfa_enabled=false WHERE id=$3 AND org_id=$4
     RETURNING id, org_id, email, full_name, role, mfa_enabled, active`,
    [hash, secret.base32, req.params.id, req.user.org_id]
  )).rows[0];
  if (!user) return res.status(404).json({ error: "user_not_found", message: "User not found." });
  await audit(req, "admin_password_reset", "user", user.id);
  res.json({ user: safeUser(user), temporaryPassword: tempPassword, mfaSetup: makeMfaSetup(user.email, secret.base32), message: "Password reset. User must re-enable MFA on next login." });
});

app.get("/api/admin/role-permissions", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  res.json({ roles: ROLES, permissions: await getRolePermissions(req.user.org_id) });
});

app.put("/api/admin/role-permissions", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const { role, permissions } = req.body || {};
  if (!ROLES.includes(role) || typeof permissions !== "object" || !permissions) return res.status(400).json({ error: "invalid_permissions", message: "Select a valid role and permissions." });
  await pool.query(
    `INSERT INTO role_permissions (org_id, role, permissions, updated_by, updated_at)
     VALUES ($1,$2,$3::jsonb,$4,now())
     ON CONFLICT (org_id, role) DO UPDATE SET permissions=EXCLUDED.permissions, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [req.user.org_id, role, JSON.stringify(permissions), req.user.id]
  );
  await audit(req, "role_permissions_updated", "role", null, { role });
  res.json({ permissions: await getRolePermissions(req.user.org_id), message: "Role permissions saved." });
});

app.get("/api/audit", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM audit_log WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.org_id])).rows;
  res.json({ audit: rows });
});

app.get("*", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));

try {
  await initSchema();
  app.listen(PORT, () => console.log(`TherapyAgent listening on port ${PORT}`));
} catch (e) {
  console.error("Schema init failed:", e.message);
  process.exit(1);
}
