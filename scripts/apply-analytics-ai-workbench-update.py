#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime

ROOT = Path.cwd()
STAMP = datetime.now().strftime('%Y%m%d-%H%M%S')


def backup(path: Path):
    if path.exists():
        b = path.with_name(path.name + f'.backup.analytics-ai-{STAMP}')
        b.write_text(path.read_text())
        print(f'Backed up {path} -> {b}')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new.strip() in text:
        print(f'Skipping {label}; already applied.')
        return text
    if old not in text:
        raise SystemExit(f'Could not find marker/block for {label}.')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# workspace.html: add left menu buttons and panels
# -----------------------------------------------------------------------------
workspace = ROOT / 'public' / 'workspace.html'
backup(workspace)
s = workspace.read_text()

old_menu = '''        <button data-panel="dashboard" class="active">Dashboard</button>
        <button data-panel="patients">Patients</button>'''
new_menu = '''        <button data-panel="dashboard" class="active">Dashboard</button>
        <button data-panel="analytics">Data Analytics</button>
        <button data-panel="aiWorkbench">AI Workbench</button>
        <button data-panel="patients">Patients</button>'''
s = replace_once(s, old_menu, new_menu, 'workspace sidebar buttons')

analytics_panels = '''
      <section class="panel" id="analytics">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Clinical intelligence</p>
            <h2>Data Analytics</h2>
          </div>
          <button class="btn small" id="refreshAnalytics" type="button">Refresh analytics</button>
        </div>
        <div class="notice">Track organization trends, patient risk signals, workload, and documentation quality. Risk signals are decision-support indicators and require BCBA review.</div>
        <div id="analyticsContent" class="analytics-content">Loading analytics...</div>
      </section>

      <section class="panel" id="aiWorkbench">
        <div class="panel-head">
          <div>
            <p class="eyebrow">ABA-skilled assistant</p>
            <h2>AI Workbench</h2>
          </div>
          <button class="btn small" id="refreshAiWorkbench" type="button">Refresh context</button>
        </div>
        <div class="notice">Talk to an ABA-skilled BCBA support agent that uses TherapyAgent records as context. The agent supports clinical documentation and plan preparation, but does not replace clinician judgment.</div>
        <section class="form-card ai-workbench-card">
          <div class="form-grid">
            <label>Patient context
              <select id="aiWorkbenchPatient"><option value="">Organization-level / no single patient</option></select>
            </label>
            <label>Date range
              <select id="aiWorkbenchRange">
                <option value="30">Last 30 days</option>
                <option value="90" selected>Last 90 days</option>
                <option value="180">Last 180 days</option>
                <option value="365">Last 365 days</option>
              </select>
            </label>
            <label>Workbench mode
              <select id="aiWorkbenchMode">
                <option value="plan_review">Plan review preparation</option>
                <option value="behavior_analysis">Behavior pattern analysis</option>
                <option value="incident_review">Incident review</option>
                <option value="report_drafting">Report drafting support</option>
                <option value="predictive_signals">Predictive risk signals</option>
                <option value="general">General BCBA question</option>
              </select>
            </label>
            <label>ABA Knowledge Base
              <select id="aiWorkbenchKnowledge">
                <option value="patient_records">Patient records only</option>
                <option value="org_approved" disabled>Org-approved ABA documents coming soon</option>
              </select>
            </label>
            <label class="span-2">Ask the ABA-Skilled BCBA Agent
              <textarea id="aiWorkbenchQuestion" placeholder="Example: Prepare me for this patient's plan review. What trends, antecedents, interventions, and data gaps should I consider?"></textarea>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn" id="runAiWorkbench" type="button">Ask ABA-Skilled BCBA Agent</button>
            <button class="btn secondary" id="clearAiWorkbench" type="button">Clear</button>
          </div>
          <div id="aiWorkbenchMsg" class="message"></div>
        </section>
        <section class="ai-workbench-output" id="aiWorkbenchOutput" hidden></section>
        <section class="ai-knowledge-card">
          <h3>ABA Knowledge Base</h3>
          <p>Future enhancement: upload organization-approved ABA resources, clinical templates, public-domain guidance, and licensed materials. TherapyAgent will not preload copyrighted ABA books unless your organization has rights to use them.</p>
        </section>
        <section class="ai-workbench-history">
          <h3>Recent AI Workbench activity</h3>
          <div id="aiWorkbenchHistory" class="table-wrap"></div>
        </section>
      </section>
'''
old_panel_marker = '''      <section class="panel" id="patients">'''
new_panel_marker = analytics_panels + '\n      <section class="panel" id="patients">'
s = replace_once(s, old_panel_marker, new_panel_marker, 'analytics and AI Workbench panels')
workspace.write_text(s)

# -----------------------------------------------------------------------------
# public/app.js: add client functions and route panel behavior
# -----------------------------------------------------------------------------
appjs = ROOT / 'public' / 'app.js'
backup(appjs)
s = appjs.read_text()

old_globals = '''let patientSummary = null;
let activeVoice = null;'''
new_globals = '''let patientSummary = null;
let activeVoice = null;
let analyticsCache = null;
let aiWorkbenchBootstrap = null;'''
s = replace_once(s, old_globals, new_globals, 'app.js globals')

old_panel = '''  if (id === "patients") loadPatients();
  if (id === "inbox") loadInbox();
  if (resourceDefs[id]) loadResourceList(id);
  if (id === "admin") loadAdmin();'''
new_panel = '''  if (id === "patients") loadPatients();
  if (id === "analytics") loadAnalytics();
  if (id === "aiWorkbench") loadAiWorkbench();
  if (id === "inbox") loadInbox();
  if (resourceDefs[id]) loadResourceList(id);
  if (id === "admin") loadAdmin();'''
s = replace_once(s, old_panel, new_panel, 'panel analytics/workbench loaders')

analytics_js = r'''

function metricHtml(label, value, helper = "") {
  return `<div class="metric"><span>${escapeHtml(value ?? "0")}</span><label>${escapeHtml(label)}</label>${helper ? `<small>${escapeHtml(helper)}</small>` : ""}</div>`;
}
function miniBarTable(headers, rows) {
  return tableHtml(headers, rows.length ? rows : []);
}
function riskBadge(score = 0) {
  const n = Number(score || 0);
  const cls = n >= 8 ? "high" : n >= 4 ? "medium" : "low";
  const label = n >= 8 ? "High attention" : n >= 4 ? "Monitor" : "Low";
  return `<span class="risk-badge ${cls}">${label}</span>`;
}
function renderAnalytics(out) {
  const mount = $("#analyticsContent");
  if (!mount) return;
  const m = out.metrics || {};
  const riskRows = (out.risk_signals || []).map(r => [
    `<button class="link-btn" type="button" data-ai-patient-risk="${r.patient_id}">${escapeHtml(r.patient_name || "Patient")}</button>`,
    riskBadge(r.risk_score),
    escapeHtml(String(r.behavior_30 || 0)),
    escapeHtml(String(r.incident_30 || 0)),
    escapeHtml(String(r.high_incident_30 || 0)),
    escapeHtml(String(Number(r.avg_intensity_30 || 0).toFixed(1))),
    escapeHtml(String(r.sessions_30 || 0)),
    escapeHtml((r.signals || []).join("; "))
  ]);
  const staffRows = (out.staff_workload || []).map(r => [
    escapeHtml(r.full_name || ""), escapeHtml(r.role || ""), escapeHtml(String(r.sessions_30 || 0)), escapeHtml(String(r.behaviors_30 || 0)), escapeHtml(String(r.incidents_30 || 0)), escapeHtml(String(r.reports_30 || 0))
  ]);
  const behaviorRows = (out.behavior_functions || []).map(r => [escapeHtml(r.label || "Unspecified"), escapeHtml(String(r.count || 0))]);
  const severityRows = (out.incident_severity || []).map(r => [escapeHtml(r.label || "Unspecified"), escapeHtml(String(r.count || 0))]);
  const qualityRows = (out.data_quality || []).map(r => [escapeHtml(r.label), escapeHtml(String(r.count || 0)), escapeHtml(r.recommendation || "")]);

  mount.innerHTML = `
    <div class="metric-grid analytics-metrics">
      ${metricHtml("Active patients", m.active_patients, "Current org")}
      ${metricHtml("Sessions / 30d", m.sessions_30, "Completed or drafted")}
      ${metricHtml("Behavior events / 30d", m.behaviors_30, "All intensities")}
      ${metricHtml("Incidents / 30d", m.incidents_30, "All severities")}
      ${metricHtml("Open incidents", m.open_incidents, "Needs follow-up")}
      ${metricHtml("Plans expiring", m.plans_expiring_30, "Next 30 days")}
      ${metricHtml("Reports / 30d", m.reports_30, "AI reports")}
      ${metricHtml("Under review", m.under_review, "All record types")}
    </div>
    <div class="analytics-grid">
      <section class="analytics-card span-2"><h3>Patient risk signals</h3><p class="muted">Transparent indicators based on recent behaviors, incidents, intensity, session consistency, and plan currency. Not a diagnosis or autonomous treatment decision.</p>${miniBarTable(["Patient", "Signal", "Behaviors", "Incidents", "High", "Avg intensity", "Sessions", "Evidence"], riskRows)}</section>
      <section class="analytics-card"><h3>Behavior suspected functions</h3>${miniBarTable(["Function", "Events"], behaviorRows)}</section>
      <section class="analytics-card"><h3>Incidents by severity</h3>${miniBarTable(["Severity", "Incidents"], severityRows)}</section>
      <section class="analytics-card span-2"><h3>Staff workload / 30 days</h3>${miniBarTable(["User", "Role", "Sessions", "Behaviors", "Incidents", "Reports"], staffRows)}</section>
      <section class="analytics-card span-2"><h3>Compliance and data quality</h3>${miniBarTable(["Check", "Count", "Recommended action"], qualityRows)}</section>
    </div>`;
  $$(`[data-ai-patient-risk]`, mount).forEach(b => b.onclick = () => {
    panel("aiWorkbench");
    setTimeout(() => {
      const sel = $("#aiWorkbenchPatient");
      if (sel) sel.value = b.dataset.aiPatientRisk;
      const q = $("#aiWorkbenchQuestion");
      if (q) q.value = "Prepare a BCBA plan review briefing for this patient. Highlight behavior trends, incident risk, possible antecedent/function patterns, intervention response, and data gaps.";
    }, 300);
  });
}
async function loadAnalytics() {
  const mount = $("#analyticsContent");
  if (!mount) return;
  mount.innerHTML = "Loading analytics...";
  try {
    analyticsCache = await api("/api/analytics/dashboard");
    renderAnalytics(analyticsCache);
  } catch (e) {
    mount.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}
function renderAiWorkbenchBootstrap(out) {
  const sel = $("#aiWorkbenchPatient");
  if (sel) {
    const current = sel.value;
    sel.innerHTML = `<option value="">Organization-level / no single patient</option>` + (out.patients || []).map(p => `<option value="${p.id}">${escapeHtml(p.full_name)}${p.diagnosis ? ` — ${escapeHtml(p.diagnosis)}` : ""}</option>`).join("");
    sel.value = current || "";
  }
  const hist = $("#aiWorkbenchHistory");
  if (hist) {
    const rows = (out.history || []).map(h => [
      fmtDate(h.created_at), escapeHtml(h.patient_name || "Org-level"), escapeHtml(h.mode || ""), escapeHtml(String(h.date_range_days || "")), escapeHtml(h.question || "")
    ]);
    hist.innerHTML = tableHtml(["Date", "Context", "Mode", "Days", "Question"], rows);
  }
}
async function loadAiWorkbench() {
  try {
    aiWorkbenchBootstrap = await api("/api/ai/workbench/bootstrap");
    renderAiWorkbenchBootstrap(aiWorkbenchBootstrap);
  } catch (e) {
    setMessage($("#aiWorkbenchMsg"), e.message, "error");
  }
}
function renderWorkbenchResponse(out) {
  const el = $("#aiWorkbenchOutput");
  if (!el) return;
  el.hidden = false;
  const evidence = (out.evidence || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
  el.innerHTML = `
    <div class="ai-answer-head"><p class="eyebrow">${escapeHtml(out.agent || "ABA-Skilled BCBA Agent")}</p><h3>Workbench response</h3><span class="risk-badge ${out.mode === "llm" ? "medium" : "low"}">${escapeHtml(out.mode === "llm" ? "LLM assisted" : "Local no-PHI mode")}</span></div>
    <div class="ai-answer-body">${escapeHtml(out.answer || "").replace(/\n/g, "<br>")}</div>
    ${evidence ? `<div class="ai-evidence"><h4>Evidence used</h4><ul>${evidence}</ul></div>` : ""}
    <p class="muted">Outputs require clinician review. TherapyAgent does not diagnose, prescribe treatment, or replace BCBA judgment.</p>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function runAiWorkbench() {
  const msg = $("#aiWorkbenchMsg");
  const question = ($("#aiWorkbenchQuestion")?.value || "").trim();
  if (!question) return setMessage(msg, "Enter a question for the ABA-Skilled BCBA Agent.", "error");
  try {
    setMessage(msg, "Building patient context and generating response...", "info");
    const out = await api("/api/ai/workbench", {
      method: "POST",
      body: JSON.stringify({
        patient_id: $("#aiWorkbenchPatient")?.value || "",
        date_range_days: $("#aiWorkbenchRange")?.value || "90",
        mode: $("#aiWorkbenchMode")?.value || "general",
        question
      })
    });
    setMessage(msg, out.message || "Response generated.", "success");
    renderWorkbenchResponse(out);
    await loadAiWorkbench();
  } catch (e) {
    setMessage(msg, e.message, "error");
  }
}
'''
marker = '''async function loadInbox() {'''
if 'async function loadAnalytics()' not in s:
    if marker not in s:
        raise SystemExit('Could not find loadInbox marker for analytics JS insertion.')
    s = s.replace(marker, analytics_js + '\n' + marker, 1)
else:
    print('Skipping analytics JS functions; already applied.')

old_bind = '''$("#refreshAll")?.addEventListener("click", async () => { await loadPatients(); await refreshDashboard(); });
$("#refreshInbox")?.addEventListener("click", loadInbox);'''
new_bind = '''$("#refreshAll")?.addEventListener("click", async () => { await loadPatients(); await refreshDashboard(); });
$("#refreshAnalytics")?.addEventListener("click", loadAnalytics);
$("#refreshAiWorkbench")?.addEventListener("click", loadAiWorkbench);
$("#runAiWorkbench")?.addEventListener("click", runAiWorkbench);
$("#clearAiWorkbench")?.addEventListener("click", () => { $("#aiWorkbenchQuestion") && ($("#aiWorkbenchQuestion").value = ""); $("#aiWorkbenchOutput") && ($("#aiWorkbenchOutput").hidden = true); setMessage($("#aiWorkbenchMsg"), ""); });
$("#refreshInbox")?.addEventListener("click", loadInbox);'''
s = replace_once(s, old_bind, new_bind, 'AI Workbench event bindings')
appjs.write_text(s)

# -----------------------------------------------------------------------------
# public/styles.css: append styles
# -----------------------------------------------------------------------------
css = ROOT / 'public' / 'styles.css'
backup(css)
s = css.read_text()
css_add = r'''

/* Data Analytics and AI Workbench */
.analytics-content{margin-top:18px}.analytics-metrics{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:18px}.metric small{display:block;color:var(--muted);font-weight:700;margin-top:6px}.analytics-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.analytics-card,.ai-workbench-output,.ai-knowledge-card,.ai-workbench-history{background:white;border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:16px;box-shadow:0 8px 32px rgba(8,32,74,.06)}.analytics-card h3,.ai-knowledge-card h3,.ai-workbench-history h3{margin:0 0 10px;color:var(--blue-900)}.risk-badge{display:inline-flex;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800}.risk-badge.high{background:#fff1f2;color:#be123c}.risk-badge.medium{background:#fffbeb;color:#92400e}.risk-badge.low{background:#ecfdf5;color:#047857}.ai-workbench-card textarea{min-height:150px}.ai-answer-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}.ai-answer-head h3{margin:0;color:var(--blue-900)}.ai-answer-body{background:#f8fafc;border:1px solid var(--line);border-radius:16px;padding:16px;line-height:1.65;color:#1f2937}.ai-evidence{margin-top:14px;background:var(--blue-050);border:1px solid var(--line);border-radius:14px;padding:12px}.ai-evidence h4{margin:0 0 8px;color:var(--blue-900)}.ai-evidence ul{margin:0;padding-left:18px;color:#334155}.ai-knowledge-card p{color:var(--muted);line-height:1.6;margin-bottom:0}@media(max-width:900px){.analytics-metrics,.analytics-grid{grid-template-columns:1fr}.analytics-card.span-2{grid-column:auto}}
'''
if '/* Data Analytics and AI Workbench */' not in s:
    css.write_text(s.rstrip() + '\n' + css_add)
else:
    print('Skipping CSS; already applied.')

# -----------------------------------------------------------------------------
# db/schema.sql: add AI Workbench history table
# -----------------------------------------------------------------------------
schema = ROOT / 'db' / 'schema.sql'
backup(schema)
s = schema.read_text()
schema_add = r'''

-- AI Workbench history stores clinician-reviewed AI support interactions.
CREATE TABLE IF NOT EXISTS ai_workbench_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'general',
  date_range_days INTEGER NOT NULL DEFAULT 90,
  question TEXT NOT NULL,
  response_summary TEXT NOT NULL,
  context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  llm_mode TEXT NOT NULL DEFAULT 'local_no_phi',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_workbench_history_org_created ON ai_workbench_history(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_workbench_history_org_patient ON ai_workbench_history(org_id, patient_id, created_at DESC);
'''
if 'CREATE TABLE IF NOT EXISTS ai_workbench_history' not in s:
    s = s.rstrip() + '\n' + schema_add + '\n'
    schema.write_text(s)
else:
    print('Skipping schema AI Workbench table; already applied.')

# -----------------------------------------------------------------------------
# server.js: add analytics and AI Workbench routes
# -----------------------------------------------------------------------------
server = ROOT / 'server.js'
backup(server)
s = server.read_text()
server_add = r'''
// Data Analytics and AI Workbench APIs
function requireAiWorkbenchAccess(req, res, next) {
  const allowedRoles = new Set(["org_admin", "bcba", "supervisor", "therapist"]);
  if (!allowedRoles.has(req.user?.role)) {
    return res.status(403).json({ error: "forbidden", message: "AI Workbench is available to Org Admin, BCBA, Supervisor, and Therapist roles." });
  }
  next();
}
function parseDays(value, fallback = 90) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(7, Math.min(365, Math.round(n)));
}
function asInt(value) { return Number(value || 0); }
function topCounts(rows, field, limit = 5) {
  const m = new Map();
  for (const row of rows || []) {
    const key = String(row?.[field] || "Unspecified").trim() || "Unspecified";
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, count]) => `${label} (${count})`);
}
function safeDateText(value) {
  if (!value) return "";
  try { return new Date(value).toISOString().slice(0, 10); } catch { return String(value).slice(0, 10); }
}

app.get("/api/analytics/dashboard", requireAuth, requireMfa, async (req, res) => {
  try {
    const orgId = req.user.org_id;
    const metrics = {};
    metrics.active_patients = asInt((await pool.query(`SELECT count(*) AS c FROM patients WHERE org_id=$1 AND COALESCE(status,'active')='active'`, [orgId])).rows[0]?.c);
    metrics.sessions_30 = asInt((await pool.query(`SELECT count(*) AS c FROM session_logs WHERE org_id=$1 AND session_date >= CURRENT_DATE - INTERVAL '30 days'`, [orgId])).rows[0]?.c);
    metrics.behaviors_30 = asInt((await pool.query(`SELECT count(*) AS c FROM behavior_events WHERE org_id=$1 AND event_time >= now() - INTERVAL '30 days'`, [orgId])).rows[0]?.c);
    metrics.incidents_30 = asInt((await pool.query(`SELECT count(*) AS c FROM incidents WHERE org_id=$1 AND incident_date >= now() - INTERVAL '30 days'`, [orgId])).rows[0]?.c);
    metrics.open_incidents = asInt((await pool.query(`SELECT count(*) AS c FROM incidents WHERE org_id=$1 AND lower(COALESCE(status,'')) IN ('open','draft','under review')`, [orgId])).rows[0]?.c);
    metrics.plans_expiring_30 = asInt((await pool.query(`SELECT count(*) AS c FROM therapy_plans WHERE org_id=$1 AND effective_to BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`, [orgId])).rows[0]?.c);
    metrics.reports_30 = asInt((await pool.query(`SELECT count(*) AS c FROM ai_reports WHERE org_id=$1 AND created_at >= now() - INTERVAL '30 days'`, [orgId])).rows[0]?.c);
    metrics.under_review = asInt((await pool.query(`
      SELECT
        (SELECT count(*) FROM session_logs WHERE org_id=$1 AND lower(COALESCE(status,''))='under review') +
        (SELECT count(*) FROM behavior_events WHERE org_id=$1 AND lower(COALESCE(status,''))='under review') +
        (SELECT count(*) FROM therapy_plans WHERE org_id=$1 AND lower(COALESCE(status,''))='under review') +
        (SELECT count(*) FROM incidents WHERE org_id=$1 AND lower(COALESCE(status,''))='under review') +
        (SELECT count(*) FROM ai_reports WHERE org_id=$1 AND lower(COALESCE(status,''))='under review') AS c`, [orgId])).rows[0]?.c);

    const behaviorFunctions = (await pool.query(`
      SELECT COALESCE(NULLIF(trim(suspected_function),''),'Unspecified') AS label, count(*)::int AS count
      FROM behavior_events
      WHERE org_id=$1 AND event_time >= now() - INTERVAL '90 days'
      GROUP BY 1 ORDER BY count DESC LIMIT 8`, [orgId])).rows;
    const incidentSeverity = (await pool.query(`
      SELECT COALESCE(NULLIF(trim(severity),''),'Unspecified') AS label, count(*)::int AS count
      FROM incidents
      WHERE org_id=$1 AND incident_date >= now() - INTERVAL '90 days'
      GROUP BY 1 ORDER BY count DESC`, [orgId])).rows;
    const staffWorkload = (await pool.query(`
      SELECT u.id, u.full_name, u.role,
        (SELECT count(*) FROM session_logs s WHERE s.org_id=$1 AND s.user_id=u.id AND s.created_at >= now() - INTERVAL '30 days')::int AS sessions_30,
        (SELECT count(*) FROM behavior_events b WHERE b.org_id=$1 AND b.user_id=u.id AND b.created_at >= now() - INTERVAL '30 days')::int AS behaviors_30,
        (SELECT count(*) FROM incidents i WHERE i.org_id=$1 AND i.reported_by=u.id AND i.created_at >= now() - INTERVAL '30 days')::int AS incidents_30,
        (SELECT count(*) FROM ai_reports r WHERE r.org_id=$1 AND r.created_by=u.id AND r.created_at >= now() - INTERVAL '30 days')::int AS reports_30
      FROM users u
      WHERE u.org_id=$1 AND u.active=true
      ORDER BY (sessions_30 + behaviors_30 + incidents_30 + reports_30) DESC, u.full_name ASC
      LIMIT 20`, [orgId])).rows;
    const rawRisk = (await pool.query(`
      WITH pa AS (
        SELECT p.id AS patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name, p.diagnosis,
          (SELECT count(*) FROM behavior_events b WHERE b.org_id=$1 AND b.patient_id=p.id AND b.event_time >= now() - INTERVAL '30 days')::int AS behavior_30,
          (SELECT count(*) FROM behavior_events b WHERE b.org_id=$1 AND b.patient_id=p.id AND b.event_time >= now() - INTERVAL '60 days' AND b.event_time < now() - INTERVAL '30 days')::int AS behavior_prev_30,
          COALESCE((SELECT avg(b.intensity)::numeric(10,2) FROM behavior_events b WHERE b.org_id=$1 AND b.patient_id=p.id AND b.event_time >= now() - INTERVAL '30 days'),0) AS avg_intensity_30,
          (SELECT count(*) FROM incidents i WHERE i.org_id=$1 AND i.patient_id=p.id AND i.incident_date >= now() - INTERVAL '30 days')::int AS incident_30,
          (SELECT count(*) FROM incidents i WHERE i.org_id=$1 AND i.patient_id=p.id AND lower(i.severity) IN ('high','critical') AND i.incident_date >= now() - INTERVAL '30 days')::int AS high_incident_30,
          (SELECT count(*) FROM session_logs s WHERE s.org_id=$1 AND s.patient_id=p.id AND s.session_date >= CURRENT_DATE - INTERVAL '30 days')::int AS sessions_30,
          (SELECT max(tp.effective_to) FROM therapy_plans tp WHERE tp.org_id=$1 AND tp.patient_id=p.id) AS latest_plan_end
        FROM patients p WHERE p.org_id=$1 AND COALESCE(p.status,'active')='active'
      )
      SELECT *,
        ((CASE WHEN behavior_30 >= behavior_prev_30 + 3 THEN 3 ELSE 0 END) +
         (CASE WHEN incident_30 >= 3 THEN 3 ELSE incident_30 END) +
         (CASE WHEN high_incident_30 > 0 THEN 3 ELSE 0 END) +
         (CASE WHEN avg_intensity_30 >= 4 THEN 2 ELSE 0 END) +
         (CASE WHEN sessions_30 = 0 THEN 1 ELSE 0 END) +
         (CASE WHEN latest_plan_end IS NULL OR latest_plan_end < CURRENT_DATE + INTERVAL '30 days' THEN 1 ELSE 0 END))::int AS risk_score
      FROM pa
      ORDER BY risk_score DESC, incident_30 DESC, behavior_30 DESC, patient_name ASC
      LIMIT 15`, [orgId])).rows;
    const riskSignals = rawRisk.map(r => {
      const signals = [];
      if (asInt(r.behavior_30) >= asInt(r.behavior_prev_30) + 3) signals.push("Behavior frequency increased vs prior 30 days");
      if (asInt(r.incident_30) >= 3) signals.push("Multiple incidents in last 30 days");
      if (asInt(r.high_incident_30) > 0) signals.push("High/critical incident present");
      if (Number(r.avg_intensity_30 || 0) >= 4) signals.push("Average behavior intensity ≥ 4");
      if (asInt(r.sessions_30) === 0) signals.push("No sessions logged in last 30 days");
      if (!r.latest_plan_end) signals.push("No active plan end date found");
      else if (new Date(r.latest_plan_end) < new Date(Date.now() + 30 * 86400000)) signals.push("Plan expires within 30 days");
      return { ...r, signals };
    });
    const dataQuality = [
      { label: "Patients without active/future therapy plan", count: asInt((await pool.query(`SELECT count(*) AS c FROM patients p WHERE p.org_id=$1 AND COALESCE(p.status,'active')='active' AND NOT EXISTS (SELECT 1 FROM therapy_plans tp WHERE tp.org_id=p.org_id AND tp.patient_id=p.id AND (tp.effective_to IS NULL OR tp.effective_to >= CURRENT_DATE))`, [orgId])).rows[0]?.c), recommendation: "Review care plan coverage." },
      { label: "Draft records older than 7 days", count: asInt((await pool.query(`SELECT (SELECT count(*) FROM session_logs WHERE org_id=$1 AND lower(COALESCE(status,''))='draft' AND created_at < now() - INTERVAL '7 days') + (SELECT count(*) FROM behavior_events WHERE org_id=$1 AND lower(COALESCE(status,''))='draft' AND created_at < now() - INTERVAL '7 days') + (SELECT count(*) FROM incidents WHERE org_id=$1 AND lower(COALESCE(status,''))='draft' AND created_at < now() - INTERVAL '7 days') + (SELECT count(*) FROM ai_reports WHERE org_id=$1 AND lower(COALESCE(status,''))='draft' AND created_at < now() - INTERVAL '7 days') AS c`, [orgId])).rows[0]?.c), recommendation: "Submit, complete, or archive stale documentation." },
      { label: "Incidents missing immediate actions", count: asInt((await pool.query(`SELECT count(*) AS c FROM incidents WHERE org_id=$1 AND (immediate_actions IS NULL OR trim(immediate_actions)='')`, [orgId])).rows[0]?.c), recommendation: "Add follow-up/actions before review." }
    ];
    await audit(req, "analytics_dashboard_viewed", "analytics", null);
    res.json({ metrics, behavior_functions: behaviorFunctions, incident_severity: incidentSeverity, staff_workload: staffWorkload, risk_signals: riskSignals, data_quality: dataQuality });
  } catch (e) {
    console.error("[analytics]", e.message);
    res.status(500).json({ error: "analytics_failed", message: "Could not load analytics dashboard." });
  }
});

async function loadWorkbenchContext(orgId, patientId, days) {
  const ctx = { days, generated_at: new Date().toISOString() };
  if (patientId) {
    ctx.patient = (await pool.query(`SELECT id, first_name, last_name, date_of_birth, external_id, diagnosis, guardian_name, status, created_at FROM patients WHERE id=$1 AND org_id=$2`, [patientId, orgId])).rows[0] || null;
    if (!ctx.patient) throw Object.assign(new Error("Patient not found."), { status: 404 });
  }
  const patientFilter = patientId ? "AND patient_id=$2" : "";
  const params = patientId ? [orgId, patientId] : [orgId];
  ctx.sessions = (await pool.query(`SELECT id, patient_id, session_date, location, service_code, activities, interventions_used, response_to_intervention, progress_notes, ai_summary, status, created_at FROM session_logs WHERE org_id=$1 ${patientFilter} AND session_date >= CURRENT_DATE - ($${params.length + 1}::int * INTERVAL '1 day') ORDER BY session_date DESC, created_at DESC LIMIT 45`, [...params, days])).rows;
  ctx.behaviors = (await pool.query(`SELECT id, patient_id, event_time, antecedent, behavior, consequence, intensity, duration_seconds, location, suspected_function, deescalation, injury, restraint, notes, status, created_at FROM behavior_events WHERE org_id=$1 ${patientFilter} AND event_time >= now() - ($${params.length + 1}::int * INTERVAL '1 day') ORDER BY event_time DESC LIMIT 80`, [...params, days])).rows;
  ctx.incidents = (await pool.query(`SELECT id, patient_id, incident_date, category, severity, location, description, immediate_actions, notifications, status, created_at FROM incidents WHERE org_id=$1 ${patientFilter} AND incident_date >= now() - ($${params.length + 1}::int * INTERVAL '1 day') ORDER BY incident_date DESC LIMIT 80`, [...params, days])).rows;
  ctx.plans = (await pool.query(`SELECT id, patient_id, title, plan_type, goals, interventions, restrictions, effective_from, effective_to, status, created_at FROM therapy_plans WHERE org_id=$1 ${patientFilter} ORDER BY COALESCE(effective_to, effective_from, created_at::date) DESC LIMIT 25`, params)).rows;
  ctx.reports = (await pool.query(`SELECT id, patient_id, report_type, prompt, output, status, created_at FROM ai_reports WHERE org_id=$1 ${patientFilter} ORDER BY created_at DESC LIMIT 20`, params)).rows;
  if (!patientId) {
    ctx.patients = (await pool.query(`SELECT id, trim(first_name || ' ' || last_name) AS full_name, diagnosis, status FROM patients WHERE org_id=$1 AND COALESCE(status,'active')='active' ORDER BY last_name, first_name LIMIT 80`, [orgId])).rows;
  }
  return ctx;
}
function buildLocalAbaWorkbenchAnswer(ctx, question, mode) {
  const patientName = ctx.patient ? `${ctx.patient.first_name || ""} ${ctx.patient.last_name || ""}`.trim() : "the organization/caseload";
  const behaviors = ctx.behaviors || [];
  const incidents = ctx.incidents || [];
  const sessions = ctx.sessions || [];
  const plans = ctx.plans || [];
  const reports = ctx.reports || [];
  const topBehaviors = topCounts(behaviors, "behavior", 5).join(", ") || "No behavior events in the selected period";
  const topAntecedents = topCounts(behaviors, "antecedent", 5).join(", ") || "No antecedent pattern available";
  const topFunctions = topCounts(behaviors, "suspected_function", 5).join(", ") || "No suspected function documented";
  const topIncidentSeverity = topCounts(incidents, "severity", 4).join(", ") || "No incidents in the selected period";
  const avgIntensity = behaviors.length ? (behaviors.reduce((sum, b) => sum + Number(b.intensity || 0), 0) / behaviors.filter(b => b.intensity != null).length || 0).toFixed(1) : "0.0";
  const recentPlan = plans[0];
  const recentSessions = sessions.slice(0, 3).map(s => `${safeDateText(s.session_date)}: ${s.response_to_intervention || s.ai_summary || s.activities || "session documented"}`).join("\n- ");
  const dataGaps = [];
  if (!plans.length) dataGaps.push("No therapy plan found in context.");
  if (behaviors.some(b => !b.antecedent)) dataGaps.push("Some behavior events are missing antecedent detail.");
  if (behaviors.some(b => !b.suspected_function)) dataGaps.push("Some behavior events are missing suspected function.");
  if (incidents.some(i => !i.immediate_actions)) dataGaps.push("Some incidents are missing immediate action/follow-up notes.");
  if (!sessions.length) dataGaps.push("No session logs in the selected date range.");
  const recommendations = [
    "Validate these patterns with direct observation and staff/caregiver input before changing a plan.",
    "Review ABC data quality and tighten antecedent/consequence documentation where fields are sparse.",
    "Compare documented interventions with response-to-intervention notes before revising goals or strategies.",
    "Use this output as a BCBA planning aid only; final treatment decisions require clinician review."
  ];
  return `ABA-Skilled BCBA Agent — clinician-reviewed support\n\nContext: ${patientName}, last ${ctx.days} days. Mode: ${mode || "general"}.\n\nYour question: ${question}\n\nSnapshot:\n- Session logs reviewed: ${sessions.length}\n- Behavior events reviewed: ${behaviors.length}\n- Incidents reviewed: ${incidents.length}\n- Therapy plans reviewed: ${plans.length}\n- AI reports reviewed: ${reports.length}\n\nObserved patterns:\n- Top documented behaviors: ${topBehaviors}\n- Top antecedents: ${topAntecedents}\n- Suspected functions: ${topFunctions}\n- Incident severity mix: ${topIncidentSeverity}\n- Average documented behavior intensity: ${avgIntensity}\n- Most recent plan: ${recentPlan ? `${recentPlan.title || "Untitled plan"} (${safeDateText(recentPlan.effective_from)} to ${safeDateText(recentPlan.effective_to) || "no end date"})` : "No plan found"}\n\nRecent session evidence:\n- ${recentSessions || "No recent session response notes available."}\n\nData gaps to check:\n- ${(dataGaps.length ? dataGaps : ["No major data gaps detected from the available fields."]).join("\n- ")}\n\nSuggested BCBA review actions:\n- ${recommendations.join("\n- ")}\n\nPredictive-model framing:\n- Data collection: continue collecting structured sessions, ABC behavior data, incident data, interventions, and plan changes.\n- Feature selection: likely useful variables include behavior frequency, intensity, antecedent, suspected function, location, time, intervention used, session consistency, incident severity, and plan age.\n- Model training/validation/deployment: do not treat this MVP as a validated predictive model yet. Use these as transparent risk signals until enough historical data exists for validation.`;
}
function workbenchEvidence(ctx) {
  const ev = [];
  if (ctx.patient) ev.push(`Patient context: ${ctx.patient.first_name} ${ctx.patient.last_name}, diagnosis/program: ${ctx.patient.diagnosis || "not specified"}`);
  ev.push(`${(ctx.sessions || []).length} session logs in selected context`);
  ev.push(`${(ctx.behaviors || []).length} behavior events in selected context`);
  ev.push(`${(ctx.incidents || []).length} incidents in selected context`);
  ev.push(`${(ctx.plans || []).length} therapy plans in selected context`);
  return ev;
}
function buildAbaWorkbenchPrompt(ctx, question, mode) {
  return `You are the ABA-Skilled BCBA Agent inside TherapyAgent. You support BCBAs and therapy supervisors, but you do not diagnose, prescribe treatment, determine medical necessity, or replace clinical judgment. Use only the provided TherapyAgent context. Cite evidence from the context. Flag uncertainty and missing data.\n\nMode: ${mode}\nQuestion: ${question}\n\nTherapyAgent context JSON:\n${JSON.stringify(ctx, null, 2).slice(0, 22000)}\n\nRespond with: 1) concise summary, 2) evidence-linked observations, 3) suggested BCBA review actions, 4) data gaps, 5) predictive model/risk-signal considerations. Include a clinician-review disclaimer.`;
}

app.get("/api/ai/workbench/bootstrap", requireAuth, requireMfa, requireAiWorkbenchAccess, async (req, res) => {
  try {
    const patients = (await pool.query(`SELECT id, trim(first_name || ' ' || last_name) AS full_name, diagnosis, status FROM patients WHERE org_id=$1 AND COALESCE(status,'active')='active' ORDER BY last_name, first_name`, [req.user.org_id])).rows;
    const history = (await pool.query(`
      SELECT h.id, h.patient_id, h.mode, h.date_range_days, h.question, h.created_at,
             trim(p.first_name || ' ' || p.last_name) AS patient_name
      FROM ai_workbench_history h
      LEFT JOIN patients p ON p.id=h.patient_id AND p.org_id=h.org_id
      WHERE h.org_id=$1
      ORDER BY h.created_at DESC LIMIT 20`, [req.user.org_id])).rows;
    res.json({ patients, history });
  } catch (e) {
    console.error("[ai-workbench-bootstrap]", e.message);
    res.status(500).json({ error: "workbench_bootstrap_failed", message: "Could not load AI Workbench context." });
  }
});

app.post("/api/ai/workbench", requireAuth, requireMfa, requireAiWorkbenchAccess, async (req, res) => {
  const question = String(req.body?.question || "").trim();
  const patientId = String(req.body?.patient_id || "").trim() || null;
  const mode = String(req.body?.mode || "general").trim() || "general";
  const days = parseDays(req.body?.date_range_days, 90);
  if (question.length < 5) return res.status(400).json({ error: "question_required", message: "Ask a more specific question for the ABA-Skilled BCBA Agent." });
  try {
    const ctx = await loadWorkbenchContext(req.user.org_id, patientId, days);
    let answer;
    let llmMode = "local_no_phi";
    let message = "Response generated in local no-PHI mode. Set ALLOW_PHI_TO_LLM=true only after confirming your AI provider/BAA posture if you want LLM-generated patient-context answers.";
    if (ALLOW_PHI_TO_LLM) {
      try {
        answer = await callOpenAI(buildAbaWorkbenchPrompt(ctx, question, mode));
        llmMode = "llm";
        message = "Response generated with patient context. Clinician review is required.";
      } catch (e) {
        console.error("[ai-workbench-llm]", e.message);
        answer = buildLocalAbaWorkbenchAnswer(ctx, question, mode);
        message = `LLM call failed, so TherapyAgent used local no-PHI mode: ${e.message}`;
      }
    } else {
      answer = buildLocalAbaWorkbenchAnswer(ctx, question, mode);
    }
    const evidence = workbenchEvidence(ctx);
    await pool.query(`INSERT INTO ai_workbench_history (org_id, user_id, patient_id, mode, date_range_days, question, response_summary, context_snapshot, llm_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.user.org_id, req.user.id, patientId, mode, days, question, String(answer || "").slice(0, 4000), JSON.stringify({ evidence, counts: { sessions: ctx.sessions?.length || 0, behaviors: ctx.behaviors?.length || 0, incidents: ctx.incidents?.length || 0, plans: ctx.plans?.length || 0, reports: ctx.reports?.length || 0 } }), llmMode]);
    await audit(req, "ai_workbench_used", "ai_workbench", patientId, { mode, days, llmMode });
    res.json({ agent: "ABA-Skilled BCBA Agent", mode: llmMode, answer, evidence, message });
  } catch (e) {
    console.error("[ai-workbench]", e.message);
    res.status(e.status || 500).json({ error: "workbench_failed", message: e.message || "AI Workbench failed." });
  }
});

'''
marker = '''// Admin APIs'''
if 'app.get("/api/analytics/dashboard"' not in s:
    if marker not in s:
        raise SystemExit('Could not find // Admin APIs marker in server.js')
    s = s.replace(marker, server_add + marker, 1)
else:
    print('Skipping server routes; already applied.')
server.write_text(s)

print('\nAnalytics + AI Workbench update applied.')
print('Next: node --check server.js && node --check public/app.js && psql "$DATABASE_URL" -f db/schema.sql && pm2 restart therapyagent --update-env')
