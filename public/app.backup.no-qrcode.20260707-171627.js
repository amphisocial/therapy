let token = localStorage.getItem("ta_token") || "";
let patients = [];
let organizationMatches = [];

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function panel(id) {
  $$(".sidebar button").forEach(b => b.classList.toggle("active", b.dataset.panel === id));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === id));
}

function setAuthScreen(name) {
  $$(".auth-tab").forEach(b => b.classList.toggle("active", b.dataset.authScreen === name));
  $$(".auth-screen").forEach(s => s.classList.toggle("active", s.id === `auth-${name}`));
  clearAuthMessage();
}

function openAuth(screen = "login") {
  $("#authModal").classList.add("show");
  $("#authModal").setAttribute("aria-hidden", "false");
  setAuthScreen(screen);
}

function closeAuth() {
  $("#authModal").classList.remove("show");
  $("#authModal").setAttribute("aria-hidden", "true");
}

function setAuthMessage(message, type = "info") {
  const el = $("#authMessage");
  if (!el) return;
  el.textContent = message || "";
  el.className = `auth-message ${message ? "show" : ""} ${type}`;
}

function clearAuthMessage() {
  setAuthMessage("");
}

function friendlyError(err) {
  if (!err) return "Something went wrong. Please try again.";
  if (err.message) return err.message;
  return String(err);
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
  if (!res.ok) throw new Error(data.message || data.error || "Request failed.");
  return data;
}

function formBody(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function requiredMissing(form) {
  return [...form.querySelectorAll("[required]")]
    .filter(el => !String(el.value || "").trim())
    .map(el => el.closest("label")?.firstChild?.textContent?.trim() || el.name || "Required field");
}

$$(".sidebar button").forEach(b => b.onclick = () => panel(b.dataset.panel));
$("#heroDemo")?.addEventListener("click", () => document.getElementById("workspace").scrollIntoView({ behavior: "smooth" }));
$("#openAuth")?.addEventListener("click", () => openAuth("login"));
$("#closeAuth")?.addEventListener("click", closeAuth);
$("#authModal")?.addEventListener("click", e => { if (e.target.id === "authModal") closeAuth(); });
$$(".auth-tab").forEach(b => b.addEventListener("click", () => setAuthScreen(b.dataset.authScreen)));
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
      $("#organizationOptions").innerHTML = organizationMatches
        .map(o => `<option value="${escapeHtml(o.name)}"></option>`)
        .join("");
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

$("#registerForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage(`Please complete: ${missing.join(", ")}.`, "error");

  const body = formBody(e.target);
  if (!body.organizationId) delete body.organizationId;

  try {
    setAuthMessage("Creating account and generating MFA setup…", "info");
    const out = await api("/api/register", { method: "POST", body: JSON.stringify(body) });
    token = out.token;
    localStorage.setItem("ta_token", token);

    $("#mfaSetupPanel").hidden = false;
    $("#mfaQr").src = out.mfaSetup?.qrDataUrl || "";
    $("#mfaSecret").textContent = out.mfaSetup?.secret || "";
    setAuthMessage(out.message || "Account created. Scan the MFA QR code and verify the 6-digit code.", out.status === "pending_approval" ? "warning" : "success");
  } catch (err) {
    setAuthMessage(friendlyError(err), "error");
  }
});

$("#mfaForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage("Enter the 6-digit MFA code from your authenticator app.", "error");
  try {
    const out = await api("/api/mfa/enable", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    token = out.token;
    localStorage.setItem("ta_token", token);
    setAuthMessage(out.message || "MFA enabled. Go to Login to access the workspace.", "success");
  } catch (err) {
    setAuthMessage(friendlyError(err), "error");
  }
});

$("#loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage(`Please complete: ${missing.join(", ")}.`, "error");

  try {
    setAuthMessage("Checking credentials…", "info");
    const out = await api("/api/login", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    token = out.token;
    localStorage.setItem("ta_token", token);
    setAuthMessage(out.message || `Logged in as ${out.user.email}.`, "success");
    setTimeout(closeAuth, 650);
    await refreshPatients();
  } catch (err) {
    setAuthMessage(friendlyError(err), "error");
  }
});

$("#forgotForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const missing = requiredMissing(e.target);
  if (missing.length) return setAuthMessage("Enter your login/email to start password recovery.", "error");
  try {
    const out = await api("/api/password/forgot", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    setAuthMessage(out.message || "If an account exists, reset instructions will be sent.", "success");
  } catch (err) {
    setAuthMessage(friendlyError(err), "error");
  }
});

async function refreshPatients() {
  if (!token) return;
  try {
    const out = await api("/api/patients");
    patients = out.patients || [];
    $("#patientList").innerHTML = patients.map(p => `<div class="row"><strong>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</strong><span>${escapeHtml(p.diagnosis || "No diagnosis entered")}</span></div>`).join("");
    $$(".patientSelect").forEach(sel => {
      sel.innerHTML = patients.map(p => `<option value="${p.id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</option>`).join("");
    });
  } catch (e) {
    console.warn(e.message);
  }
}

$("#patientForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/patients", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    e.target.reset();
    await refreshPatients();
    alert("Patient added.");
  } catch (err) { alert(friendlyError(err)); }
});

$("#sessionForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/session-logs", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    alert("Session log saved.");
  } catch (err) { alert(friendlyError(err)); }
});

$("#behaviorForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/behavior-events", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    alert("Behavior event saved.");
  } catch (err) { alert(friendlyError(err)); }
});

$("#planForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const body = formBody(e.target);
  for (const k of ["goals", "interventions", "restrictions"]) {
    try { body[k] = body[k] ? JSON.parse(body[k]) : []; } catch { body[k] = []; }
  }
  try {
    await api("/api/therapy-plans", { method: "POST", body: JSON.stringify(body) });
    alert("Therapy plan saved.");
  } catch (err) { alert(friendlyError(err)); }
});

$("#reportForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const out = await api("/api/ai/session-summary", { method: "POST", body: JSON.stringify(formBody(e.target)) });
    $("#reportOutput").textContent = out.output || JSON.stringify(out.report, null, 2);
  } catch (err) { $("#reportOutput").textContent = friendlyError(err); }
});

function startVoice(targetId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert("Browser speech recognition is not supported in this browser.");
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  const target = document.getElementById(targetId);
  rec.onresult = ev => {
    let text = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) text += ev.results[i][0].transcript;
    target.value = (target.value + " " + text).trim();
  };
  rec.start();
  setTimeout(() => rec.stop(), 30000);
}

$$(".mic").forEach(b => b.onclick = () => startVoice(b.dataset.target));

$("#seedDemo")?.addEventListener("click", async () => {
  if (!token) return openAuth("login");
  await api("/api/patients", { method: "POST", body: JSON.stringify({ first_name: "Demo", last_name: "Client", diagnosis: "ASD support program", guardian_name: "Caregiver" }) });
  await refreshPatients();
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refreshPatients();
