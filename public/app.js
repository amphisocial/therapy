let token = localStorage.getItem("ta_token") || "";
let currentUser = null;
let currentPermissions = {};
let patients = [];
let organizationMatches = [];
let activeRecognition = null;
let activeVoice = null;
let rolePermissions = {};
let selectedRole = "org_admin";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const PERMISSION_LABELS = {
  view_patients: "Can view patients",
  edit_patients: "Can add/edit patients",
  record_sessions: "Can record sessions",
  record_behavior_events: "Can record behavior events",
  create_therapy_plans: "Can create therapy plans",
  approve_plans: "Can approve/sign plans",
  create_incidents: "Can create incidents",
  generate_reports: "Can generate AI reports",
  sign_records: "Can sign records",
  manage_users: "Can manage users",
  manage_roles: "Can manage roles",
  view_audit: "Can view audit"
};

function panel(id) {
  $$(".sidebar button").forEach(b => b.classList.toggle("active", b.dataset.panel === id));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === id));
  if (id === "admin") loadAdmin();
}

function setAuthScreen(name) {
  $$(".auth-tab").forEach(b => b.classList.toggle("active", b.dataset.authScreen === name));
  $$(".auth-screen").forEach(s => s.classList.toggle("active", s.id === `auth-${name}`));
  clearAuthMessage();
}

function openAuth(screen = "login") {
  $("#authModal")?.classList.add("show");
  $("#authModal")?.setAttribute("aria-hidden", "false");
  setAuthScreen(screen);
}

function closeAuth() {
  $("#authModal")?.classList.remove("show");
  $("#authModal")?.setAttribute("aria-hidden", "true");
}

function setAuthMessage(message, type = "info") {
  const el = $("#authMessage");
  if (!el) return;
  el.textContent = message || "";
  el.className = `auth-message ${message ? "show" : ""} ${type}`;
  if (message) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function clearAuthMessage() { setAuthMessage(""); }
function friendlyError(err) { return err?.message || String(err || "Something went wrong. Please try again."); }

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
  if (!res.ok) throw new Error(data.message || data.error || "Request failed.");
  return data;
}

function formBody(form) { return Object.fromEntries(new FormData(form).entries()); }
function requiredMissing(form) {
  return [...form.querySelectorAll("[required]")]
    .filter(el => !String(el.value || "").trim())
    .map(el => el.closest("label")?.firstChild?.textContent?.trim() || el.placeholder || el.name || "Required field");
}
function setField(form, name, value, overwrite = false) {
  if (value === undefined || value === null || value === "") return;
  const el = form.querySelector(`[name="${CSS.escape(name)}"]`) || document.getElementById(name);
  if (!el) return;
  if (!overwrite && String(el.value || "").trim()) return;
  el.value = value;
}
function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function updateAuthState() {
  document.body.classList.toggle("authenticated", Boolean(currentUser && token && currentUser.mfa_enabled));
  const area = $("#authArea");
  if (!area) return;
  if (currentUser && token && currentUser.mfa_enabled) {
    area.innerHTML = `<span class="welcome">Welcome ${escapeHtml(currentUser.full_name || currentUser.email)}</span><button id="logoutBtn" class="btn small secondary" type="button">Logoff</button>`;
    $("#logoutBtn")?.addEventListener("click", logout);
    $("#workspaceWelcome").textContent = `Logged in as ${currentUser.full_name} (${currentUser.role}).`;
  } else {
    area.innerHTML = `<button id="openAuth" class="btn small" type="button">Login</button>`;
    $("#openAuth")?.addEventListener("click", () => openAuth("login"));
  }
}

function logout() {
  token = ""; currentUser = null; currentPermissions = {}; patients = [];
  localStorage.removeItem("ta_token");
  updateAuthState();
  renderPatients();
  openAuth("login");
}

async function loadMe() {
  if (!token) { updateAuthState(); return; }
  try {
    const out = await api("/api/me");
    currentUser = out.user;
    currentPermissions = out.permissions || {};
    updateAuthState();
    if (currentUser?.mfa_enabled) await refreshPatients();
  } catch {
    logout();
  }
}

$$('.sidebar button').forEach(b => b.onclick = () => panel(b.dataset.panel));
$("#heroDemo")?.addEventListener("click", () => document.getElementById("workspace").scrollIntoView({ behavior: "smooth" }));
$("#openAuth")?.addEventListener("click", () => openAuth("login"));
$("#closeAuth")?.addEventListener("click", closeAuth);
$("#authModal")?.addEventListener("click", e => { if (e.target.id === "authModal") closeAuth(); });
$$('.auth-tab').forEach(b => b.addEventListener("click", () => setAuthScreen(b.dataset.authScreen)));
$("#goLoginAfterMfa")?.addEventListener("click", () => setAuthScreen("login"));

let orgSearchTimer;
$("#orgSearch")?.addEventListener("input", e => {
  const value = e.target.value.trim();
  $("#organizationId").value = "";
  clearTimeout(orgSearchTimer);
  orgSearchTimer = setTimeout(async () => {
    if (value.length < 2) {
      organizationMatches = [];
      $("#organizationOptions").innerHTML = "";
      $("#orgHint").textContent = "Type at least 2 characters to search for an existing organization.";
      return;
    }
    try {
      const out = await api(`/api/organizations?q=${encodeURIComponent(value)}`);
      organizationMatches = out.organizations || [];
      $("#organizationOptions").innerHTML = organizationMatches.map(o => `<option value="${escapeHtml(o.name)}"></option>`).join("");
      const exact = organizationMatches.find(o => o.name.toLowerCase() === value.toLowerCase());
      if (exact) {
        $("#organizationId").value = exact.id;
        $("#orgHint").textContent = `Selected existing organization: ${exact.name}. New account requests may require admin approval.`;
      } else if (organizationMatches.length) {
        $("#orgHint").textContent = "Select a matching organization from the list, or keep your typed name to create a new organization.";
      } else {
        $("#orgHint").textContent = "No existing organization found. This will create a new organization and make you the org admin.";
      }
    } catch {
      $("#orgHint").textContent = "Could not search organizations right now. You can still enter a new organization name.";
    }
  }, 250);
});
$("#orgSearch")?.addEventListener("change", e => {
  const value = e.target.value.trim();
  const exact = organizationMatches.find(o => o.name.toLowerCase() === value.toLowerCase());
  $("#organizationId").value = exact ? exact.id : "";
});

function showMfaSetup(mfaSetup = {}) {
  const panel = $("#mfaSetupPanel");
  panel.hidden = false;
  $("#mfaSecret").textContent = mfaSetup.secret || "";
  const link = $("#mfaSetupLink");
  if (link) {
    link.href = mfaSetup.otpauth_url || "#";
    link.hidden = !mfaSetup.otpauth_url;
  }
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

$("#registerForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage(`Please complete: ${missing.join(", ")}.`, "error");
  const body = formBody(e.target);
  if (!body.organizationId) delete body.organizationId;
  try {
    setAuthMessage("Creating account and generating MFA setup…", "info");
    const out = await api("/api/register", { method: "POST", body: JSON.stringify(body) });
    token = out.token; localStorage.setItem("ta_token", token);
    currentUser = out.user; updateAuthState(); showMfaSetup(out.mfaSetup);
    setAuthMessage(out.message || "Account created. Manually enter the MFA setup key and verify the 6-digit code.", out.status === "pending_approval" ? "warning" : "success");
  } catch (err) { setAuthMessage(friendlyError(err), "error"); }
});

$("#mfaForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage("Enter the 6-digit MFA code from your authenticator app.", "error");
  try {
    const out = await api("/api/mfa/enable", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    token = out.token; localStorage.setItem("ta_token", token); currentUser = out.user; updateAuthState();
    setAuthMessage(out.message || "MFA enabled. Go to Login to access the workspace.", "success");
  } catch (err) { setAuthMessage(friendlyError(err), "error"); }
});

$("#loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage(`Please complete: ${missing.join(", ")}.`, "error");
  try {
    setAuthMessage("Checking credentials…", "info");
    const out = await api("/api/login", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    token = out.token; localStorage.setItem("ta_token", token); currentUser = out.user; currentPermissions = out.permissions || {};
    if (out.mfaSetupRequired) {
      showMfaSetup(out.mfaSetup);
      setAuthScreen("register");
      setAuthMessage(out.message, "warning");
      return;
    }
    updateAuthState();
    setAuthMessage(out.message || `Logged in as ${out.user.email}.`, "success");
    setTimeout(closeAuth, 650);
    await refreshPatients();
    panel("dashboard");
  } catch (err) { setAuthMessage(friendlyError(err), "error"); }
});

$("#forgotForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage("Enter your login/email to start password recovery.", "error");
  try {
    const out = await api("/api/password/forgot", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    setAuthMessage(out.message || "If an account exists, reset instructions will be sent.", "success");
  } catch (err) { setAuthMessage(friendlyError(err), "error"); }
});

async function refreshPatients() {
  if (!token || !currentUser?.mfa_enabled) return;
  try {
    const out = await api("/api/patients");
    patients = out.patients || [];
    renderPatients();
  } catch (e) { console.warn(e.message); }
}
function renderPatients() {
  $("#metricPatients") && ($("#metricPatients").textContent = patients.length ? String(patients.length) : "—");
  $("#patientList") && ($("#patientList").innerHTML = patients.map(p => `<div class="row"><strong>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</strong><span>${escapeHtml(p.diagnosis || "No diagnosis entered")}</span></div>`).join(""));
  $$(".patientSelect").forEach(sel => {
    sel.innerHTML = patients.length ? patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</option>`).join("") : `<option value="">No patients loaded</option>`;
  });
}

async function extractAndFill(formName, form, text, overwrite = false) {
  if (!text || !String(text).trim()) return;
  try {
    const out = await api("/api/ai/extract-fields", { method: "POST", body: JSON.stringify({ form: formName, text }) });
    Object.entries(out.fields || {}).forEach(([name, value]) => setField(form, name, value, overwrite));
    toast(out.message || "Voice note mapped into available fields. Review before saving.");
  } catch (e) { toast(friendlyError(e), "error"); }
}

function formRawText(formName, form) {
  if (formName === "session") return form.progress_notes?.value || "";
  if (formName === "behavior") return form.notes?.value || "";
  if (formName === "incident") return form.description?.value || "";
  if (formName === "plan") return $("#plan_voice")?.value || "";
  if (formName === "report") return form.note?.value || "";
  return "";
}

function getFormByName(formName) {
  return { session: $("#sessionForm"), behavior: $("#behaviorForm"), incident: $("#incidentForm"), plan: $("#planForm"), report: $("#reportForm") }[formName];
}

function setVoiceStatus(formName, text, recording = false) {
  const id = `${formName}VoiceStatus`;
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  const start = $(`.mic[data-form="${formName}"]`);
  const stop = $(`.stop-mic[data-form="${formName}"]`);
  if (start) { start.textContent = recording ? "Recording…" : "Start voice"; start.disabled = recording; }
  if (stop) stop.disabled = !recording;
}

function startVoice(formName, targetId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert("Browser speech recognition is not supported in this browser.");
  if (activeRecognition) activeRecognition.stop();
  const rec = new SpeechRecognition();
  const target = document.getElementById(targetId);
  const original = target.value.trim();
  let finalText = original;
  rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
  rec.onresult = ev => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText = `${finalText} ${piece}`.trim(); else interim += piece;
    }
    target.value = `${finalText} ${interim}`.trim();
  };
  rec.onerror = ev => { setVoiceStatus(formName, `Voice error: ${ev.error || "unknown"}`); };
  rec.onend = async () => {
    const stopped = activeRecognition === rec;
    activeRecognition = null; activeVoice = null; setVoiceStatus(formName, "Recording stopped. Mapping clear facts into fields for review…", false);
    if (stopped) await extractAndFill(formName, getFormByName(formName), target.value, false);
  };
  activeRecognition = rec; activeVoice = { formName, targetId };
  rec.start();
  setVoiceStatus(formName, "Recording. Click Stop when finished.", true);
}
function stopVoice(formName) { if (activeRecognition && (!formName || activeVoice?.formName === formName)) activeRecognition.stop(); }
$$('.mic').forEach(b => b.onclick = () => startVoice(b.dataset.form, b.dataset.target));
$$('.stop-mic').forEach(b => b.onclick = () => stopVoice(b.dataset.form));

function toast(message, type = "success") {
  const div = document.createElement("div");
  div.className = `toast ${type}`; div.textContent = message; document.body.appendChild(div);
  setTimeout(() => div.remove(), 4200);
}

$("#patientForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try { await api("/api/patients", { method: "POST", body: JSON.stringify(formBody(e.target)) }); e.target.reset(); await refreshPatients(); toast("Patient added."); }
  catch (err) { toast(friendlyError(err), "error"); }
});

$("#sessionForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const raw = formRawText("session", e.target);
  if (raw) await extractAndFill("session", e.target, raw, false);
  try { const out = await api("/api/session-logs", { method: "POST", body: JSON.stringify(formBody(e.target)) }); toast(out.message || "Session log saved."); }
  catch (err) { toast(friendlyError(err), "error"); }
});

$("#behaviorForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const raw = formRawText("behavior", e.target);
  if (raw) await extractAndFill("behavior", e.target, raw, false);
  try { const out = await api("/api/behavior-events", { method: "POST", body: JSON.stringify(formBody(e.target)) }); toast(out.message || "Behavior event saved."); }
  catch (err) { toast(friendlyError(err), "error"); }
});

$("#incidentForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const raw = formRawText("incident", e.target);
  if (raw) await extractAndFill("incident", e.target, raw, false);
  try { const out = await api("/api/incidents", { method: "POST", body: JSON.stringify(formBody(e.target)) }); toast(out.message || "Incident saved."); }
  catch (err) { toast(friendlyError(err), "error"); }
});

$("#planForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const raw = formRawText("plan", e.target);
  if (raw) await extractAndFill("plan", e.target, raw, false);
  const body = formBody(e.target);
  for (const k of ["goals", "interventions", "restrictions"]) { try { body[k] = body[k] ? JSON.parse(body[k]) : []; } catch { body[k] = []; } }
  try { const out = await api("/api/therapy-plans", { method: "POST", body: JSON.stringify(body) }); toast(out.message || "Therapy plan saved."); }
  catch (err) { toast(friendlyError(err), "error"); }
});

$("#reportForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const raw = formRawText("report", e.target);
  if (raw) await extractAndFill("report", e.target, raw, false);
  try { const out = await api("/api/ai/session-summary", { method: "POST", body: JSON.stringify(formBody(e.target)) }); $("#reportOutput").textContent = out.output || JSON.stringify(out.report, null, 2); }
  catch (err) { $("#reportOutput").textContent = friendlyError(err); }
});

$("#seedDemo")?.addEventListener("click", async () => {
  if (!token) return openAuth("login");
  try { await api("/api/patients", { method: "POST", body: JSON.stringify({ first_name: "Demo", last_name: "Client", diagnosis: "ASD support program", guardian_name: "Caregiver" }) }); await refreshPatients(); toast("Demo patient added."); }
  catch (err) { toast(friendlyError(err), "error"); }
});

$$('.admin-tab').forEach(b => b.addEventListener("click", () => {
  $$('.admin-tab').forEach(x => x.classList.toggle("active", x === b));
  $$('.admin-panel').forEach(p => p.classList.toggle("active", p.id === `admin-${b.dataset.adminTab}`));
}));

async function loadAdmin() {
  if (!currentUser?.mfa_enabled || currentUser.role !== "org_admin") { $("#adminNotice").textContent = "Only org admins can manage users and roles."; return; }
  $("#adminNotice").textContent = "Manage users, activation, password reset, roles, and role permissions for this organization.";
  await Promise.all([loadUsers(), loadRolePermissions()]);
}

async function loadUsers() {
  try {
    const out = await api("/api/admin/users");
    $("#userRows").innerHTML = (out.users || []).map(u => `
      <tr data-user-id="${u.id}">
        <td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.email)}</td>
        <td><select class="roleSelect">${["org_admin","bcba","supervisor","therapist","rbt","billing_auditor","read_only"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td>${u.mfa_enabled ? "Enabled" : "Not enrolled"}</td><td>${u.active ? "Active" : "Inactive"}</td>
        <td><button class="btn small saveUser" type="button">Save</button> <button class="btn small secondary toggleUser" type="button">${u.active ? "Deactivate" : "Activate"}</button> <button class="btn small secondary resetUser" type="button">Reset password</button></td>
      </tr>`).join("");
  } catch (e) { toast(friendlyError(e), "error"); }
}

$("#adminUserForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return toast(`Please complete: ${missing.join(", ")}.`, "error");
  try {
    const out = await api("/api/admin/users", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    e.target.reset(); await loadUsers();
    const inv = out.invite || {};
    $("#inviteOutput").hidden = false;
    $("#inviteOutput").innerHTML = `<strong>Invite generated for ${escapeHtml(inv.email || "user")}</strong><br>Temporary password: <code>${escapeHtml(inv.temporaryPassword || "")}</code><br>MFA setup key: <code>${escapeHtml(inv.mfaSetup?.secret || "")}</code><br>${escapeHtml(inv.message || "")}`;
  } catch (err) { toast(friendlyError(err), "error"); }
});

$("#userRows")?.addEventListener("click", async e => {
  const tr = e.target.closest("tr[data-user-id]"); if (!tr) return;
  const id = tr.dataset.userId;
  try {
    if (e.target.classList.contains("saveUser")) {
      const role = tr.querySelector(".roleSelect").value;
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      toast("User role updated."); await loadUsers();
    }
    if (e.target.classList.contains("toggleUser")) {
      const active = e.target.textContent.trim() === "Activate";
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      toast(active ? "User activated." : "User deactivated."); await loadUsers();
    }
    if (e.target.classList.contains("resetUser")) {
      const out = await api(`/api/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({}) });
      $("#inviteOutput").hidden = false;
      $("#inviteOutput").innerHTML = `<strong>Password reset for ${escapeHtml(out.user.email)}</strong><br>Temporary password: <code>${escapeHtml(out.temporaryPassword)}</code><br>MFA setup key: <code>${escapeHtml(out.mfaSetup?.secret || "")}</code><br>${escapeHtml(out.message || "")}`;
    }
  } catch (err) { toast(friendlyError(err), "error"); }
});

async function loadRolePermissions() {
  try {
    const out = await api("/api/admin/role-permissions");
    rolePermissions = out.permissions || {};
    renderRoleMatrix();
  } catch (e) { toast(friendlyError(e), "error"); }
}
function renderRoleMatrix() {
  const roles = Object.keys(rolePermissions);
  $("#roleMatrix").innerHTML = `<div class="role-picker">${roles.map(r => `<button class="role-pick ${r === selectedRole ? "active" : ""}" data-role="${r}" type="button">${r}</button>`).join("")}</div><div class="perm-grid">${Object.entries(PERMISSION_LABELS).map(([key, label]) => `<label><input type="checkbox" data-perm="${key}" ${rolePermissions[selectedRole]?.[key] ? "checked" : ""}> ${label}</label>`).join("")}</div>`;
}
$("#roleMatrix")?.addEventListener("click", e => { const b = e.target.closest(".role-pick"); if (b) { selectedRole = b.dataset.role; renderRoleMatrix(); } });
$("#saveRolePermissions")?.addEventListener("click", async () => {
  const permissions = {};
  $$("#roleMatrix [data-perm]").forEach(cb => permissions[cb.dataset.perm] = cb.checked);
  try { const out = await api("/api/admin/role-permissions", { method: "PUT", body: JSON.stringify({ role: selectedRole, permissions }) }); rolePermissions = out.permissions || rolePermissions; toast(out.message || "Role permissions saved."); renderRoleMatrix(); }
  catch (err) { toast(friendlyError(err), "error"); }
});

loadMe();
