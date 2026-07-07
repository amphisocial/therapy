let token = localStorage.getItem("ta_token") || "";
let patients = [];

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function panel(id){
  $$(".sidebar button").forEach(b => b.classList.toggle("active", b.dataset.panel === id));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === id));
}
$$(".sidebar button").forEach(b => b.onclick = () => panel(b.dataset.panel));
$("#heroDemo").onclick = () => document.getElementById("workspace").scrollIntoView({behavior:"smooth"});
$("#openAuth").onclick = () => $("#authModal").classList.add("show");
$("#closeAuth").onclick = () => $("#authModal").classList.remove("show");

async function api(path, opts={}){
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type":"application/json", ...(opts.headers||{}), ...(token ? {Authorization:`Bearer ${token}`} : {}) }
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}

$("#registerForm").onsubmit = async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try{
    const out = await api("/api/register", {method:"POST", body:JSON.stringify(body)});
    token = out.token; localStorage.setItem("ta_token", token);
    $("#authOutput").textContent = "Registered. Save this MFA secret for setup:\n" + JSON.stringify(out.mfaSetup, null, 2);
    await refreshPatients();
  } catch(err){ $("#authOutput").textContent = err.message; }
};
$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try{
    const out = await api("/api/login", {method:"POST", body:JSON.stringify(body)});
    token = out.token; localStorage.setItem("ta_token", token);
    $("#authOutput").textContent = "Logged in as " + out.user.email;
    await refreshPatients();
  } catch(err){ $("#authOutput").textContent = err.message; }
};


$("#mfaForm").onsubmit = async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try{
    const out = await api("/api/mfa/enable", {method:"POST", body:JSON.stringify(body)});
    token = out.token; localStorage.setItem("ta_token", token);
    $("#authOutput").textContent = "MFA enabled. Patient records are now accessible.";
    await refreshPatients();
  } catch(err){ $("#authOutput").textContent = err.message; }
};

async function refreshPatients(){
  if(!token) return;
  try{
    const out = await api("/api/patients");
    patients = out.patients || [];
    $("#patientList").innerHTML = patients.map(p => `<div class="row"><strong>${p.first_name} ${p.last_name}</strong><span>${p.diagnosis || "No diagnosis entered"}</span></div>`).join("");
    $$(".patientSelect").forEach(sel => {
      sel.innerHTML = patients.map(p => `<option value="${p.id}">${p.first_name} ${p.last_name}</option>`).join("");
    });
  }catch(e){ console.warn(e); }
}
$("#patientForm").onsubmit = async e => {
  e.preventDefault();
  try{ await api("/api/patients", {method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))}); e.target.reset(); await refreshPatients(); }
  catch(err){ alert(err.message); }
};
$("#sessionForm").onsubmit = async e => {
  e.preventDefault();
  try{ await api("/api/session-logs", {method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))}); alert("Session log saved."); }
  catch(err){ alert(err.message); }
};
$("#behaviorForm").onsubmit = async e => {
  e.preventDefault();
  try{ await api("/api/behavior-events", {method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))}); alert("Behavior event saved."); }
  catch(err){ alert(err.message); }
};
$("#planForm").onsubmit = async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  for (const k of ["goals","interventions","restrictions"]) {
    try { body[k] = body[k] ? JSON.parse(body[k]) : []; } catch { body[k] = []; }
  }
  try{ await api("/api/therapy-plans", {method:"POST", body:JSON.stringify(body)}); alert("Therapy plan saved."); }
  catch(err){ alert(err.message); }
};
$("#reportForm").onsubmit = async e => {
  e.preventDefault();
  try{
    const out = await api("/api/ai/session-summary", {method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});
    $("#reportOutput").textContent = out.output || JSON.stringify(out.report, null, 2);
  } catch(err){ $("#reportOutput").textContent = err.message; }
};

function startVoice(targetId){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition) return alert("Browser speech recognition is not supported in this browser.");
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  const target = document.getElementById(targetId);
  rec.onresult = ev => {
    let text = "";
    for(let i=ev.resultIndex; i<ev.results.length; i++) text += ev.results[i][0].transcript;
    target.value = (target.value + " " + text).trim();
  };
  rec.start();
  setTimeout(()=>rec.stop(), 30000);
}
$$(".mic").forEach(b => b.onclick = () => startVoice(b.dataset.target));

$("#seedDemo").onclick = async () => {
  if(!token) return $("#authModal").classList.add("show");
  await api("/api/patients", {method:"POST", body:JSON.stringify({first_name:"Demo",last_name:"Client",diagnosis:"ASD support program",guardian_name:"Caregiver"})});
  await refreshPatients();
};
refreshPatients();
