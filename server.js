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

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3060);
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://therapyagent.athenabot.ai";
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const ALLOW_PHI_TO_LLM = String(process.env.ALLOW_PHI_TO_LLM || "false").toLowerCase() === "true";

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
  max: 10,
});

const app = express();
app.set("trust proxy", true);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));
app.use(cors({ origin: SITE_ORIGIN.split(",").map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static(join(__dirname, "public")));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use("/api", limiter);

function sign(user) {
  return jwt.sign(
    { id: user.id, org_id: user.org_id, role: user.role, email: user.email, name: user.full_name },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : req.cookies?.ta_token;
  if (!token) return res.status(401).json({ error: "missing_token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

function requireMfa(req, res, next) {
  if (req.user?.mfa_enabled) return next();
  return res.status(403).json({ error: "mfa_not_enabled", message: "MFA must be enabled before accessing patient records." });
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

async function audit(req, action, entity_type, entity_id, details = {}) {
  await pool.query(
    `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, ip_address, user_agent, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.user?.org_id || null, req.user?.id || null, action, entity_type, entity_id || null, req.ip, req.get("user-agent") || "", details]
  );
}

function patientWhere() { return "org_id = $1"; }

async function initSchema() {
  const sql = readFileSync(join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schema ready.");
}

const registerSchema = z.object({
  organizationName: z.string().min(2),
  adminName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10)
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "therapyagent" }));

app.post("/api/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationName, adminName, email, password } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = (await client.query(
      `INSERT INTO organizations (name, contact_email) VALUES ($1,$2) RETURNING *`,
      [organizationName, email.toLowerCase()]
    )).rows[0];
    const hash = await bcrypt.hash(password, 12);
    const secret = speakeasy.generateSecret({ name: `TherapyAgent (${email})` });
    const user = (await client.query(
      `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled)
       VALUES ($1,$2,$3,$4,'org_admin',$5,false) RETURNING id, org_id, email, full_name, role, mfa_enabled`,
      [org.id, email.toLowerCase(), adminName, hash, secret.base32]
    )).rows[0];
    await client.query("COMMIT");
    const token = sign(user);
    res.json({ token, user, mfaSetup: { secret: secret.base32, otpauth_url: secret.otpauth_url } });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[register]", e.message);
    res.status(500).json({ error: "could_not_register" });
  } finally {
    client.release();
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password, totp } = req.body || {};
  const user = (await pool.query(
    `SELECT id, org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active
     FROM users WHERE email = $1 AND active = true LIMIT 1`,
    [String(email || "").toLowerCase()]
  )).rows[0];
  if (!user || !(await bcrypt.compare(String(password || ""), user.password_hash))) {
    return res.status(401).json({ error: "invalid_login" });
  }
  if (user.mfa_enabled) {
    const ok = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: "base32", token: String(totp || ""), window: 1 });
    if (!ok) return res.status(401).json({ error: "mfa_required" });
  }
  const safe = { id: user.id, org_id: user.org_id, email: user.email, full_name: user.full_name, role: user.role, mfa_enabled: user.mfa_enabled };
  res.json({ token: sign(safe), user: safe });
});

app.post("/api/mfa/enable", requireAuth, async (req, res) => {
  const { totp } = req.body || {};
  const u = (await pool.query(`SELECT mfa_secret FROM users WHERE id=$1 AND org_id=$2`, [req.user.id, req.user.org_id])).rows[0];
  const ok = u && speakeasy.totp.verify({ secret: u.mfa_secret, encoding: "base32", token: String(totp || ""), window: 1 });
  if (!ok) return res.status(400).json({ error: "invalid_totp" });
  const updated = (await pool.query(
    `SELECT id, org_id, email, full_name, role, true AS mfa_enabled FROM users WHERE id=$1 AND org_id=$2`,
    [req.user.id, req.user.org_id]
  )).rows[0];
  await pool.query(`UPDATE users SET mfa_enabled=true WHERE id=$1 AND org_id=$2`, [req.user.id, req.user.org_id]);
  await audit(req, "mfa_enabled", "user", req.user.id);
  res.json({ ok: true, token: sign(updated), user: updated });
});

app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/patients", requireAuth, requireMfa, async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM patients WHERE ${patientWhere()} ORDER BY created_at DESC LIMIT 200`, [req.user.org_id])).rows;
  res.json({ patients: rows });
});

app.post("/api/patients", requireAuth, requireMfa, allow("org_admin","bcba","supervisor"), async (req, res) => {
  const { first_name, last_name, date_of_birth, external_id, guardian_name, guardian_phone, guardian_email, diagnosis, insurance } = req.body || {};
  if (!first_name || !last_name) return res.status(400).json({ error: "first_name_last_name_required" });
  const row = (await pool.query(
    `INSERT INTO patients (org_id, first_name, last_name, date_of_birth, external_id, guardian_name, guardian_phone, guardian_email, diagnosis, insurance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.user.org_id, first_name, last_name, date_of_birth || null, external_id || null, guardian_name || null, guardian_phone || null, guardian_email || null, diagnosis || null, insurance || null]
  )).rows[0];
  await audit(req, "patient_created", "patient", row.id);
  res.json({ patient: row });
});

async function assertPatient(req, id) {
  const row = (await pool.query(`SELECT id FROM patients WHERE id=$1 AND org_id=$2`, [id, req.user.org_id])).rows[0];
  return Boolean(row);
}

app.post("/api/session-logs", requireAuth, requireMfa, allow("org_admin","bcba","supervisor","therapist","rbt"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found" });
  const row = (await pool.query(
    `INSERT INTO session_logs
     (org_id, patient_id, user_id, session_date, start_time, end_time, location, service_code, participants, activities, interventions_used, response_to_intervention, progress_notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.user.org_id, b.patient_id, req.user.id, b.session_date || null, b.start_time || null, b.end_time || null, b.location || null, b.service_code || null, b.participants || null, b.activities || null, b.interventions_used || null, b.response_to_intervention || null, b.progress_notes || null, b.status || "draft"]
  )).rows[0];
  await audit(req, "session_log_created", "session_log", row.id, { patient_id: b.patient_id });
  res.json({ session_log: row });
});

app.post("/api/behavior-events", requireAuth, requireMfa, allow("org_admin","bcba","supervisor","therapist","rbt"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found" });
  const row = (await pool.query(
    `INSERT INTO behavior_events
     (org_id, patient_id, user_id, event_time, antecedent, behavior, consequence, intensity, duration_seconds, location, suspected_function, deescalation, injury, restraint, notes)
     VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [req.user.org_id, b.patient_id, req.user.id, b.event_time || null, b.antecedent || null, b.behavior, b.consequence || null, b.intensity || null, b.duration_seconds || null, b.location || null, b.suspected_function || null, b.deescalation || null, !!b.injury, !!b.restraint, b.notes || null]
  )).rows[0];
  await audit(req, "behavior_event_created", "behavior_event", row.id, { patient_id: b.patient_id });
  res.json({ behavior_event: row });
});

app.post("/api/therapy-plans", requireAuth, requireMfa, allow("org_admin","bcba","supervisor"), async (req, res) => {
  const b = req.body || {};
  if (!b.patient_id || !(await assertPatient(req, b.patient_id))) return res.status(404).json({ error: "patient_not_found" });
  const row = (await pool.query(
    `INSERT INTO therapy_plans (org_id, patient_id, title, plan_type, goals, interventions, restrictions, effective_from, effective_to, status, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING *`,
    [req.user.org_id, b.patient_id, b.title || "Therapy plan", b.plan_type || "behavior_support", JSON.stringify(b.goals || []), JSON.stringify(b.interventions || []), JSON.stringify(b.restrictions || []), b.effective_from || null, b.effective_to || null, b.status || "draft", req.user.id]
  )).rows[0];
  await audit(req, "therapy_plan_created", "therapy_plan", row.id, { patient_id: b.patient_id });
  res.json({ therapy_plan: row });
});

function redactPhi(text = "") {
  return String(text)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]")
    .replace(/\b\d{10,}\b/g, "[NUMBER]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE]");
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful clinical documentation assistant. Do not diagnose. Draft factual, neutral, auditable summaries. Highlight uncertainty and require clinician review." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });
  if (!res.ok) throw new Error(`AI provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

app.post("/api/ai/session-summary", requireAuth, requireMfa, allow("org_admin","bcba","supervisor","therapist"), async (req, res) => {
  const { patient_id, note } = req.body || {};
  if (!patient_id || !(await assertPatient(req, patient_id))) return res.status(404).json({ error: "patient_not_found" });
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
    res.status(502).json({ error: "ai_provider_error", detail: e.message });
  }
});

app.get("/api/audit", requireAuth, requireMfa, allow("org_admin"), async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM audit_log WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.org_id])).rows;
  res.json({ audit: rows });
});

app.get("*", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));

await initSchema();
app.listen(PORT, () => console.log(`TherapyAgent listening on port ${PORT}`));
