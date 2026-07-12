let token = localStorage.getItem("ta_token") || "";
let currentUser = null;
let patients = [];
let organizationMatches = [];
let orgUsers = [];
let roleMatrix = null;
let attachmentSetup = null;
let activePatient = null;
let patientSummary = null;
let activeVoice = null;
let analyticsCache = null;
let globalSearchTimer = null;
let globalSearchModalQuery = "";
let bcbaChatState = null;


const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const roles = ["org_admin", "bcba", "supervisor", "therapist", "rbt", "billing_auditor", "read_only"];
const isWorkspacePage = document.body?.dataset?.page === "workspace";
const isPublicPage = document.body?.dataset?.page === "public";

const structuredIspFields = new Set([
  "target_behaviors",
  "abc_patterns",
  "suspected_functions",
  "replacement_skills",
  "goals",
  "interventions"
]);

const cleanIspTextFields = new Set([
  "safety_plan",
  "data_collection_plan",
  "caregiver_training_plan",
  "generalization_plan",
  "review_schedule",
  "bcba_review_notes"
]);

function fieldLabel(f) {
  return String(f.label || f.name || "")
    .replace(/\s+JSON$/i, "")
    .replace("Measurable goals and objectives", "Goals and objectives")
    .replace("Crisis / safety / incident response plan", "Crisis, safety, and incident response plan");
}

function tryJsonParse(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return "";
  try { return JSON.parse(text); } catch { return value; }
}

function parseJsonishLoose(value) {
  let v = value;
  for (let i = 0; i < 5; i++) {
    if (v == null) return "";
    if (typeof v !== "string") return v;
    let t = v.trim();
    if (!t) return "";

    const parsed = tryJsonParse(t);
    if (parsed !== t) {
      v = parsed;
      continue;
    }

    if (t.includes('\\"')) {
      let u = t.replace(/\\"/g, '"').replace(/^"|"$/g, "");
      // Handles odd object-wrapped strings like {"{\\"action\\":\\"...\\"}"}
      if (/^\{\s*"?\{/.test(u) || /^\{\s*"?\\?\{/.test(t)) {
        u = u.replace(/^\{\s*"?/, "").replace(/"?\s*\}$/, "");
      }
      const parsed2 = tryJsonParse(u);
      if (parsed2 !== u) {
        v = parsed2;
        continue;
      }
      v = u;
      continue;
    }

    // Handles {"action":"..."} that was saved as text with extra braces/quotes.
    if (/^\{.*\}$/.test(t) && t.includes(":")) {
      const inner = t.replace(/^\{\s*/, "").replace(/\s*\}$/, "");
      const parsed3 = tryJsonParse(`{${inner}}`);
      if (parsed3 !== `{${inner}}`) return parsed3;
    }

    return v;
  }
  return v;
}

function objectToReadableLine(item, fieldName = "") {
  if (item == null) return "";
  if (typeof item === "string") {
    const parsed = parseJsonishLoose(item);
    if (parsed !== item) return objectToReadableLine(parsed, fieldName);
    return item.replace(/^[-•]\s*/, "").trim();
  }
  if (typeof item !== "object") return String(item);

  if (fieldName === "target_behaviors") return item.behavior || item.target || item.text || item.description || Object.values(item).filter(Boolean).join(" - ");
  if (fieldName === "suspected_functions") return item.function || item.suspected_function || item.text || item.description || Object.values(item).filter(Boolean).join(" - ");
  if (fieldName === "replacement_skills") return item.skill || item.replacement_skill || item.text || item.description || Object.values(item).filter(Boolean).join(" - ");
  if (fieldName === "goals") return item.goal || item.objective || item.text || item.description || Object.values(item).filter(Boolean).join(" - ");
  if (fieldName === "interventions") return item.intervention || item.strategy || item.text || item.description || Object.values(item).filter(Boolean).join(" - ");

  if (fieldName === "abc_patterns") {
    const parts = [];
    if (item.behavior) parts.push(`Behavior: ${item.behavior}`);
    if (item.antecedent) parts.push(`Antecedent: ${item.antecedent}`);
    if (item.consequence) parts.push(`Consequence: ${item.consequence}`);
    if (item.pattern && !parts.length) parts.push(item.pattern);
    return parts.length ? parts.join("; ") : Object.values(item).filter(Boolean).join("; ");
  }

  if (item.action) return item.action;
  if (item.plan) return item.plan;
  if (item.text) return item.text;
  if (item.note) return item.note;
  if (item.description) return item.description;

  return Object.entries(item)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k.replaceAll("_", " ")}: ${typeof v === "object" ? objectToReadableLine(v, fieldName) : v}`)
    .join("; ");
}

function cleanStructuredText(value, fieldName = "") {
  const parsed = parseJsonishLoose(value);
  if (parsed == null || parsed === "") return "";
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const lines = arr.map(x => objectToReadableLine(x, fieldName)).filter(Boolean);
  if (!lines.length && typeof parsed === "string") return parsed;
  return lines.map(x => `- ${x}`).join("\n");
}

function cleanPlainText(value, fieldName = "") {
  const text = cleanStructuredText(value, fieldName);
  return text || String(value || "");
}

function structuredTextToJson(value, fieldName = "") {
  const text = String(value || "").trim();
  if (!text) return "[]";

  const parsed = parseJsonishLoose(text);
  if (parsed !== text && typeof parsed !== "string") {
    return JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]);
  }

  const keyMap = {
    target_behaviors: "behavior",
    suspected_functions: "function",
    replacement_skills: "skill",
    goals: "goal",
    interventions: "intervention"
  };

  const lines = text
    .split(/\n+/)
    .map(x => x.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean);

  const arr = lines.map(line => {
    if (fieldName === "abc_patterns") {
      const obj = {};
      for (const part of line.split(";")) {
        const [rawKey, ...rest] = part.split(":");
        const key = String(rawKey || "").trim().toLowerCase();
        const val = rest.join(":").trim();
        if (key.includes("antecedent")) obj.antecedent = val;
        else if (key.includes("behavior")) obj.behavior = val;
        else if (key.includes("consequence")) obj.consequence = val;
      }
      return Object.keys(obj).length ? obj : { pattern: line };
    }
    const key = keyMap[fieldName] || "text";
    return { [key]: line };
  });

  return JSON.stringify(arr);
}



const resourceDefs = {
  sessions: {
    title: "Session Logs",
    singular: "session",
    endpoint: "/api/sessions",
    listKey: "sessions",
    voiceField: "progress_notes",
    columns: ["patient", "status", "session_date", "location", "created_by_name", "created_at", "modified_by_name", "modified_at"],
    fields: [
      { name: "patient_id", label: "Patient", type: "patient", required: true },
      { name: "session_date", label: "Session date", type: "date" },
      { name: "start_time", label: "Start time", type: "time" },
      { name: "end_time", label: "End time", type: "time" },
      { name: "location", label: "Location" },
      { name: "service_code", label: "Service code" },
      { name: "participants", label: "Participants", type: "textarea" },
      { name: "activities", label: "Activities performed", type: "textarea" },
      { name: "interventions_used", label: "Interventions used", type: "textarea" },
      { name: "response_to_intervention", label: "Response to intervention", type: "textarea" },
      { name: "progress_notes", label: "Raw voice / progress notes", type: "textarea", wide: true },
      { name: "ai_summary", label: "AI summary / clinician notes", type: "textarea", wide: true }
    ]
  },
  behaviors: {
    title: "Behavior Events",
    singular: "behavior",
    endpoint: "/api/behaviors",
    listKey: "behaviors",
    voiceField: "notes",
    columns: ["patient", "status", "event_time", "behavior", "location", "created_by_name", "created_at", "modified_by_name", "modified_at"],
    fields: [
      { name: "patient_id", label: "Patient", type: "patient", required: true },
      { name: "event_time", label: "Event time", type: "datetime-local" },
      { name: "location", label: "Location" },
      { name: "intensity", label: "Intensity 1-5", type: "number", attrs: "min='1' max='5'" },
      { name: "duration_seconds", label: "Duration seconds", type: "number" },
      { name: "antecedent", label: "Antecedent", type: "textarea" },
      { name: "behavior", label: "Behavior observed", type: "textarea", required: true },
      { name: "consequence", label: "Consequence", type: "textarea" },
      { name: "suspected_function", label: "Suspected function" },
      { name: "deescalation", label: "De-escalation used", type: "textarea" },
      { name: "injury", label: "Injury occurred", type: "checkbox" },
      { name: "restraint", label: "Restraint used", type: "checkbox" },
      { name: "notes", label: "Raw voice / additional notes", type: "textarea", wide: true }
    ]
  },
  plans: {
    title: "Therapy Plans",
    singular: "plan",
    endpoint: "/api/plans",
    listKey: "plans",
    voiceField: "goals",
    columns: ["patient", "status", "title", "plan_type", "created_by_name", "created_at", "modified_by_name", "modified_at"],
    fields: [
      { name: "patient_id", label: "Patient", type: "patient", required: true },
      { name: "title", label: "Plan title", required: true },
      { name: "plan_type", label: "Plan type" },
      { name: "effective_from", label: "Effective from", type: "date" },
      { name: "effective_to", label: "Effective to", type: "date" },
      { name: "goals", label: "Goals", type: "textarea", wide: true },
      { name: "interventions", label: "Interventions", type: "textarea", wide: true },
      { name: "restrictions", label: "Restrictions / contraindications", type: "textarea", wide: true }
    ]
  },

  isps: {
    title: "Individual Service Plans",
    singular: "isp",
    endpoint: "/api/isps",
    listKey: "isps",
    voiceField: "background",
    columns: ["patient", "status", "title", "created_by_name", "created_at", "modified_by_name", "modified_at"],
    fields: [
      { name: "patient_id", label: "Patient", type: "patient", required: true },
      { name: "title", label: "ISP title", required: true },
      { name: "plan_purpose", label: "Reason for ISP / plan purpose", type: "textarea", wide: true },
      { name: "background", label: "Background and current status", type: "textarea", wide: true },
      { name: "strengths", label: "Strengths, preferences, motivators", type: "textarea", wide: true },
      { name: "behavioral_summary", label: "Behavioral summary", type: "textarea", wide: true },
      { name: "target_behaviors", label: "Target behaviors", type: "structured_text", wide: true },
      { name: "abc_patterns", label: "ABC patterns", type: "structured_text", wide: true },
      { name: "suspected_functions", label: "Suspected functions", type: "structured_text", wide: true },
      { name: "replacement_skills", label: "Replacement skills", type: "structured_text", wide: true },
      { name: "goals", label: "Goals and objectives", type: "structured_text", wide: true },
      { name: "interventions", label: "Interventions and teaching strategies", type: "structured_text", wide: true },
      { name: "safety_plan", label: "Crisis, safety, and incident response plan", type: "clean_text", wide: true },
      { name: "data_collection_plan", label: "Data collection plan", type: "clean_text", wide: true },
      { name: "caregiver_training_plan", label: "Caregiver / staff training plan", type: "clean_text", wide: true },
      { name: "generalization_plan", label: "Generalization and maintenance plan", type: "clean_text", wide: true },
      { name: "review_schedule", label: "Review schedule", type: "clean_text", wide: true },
      { name: "bcba_review_notes", label: "BCBA review notes / sign-off", type: "clean_text", wide: true }
    ]
  },
  incidents: {
    title: "Incidents",
    singular: "incident",
    endpoint: "/api/incidents",
    listKey: "incidents",
    voiceField: "description",
    columns: ["patient", "status", "incident_date", "category", "severity", "created_by_name", "created_at", "modified_by_name", "modified_at"],
    fields: [
      { name: "patient_id", label: "Patient", type: "patient", required: true },
      { name: "incident_date", label: "Incident date/time", type: "datetime-local" },
      { name: "category", label: "Category", required: true },
      { name: "severity", label: "Severity", type: "select", options: ["low", "medium", "high", "critical"] },
      { name: "location", label: "Location" },
      { name: "description", label: "Description", type: "textarea", required: true, wide: true },
      { name: "immediate_actions", label: "Immediate actions", type: "textarea", wide: true },
      { name: "notifications", label: "Notifications", type: "textarea", wide: true }
    ]
  },
  reports: {
    title: "AI Reports",
    singular: "report",
    endpoint: "/api/reports",
    listKey: "reports",
    voiceField: "prompt",
    columns: ["patient", "status", "report_type", "created_by_name", "created_at", "modified_by_name", "modified_at"],
    fields: [
      { name: "patient_id", label: "Patient", type: "patient", required: true },
      { name: "report_type", label: "Report type", type: "select", options: ["session_summary", "monthly_progress", "incident_summary", "caregiver_report"] },
      { name: "prompt", label: "Raw notes / report request", type: "textarea", wide: true },
      { name: "output", label: "Report draft", type: "textarea", required: true, wide: true }
    ]
  }
};

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function fmtDate(value) { if (!value) return ""; try { return new Date(value).toLocaleString(); } catch { return String(value); } }
function dateInput(value) { if (!value) return ""; return String(value).slice(0, 10); }
function dtInput(value) { if (!value) return ""; const d = new Date(value); if (Number.isNaN(+d)) return String(value).slice(0,16); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function patientName(row) { return row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : patients.find(p => p.id === row.patient_id)?.full_name || patients.find(p => p.id === row.patient_id)?.first_name || ""; }
function fullPatientName(p) { return `${p.first_name || ""} ${p.last_name || ""}`.trim(); }
function isAdmin() { return currentUser?.role === "org_admin"; }

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_RULES = [
  { key: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: p => String(p).length >= PASSWORD_MIN_LENGTH },
  { key: "upper", label: "One uppercase letter", test: p => /[A-Z]/.test(p) },
  { key: "lower", label: "One lowercase letter", test: p => /[a-z]/.test(p) },
  { key: "number", label: "One number", test: p => /[0-9]/.test(p) },
  { key: "special", label: "One special character", test: p => /[^A-Za-z0-9]/.test(p) }
];
function passwordRuleErrors(password = "") {
  return PASSWORD_RULES.filter(r => !r.test(password)).map(r => r.label.replace(/^One /, "one ").replace(/^At least/, "at least"));
}
function passwordRulesMessage() {
  return `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include uppercase, lowercase, number, and special character.`;
}
function validatePasswordFields(password, confirmPassword) {
  const errors = passwordRuleErrors(password);
  if (errors.length) return passwordRulesMessage();
  if (password !== confirmPassword) return "Passwords do not match.";
  return "";
}
// Renders a live pass/fail checklist under a password field as the user types,
// so weak passwords are caught before submit instead of only on server error.
function renderPasswordChecklist(password, listEl) {
  if (!listEl) return;
  listEl.innerHTML = PASSWORD_RULES.map(r => {
    const ok = r.test(password || "");
    return `<li class="${ok ? "ok" : "fail"}"><span class="pw-check-icon">${ok ? "✓" : "•"}</span>${escapeHtml(r.label)}</li>`;
  }).join("");
}
function attachLivePasswordChecklist(inputEl, listEl) {
  if (!inputEl || !listEl || inputEl.dataset.pwChecklistBound) return;
  inputEl.dataset.pwChecklistBound = "1";
  renderPasswordChecklist(inputEl.value, listEl);
  inputEl.addEventListener("input", () => renderPasswordChecklist(inputEl.value, listEl));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.detail || data.error || "Request failed.");
  return data;
}
function formBody(form) { return Object.fromEntries(new FormData(form).entries()); }
function setMessage(el, message, type = "info") {
  if (!el) return;
  el.textContent = message || "";
  el.className = `message ${message ? "show" : ""} ${type}`;
}
function setAuthMessage(message, type = "info") {
  const el = $("#authMessage");
  if (!el) return;
  el.textContent = message || "";
  el.className = `auth-message ${message ? "show" : ""} ${type}`;
}
function setAuthScreen(name) {
  $$(".auth-tab").forEach(b => b.classList.toggle("active", b.dataset.authScreen === name));
  $$(".auth-screen").forEach(s => s.classList.toggle("active", s.id === `auth-${name}`));
  setAuthMessage("");
}
function openAuth(screen = "login") { $("#authModal")?.classList.add("show"); $("#authModal")?.setAttribute("aria-hidden", "false"); setAuthScreen(screen); }
function closeAuth() { $("#authModal")?.classList.remove("show"); $("#authModal")?.setAttribute("aria-hidden", "true"); }

function setAuthenticatedUI() {
  document.body.classList.toggle("app-authenticated", !!currentUser);
  document.body.classList.toggle("app-anonymous", !currentUser);

  // Public site and logged-in workspace are intentionally separate pages.
  // The marketing page never tries to render workspace panels, and the workspace page
  // never contains marketing sections.
  $("#publicNav") && ($("#publicNav").hidden = false);
  $("#userNav") && ($("#userNav").hidden = !currentUser);
  $("#welcomeUser") && ($("#welcomeUser").textContent = currentUser ? `Welcome ${currentUser.full_name || currentUser.name || currentUser.email}` : "Welcome");
  $$(".public-section").forEach(s => s.hidden = false);
  $("#workspace") && ($("#workspace").hidden = !currentUser);

  renderMfaOptionalBanner();
  ensureGlobalPatientSearch();
  if (currentUser && isWorkspacePage) panel("dashboard");
}
function logout() {
  token = "";
  currentUser = null;
  localStorage.removeItem("ta_token");
  setAuthenticatedUI();
  if (isWorkspacePage) window.location.href = "/?login=1";
  else openAuth("login");
}

function renderMfaOptionalBanner() {
  const oldBanner = document.getElementById("mfaOptionalBanner");
  if (oldBanner) oldBanner.remove();

  const existing = document.getElementById("mfaSetupIcon");
  if (!isWorkspacePage || !currentUser || currentUser.mfa_enabled || currentUser.must_change_password) {
    if (existing) existing.remove();
    return;
  }

  const nav = document.getElementById("userNav");
  if (!nav) return;

  let btn = existing;
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "mfaSetupIcon";
    btn.type = "button";
    btn.className = "btn small secondary ta-icon-btn";
    btn.title = "Set up MFA";
    btn.innerHTML = "⚠ MFA";
    const logout = document.getElementById("logoutBtn");
    if (logout) nav.insertBefore(btn, logout);
    else nav.appendChild(btn);
  }
  btn.onclick = showMfaSetupModal;
}

function ensureProfessionalStyles() {
  if (document.getElementById("taProfessionalStyles")) return;
  const style = document.createElement("style");
  style.id = "taProfessionalStyles";
  style.textContent = `
    .ta-icon-btn { white-space: nowrap; }
    .ta-modal-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.52); z-index:9998; display:flex; align-items:flex-start; justify-content:center; overflow:auto; padding:48px 18px; }
    .ta-modal-card { width:min(1040px, 96vw); background:white; border-radius:22px; box-shadow:0 28px 80px rgba(15,23,42,.28); padding:0; overflow:hidden; }
    .ta-modal-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:22px 26px; border-bottom:1px solid rgba(15,23,42,.1); background:linear-gradient(135deg, rgba(37,99,235,.08), rgba(14,165,233,.08)); }
    .ta-modal-head h2 { margin:0; font-size:1.35rem; }
    .ta-modal-head p { margin:.35rem 0 0; color:#475569; }
    .ta-modal-close { border:0; background:transparent; font-size:28px; line-height:1; cursor:pointer; color:#334155; }
    .ta-modal-body { padding:24px 26px; }
    .ta-modal-actions { display:flex; flex-wrap:wrap; gap:10px; padding:18px 26px; border-top:1px solid rgba(15,23,42,.1); background:#f8fafc; }
    .ta-search-launcher { display:flex; gap:8px; align-items:center; min-width:300px; }
    .ta-search-launcher input { margin:0; height:36px; }
    .ta-search-results { display:grid; gap:16px; margin-top:16px; }
    .ta-search-card { border:1px solid rgba(15,23,42,.12); border-radius:16px; padding:16px; background:#fff; }
    .ta-search-card h3 { margin:0 0 4px; }
    .ta-count-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .ta-count-pill { border:1px solid rgba(15,23,42,.12); border-radius:999px; padding:4px 10px; font-size:.82rem; color:#334155; background:#f8fafc; }
    .ta-record-grid { display:grid; gap:12px; }
    .ta-record-section { border:1px solid rgba(15,23,42,.1); border-radius:14px; overflow:hidden; }
    .ta-record-section h4 { margin:0; padding:10px 12px; background:#f8fafc; border-bottom:1px solid rgba(15,23,42,.08); }
    .ta-summary-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:12px; }
    .ta-summary-item { border:1px solid rgba(15,23,42,.1); border-radius:12px; padding:12px; background:#fff; }
    .ta-summary-item strong { display:block; color:#0f172a; margin-bottom:5px; }
    .ta-summary-item span { white-space:pre-wrap; color:#334155; }

    .ta-chat-shell { display:grid; grid-template-columns:300px 1fr; gap:18px; min-height:620px; }
    .ta-chat-side { border:1px solid rgba(15,23,42,.1); border-radius:18px; background:#fff; padding:16px; align-self:start; }
    .ta-chat-side label { display:block; margin-bottom:12px; }
    .ta-chat-side select, .ta-chat-side input { width:100%; }
    .ta-chat-main { border:1px solid rgba(15,23,42,.1); border-radius:18px; background:#fff; display:flex; flex-direction:column; min-height:620px; overflow:hidden; }
    .ta-chat-transcript { flex:1; padding:20px; overflow:auto; background:linear-gradient(180deg,#f8fafc,#fff); }
    .ta-chat-empty { border:1px dashed rgba(37,99,235,.25); border-radius:18px; padding:22px; background:white; color:#334155; }
    .ta-chat-empty h3 { margin:0 0 8px; color:#0f172a; }
    .ta-chat-bubble { max-width:82%; margin:0 0 14px; border-radius:18px; padding:13px 15px; box-shadow:0 10px 24px rgba(15,23,42,.06); white-space:pre-wrap; line-height:1.45; }
    .ta-chat-bubble.user { margin-left:auto; background:#2563eb; color:#fff; border-bottom-right-radius:6px; }
    .ta-chat-bubble.assistant { margin-right:auto; background:#fff; color:#0f172a; border:1px solid rgba(15,23,42,.1); border-bottom-left-radius:6px; }
    .ta-chat-bubble.system { max-width:100%; margin-left:auto; margin-right:auto; background:#ecfeff; color:#155e75; border:1px solid rgba(6,182,212,.25); font-size:.92rem; }
    .ta-chat-meta { display:block; font-size:.76rem; opacity:.74; margin-bottom:6px; font-weight:700; }
    .ta-chat-compose { border-top:1px solid rgba(15,23,42,.1); background:#fff; padding:14px; display:grid; gap:10px; }
    .ta-chat-compose textarea { min-height:86px; resize:vertical; }
    .ta-chat-tools { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
    .ta-chat-suggestions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    .ta-chip-btn { border:1px solid rgba(37,99,235,.25); background:#eff6ff; color:#1d4ed8; border-radius:999px; padding:7px 10px; cursor:pointer; font-weight:700; font-size:.85rem; }
    .ta-chip-btn:hover { background:#dbeafe; }
    .ta-chat-sessions-card { padding:10px; }
    .ta-chat-sessions-card h3 { padding:6px 6px 4px; }
    .ta-chat-session-list { display:flex; flex-direction:column; gap:4px; max-height:280px; overflow:auto; }
    .ta-chat-session-item { display:flex; align-items:stretch; gap:4px; border-radius:12px; }
    .ta-chat-session-item.active { background:#eff6ff; }
    .ta-chat-session-open { flex:1; min-width:0; text-align:left; border:0; background:transparent; cursor:pointer; padding:8px 10px; border-radius:12px; display:flex; flex-direction:column; gap:2px; }
    .ta-chat-session-open:hover { background:#f1f5f9; }
    .ta-chat-session-title { font-weight:700; font-size:.87rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ta-chat-session-meta { font-size:.74rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ta-chat-session-delete { border:0; background:transparent; color:#94a3b8; font-size:18px; line-height:1; cursor:pointer; padding:0 8px; border-radius:8px; }
    .ta-chat-session-delete:hover { background:#fff1f2; color:#be123c; }
    .ta-chat-session-empty { color:#94a3b8; font-size:.85rem; padding:6px; }
    @media (max-width: 980px) { .ta-chat-shell { grid-template-columns:1fr; } .ta-chat-bubble { max-width:96%; } }

    @media (max-width: 820px) {
      .ta-search-launcher { min-width:100%; width:100%; }
      #userNav { flex-wrap:wrap; }
    }
  `;
  document.head.appendChild(style);
}

function closeProfessionalModal(id = "taProfessionalModal") {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function openProfessionalModal({ id = "taProfessionalModal", title = "", subtitle = "", body = "", actions = "" } = {}) {
  ensureProfessionalStyles();
  closeProfessionalModal(id);
  const wrap = document.createElement("div");
  wrap.id = id;
  wrap.className = "ta-modal-backdrop";
  wrap.innerHTML = `
    <section class="ta-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="ta-modal-head">
        <div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div>
        <button class="ta-modal-close" type="button" aria-label="Close">×</button>
      </header>
      <div class="ta-modal-body">${body}</div>
      ${actions ? `<footer class="ta-modal-actions">${actions}</footer>` : ""}
    </section>`;
  document.body.appendChild(wrap);
  wrap.querySelector(".ta-modal-close").onclick = () => closeProfessionalModal(id);
  wrap.addEventListener("click", e => {
    if (e.target === wrap) closeProfessionalModal(id);
  });
  return wrap;
}

function showMfaSetupModal() {
  const setupKey = currentUser?.mfaSetup?.secret || "";
  const qrDataUrl = currentUser?.mfaSetup?.qrDataUrl || "";
  const body = `
    <div class="notice">
      <strong>MFA is optional but recommended.</strong>
      <p>Open Google Authenticator, Microsoft Authenticator, or Authy. Choose <b>Add account</b>, then <b>Scan a QR code</b>.</p>
    </div>
    <div class="form-card" style="margin-top:16px">
      ${qrDataUrl
        ? `<div class="mfa-qr-wrap"><img class="mfa-qr-img" src="${qrDataUrl}" alt="Scan this QR code with your authenticator app" width="200" height="200"></div>`
        : `<div class="notice">QR code is not available right now. Use the setup key below instead, or ask your admin to reset MFA.</div>`}
      <details class="mfa-manual-key">
        <summary>Can't scan? Enter the setup key manually</summary>
        <label>Setup key
          <input readonly value="${escapeHtml(setupKey || "Setup key is not available. Ask your admin to reset MFA.")}">
        </label>
      </details>
      <label>6-digit MFA code
        <input id="mfaModalTotp" inputmode="numeric" placeholder="123456">
      </label>
      <div id="mfaModalMsg" class="message"></div>
    </div>`;
  const modal = openProfessionalModal({
    id: "mfaSetupModal",
    title: "Set up multi-factor authentication",
    subtitle: "Protect your TherapyAgent account with an authenticator app.",
    body,
    actions: `<button class="btn" id="enableMfaFromModal" type="button">Enable MFA</button><button class="btn secondary" type="button" id="closeMfaModal">Close</button>`
  });
  modal.querySelector("#closeMfaModal").onclick = () => closeProfessionalModal("mfaSetupModal");
  modal.querySelector("#enableMfaFromModal").onclick = async () => {
    const msg = modal.querySelector("#mfaModalMsg");
    const totp = modal.querySelector("#mfaModalTotp")?.value || "";
    if (!totp.trim()) return setMessage(msg, "Enter the 6-digit code from your authenticator app.", "error");
    try {
      setMessage(msg, "Verifying MFA code...", "info");
      const out = await api("/api/mfa/enable", { method: "POST", body: JSON.stringify({ totp }) });
      token = out.token;
      localStorage.setItem("ta_token", token);
      currentUser = { ...(out.user || {}), mfaSetup: null };
      setMessage(msg, out.message || "MFA enabled.", "success");
      setTimeout(() => {
        closeProfessionalModal("mfaSetupModal");
        setAuthenticatedUI();
      }, 800);
    } catch (e) {
      setMessage(msg, e.message, "error");
    }
  };
}

function isExportableResource(resource) {
  return resource === "isps" || resource === "reports";
}

function exportTitle(resource, item = {}) {
  if (resource === "isps") return item.title || "Individual Service Plan";
  if (resource === "reports") return `${item.report_type || "AI Report"} ${item.created_at ? dateInput(item.created_at) : ""}`.trim();
  return item.title || "TherapyAgent Export";
}

function resourceFieldRows(resource, item = {}) {
  const def = resourceDefs[resource];
  if (!def) return [];
  return def.fields
    .filter(f => f.name !== "patient_id")
    .map(f => {
      let value = item[f.name];
      if (structuredIspFields.has(f.name) || f.type === "structured_text") value = cleanStructuredText(value, f.name);
      else if (cleanIspTextFields.has(f.name) || f.type === "clean_text") value = cleanPlainText(value, f.name);
      else if (f.type === "checkbox") value = value ? "Yes" : "No";
      else value = formatJsonish(value);
      return [fieldLabel(f), value || ""];
    })
    .filter(([, value]) => String(value || "").trim());
}

function patientDisplayForItem(item = {}) {
  return patientName(item) || patients.find(p => p.id === item.patient_id)?.full_name || "";
}

function exportHtml(resource, item = {}) {
  const title = exportTitle(resource, item);
  const appLink = window.location.origin || "https://therapyagent.athenabot.ai";
  const rows = resourceFieldRows(resource, item);
  const patient = patientDisplayForItem(item);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.45;margin:40px}
      .brand{border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:24px}
      .brand h1{margin:0;font-size:26px}
      .brand p{margin:5px 0;color:#475569}
      h2{font-size:20px;margin:24px 0 12px;color:#0f172a}
      .meta{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:20px}
      .section{break-inside:avoid;margin:14px 0;padding:14px;border:1px solid #e2e8f0;border-radius:12px}
      .section h3{margin:0 0 8px;font-size:15px;color:#1e293b}
      .section div{white-space:pre-wrap}
      .footer{margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}
      a{color:#2563eb}
    </style></head><body>
    <div class="brand">
      <h1>TherapyAgent</h1>
      <p>Secure clinical documentation workspace</p>
      <p><a href="${escapeHtml(appLink)}">${escapeHtml(appLink)}</a></p>
    </div>
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">
      <strong>Patient:</strong> ${escapeHtml(patient || "Not specified")}<br>
      <strong>Status:</strong> ${escapeHtml(item.status || "Draft")}<br>
      <strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}<br>
      <strong>Generated from:</strong> <a href="${escapeHtml(appLink)}">${escapeHtml(appLink)}</a>
    </div>
    ${rows.map(([label, value]) => `<section class="section"><h3>${escapeHtml(label)}</h3><div>${escapeHtml(value)}</div></section>`).join("")}
    <div class="footer">Draft/export generated by TherapyAgent. Outputs require clinician review. TherapyAgent does not diagnose, prescribe treatment, or replace BCBA judgment.</div>
  </body></html>`;
}

// Prints via a hidden same-page iframe instead of window.open(). Opening a
// blank popup window and document.write()-ing into it (the old approach) is
// flagged as a suspicious popup by Safari and some Chrome popup-blocker
// configurations, even when triggered synchronously from a click — which is
// exactly the "popup blocked" error users were hitting. An iframe never
// creates a new window/tab at all, so there is nothing for a popup blocker
// to block, and no browser permission is required.
function exportPdf(resource, item) {
  const html = exportHtml(resource, item);
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
  // Safety net in case print()/afterprint never fires (some browsers).
  const cleanupTimer = setTimeout(cleanup, 60000);

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      const finish = () => { clearTimeout(cleanupTimer); cleanup(); };
      win.addEventListener("afterprint", finish, { once: true });
      win.focus();
      win.print();
      // Fallback cleanup shortly after print() returns, in case the browser
      // never fires afterprint for iframe-hosted documents.
      setTimeout(finish, 2000);
    } catch (e) {
      clearTimeout(cleanupTimer);
      cleanup();
      alert(`Could not open the print dialog for PDF export: ${e.message}`);
    }
  };
  iframe.srcdoc = html;
}

function xmlEscape(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wordParagraph(text = "", style = "") {
  const lines = String(text || "").split(/\n/);
  return lines.map(line => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join("");
}

function crc32(bytes) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  }));
  let c = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ table[(c ^ bytes[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
function utf8Bytes(str) { return new TextEncoder().encode(str); }

function zipStored(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8Bytes(f.name);
    const data = utf8Bytes(f.content);
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)
    ]);
    chunks.push(local, name, data);
    const cen = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
    ]);
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);
  return new Blob([...chunks, ...central, end], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function exportDocx(resource, item) {
  const title = exportTitle(resource, item);
  const appLink = window.location.origin || "https://therapyagent.athenabot.ai";
  const rows = resourceFieldRows(resource, item);
  const bodyXml = [
    wordParagraph("TherapyAgent", "Title"),
    wordParagraph("Secure clinical documentation workspace"),
    wordParagraph(appLink),
    wordParagraph(title, "Heading1"),
    wordParagraph(`Patient: ${patientDisplayForItem(item) || "Not specified"}`),
    wordParagraph(`Status: ${item.status || "Draft"}`),
    wordParagraph(`Generated: ${new Date().toLocaleString()}`),
    ...rows.flatMap(([label, value]) => [wordParagraph(label, "Heading2"), wordParagraph(value)]),
    wordParagraph("Draft/export generated by TherapyAgent. Outputs require clinician review. TherapyAgent does not diagnose, prescribe treatment, or replace BCBA judgment.")
  ].join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
    </w:document>`;
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", content: documentXml }
  ];
  const blob = zipStored(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeDownloadName(title)}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeDownloadName(name = "therapyagent-export") {
  return String(name || "therapyagent-export").replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "therapyagent-export";
}

async function openResourceDetailModal(resource, id) {
  const def = resourceDefs[resource];
  if (!def) return alert("Unknown resource.");
  try {
    const out = await api(`${def.endpoint}/${id}`);
    const item = out[def.singular] || {};
    item.__history = out.history || [];
    const title = `${def.title.replace(/s$/, "")}: ${globalResourceTitle(resource, item)}`;
    const rows = resourceFieldRows(resource, item);
    const body = `
      <div class="ta-summary-grid">
        <div class="ta-summary-item"><strong>Patient</strong><span>${escapeHtml(patientDisplayForItem(item) || "Not specified")}</span></div>
        <div class="ta-summary-item"><strong>Status</strong><span>${statusBadge(item.status || "Draft")}</span></div>
        <div class="ta-summary-item"><strong>Date</strong><span>${escapeHtml(dateInput(globalResourceDate(item)) || fmtDate(globalResourceDate(item)))}</span></div>
        <div class="ta-summary-item"><strong>Created By</strong><span>${escapeHtml(item.created_by_name || item.user_name || "")}</span></div>
      </div>
      <div class="ta-record-grid" style="margin-top:16px">
        ${rows.map(([label, value]) => `<section class="ta-record-section"><h4>${escapeHtml(label)}</h4><div style="padding:12px;white-space:pre-wrap">${escapeHtml(value)}</div></section>`).join("") || `<div class="empty">No details available.</div>`}
      </div>`;
    const exportActions = isExportableResource(resource)
      ? `<button class="btn secondary" type="button" id="modalExportDocx">Export DOCX</button><button class="btn secondary" type="button" id="modalExportPdf">Export PDF</button>`
      : "";
    const modal = openProfessionalModal({
      id: "resourcePreviewModal",
      title,
      subtitle: "Preview record without leaving your current workspace context.",
      body,
      actions: `${exportActions}<button class="btn" type="button" id="modalOpenFullRecord">Open full record</button><button class="btn secondary" type="button" id="modalCloseRecord">Close</button>`
    });
    modal.querySelector("#modalCloseRecord").onclick = () => closeProfessionalModal("resourcePreviewModal");
    modal.querySelector("#modalOpenFullRecord").onclick = () => {
      closeProfessionalModal("resourcePreviewModal");
      panel(resource);
      setTimeout(() => openResourceDetail(resource, id), 150);
    };
    modal.querySelector("#modalExportDocx")?.addEventListener("click", () => exportDocx(resource, item));
    modal.querySelector("#modalExportPdf")?.addEventListener("click", () => exportPdf(resource, item));
  } catch (e) {
    alert(e.message);
  }
}



async function loadAttachmentSetup() {
  if (!token || currentUser?.must_change_password || !isWorkspacePage) return null;
  try {
    const out = await api(isAdmin() ? "/api/admin/attachment-setup" : "/api/attachment-setup");
    attachmentSetup = out.setup || null;
  } catch (e) {
    attachmentSetup = null;
    console.warn(e.message);
  }
  return attachmentSetup;
}

function renderAttachmentSetup() {
  const status = $("#attachmentSetupStatus");
  const toggle = $("#attachmentsEnabledToggle");
  const msg = $("#attachmentSetupMsg");
  if (!status || !toggle) return;
  const setup = attachmentSetup || {};
  toggle.checked = Boolean(setup.attachments_enabled);
  const configured = setup.env_configured;
  const cls = setup.attachments_enabled ? "s3-ok" : configured ? "s3-off" : "s3-error";
  status.className = `notice ${cls}`;
  status.innerHTML = setup.attachments_enabled
    ? `<strong>Attachments enabled.</strong><br>S3 bucket: <code class="inline-code">${escapeHtml(setup.s3_bucket || setup.env_bucket || "")}</code><br>Region: <code class="inline-code">${escapeHtml(setup.s3_region || setup.env_region || "")}</code><br>Org prefix: <code class="inline-code">${escapeHtml(setup.s3_prefix || "")}/</code><br>Setup: ${setup.s3_setup_at ? fmtDate(setup.s3_setup_at) : ""} ${setup.s3_setup_by_name ? `by ${escapeHtml(setup.s3_setup_by_name)}` : ""}`
    : configured
      ? `<strong>Attachments disabled.</strong><br>Toggle Attach File to Yes and Save. The app will initialize this org's prefix inside <code class="inline-code">${escapeHtml(setup.env_bucket || "S3_BUCKET")}</code>.`
      : `<strong>S3 is not configured.</strong><br>Set <code class="inline-code">S3_BUCKET</code>, <code class="inline-code">S3_REGION</code>, <code class="inline-code">AWS_ACCESS_KEY_ID</code>, and <code class="inline-code">AWS_SECRET_ACCESS_KEY</code> in .env, then restart the app.`;
  setMessage(msg, "");
}

async function saveAttachmentSetup() {
  const msg = $("#attachmentSetupMsg");
  const enabled = Boolean($("#attachmentsEnabledToggle")?.checked);
  try {
    setMessage(msg, enabled ? "Initializing S3 prefix for this organization..." : "Disabling attachments...", "info");
    const out = await api("/api/admin/attachment-setup", { method: "POST", body: JSON.stringify({ enabled }) });
    attachmentSetup = out.setup || null;
    renderAttachmentSetup();
    setMessage(msg, out.message || "Attachment setup saved.", "success");
  } catch (e) {
    setMessage(msg, e.message, "error");
  }
}

function attachmentSectionHtml(resource, item = {}) {
  const id = item.id || "";
  const setup = attachmentSetup || {};
  const enabled = Boolean(setup.attachments_enabled);
  if (!id) {
    return `<section class="attachment-box"><h4>Attachments</h4><p class="muted">Save this record before attaching files.</p></section>`;
  }
  if (!enabled) {
    return `<section class="attachment-box"><h4>Attachments</h4><p class="muted">Attachments are disabled for this organization. Org Admin can enable this under Admin & Roles → Attachment Setup.</p></section>`;
  }
  const reportButton = resource === "reports"
    ? `<div class="report-s3-row"><button class="btn small secondary" type="button" data-save-report-s3="${id}">Save report file to S3</button><span class="muted">Creates a text file copy of this report in the org S3 location.</span></div>`
    : "";
  return `<section class="attachment-box" data-attachment-box="${resource}" data-entity-id="${id}">
    <h4>Attachments</h4>
    <div class="attachment-actions">
      <label>Attach File<input type="file" data-attach-file="${resource}" data-entity-id="${id}"></label>
      <button class="btn small" type="button" data-upload-attachment="${resource}" data-entity-id="${id}">Upload to S3</button>
      <span class="attachment-pill">${escapeHtml(setup.s3_prefix || "org S3 prefix")}</span>
    </div>
    ${reportButton}
    <div class="message" id="${resource}AttachmentMsg"></div>
    <div class="attachment-list" id="${resource}AttachmentList">Loading attachments...</div>
  </section>`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

async function uploadAttachment(resource, entityId, root = document) {
  const msg = $(`#${resource}AttachmentMsg`, root) || $(`#${resource}AttachmentMsg`);
  const input = root.querySelector(`[data-attach-file="${resource}"][data-entity-id="${entityId}"]`);
  const file = input?.files?.[0];
  if (!file) return setMessage(msg, "Choose a file first.", "error");
  try {
    setMessage(msg, `Uploading ${file.name}...`, "info");
    const content_base64 = await fileToBase64(file);
    const out = await api("/api/attachments/upload", {
      method: "POST",
      body: JSON.stringify({
        resource,
        entity_id: entityId,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        content_base64
      })
    });
    setMessage(msg, out.message || "File uploaded.", "success");
    input.value = "";
    await loadAttachments(resource, entityId);
  } catch (e) {
    setMessage(msg, e.message, "error");
  }
}

async function loadAttachments(resource, entityId) {
  const mount = $(`#${resource}AttachmentList`);
  if (!mount) return;
  try {
    const out = await api(`/api/attachments/${resource}/${entityId}`);
    const files = out.files || [];
    mount.innerHTML = tableHtml(["File", "Type", "Size", "Uploaded By", "Date", "Action"], files.map(f => [
      `<span class="file-name-cell">${escapeHtml(f.original_filename)}</span>`,
      escapeHtml(f.mime_type || ""),
      escapeHtml(formatBytes(f.size_bytes || 0)),
      escapeHtml(f.uploaded_by_name || ""),
      fmtDate(f.created_at),
      `<button class="link-btn" type="button" data-download-attachment="${f.id}" data-filename="${escapeHtml(f.original_filename || "attachment")}">Download</button>`
    ]));
    $$("[data-download-attachment]", mount).forEach(b => {
      b.onclick = async () => {
        try {
          await downloadAttachment(b.dataset.downloadAttachment, b.dataset.filename || "attachment");
        } catch (e) {
          alert(e.message);
        }
      };
    });
  } catch (e) {
    mount.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
  }
}

async function downloadAttachment(id, filename = "attachment") {
  if (!token) throw new Error("Please log in again.");

  const res = await fetch(`/api/attachment-download/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    let message = "Download failed.";
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {}
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const cd = res.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/i);
  const downloadName = match?.[1] || filename || "attachment";

  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function saveReportFileToS3(id) {
  const msg = $("#reportsAttachmentMsg");
  try {
    setMessage(msg, "Saving report file to S3...", "info");
    const out = await api(`/api/reports/${id}/save-to-s3`, { method: "POST", body: JSON.stringify({}) });
    setMessage(msg, out.message || "Report saved to S3.", "success");
    await loadAttachments("reports", id);
  } catch (e) {
    setMessage(msg, e.message, "error");
  }
}

function showPasswordChangeRequiredModal() {
  if (!currentUser?.must_change_password) return;
  let wrap = document.getElementById("changePasswordRequiredModal");
  if (wrap) return;
  wrap = document.createElement("div");
  wrap.id = "changePasswordRequiredModal";
  wrap.className = "modal show";
  wrap.setAttribute("aria-hidden", "false");
  wrap.innerHTML = `
    <div class="modal-card" style="max-width:620px;padding:30px">
      <h2>Change temporary password</h2>
      <p class="notice">Your administrator created this account with a temporary password. You must choose a new password before accessing the workspace.</p>
      <form id="firstLoginPasswordForm" class="auth-form">
        <label>Current temporary password
          <input name="currentPassword" type="password" required autocomplete="current-password">
        </label>
        <label>New password
          <input id="firstLoginNewPassword" name="newPassword" type="password" required minlength="12" autocomplete="new-password">
        </label>
        <ul id="firstLoginPasswordChecklist" class="password-checklist"></ul>
        <label>Confirm new password
          <input name="confirmPassword" type="password" required minlength="12" autocomplete="new-password">
        </label>
        <div class="form-actions">
          <button class="btn">Change password</button>
          <button class="btn secondary" type="button" id="firstLoginLogout">Logoff</button>
        </div>
        <div class="message" id="firstLoginPasswordMsg"></div>
      </form>
    </div>
  `;
  document.body.appendChild(wrap);
  attachLivePasswordChecklist(wrap.querySelector("#firstLoginNewPassword"), wrap.querySelector("#firstLoginPasswordChecklist"));
  wrap.querySelector("#firstLoginLogout").onclick = logout;
  wrap.querySelector("#firstLoginPasswordForm").onsubmit = async e => {
    e.preventDefault();
    const msg = wrap.querySelector("#firstLoginPasswordMsg");
    const currentPassword = e.target.currentPassword.value;
    const newPassword = e.target.newPassword.value;
    const confirmPassword = e.target.confirmPassword.value;
    const validation = validatePasswordFields(newPassword, confirmPassword);
    if (validation) return setMessage(msg, validation, "error");
    try {
      const out = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      token = out.token;
      localStorage.setItem("ta_token", token);
      currentUser = { ...(out.user || {}), mfaSetup: currentUser?.mfaSetup || null };
      setMessage(msg, out.message || "Password changed successfully.", "success");
      setTimeout(async () => {
        wrap.remove();
        setAuthenticatedUI();
        await loadPatients();
        await refreshDashboard();
      }, 700);
    } catch (err) {
      setMessage(msg, err.message, "error");
    }
  };
}

function panel(id) {
  if (!currentUser) {
    if (isWorkspacePage) window.location.replace("/?login=1");
    else openAuth("login");
    return;
  }
  if (currentUser?.must_change_password && id !== "dashboard") return showPasswordChangeRequiredModal();
  $$(".sidebar button").forEach(b => b.classList.toggle("active", b.dataset.panel === id));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === id));
  if (id === "patients") loadPatients();
  if (id === "analytics") loadAnalytics();
  if (id === "bcbaChat") loadBcbaChat();
  if (id === "inbox") loadInbox();
  if (resourceDefs[id]) loadResourceList(id);
  if (id === "admin") loadAdmin();
}

async function initAuth() {
  if (!token) {
    setAuthenticatedUI();
    if (isWorkspacePage) window.location.replace("/?login=1");
    return;
  }
  try {
    const out = await api("/api/me");
    currentUser = { ...(out.user || {}), mfaSetup: out.mfaSetup || null };

    if (!isWorkspacePage) {
      window.location.replace("/workspace.html");
      return;
    }

    await loadAttachmentSetup();
    setAuthenticatedUI();
    if (currentUser.must_change_password) {
      showPasswordChangeRequiredModal();
      return;
    }
    await loadPatients();
    await refreshDashboard();
  } catch (e) {
    token = "";
    currentUser = null;
    localStorage.removeItem("ta_token");
    setAuthenticatedUI();
    if (isWorkspacePage) window.location.replace("/?login=1");
  }
}

async function loadPatients() {
  if (!token || currentUser?.must_change_password) return;
  try {
    const out = await api("/api/patients");
    patients = (out.patients || []).map(p => ({ ...p, full_name: fullPatientName(p) }));
    renderPatientSelects();
    renderPatients();
    await refreshDashboard();
  } catch (e) { console.warn(e.message); }
}
function renderPatientSelects() {
  const opts = `<option value="">Select patient</option>` + patients.map(p => `<option value="${p.id}">${escapeHtml(fullPatientName(p))}</option>`).join("");
  $$("select.patientSelect").forEach(s => { const v = s.value; s.innerHTML = opts; s.value = v; });
}
function renderPatients() {
  const mount = $("#patientList");
  if (!mount) return;
  mount.innerHTML = tableHtml([
    "Name", "DOB", "MRN", "Diagnosis", "Guardian", "Created", "Modified", "Action"
  ], patients.map(p => [
    escapeHtml(fullPatientName(p)), escapeHtml(dateInput(p.date_of_birth)), escapeHtml(p.external_id || ""), escapeHtml(p.diagnosis || ""), escapeHtml(p.guardian_name || ""), fmtDate(p.created_at), p.modified_at ? fmtDate(p.modified_at) : "", `<button class="link-btn" data-open-patient="${p.id}">Open</button>`
  ]));
  $$("[data-open-patient]", mount).forEach(b => b.onclick = () => openPatientDetail(b.dataset.openPatient));
  $$("tbody tr", mount).forEach((tr, i) => tr.ondblclick = () => openPatientDetail(patients[i].id));
}

async function openPatientDetail(id) {
  const p = patients.find(x => x.id === id);
  if (!p) return;
  activePatient = p;
  $("#patientDetail").hidden = false;
  $("#patientDetailTitle").textContent = fullPatientName(p);
  patientSummary = await api(`/api/patients/${id}/summary`);
  renderPatientTab("sessions");
  $("#patientDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderPatientTab(resource) {
  $$("#patientTabs button").forEach(b => b.classList.toggle("active", b.dataset.patientTab === resource));
  const rows = patientSummary?.[resource] || [];
  const def = resourceDefs[resource];
  const html = `<div class="subhead"><h3>${def.title}</h3><button class="btn small" data-new-for-patient="${resource}">New ${def.singular}</button></div>` + resourceTable(resource, rows, true);
  $("#patientTabContent").innerHTML = html;
  $("[data-new-for-patient]")?.addEventListener("click", () => { panel(resource); renderResourceDetail(resource, { patient_id: activePatient.id, status: "draft" }, true); });
  $$(`[data-open-resource]`, $("#patientTabContent")).forEach(b => b.onclick = () => openResourceDetailModal(b.dataset.resource, b.dataset.id));
}

function tableHtml(headers, rows) {
  return `<table class="data-table"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${headers.length}" class="empty">No records yet.</td></tr>`}</tbody></table>`;
}
function resourceTable(resource, rows, compact = false) {
  const def = resourceDefs[resource];
  const headers = ["Patient", "Status", "Date", "Title / Details", "Created By", "Created Date", "Modified By", "Modified Date", "Action"];
  const cells = rows.map(r => {
    const date = r.session_date || r.event_time || r.incident_date || r.created_at;
    const title = r.title || r.behavior || r.category || r.report_type || r.location || "Record";
    return [
      escapeHtml(patientName(r)), statusBadge(r.status), escapeHtml(dateInput(date) || fmtDate(date)), escapeHtml(title) + similarityBadgeHtml(resource, r), escapeHtml(r.created_by_name || r.user_name || ""), fmtDate(r.created_at), escapeHtml(r.modified_by_name || ""), r.modified_at ? fmtDate(r.modified_at) : "", `<button class="link-btn" data-open-resource="${resource}" data-resource="${resource}" data-id="${r.id}">Open</button>${isAdmin() && !compact ? ` <button class="link-btn danger" data-delete-resource="${resource}" data-id="${r.id}">Delete</button>` : ""}`
    ];
  });
  return tableHtml(headers, cells);
}
function similarityWarningHtml(resource, item = {}) {
  if (resource !== "reports" || !item.similarity_flagged) return "";
  const pct = Math.round((Number(item.similarity_score) || 0) * 100);
  return `<div class="notice warning similarity-warning">
    <strong>Possible copy-paste note (${pct}% text overlap)</strong>
    <p>This note is textually very similar to a prior note you wrote. Review for documentation-fraud/audit risk before submitting.
      ${item.similarity_matched_report_id ? `<button class="link-btn" type="button" data-open-resource="reports" data-resource="reports" data-id="${item.similarity_matched_report_id}">View the prior note</button>` : ""}
    </p>
  </div>`;
}

function similarityBadgeHtml(resource, r = {}) {
  if (resource !== "reports" || !r.similarity_flagged) return "";
  const pct = Math.round((Number(r.similarity_score) || 0) * 100);
  return ` <span class="risk-badge medium" title="Textually similar to a prior note by this author">⚠ ${pct}% similar</span>`;
}
function statusBadge(status = "draft") { return `<span class="status ${String(status).toLowerCase().replaceAll(" ", "-")}">${escapeHtml(status || "Draft")}</span>`; }

async function loadResourceList(resource) {
  const def = resourceDefs[resource];
  const mount = $(`#${resource} .resourceMount`);
  if (!mount) return;
  mount.innerHTML = `<div class="panel-head"><div><p class="eyebrow">Saved forms</p><h2>${def.title}</h2></div><button class="btn small" data-new-resource="${resource}">New ${def.singular}</button></div><div class="message" id="${resource}Msg"></div><div id="${resource}List" class="table-wrap">Loading...</div><div id="${resource}Detail"></div>`;
  mount.querySelector("[data-new-resource]").onclick = () => renderResourceDetail(resource, { status: "draft" }, true);
  try {
    const out = await api(def.endpoint);
    const rows = out[def.listKey] || [];
    mount.querySelector(`#${resource}List`).innerHTML = resourceTable(resource, rows);
    $$(`[data-open-resource]`, mount).forEach(b => b.onclick = () => openResourceDetailModal(b.dataset.resource, b.dataset.id));
    $$(`[data-delete-resource]`, mount).forEach(b => b.onclick = () => deleteResource(b.dataset.deleteResource, b.dataset.id));
    $$(`tbody tr`, mount.querySelector(`#${resource}List`)).forEach((tr, i) => tr.ondblclick = () => rows[i] && openResourceDetailModal(resource, rows[i].id));
  } catch (e) { mount.querySelector(`#${resource}List`).innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
}
async function openResourceDetail(resource, id) {
  const def = resourceDefs[resource];
  try {
    const out = await api(`${def.endpoint}/${id}`);
    const item = out[def.singular];
    item.__history = out.history || [];
    renderResourceDetail(resource, item, false);
  } catch (e) { alert(e.message); }
}
function fieldHtml(f, item, disabled) {
  const val = item?.[f.name] ?? "";
  const attr = `${f.required ? "required" : ""} ${disabled ? "disabled" : ""} ${f.attrs || ""}`;
  const cls = f.wide ? "span-2" : "";
  const label = fieldLabel(f);

  if (structuredIspFields.has(f.name) || f.type === "structured_text") {
    return `<label class="${cls}">${escapeHtml(label)}<textarea name="${f.name}" ${attr}>${escapeHtml(cleanStructuredText(val, f.name))}</textarea><small>Use plain text or bullets. TherapyAgent stores this as structured plan data.</small></label>`;
  }

  if (cleanIspTextFields.has(f.name) || f.type === "clean_text") {
    return `<label class="${cls}">${escapeHtml(label)}<textarea name="${f.name}" ${attr}>${escapeHtml(cleanPlainText(val, f.name))}</textarea></label>`;
  }

  if (f.type === "patient") {
    return `<label class="${cls}">${escapeHtml(label)}<select name="${f.name}" class="patientSelect" ${attr}>${patientOptions(val)}</select></label>`;
  }
  if (f.type === "textarea") return `<label class="${cls}">${escapeHtml(label)}<textarea name="${f.name}" ${attr}>${escapeHtml(formatJsonish(val))}</textarea></label>`;
  if (f.type === "select") return `<label class="${cls}">${escapeHtml(label)}<select name="${f.name}" ${attr}>${(f.options || []).map(o => `<option value="${escapeHtml(o)}" ${String(val || "").toLowerCase() === o.toLowerCase() ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select></label>`;
  if (f.type === "checkbox") return `<label class="check ${cls}"><input type="checkbox" name="${f.name}" ${val ? "checked" : ""} ${disabled ? "disabled" : ""}> ${escapeHtml(label)}</label>`;
  const v = f.type === "date" ? dateInput(val) : f.type === "datetime-local" ? dtInput(val) : val;
  return `<label class="${cls}">${escapeHtml(label)}<input name="${f.name}" type="${f.type || "text"}" value="${escapeHtml(v)}" ${attr}></label>`;
}
function patientOptions(selected = "") {
  return `<option value="">Select patient</option>` + patients.map(p => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(fullPatientName(p))}</option>`).join("");
}
function formatJsonish(value) {
  if (value == null) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
function renderResourceDetail(resource, item = {}, editing = false) {
  const def = resourceDefs[resource];
  const detail = $(`#${resource}Detail`) || $(`#${resource} .resourceMount`);
  if (!detail) return;
  const isNew = !item.id;
  const disabled = !editing && !isNew;
  const title = isNew ? `New ${def.singular}` : `${def.title.slice(0, -1)} detail`;
  detail.innerHTML = `<section class="detail-card" data-resource="${resource}" data-id="${item.id || ""}">
    <div class="detail-head"><div><p class="eyebrow">${statusBadge(item.status || "Draft")}</p><h3>${title}</h3></div><div class="detail-actions">${!isNew && disabled ? `<button class="btn small" data-edit="${resource}">Edit</button>` : ""}<button class="btn small secondary" data-back-list="${resource}">Back to list</button></div></div>
    ${similarityWarningHtml(resource, item)}
    <div class="voice-tools"><button class="btn small mic" data-voice-resource="${resource}" data-voice-target="${def.voiceField}">Start voice</button><button class="btn small secondary" data-stop-voice hidden>Stop</button><span class="voice-status">Not recording</span></div>
    <form id="${resource}Form" class="form-card resource-form">
      <div class="form-grid">${def.fields.map(f => fieldHtml(f, item, disabled)).join("")}</div>
      <details class="audit-box"><summary>Audit / review details</summary>${auditHtml(item)}</details>
      ${attachmentSectionHtml(resource, item)}
      <div class="form-actions">
        ${!disabled ? `<button class="btn" data-save-resource="${resource}">${isNew ? "Save" : "Save changes"}</button><button class="btn secondary" type="button" data-cancel-edit="${resource}">Cancel</button>` : ""}
        ${!isNew ? `<button class="btn secondary" type="button" data-submit-review="${resource}">Send for Review</button>` : ""}
        ${!isNew && canActOnReview(item) ? `<button class="btn" type="button" data-approve-review="${resource}">Approve</button><button class="btn secondary danger" type="button" data-reject-review="${resource}">Reject</button>` : ""}
        ${!isNew && isExportableResource(resource) ? `<button class="btn secondary" type="button" data-export-docx="${resource}">Export DOCX</button><button class="btn secondary" type="button" data-export-pdf="${resource}">Export PDF</button>` : ""}
        ${!isNew && isAdmin() ? `<button class="btn secondary danger" type="button" data-delete-detail="${resource}">Delete</button>` : ""}
      </div>
      <div class="review-box" id="${resource}ReviewBox" hidden></div>
      <div class="message" id="${resource}DetailMsg"></div>
    </form>
  </section>`;
  renderPatientSelects();
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
  detail.querySelector(`[data-back-list]`).onclick = () => loadResourceList(resource);
  detail.querySelector(`[data-edit]`)?.addEventListener("click", () => renderResourceDetail(resource, item, true));
  detail.querySelector(`[data-cancel-edit]`)?.addEventListener("click", () => isNew ? loadResourceList(resource) : renderResourceDetail(resource, item, false));
  detail.querySelector(`[data-save-resource]`)?.addEventListener("click", e => { e.preventDefault(); saveResource(resource, item.id); });
  detail.querySelector(`[data-delete-detail]`)?.addEventListener("click", () => deleteResource(resource, item.id));
  detail.querySelector(`[data-submit-review]`)?.addEventListener("click", () => showReviewSubmit(resource, item.id));
  detail.querySelector(`[data-approve-review]`)?.addEventListener("click", () => approveReview(resource, item.id));
  detail.querySelector(`[data-reject-review]`)?.addEventListener("click", () => rejectReview(resource, item.id));
  detail.querySelector(`[data-voice-resource]`)?.addEventListener("click", e => { e.preventDefault(); startVoice(resource, def.voiceField, detail); });
  detail.querySelector(`[data-stop-voice]`)?.addEventListener("click", e => { e.preventDefault(); stopVoice(); });
  detail.querySelector(`[data-upload-attachment]`)?.addEventListener("click", e => { e.preventDefault(); uploadAttachment(resource, item.id, detail); });
  detail.querySelector(`[data-save-report-s3]`)?.addEventListener("click", e => { e.preventDefault(); saveReportFileToS3(item.id); });
  detail.querySelector(`[data-export-docx]`)?.addEventListener("click", e => { e.preventDefault(); exportDocx(resource, item); });
  detail.querySelector(`[data-export-pdf]`)?.addEventListener("click", e => { e.preventDefault(); exportPdf(resource, item); });
  detail.querySelector(`.similarity-warning [data-open-resource]`)?.addEventListener("click", e => { e.preventDefault(); openResourceDetail("reports", e.target.dataset.id); });
  if (item.id) loadAttachments(resource, item.id);
}
function canActOnReview(item) { return item?.status === "Under Review" && (item.review_assigned_to === currentUser?.id || isAdmin()); }
function auditHtml(item = {}) {
  const rows = [
    ["Created By", item.created_by_name || ""], ["Created Date", fmtDate(item.created_at)], ["Modified By", item.modified_by_name || ""], ["Modified Date", item.modified_at ? fmtDate(item.modified_at) : ""], ["Review Assigned To", item.review_assigned_to_name || ""], ["Review Requested At", item.review_requested_at ? fmtDate(item.review_requested_at) : ""], ["Reviewed By", item.reviewed_by_name || ""], ["Reviewed Date", item.reviewed_at ? fmtDate(item.reviewed_at) : ""], ["Rejection Reason", item.rejection_reason || ""]
  ];
  const history = (item.__history || []).map(h => `<tr><td>${escapeHtml(h.action)}</td><td>${escapeHtml(h.actor_name || "")}</td><td>${escapeHtml(h.reviewer_name || "")}</td><td>${escapeHtml(h.from_status || "")}</td><td>${escapeHtml(h.to_status || "")}</td><td>${escapeHtml(h.comment || "")}</td><td>${fmtDate(h.created_at)}</td></tr>`).join("");
  return `<div class="audit-grid">${rows.map(([k,v]) => `<div><strong>${escapeHtml(k)}</strong><span>${escapeHtml(v)}</span></div>`).join("")}</div>${history ? `<h4>Review history</h4><table class="data-table small"><thead><tr><th>Action</th><th>Actor</th><th>Reviewer</th><th>From</th><th>To</th><th>Comment</th><th>Date</th></tr></thead><tbody>${history}</tbody></table>` : ""}`;
}
async function saveResource(resource, id) {
  const def = resourceDefs[resource];
  const form = $(`#${resource}Form`);
  const msg = $(`#${resource}DetailMsg`);
  const body = formToResourceBody(form, def);
  try {
    if (resource === "reports" && !body.output && body.prompt && !id) {
      setMessage(msg, "Drafting report with AI...", "info");
      const out = await api("/api/ai/session-summary", { method: "POST", body: JSON.stringify({ patient_id: body.patient_id, note: body.prompt }) });
      setMessage(msg, "Report drafted and saved.", "success");
      await loadResourceList(resource);
      await openResourceDetail(resource, out.report.id);
      return;
    }
    const out = await api(id ? `${def.endpoint}/${id}` : def.endpoint, { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
    const saved = out[def.singular];
    setMessage(msg, "Saved successfully.", "success");
    await loadResourceList(resource);
    if (saved?.id) await openResourceDetail(resource, saved.id);
  } catch (e) { setMessage(msg, e.message, "error"); }
}
function formToResourceBody(form, def) {
  const body = {};
  for (const f of def.fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === "checkbox") body[f.name] = el.checked;
    else if (structuredIspFields.has(f.name) || f.type === "structured_text") body[f.name] = structuredTextToJson(el.value, f.name);
    else if (cleanIspTextFields.has(f.name) || f.type === "clean_text") body[f.name] = cleanPlainText(el.value, f.name);
    else body[f.name] = el.value;
  }
  body.status = body.status || "draft";
  return body;
}
async function deleteResource(resource, id) {
  if (!confirm("Delete this record? This is permanent.")) return;
  try { await api(`${resourceDefs[resource].endpoint}/${id}`, { method: "DELETE" }); await loadResourceList(resource); } catch (e) { alert(e.message); }
}

async function showReviewSubmit(resource, id) {
  await loadOrgUsers();
  const box = $(`#${resource}ReviewBox`);
  box.hidden = false;
  box.innerHTML = `<h4>Send for review</h4><label>Reviewer<select id="reviewerSelect"><option value="">Select reviewer</option>${orgUsers.filter(u => u.active).map(u => `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.role)})</option>`).join("")}</select></label><label>Comment<textarea id="reviewComment" placeholder="Optional note to reviewer"></textarea></label><button class="btn small" type="button" id="submitReviewBtn">Submit for review</button>`;
  $("#submitReviewBtn").onclick = async () => {
    try {
      const out = await api(`/api/review/${resource}/${id}/submit`, { method: "POST", body: JSON.stringify({ reviewer_id: $("#reviewerSelect").value, comment: $("#reviewComment").value }) });
      alert(out.message || "Sent for review.");
      await openResourceDetail(resource, id);
    } catch (e) { alert(e.message); }
  };
}
async function approveReview(resource, id) {
  const comment = prompt("Approval comment, optional") || "";
  try { const out = await api(`/api/review/${resource}/${id}/approve`, { method: "POST", body: JSON.stringify({ comment }) }); alert(out.message || "Approved."); await openResourceDetail(resource, id); await loadInbox(); } catch (e) { alert(e.message); }
}
async function rejectReview(resource, id) {
  const comment = prompt("Reason for rejection / changes needed") || "Rejected for changes.";
  try { const out = await api(`/api/review/${resource}/${id}/reject`, { method: "POST", body: JSON.stringify({ comment }) }); alert(out.message || "Rejected."); await openResourceDetail(resource, id); await loadInbox(); } catch (e) { alert(e.message); }
}

function startVoice(resource, targetName, root) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert("Browser speech recognition is not supported in this browser.");
  if (activeVoice) stopVoice();
  const rec = new SpeechRecognition();
  const target = root.querySelector(`[name="${targetName}"]`);
  if (!target) return alert("Target field not found.");
  const startBtn = root.querySelector(`[data-voice-resource]`);
  const stopBtn = root.querySelector(`[data-stop-voice]`);
  const status = root.querySelector(".voice-status");
  rec.lang = "en-US"; rec.interimResults = false; rec.continuous = true;
  rec.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) target.value = `${target.value || ""} ${ev.results[i][0].transcript}`.trim(); };
  rec.onerror = ev => { if (status) status.textContent = `Speech error: ${ev.error}`; };
  rec.onend = async () => {
    if (startBtn) { startBtn.textContent = "Start voice"; startBtn.disabled = false; }
    if (stopBtn) stopBtn.hidden = true;
    if (status) status.textContent = "Stopped. Mapping fields...";
    const text = target.value.trim();
    activeVoice = null;
    if (text) await extractFields(resource, text, root);
    if (status) status.textContent = "Not recording";
  };
  activeVoice = rec;
  if (startBtn) { startBtn.textContent = "Recording..."; startBtn.disabled = true; }
  if (stopBtn) stopBtn.hidden = false;
  if (status) status.textContent = "Recording. Click Stop when finished.";
  rec.start();
}
function stopVoice() { if (activeVoice) { try { activeVoice.stop(); } catch {} } }
async function extractFields(resource, text, root) {
  try {
    const out = await api("/api/ai/extract-fields", { method: "POST", body: JSON.stringify({ resource_type: resource, text }) });
    const fields = out.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      const el = root.querySelector(`[name="${k}"]`);
      if (!el || v == null || v === "") continue;
      if (el.type === "checkbox") el.checked = Boolean(v);
      else if (el.type === "datetime-local") el.value = dtInput(v);
      else if (el.type === "date") el.value = dateInput(v);
      else if (!el.value || el.tagName === "TEXTAREA") el.value = String(v);
    }
  } catch (e) { console.warn(e.message); }
}



function ensureGlobalPatientSearch() {
  if (!isWorkspacePage || !currentUser || currentUser?.must_change_password) {
    document.getElementById("globalPatientSearchLauncher")?.remove();
    document.getElementById("globalPatientSearchBox")?.remove();
    closeProfessionalModal("globalPatientSearchModal");
    return;
  }
  ensureProfessionalStyles();
  const nav = document.getElementById("userNav");
  if (!nav) return;
  if (document.getElementById("globalPatientSearchLauncher")) return;

  const launcher = document.createElement("div");
  launcher.id = "globalPatientSearchLauncher";
  launcher.className = "ta-search-launcher";
  launcher.innerHTML = `
    <input id="globalPatientSearchTopInput" type="search" placeholder="Search patients..." autocomplete="off" aria-label="Search patients">
    <button class="btn small" id="globalPatientSearchTopBtn" type="button">Search</button>`;
  nav.insertBefore(launcher, nav.firstChild);

  const input = launcher.querySelector("#globalPatientSearchTopInput");
  const run = () => openGlobalPatientSearchModal(input.value);
  launcher.querySelector("#globalPatientSearchTopBtn").onclick = run;
  input.onkeydown = e => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };
  input.addEventListener("input", () => {
    clearTimeout(globalSearchTimer);
    const q = input.value.trim();
    if (q.length >= 2) globalSearchTimer = setTimeout(() => openGlobalPatientSearchModal(q), 450);
  });
}

function openGlobalPatientSearchModal(query = "") {
  if (!isWorkspacePage || !currentUser) return;
  globalSearchModalQuery = String(query || "").trim();
  const modal = openProfessionalModal({
    id: "globalPatientSearchModal",
    title: "Patient Search",
    subtitle: "Search a patient and review all linked TherapyAgent records in one focused view.",
    body: `
      <div class="form-card">
        <label>Patient name, MRN, guardian, diagnosis, or insurance
          <input id="globalPatientSearchInput" type="search" value="${escapeHtml(globalSearchModalQuery)}" placeholder="Start typing a patient name..." autocomplete="off">
        </label>
        <div id="globalPatientSearchMsg" class="message"></div>
      </div>
      <div id="globalPatientSearchResults" class="ta-search-results"></div>`,
    actions: `<button class="btn" id="globalPatientSearchRun" type="button">Search</button><button class="btn secondary" id="globalPatientSearchClose" type="button">Close</button>`
  });
  const input = modal.querySelector("#globalPatientSearchInput");
  const run = () => runGlobalPatientSearch(input.value);
  modal.querySelector("#globalPatientSearchRun").onclick = run;
  modal.querySelector("#globalPatientSearchClose").onclick = () => closeProfessionalModal("globalPatientSearchModal");
  input.onkeydown = e => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };
  input.addEventListener("input", () => {
    clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(() => runGlobalPatientSearch(input.value), 350);
  });
  setTimeout(() => input.focus(), 50);
  if (globalSearchModalQuery.length >= 2) runGlobalPatientSearch(globalSearchModalQuery);
}


function globalPatientMatchText(p = {}) {
  return [
    fullPatientName(p),
    p.external_id,
    p.guardian_name,
    p.guardian_phone,
    p.guardian_email,
    p.diagnosis,
    p.insurance
  ].filter(Boolean).join(" ").toLowerCase();
}

async function runGlobalPatientSearch(rawQuery = "") {
  const modal = document.getElementById("globalPatientSearchModal");
  if (!modal || !isWorkspacePage || !currentUser) return;
  const msg = modal.querySelector("#globalPatientSearchMsg");
  const results = modal.querySelector("#globalPatientSearchResults");
  const q = String(rawQuery || "").trim().toLowerCase();

  if (!q) {
    setMessage(msg, "");
    if (results) results.innerHTML = `<div class="empty">Search for a patient to see linked records.</div>`;
    return;
  }
  if (q.length < 2) {
    setMessage(msg, "Type at least 2 characters to search patients.", "info");
    if (results) results.innerHTML = "";
    return;
  }

  try {
    setMessage(msg, "Searching patient records...", "info");
    if (!patients.length) await loadPatients();
    const matches = patients.filter(p => globalPatientMatchText(p).includes(q)).slice(0, 8);

    if (!matches.length) {
      setMessage(msg, "No matching patients found.", "warning");
      if (results) results.innerHTML = `<div class="empty">No matching patients found.</div>`;
      return;
    }

    const summaries = [];
    for (const p of matches) {
      try {
        const summary = await api(`/api/patients/${encodeURIComponent(p.id)}/summary`);
        summaries.push({ patient: p, summary });
      } catch (e) {
        summaries.push({ patient: p, error: e.message });
      }
    }

    renderGlobalPatientSearchResults(summaries);
    setMessage(msg, `${matches.length} patient match${matches.length === 1 ? "" : "es"} found.`, "success");
  } catch (e) {
    setMessage(msg, e.message, "error");
  }
}

function globalResourceDate(row = {}) {
  return row.session_date || row.event_time || row.incident_date || row.effective_from || row.created_at || "";
}

function globalResourceTitle(resource, row = {}) {
  if (resource === "sessions") return row.service_code || row.location || row.ai_summary || row.activities || "Session log";
  if (resource === "behaviors") return row.behavior || "Behavior event";
  if (resource === "plans") return row.title || row.plan_type || "Therapy plan";
  if (resource === "isps") return row.title || "Individual Service Plan";
  if (resource === "incidents") return row.category || row.severity || "Incident";
  if (resource === "reports") return row.report_type || "AI report";
  return row.title || row.category || row.report_type || "Record";
}

function globalSearchRecordRows(summary = {}) {
  const resources = ["sessions", "behaviors", "plans", "isps", "incidents", "reports"];
  const labels = {
    sessions: "Session Log",
    behaviors: "Behavior Event",
    plans: "Therapy Plan",
    isps: "ISP",
    incidents: "Incident",
    reports: "AI Report"
  };
  const rows = [];
  for (const resource of resources) {
    for (const row of summary[resource] || []) {
      rows.push({
        resource,
        label: labels[resource] || resource,
        status: row.status || "",
        date: globalResourceDate(row),
        title: globalResourceTitle(resource, row),
        created_by_name: row.created_by_name || row.user_name || "",
        id: row.id
      });
    }
  }
  rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return rows.slice(0, 60);
}

function renderGlobalPatientSearchResults(items = []) {
  const modal = document.getElementById("globalPatientSearchModal");
  const results = modal?.querySelector("#globalPatientSearchResults");
  if (!results) return;

  results.innerHTML = items.map(({ patient, summary, error }) => {
    const name = fullPatientName(patient);
    const counts = summary ? [
      ["Sessions", (summary.sessions || []).length],
      ["Behaviors", (summary.behaviors || []).length],
      ["Plans", (summary.plans || []).length],
      ["ISPs", (summary.isps || []).length],
      ["Incidents", (summary.incidents || []).length],
      ["Reports", (summary.reports || []).length]
    ] : [];
    const rows = summary ? globalSearchRecordRows(summary) : [];
    return `<section class="ta-search-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h3>${escapeHtml(name || "Patient")}</h3>
          <p class="muted" style="margin:0">MRN: ${escapeHtml(patient.external_id || "not set")} · DOB: ${escapeHtml(dateInput(patient.date_of_birth) || "not set")} · Diagnosis/program: ${escapeHtml(patient.diagnosis || "not set")}</p>
          ${counts.length ? `<div class="ta-count-row">${counts.map(([k, v]) => `<span class="ta-count-pill">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`).join("")}</div>` : ""}
        </div>
        <button class="btn small" type="button" data-global-open-patient="${patient.id}">Open Patient</button>
      </div>
      ${error ? `<div class="error" style="margin-top:10px">${escapeHtml(error)}</div>` : tableHtml(["Type", "Status", "Date", "Details", "Created By", "Action"], rows.map(r => [
        escapeHtml(r.label),
        statusBadge(r.status),
        escapeHtml(dateInput(r.date) || fmtDate(r.date)),
        escapeHtml(r.title),
        escapeHtml(r.created_by_name || ""),
        `<button class="link-btn" type="button" data-global-open-resource="${r.resource}" data-id="${r.id}">Open</button>`
      ]))}
    </section>`;
  }).join("");

  $$(`[data-global-open-patient]`, results).forEach(b => {
    b.onclick = () => {
      closeProfessionalModal("globalPatientSearchModal");
      panel("patients");
      setTimeout(() => openPatientDetail(b.dataset.globalOpenPatient), 150);
    };
  });
  $$(`[data-global-open-resource]`, results).forEach(b => {
    b.onclick = () => openResourceDetailModal(b.dataset.globalOpenResource, b.dataset.id);
  });
}


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
    panel("bcbaChat");
    setTimeout(() => {
      startNewBcbaChatSession(b.dataset.aiPatientRisk || "");
      const input = $("#bcbaChatInput");
      if (input) { input.value = "Prepare a BCBA plan review briefing for this patient. Highlight behavior trends, incident risk, possible antecedent/function patterns, intervention response, and data gaps."; input.focus(); }
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

function bcbaChatSessionsKey() {
  return `therapyagent_bcba_chat_sessions_${currentUser?.id || "anonymous"}`;
}
function bcbaChatActiveKey() {
  return `therapyagent_bcba_chat_active_${currentUser?.id || "anonymous"}`;
}
function bcbaChatLegacyKey() {
  return `therapyagent_bcba_chat_${currentUser?.id || "anonymous"}`;
}

function bcbaChatDeriveTitle(messages) {
  const firstUser = (messages || []).find(m => m.role === "user");
  const text = String(firstUser?.text || "").trim();
  if (!text) return "New chat";
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}

function bcbaChatWelcomeMessage(patientId) {
  return patientId
    ? "BCBA Chat is ready for this patient. Outputs require clinician review."
    : "BCBA Chat is ready. Select a patient for patient-specific context, or leave patient blank for organization-level guidance. Outputs require clinician review.";
}

function newBcbaChatSession(patientId = "") {
  const now = new Date().toISOString();
  return {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    patient_id: patientId || "",
    date_range_days: "90",
    title: "New chat",
    messages: [{ role: "system", text: bcbaChatWelcomeMessage(patientId), at: now }],
    created_at: now,
    updated_at: now
  };
}

// Reads every saved BCBA Chat session for this user. One-time migrates the
// old single-thread storage format (pre-history-list) into the new list so
// existing conversations aren't lost when this feature ships.
function loadBcbaChatSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(bcbaChatSessionsKey()) || "null");
    if (Array.isArray(raw)) return raw;
  } catch {}
  try {
    const legacy = JSON.parse(localStorage.getItem(bcbaChatLegacyKey()) || "null");
    if (legacy && Array.isArray(legacy.messages) && legacy.messages.some(m => m.role === "user")) {
      const migrated = [{
        id: `sess_${Date.now()}_migrated`,
        patient_id: legacy.patient_id || "",
        date_range_days: String(legacy.date_range_days || "90"),
        title: bcbaChatDeriveTitle(legacy.messages),
        messages: legacy.messages.slice(-60),
        created_at: legacy.messages[0]?.at || new Date().toISOString(),
        updated_at: legacy.messages[legacy.messages.length - 1]?.at || new Date().toISOString()
      }];
      saveBcbaChatSessions(migrated);
      localStorage.removeItem(bcbaChatLegacyKey());
      return migrated;
    }
  } catch {}
  return [];
}
function saveBcbaChatSessions(sessions) {
  try { localStorage.setItem(bcbaChatSessionsKey(), JSON.stringify((sessions || []).slice(0, 50))); } catch {}
}
function getActiveBcbaChatSessionId() {
  try { return localStorage.getItem(bcbaChatActiveKey()) || ""; } catch { return ""; }
}
function setActiveBcbaChatSessionId(id) {
  try { localStorage.setItem(bcbaChatActiveKey(), id || ""); } catch {}
}

function loadBcbaChatState() {
  if (bcbaChatState) return bcbaChatState;
  const sessions = loadBcbaChatSessions();
  const activeId = getActiveBcbaChatSessionId();
  let active = sessions.find(s => s.id === activeId) || sessions[0];
  if (!active) {
    active = newBcbaChatSession();
    sessions.unshift(active);
    saveBcbaChatSessions(sessions);
  }
  setActiveBcbaChatSessionId(active.id);
  bcbaChatState = active;
  return bcbaChatState;
}

function saveBcbaChatState() {
  if (!bcbaChatState) return;
  try {
    bcbaChatState.messages = (bcbaChatState.messages || []).slice(-60);
    bcbaChatState.updated_at = new Date().toISOString();
    if (!bcbaChatState.title || bcbaChatState.title === "New chat") {
      bcbaChatState.title = bcbaChatDeriveTitle(bcbaChatState.messages);
    }
    const sessions = loadBcbaChatSessions();
    const idx = sessions.findIndex(s => s.id === bcbaChatState.id);
    if (idx >= 0) sessions[idx] = bcbaChatState; else sessions.unshift(bcbaChatState);
    saveBcbaChatSessions(sessions);
    refreshBcbaChatSessionListUI();
  } catch {}
}

// Starts a brand-new, empty conversation. Used for the "New chat" button and,
// per the requested UX, automatically whenever the patient selection changes
// so patient context never bleeds between unrelated conversations.
function startNewBcbaChatSession(patientId = "") {
  const sessions = loadBcbaChatSessions();
  const session = newBcbaChatSession(patientId);
  sessions.unshift(session);
  saveBcbaChatSessions(sessions);
  setActiveBcbaChatSessionId(session.id);
  bcbaChatState = session;
  loadBcbaChat();
}
function switchBcbaChatSession(id) {
  const sessions = loadBcbaChatSessions();
  const found = sessions.find(s => s.id === id);
  if (!found || found.id === bcbaChatState?.id) return;
  setActiveBcbaChatSessionId(id);
  bcbaChatState = found;
  loadBcbaChat();
}
function deleteBcbaChatSession(id) {
  if (!confirm("Delete this chat? This can't be undone.")) return;
  let sessions = loadBcbaChatSessions();
  sessions = sessions.filter(s => s.id !== id);
  saveBcbaChatSessions(sessions);
  if (bcbaChatState?.id === id) {
    bcbaChatState = null;
    setActiveBcbaChatSessionId("");
  }
  loadBcbaChat();
}
function bcbaChatRelativeTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
function bcbaChatSessionPatientLabel(patientId) {
  if (!patientId) return "Org-level";
  const p = patients.find(x => x.id === patientId);
  return p ? fullPatientName(p) : "Patient";
}
function bcbaChatSessionListHtml(sessions, activeId) {
  if (!sessions.length) return `<p class="ta-chat-session-empty">No previous chats yet.</p>`;
  return sessions
    .slice()
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, 25)
    .map(s => `
      <div class="ta-chat-session-item ${s.id === activeId ? "active" : ""}">
        <button class="ta-chat-session-open" data-open-session="${s.id}" type="button">
          <span class="ta-chat-session-title">${escapeHtml(s.title || "New chat")}</span>
          <span class="ta-chat-session-meta">${escapeHtml(bcbaChatSessionPatientLabel(s.patient_id))} · ${escapeHtml(bcbaChatRelativeTime(s.updated_at))}</span>
        </button>
        <button class="ta-chat-session-delete" data-delete-session="${s.id}" type="button" aria-label="Delete chat" title="Delete chat">×</button>
      </div>`).join("");
}
function bindBcbaChatSessionListEvents() {
  $$("[data-open-session]").forEach(b => b.onclick = () => switchBcbaChatSession(b.dataset.openSession));
  $$("[data-delete-session]").forEach(b => b.onclick = e => { e.stopPropagation(); deleteBcbaChatSession(b.dataset.deleteSession); });
}
function refreshBcbaChatSessionListUI() {
  const listEl = $("#bcbaChatSessionList");
  if (!listEl || !bcbaChatState) return;
  listEl.innerHTML = bcbaChatSessionListHtml(loadBcbaChatSessions(), bcbaChatState.id);
  bindBcbaChatSessionListEvents();
}

function bcbaChatPatientOptions(selected = "") {
  return `<option value="">No single patient / organization-level chat</option>` + patients.map(p => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${escapeHtml(fullPatientName(p))}${p.diagnosis ? ` — ${escapeHtml(p.diagnosis)}` : ""}</option>`).join("");
}

function renderBcbaChatMessages() {
  const mount = $("#bcbaChatTranscript");
  if (!mount) return;
  const state = loadBcbaChatState();
  const msgs = state.messages || [];
  if (!msgs.length) {
    mount.innerHTML = `<div class="ta-chat-empty"><h3>Start a BCBA chat</h3><p>Ask about behavior patterns, plan review preparation, parent/staff training ideas, data gaps, ISP drafting, or documentation quality.</p></div>`;
    return;
  }
  mount.innerHTML = msgs.map(m => `
    <div class="ta-chat-bubble ${escapeHtml(m.role || "assistant")}">
      <span class="ta-chat-meta">${escapeHtml(m.role === "user" ? "You" : m.role === "system" ? "TherapyAgent" : "ABA-Skilled BCBA Agent")} ${m.mode ? `• ${escapeHtml(m.mode)}` : ""}</span>
      ${escapeHtml(m.text || "").replace(/\n/g, "<br>")}
    </div>`).join("");
  mount.scrollTop = mount.scrollHeight;
}

function bcbaChatHistoryPrompt(question) {
  const state = loadBcbaChatState();
  const history = (state.messages || [])
    .filter(m => ["user", "assistant"].includes(m.role))
    .slice(-10)
    .map(m => `${m.role === "user" ? "User" : "ABA-Skilled BCBA Agent"}: ${m.text}`)
    .join("\n\n");
  return `This is an ongoing TherapyAgent BCBA Chat. Continue the conversation naturally and clinically. Use the TherapyAgent ABA-Skilled BCBA Agent skill and any selected patient context. Do not diagnose, prescribe, determine medical necessity, or replace BCBA judgment. Be practical, evidence-linked, and ask clarifying questions when needed.\n\nConversation so far:\n${history || "No prior conversation in this thread."}\n\nCurrent user message:\n${question}`;
}

async function loadBcbaChat() {
  if (!isWorkspacePage || !currentUser) return;
  ensureProfessionalStyles();
  if (!patients.length) {
    try { await loadPatients(); } catch {}
  }
  const mount = $("#bcbaChat .bcbaChatMount") || $("#bcbaChat");
  if (!mount) return;
  const state = loadBcbaChatState();
  mount.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">Conversational assistant</p>
        <h2>BCBA Chat</h2>
      </div>
      <button class="btn small secondary" id="newBcbaChat" type="button">New chat</button>
    </div>
    <div class="notice">Chat with the ABA-Skilled BCBA Agent. Select a patient for patient-specific context, or keep it organization-level. Outputs require clinician review and do not replace BCBA judgment.</div>
    <section class="ta-chat-shell">
      <aside class="ta-chat-side">
        <label>Patient context
          <select id="bcbaChatPatient">${bcbaChatPatientOptions(state.patient_id || "")}</select>
        </label>
        <label>Date range
          <select id="bcbaChatRange">
            <option value="30" ${state.date_range_days === "30" ? "selected" : ""}>Last 30 days</option>
            <option value="90" ${state.date_range_days === "90" ? "selected" : ""}>Last 90 days</option>
            <option value="180" ${state.date_range_days === "180" ? "selected" : ""}>Last 180 days</option>
            <option value="365" ${state.date_range_days === "365" ? "selected" : ""}>Last 365 days</option>
          </select>
        </label>
        <div class="ta-search-card ta-chat-sessions-card">
          <h3>Recent chats</h3>
          <div class="ta-chat-session-list" id="bcbaChatSessionList">${bcbaChatSessionListHtml(loadBcbaChatSessions(), state.id)}</div>
        </div>
        <div class="ta-search-card">
          <h3>Try asking</h3>
          <div class="ta-chat-suggestions">
            <button class="ta-chip-btn" data-chat-suggest="What are the top behavior patterns and data gaps I should review?">Patterns & gaps</button>
            <button class="ta-chip-btn" data-chat-suggest="Help me prepare for a BCBA plan review for this patient.">Plan review</button>
            <button class="ta-chip-btn" data-chat-suggest="Suggest caregiver or staff training topics based on available records.">Training topics</button>
            <button class="ta-chip-btn" data-chat-suggest="What should I verify before updating the ISP?">ISP readiness</button>
          </div>
        </div>
        <div class="message" id="bcbaChatMsg"></div>
      </aside>
      <main class="ta-chat-main">
        <div class="ta-chat-transcript" id="bcbaChatTranscript"></div>
        <form class="ta-chat-compose" id="bcbaChatForm">
          <textarea id="bcbaChatInput" placeholder="Ask a follow-up question. Example: Given the recent incidents, what should I check before changing the intervention plan?"></textarea>
          <div class="ta-chat-tools">
            <span class="muted">Uses TherapyAgent record context and the configured ABA/BCBA skill.</span>
            <div>
              <button class="btn secondary" id="bcbaChatGenerateIsp" type="button">Generate ISP Draft</button>
              <button class="btn" type="submit">Send</button>
            </div>
          </div>
        </form>
      </main>
    </section>`;
  renderBcbaChatMessages();
  bindBcbaChatSessionListEvents();

  $("#bcbaChatPatient")?.addEventListener("change", e => {
    // Per product decision: switching patient starts a fresh conversation
    // instead of mixing context, so a prior patient's details never leak
    // into a new patient's thread. The previous chat stays saved in history.
    startNewBcbaChatSession(e.target.value || "");
  });
  $("#bcbaChatRange")?.addEventListener("change", e => {
    state.date_range_days = e.target.value || "90";
    saveBcbaChatState();
  });
  $("#newBcbaChat")?.addEventListener("click", () => startNewBcbaChatSession(""));
  $("#bcbaChatForm")?.addEventListener("submit", sendBcbaChatMessage);
  $("#bcbaChatGenerateIsp")?.addEventListener("click", generateIspFromBcbaChat);
  $$('[data-chat-suggest]', mount).forEach(b => b.onclick = () => {
    const input = $("#bcbaChatInput");
    if (input) {
      input.value = b.dataset.chatSuggest || "";
      input.focus();
    }
  });
}

async function sendBcbaChatMessage(e) {
  e?.preventDefault?.();
  const msg = $("#bcbaChatMsg");
  const input = $("#bcbaChatInput");
  const question = String(input?.value || "").trim();
  if (!question) return setMessage(msg, "Type a message first.", "error");

  const state = loadBcbaChatState();
  state.patient_id = $("#bcbaChatPatient")?.value || state.patient_id || "";
  state.date_range_days = $("#bcbaChatRange")?.value || state.date_range_days || "90";
  state.messages.push({ role: "user", text: question, at: new Date().toISOString() });
  if (input) input.value = "";
  saveBcbaChatState();
  renderBcbaChatMessages();

  try {
    setMessage(msg, "Thinking with TherapyAgent context...", "info");
    const out = await api("/api/ai/workbench", {
      method: "POST",
      body: JSON.stringify({
        patient_id: state.patient_id || "",
        date_range_days: state.date_range_days || "90",
        mode: "general",
        question: bcbaChatHistoryPrompt(question)
      })
    });
    state.messages.push({ role: "assistant", text: out.answer || "No answer returned.", mode: out.mode || "", evidence: out.evidence || [], at: new Date().toISOString() });
    saveBcbaChatState();
    renderBcbaChatMessages();
    setMessage(msg, out.message || "Response generated.", "success");
  } catch (err) {
    state.messages.push({ role: "system", text: `Chat failed: ${err.message}`, at: new Date().toISOString() });
    saveBcbaChatState();
    renderBcbaChatMessages();
    setMessage(msg, err.message, "error");
  }
}

async function generateIspFromBcbaChat() {
  const msg = $("#bcbaChatMsg");
  const state = loadBcbaChatState();
  state.patient_id = $("#bcbaChatPatient")?.value || state.patient_id || "";
  state.date_range_days = $("#bcbaChatRange")?.value || state.date_range_days || "90";
  if (!state.patient_id) return setMessage(msg, "Select a patient before generating an ISP draft.", "error");
  const thread = (state.messages || []).filter(m => ["user", "assistant"].includes(m.role)).slice(-14).map(m => `${m.role === "user" ? "User" : "ABA-Skilled BCBA Agent"}: ${m.text}`).join("\n\n");
  try {
    setMessage(msg, "Generating ISP draft from this chat and patient context...", "info");
    const out = await api("/api/ai/workbench/isp", {
      method: "POST",
      body: JSON.stringify({
        patient_id: state.patient_id,
        date_range_days: state.date_range_days || "90",
        question: `Generate an ISP draft using this BCBA Chat context and the selected patient's TherapyAgent record context.\n\nChat context:\n${thread}`
      })
    });
    setMessage(msg, out.message || "ISP draft generated and saved.", "success");
    if (out.isp?.id) {
      panel("isps");
      setTimeout(() => openResourceDetail("isps", out.isp.id), 350);
    }
  } catch (err) {
    setMessage(msg, err.message, "error");
  }
}

async function loadInbox() {
  const assigned = $("#assignedInbox"), returned = $("#returnedInbox");
  if (!assigned || !returned) return;
  try {
    const out = await api("/api/inbox");
    assigned.innerHTML = inboxTable(out.assigned || [], true);
    returned.innerHTML = inboxTable(out.returned || [], false);
    $$(`[data-open-inbox]`).forEach(b => b.onclick = () => openResourceDetailModal(b.dataset.resource, b.dataset.id));
    $("#metricInbox") && ($("#metricInbox").textContent = String((out.assigned || []).length + (out.returned || []).length));
  } catch (e) { assigned.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
}
function inboxTable(rows, assigned) {
  return tableHtml(["Type", "Patient", "Status", "Details", assigned ? "Requested By" : "Reviewer", "Date", "Action"], rows.map(r => [
    escapeHtml(r.resource_label || r.resource), escapeHtml(patientName(r)), statusBadge(r.status), escapeHtml(r.title || r.behavior || r.category || r.report_type || r.location || "Record"), escapeHtml(assigned ? (r.created_by_name || "") : (r.reviewed_by_name || r.review_assigned_to_name || "")), fmtDate(r.review_requested_at || r.modified_at || r.created_at), `<button class="link-btn" data-open-inbox="1" data-resource="${r.resource}" data-id="${r.id}">Open</button>`
  ]));
}

async function loadOrgUsers() {
  if (!isAdmin() && orgUsers.length) return orgUsers;
  try { const out = await api("/api/admin/users"); orgUsers = out.users || []; return orgUsers; } catch { return orgUsers; }
}
async function loadAdmin() {
  if (!isAdmin()) { $("#admin").innerHTML = `<div class="notice">Admin & Roles is available to Org Admin users only.</div>`; return; }
  await loadOrgUsers();
  renderRoleSelects();
  renderAdminUsers();
  await loadRoleMatrix();
  await loadAttachmentSetup();
  renderAttachmentSetup();
}
function renderRoleSelects() { $$(".roleSelect").forEach(s => s.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join("")); }
function renderAdminUsers() {
  const mount = $("#adminUserList");
  if (!mount) return;
  mount.innerHTML = tableHtml(["Name", "Email", "Role", "Active", "MFA", "Must Change Pwd", "Created", "Modified", "Actions"], orgUsers.map(u => [
    escapeHtml(u.full_name), escapeHtml(u.email), `<select data-user-role="${u.id}">${roles.map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>`, `<input type="checkbox" data-user-active="${u.id}" ${u.active ? "checked" : ""}>`, u.mfa_enabled ? "Yes" : "No", u.must_change_password ? "Yes" : "No", fmtDate(u.created_at), u.modified_at ? fmtDate(u.modified_at) : "", `<button class="link-btn" data-save-user="${u.id}">Save</button> <button class="link-btn" data-reset-user="${u.id}">Reset Password</button>`
  ]));
  $$(`[data-save-user]`, mount).forEach(b => b.onclick = () => saveAdminUser(b.dataset.saveUser));
  $$(`[data-reset-user]`, mount).forEach(b => b.onclick = () => resetAdminPassword(b.dataset.resetUser));
}
async function saveAdminUser(id) {
  try { await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role: $(`[data-user-role="${id}"]`).value, active: $(`[data-user-active="${id}"]`).checked }) }); await loadAdmin(); } catch (e) { alert(e.message); }
}
async function resetAdminPassword(id) {
  const wrap = document.createElement("div");
  wrap.className = "modal show";
  wrap.innerHTML = `
    <div class="modal-card" style="max-width:520px;padding:28px">
      <button class="x" type="button" aria-label="Close">×</button>
      <h2>Reset Password</h2>
      <p class="notice">Enter a temporary password. The user will receive it by email if SMTP is configured and must change it at next login.</p>
      <form id="resetPasswordForm" class="auth-form">
        <label>Temporary password<input id="resetInitialPassword" name="initialPassword" type="password" required minlength="12" autocomplete="new-password"></label>
        <ul id="resetPasswordChecklist" class="password-checklist"></ul>
        <label>Confirm temporary password<input name="confirmPassword" type="password" required minlength="12" autocomplete="new-password"></label>
        <div class="form-actions"><button class="btn">Reset password</button><button class="btn secondary" type="button" data-cancel-reset>Cancel</button></div>
        <div class="message" id="resetPasswordMsg"></div>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  attachLivePasswordChecklist(wrap.querySelector("#resetInitialPassword"), wrap.querySelector("#resetPasswordChecklist"));
  const close = () => wrap.remove();
  wrap.querySelector(".x").onclick = close;
  wrap.querySelector("[data-cancel-reset]").onclick = close;
  wrap.querySelector("#resetPasswordForm").onsubmit = async e => {
    e.preventDefault();
    const initialPassword = e.target.initialPassword.value;
    const confirmPassword = e.target.confirmPassword.value;
    const msg = wrap.querySelector("#resetPasswordMsg");
    const validation = validatePasswordFields(initialPassword, confirmPassword);
    if (validation) return setMessage(msg, validation, "error");
    try {
      const out = await api(`/api/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ initialPassword }) });
      const mailMsg = out.emailSent ? "Temporary password email sent." : `Password reset, but email was not sent: ${out.emailError || "SMTP not configured"}.`;
      setMessage(msg, `Password reset for ${out.user.email}. ${mailMsg}`, out.emailSent ? "success" : "warning");
      await loadAdmin();
      setTimeout(close, 1800);
    } catch (e) { setMessage(msg, e.message, "error"); }
  };
}

async function loadRoleMatrix() {
  try { const out = await api("/api/admin/role-permissions"); roleMatrix = out; renderRoleMatrix(); } catch (e) { console.warn(e.message); }
}
function renderRoleMatrix() {
  const mount = $("#roleMatrix");
  if (!mount || !roleMatrix) return;
  mount.innerHTML = `<table class="data-table matrix"><thead><tr><th>Permission</th>${roleMatrix.roles.map(r => `<th>${r}</th>`).join("")}</tr></thead><tbody>${roleMatrix.permissionKeys.map(k => `<tr><td>${k}</td>${roleMatrix.roles.map(r => `<td><input type="checkbox" data-perm-role="${r}" data-perm-key="${k}" ${roleMatrix.matrix?.[r]?.[k] ? "checked" : ""}></td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
async function saveRoleMatrix() {
  if (!roleMatrix) return;
  for (const r of roleMatrix.roles) for (const k of roleMatrix.permissionKeys) roleMatrix.matrix[r][k] = Boolean($(`[data-perm-role="${r}"][data-perm-key="${k}"]`)?.checked);
  try { await api("/api/admin/role-permissions", { method: "PUT", body: JSON.stringify({ matrix: roleMatrix.matrix }) }); alert("Role permissions saved."); } catch (e) { alert(e.message); }
}

async function refreshDashboard() {
  if (currentUser?.must_change_password) return;
  $("#metricPatients") && ($("#metricPatients").textContent = String(patients.length));
  let drafts = 0, reviews = 0;
  for (const key of Object.keys(resourceDefs)) {
    try {
      const out = await api(resourceDefs[key].endpoint);
      const rows = out[key] || [];
      drafts += rows.filter(r => String(r.status).toLowerCase() === "draft").length;
      reviews += rows.filter(r => String(r.status).toLowerCase() === "under review").length;
    } catch {}
  }
  $("#metricDrafts") && ($("#metricDrafts").textContent = String(drafts));
  $("#metricReviews") && ($("#metricReviews").textContent = String(reviews));
}


function ensureWorkspaceUiPatch() {
  if (!isWorkspacePage) return;

  const sidebar = $(".sidebar");
  if (sidebar && !$('[data-panel="bcbaChat"]', sidebar)) {
    const btn = document.createElement("button");
    btn.dataset.panel = "bcbaChat";
    btn.textContent = "BCBA Chat";
    const before = $('[data-panel="isps"]', sidebar) || $('[data-panel="patients"]', sidebar) || $('[data-panel="inbox"]', sidebar);
    sidebar.insertBefore(btn, before || null);
  }
  if (sidebar && !$('[data-panel="isps"]', sidebar)) {
    const btn = document.createElement("button");
    btn.dataset.panel = "isps";
    btn.textContent = "ISP Builder";
    const before = $('[data-panel="patients"]', sidebar) || $('[data-panel="inbox"]', sidebar);
    sidebar.insertBefore(btn, before || null);
  }

  const workspace = $("#workspace");
  if (workspace && !$("#bcbaChat")) {
    const section = document.createElement("section");
    section.className = "panel";
    section.id = "bcbaChat";
    section.innerHTML = '<div class="bcbaChatMount"></div>';
    const isps = $("#isps");
    const admin = $("#admin");
    workspace.insertBefore(section, isps || admin || null);
  }
  if (workspace && !$("#isps")) {
    const section = document.createElement("section");
    section.className = "panel resource-panel";
    section.id = "isps";
    section.dataset.resource = "isps";
    section.innerHTML = '<div class="resourceMount"></div>';
    const admin = $("#admin");
    workspace.insertBefore(section, admin || null);
  }

  const tabs = $("#patientTabs");
  if (tabs && !$('[data-patient-tab="isps"]', tabs)) {
    const btn = document.createElement("button");
    btn.dataset.patientTab = "isps";
    btn.textContent = "ISP";
    const before = $('[data-patient-tab="reports"]', tabs) || $('[data-patient-tab="incidents"]', tabs);
    tabs.insertBefore(btn, before || null);
  }
}


ensureWorkspaceUiPatch();

// Event bindings
$$(".sidebar button").forEach(b => b.onclick = () => panel(b.dataset.panel));
$("#openAuth")?.addEventListener("click", () => openAuth("login"));
$("#heroLogin")?.addEventListener("click", () => openAuth("login"));
$("#closeAuth")?.addEventListener("click", closeAuth);
$("#authModal")?.addEventListener("click", e => { if (e.target.id === "authModal") closeAuth(); });
$$(".auth-tab").forEach(b => b.addEventListener("click", () => setAuthScreen(b.dataset.authScreen)));
$("#goLoginAfterMfa")?.addEventListener("click", () => setAuthScreen("login"));
$("#logoutBtn")?.addEventListener("click", logout);
$("#refreshAll")?.addEventListener("click", async () => { await loadPatients(); await refreshDashboard(); });
$("#refreshAnalytics")?.addEventListener("click", loadAnalytics);
$("#refreshInbox")?.addEventListener("click", loadInbox);
$("#refreshAdmin")?.addEventListener("click", loadAdmin);
$("#saveRoleMatrix")?.addEventListener("click", saveRoleMatrix);
$("#saveAttachmentSetup")?.addEventListener("click", saveAttachmentSetup);
$("#refreshAttachmentSetup")?.addEventListener("click", async () => { await loadAttachmentSetup(); renderAttachmentSetup(); });
$("#closePatientDetail")?.addEventListener("click", () => { $("#patientDetail").hidden = true; activePatient = null; });
$$("#patientTabs button").forEach(b => b.onclick = () => renderPatientTab(b.dataset.patientTab));
$$("#adminTabs button").forEach(b => b.onclick = () => {
  $$("#adminTabs button").forEach(x => x.classList.toggle("active", x === b));
  $("#adminUsersTab") && ($("#adminUsersTab").hidden = b.dataset.adminTab !== "users");
  $("#adminRolesTab") && ($("#adminRolesTab").hidden = b.dataset.adminTab !== "roles");
  $("#adminAttachmentsTab") && ($("#adminAttachmentsTab").hidden = b.dataset.adminTab !== "attachments");
  if (b.dataset.adminTab === "attachments") renderAttachmentSetup();
});
$("#newPatientBtn")?.addEventListener("click", () => { $("#patientForm").hidden = false; $("#patientForm").reset(); });
$("#cancelPatientBtn")?.addEventListener("click", () => { $("#patientForm").hidden = true; });

let orgSearchTimer;
$("#orgSearch")?.addEventListener("input", e => {
  const value = e.target.value.trim();
  $("#organizationId").value = "";
  clearTimeout(orgSearchTimer);
  orgSearchTimer = setTimeout(async () => {
    if (value.length < 2) { $("#organizationOptions").innerHTML = ""; $("#orgHint").textContent = "Type at least 2 characters to search or create a new organization."; return; }
    try {
      const out = await api(`/api/organizations?q=${encodeURIComponent(value)}`);
      organizationMatches = out.organizations || [];
      $("#organizationOptions").innerHTML = organizationMatches.map(o => `<option value="${escapeHtml(o.name)}"></option>`).join("");
      const exact = organizationMatches.find(o => o.name.toLowerCase() === value.toLowerCase());
      if (exact) { $("#organizationId").value = exact.id; $("#orgHint").textContent = `Selected existing organization: ${exact.name}. Admin approval may be required.`; }
      else $("#orgHint").textContent = organizationMatches.length ? "Select a match or keep typed name to create a new organization." : "No match found. This will create a new organization and make you admin.";
    } catch { $("#orgHint").textContent = "Could not search organizations right now."; }
  }, 250);
});
$("#orgSearch")?.addEventListener("change", e => {
  const exact = organizationMatches.find(o => o.name.toLowerCase() === e.target.value.trim().toLowerCase());
  $("#organizationId").value = exact ? exact.id : "";
});

attachLivePasswordChecklist($("#registerPassword"), $("#registerPasswordChecklist"));
attachLivePasswordChecklist($("#adminInitialPassword"), $("#adminInitialPasswordChecklist"));

$("#registerForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const body = formBody(e.target);
  if (body.termsAccepted !== "on") {
    setAuthMessage("You must agree to the TherapyAgent Terms and Conditions before creating an account.", "error");
    return;
  }
  if (!body.organizationId) delete body.organizationId;
  try {
    setAuthMessage("Creating account and MFA setup key...", "info");
    const out = await api("/api/register", { method: "POST", body: JSON.stringify(body) });
    token = out.token; localStorage.setItem("ta_token", token);
    $("#mfaSetupPanel").hidden = false;
    $("#mfaSecret").textContent = out.mfaSetup?.secret || "";
    const qrWrap = $("#mfaQrWrap");
    if (qrWrap) {
      qrWrap.innerHTML = out.mfaSetup?.qrDataUrl
        ? `<img class="mfa-qr-img" src="${out.mfaSetup.qrDataUrl}" alt="Scan this QR code with your authenticator app" width="200" height="200">`
        : `<div class="notice">QR code is not available right now. Use the setup key below.</div>`;
    }
    setAuthMessage(out.message || "Account created. Scan the QR code in Authenticator, then verify the 6-digit code.", out.status === "pending_approval" ? "warning" : "success");
  } catch (err) { setAuthMessage(err.message, "error"); }
});
$("#mfaForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try { const out = await api("/api/mfa/enable", { method: "POST", body: JSON.stringify(formBody(e.target)) }); token = out.token; localStorage.setItem("ta_token", token); setAuthMessage(out.message || "MFA enabled. Go to Login.", "success"); }
  catch (err) { setAuthMessage(err.message, "error"); }
});
$("#loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    setAuthMessage("Checking credentials...", "info");
    const out = await api("/api/login", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    token = out.token; localStorage.setItem("ta_token", token); currentUser = { ...(out.user || {}), mfaSetup: out.mfaSetup || null };
    setAuthMessage(out.message || `Welcome ${out.user.full_name}.`, "success");
    closeAuth();
    if (!isWorkspacePage) {
      window.location.href = "/workspace.html";
      return;
    }
    await loadAttachmentSetup();
    setAuthenticatedUI();
    if (currentUser.must_change_password) {
      showPasswordChangeRequiredModal();
      return;
    }
    await loadPatients();
    await refreshDashboard();
  } catch (err) { setAuthMessage(err.message, "error"); }
});
$("#forgotForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try { const out = await api("/api/password/forgot", { method: "POST", body: JSON.stringify(formBody(e.target)) }); setAuthMessage(out.message, "success"); }
  catch (err) { setAuthMessage(err.message, "error"); }
});
$("#patientForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try { await api("/api/patients", { method: "POST", body: JSON.stringify(formBody(e.target)) }); e.target.reset(); e.target.hidden = true; await loadPatients(); }
  catch (err) { alert(err.message); }
});
$("#adminAddUserForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const body = formBody(e.target);
  if (body.adminTermsAttested !== "on") {
    $("#inviteOutput").hidden = false;
    $("#inviteOutput").textContent = "You must attest that the invited user is authorized and covered by the TherapyAgent Terms and Conditions.";
    return;
  }
  const validation = passwordRuleErrors(body.initialPassword || "").length ? passwordRulesMessage() : "";
  if (validation) {
    $("#inviteOutput").hidden = false;
    $("#inviteOutput").textContent = validation;
    return;
  }
  try {
    const out = await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
    $("#inviteOutput").hidden = false;
    const emailMsg = out.invite.emailSent
      ? "Invitation email sent with the login link and temporary password."
      : `User created, but email was not sent: ${out.invite.emailError || "SMTP is not configured"}.`;
    $("#inviteOutput").textContent = `${emailMsg} Login: ${out.invite.email}. The user must change the temporary password at first login. MFA is optional.`;
    e.target.reset(); await loadAdmin();
  } catch (err) { alert(err.message); }
});

if (isPublicPage && new URLSearchParams(window.location.search).get("login") === "1") {
  setTimeout(() => openAuth("login"), 0);
}
initAuth();
