/*!
 * TherapyAgent — BCBA Chat, rebuilt.
 * Loaded after app.js (and after dashboard.js/charts.js, order doesn't matter
 * between those two). Like dashboard.js, this file does NOT edit app.js —
 * it overrides `window.loadBcbaChat`, `window.renderBcbaChatMessages`, and
 * `window.sendBcbaChatMessage` after app.js has defined them. Every call
 * site in app.js (panel switching, "New chat", patient-switch, etc.) looks
 * these up by name at call time, so the override takes effect everywhere.
 *
 * It reuses app.js's session storage helpers (loadBcbaChatState,
 * saveBcbaChatState, startNewBcbaChatSession, switchBcbaChatSession,
 * deleteBcbaChatSession, bcbaChatSessionListHtml, generateIspFromBcbaChat,
 * openResourceDetail, panel, api, escapeHtml, setMessage) rather than
 * reimplementing them — those are plain top-level function declarations in
 * app.js's classic script, so they're safe to call from here.
 *
 * New capability: while chatting, a BCBA can say "log a session for this
 * patient" / "create an incident report" / "add a behavior event" /
 * "draft a therapy plan", and the assistant asks only for what's still
 * missing (using the app's existing local field-extraction endpoint,
 * /api/ai/extract-fields, which works with or without an LLM configured),
 * then creates the record as a draft via the app's existing REST endpoints
 * — nothing is finalized without the clinician opening and submitting it
 * for review, same as records created through the forms.
 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const now = () => new Date().toISOString();
  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? "" : s));

  // ---------------------------------------------------------------------
  // Lean field schema for guided record creation (a small, targeted subset
  // of each form's full field list — required fields plus the handful of
  // fields that make the record actually useful). Anything left blank
  // stays editable in the normal form before the record is submitted for
  // review, since everything created here lands as a draft.
  // ---------------------------------------------------------------------
  const RECORD_DEFS = {
    sessions: {
      label: "Session Log", endpoint: "/api/sessions", singular: "session", panel: "sessions",
      verbs: ["log", "create", "add", "record", "start", "file"],
      nouns: ["session log", "session note", "session"],
      target: [
        { name: "session_date", label: "the session date" },
        { name: "location", label: "the location" },
        { name: "activities", label: "what activities/goals were worked on" },
        { name: "response_to_intervention", label: "how the client responded" }
      ]
    },
    behaviors: {
      label: "Behavior Event", endpoint: "/api/behaviors", singular: "behavior", panel: "behaviors",
      verbs: ["log", "create", "add", "record", "report", "file"],
      nouns: ["behavior event", "behavior incident", "behavior"],
      target: [
        { name: "behavior", label: "the behavior observed" },
        { name: "antecedent", label: "what happened right before (antecedent)" },
        { name: "consequence", label: "what happened right after (consequence)" },
        { name: "intensity", label: "intensity, 1 to 5" }
      ]
    },
    incidents: {
      label: "Incident", endpoint: "/api/incidents", singular: "incident", panel: "incidents",
      verbs: ["log", "create", "add", "record", "report", "file", "open"],
      nouns: ["incident report", "incident"],
      target: [
        { name: "category", label: "the incident category" },
        { name: "severity", label: "severity — low, medium, high, or critical" },
        { name: "description", label: "what happened" },
        { name: "immediate_actions", label: "immediate actions taken" }
      ]
    },
    plans: {
      label: "Therapy Plan", endpoint: "/api/plans", singular: "plan", panel: "plans",
      verbs: ["draft", "create", "write", "start", "add"],
      nouns: ["therapy plan", "behavior support plan", "behavior plan", "treatment plan"],
      target: [
        { name: "title", label: "a title for the plan" },
        { name: "goals", label: "the goals" },
        { name: "interventions", label: "the planned interventions" }
      ]
    }
  };

  function detectRecordIntent(text) {
    const t = String(text || "").toLowerCase();
    if (!/\b(log|create|add|record|report|file|draft|write|start|open)\b/.test(t)) return null;
    for (const [key, def] of Object.entries(RECORD_DEFS)) {
      for (const noun of def.nouns) {
        if (t.includes(noun)) return key;
      }
    }
    return null;
  }
  function isCancelPhrase(text) {
    return /\b(cancel|never\s?mind|nevermind|forget it|stop that|skip it)\b/i.test(String(text || ""));
  }

  // ---------------------------------------------------------------------
  // Speech (Web Speech API) — dictation + hands-free voice mode
  //
  // Voice mode is a small explicit state machine, on purpose: the browser's
  // built-in "stop listening after a pause" behavior is unreliable and cuts
  // people off mid-sentence, then the assistant starts speaking over them.
  // Instead the user always gives an explicit start/stop signal:
  //   off -> ready -> listening -> (user taps Stop) -> thinking -> speaking -> ready
  // The assistant only ever speaks after the user has explicitly stopped
  // listening, and the mic is fully stopped while it speaks so it can't
  // pick up its own voice or talk over the user.
  // ---------------------------------------------------------------------
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const speechSupported = !!SpeechRecognitionCtor;
  const ttsSupported = "speechSynthesis" in window;

  let recognizer = null;
  let dictating = false;              // single push-to-talk dictation into the input
  let voicePhase = "off";             // off | ready | listening | thinking | speaking
  let voiceFinalText = "";
  let preferredVoice = null;

  function pickVoice() {
    if (!ttsSupported) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    preferredVoice =
      voices.find((v) => /en-US/i.test(v.lang) && /Natural|Neural|Google US English/i.test(v.name)) ||
      voices.find((v) => /en-US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      voices[0] || null;
    return preferredVoice;
  }
  if (ttsSupported) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  function cleanForSpeech(text) {
    return String(text || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/[#*_`>]/g, "")
      .replace(/^-{1,}\s*/gm, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, ". ")
      .trim();
  }

  function setVoiceStatus(text, cls) {
    const el = $("#tacVoiceStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = `tac-voice-status ${cls || ""}`.trim();
    el.hidden = !text;
  }

  function stopRecognition() {
    if (!recognizer) return;
    recognizer.onend = null; // don't let the stale handler auto-restart/react
    try { recognizer.stop(); } catch {}
  }

  function speak(text, onDone) {
    if (!ttsSupported || !text) { onDone && onDone(); return; }
    try { window.speechSynthesis.cancel(); } catch {}
    const utter = new SpeechSynthesisUtterance(cleanForSpeech(text));
    if (preferredVoice) utter.voice = preferredVoice;
    utter.rate = 1.02;
    utter.pitch = 1;
    utter.onend = utter.onerror = () => onDone && onDone();
    window.speechSynthesis.speak(utter);
  }

  function ensureRecognizer() {
    if (!speechSupported) return null;
    if (recognizer) return recognizer;
    recognizer = new SpeechRecognitionCtor();
    recognizer.lang = "en-US";
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    return recognizer;
  }

  // Single dictation into the textbox (does not auto-send). Continuous mode
  // + explicit stop, so it doesn't cut a sentence off during a short pause.
  function toggleDictation() {
    if (!speechSupported) {
      setVoiceStatus("Voice input isn't supported in this browser. Try Chrome or Edge.", "error");
      return;
    }
    if (dictating) { stopRecognition(); dictating = false; updateMicButton(); setVoiceStatus("", ""); return; }
    if (voicePhase !== "off") exitVoiceMode();
    const rec = ensureRecognizer();
    rec.continuous = true;
    const input = $("#bcbaChatInput");
    const baseText = input ? input.value : "";
    dictating = true;
    updateMicButton();
    setVoiceStatus("Listening… tap the mic again when you're done.", "listening");
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += (finalText ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      if (input) { input.value = [baseText, finalText, interim].filter(Boolean).join(" "); autoResize(input); }
    };
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      dictating = false; updateMicButton();
      setVoiceStatus(`Mic error: ${esc(ev.error || "unknown")}.`, "error");
    };
    rec.onend = () => { if (dictating) { try { rec.start(); } catch { dictating = false; updateMicButton(); } } };
    try { rec.start(); } catch { dictating = false; updateMicButton(); }
  }

  function updateMicButton() {
    const btn = $("#bcbaChatMicBtn");
    if (btn) btn.classList.toggle("active", dictating);
  }

  // ---- Hands-free voice mode: explicit start/stop, no auto-endpointing ----
  function renderVoiceControls() {
    const btn = $("#tacVoiceModeBtn");
    const exitBtn = $("#tacVoiceExitBtn");
    if (!btn) return;
    if (exitBtn) exitBtn.hidden = voicePhase === "off";
    btn.disabled = voicePhase === "thinking";
    btn.classList.toggle("active", voicePhase === "listening");
    switch (voicePhase) {
      case "off": btn.textContent = "🎙️ Talk"; setVoiceStatus("", ""); break;
      case "ready": btn.textContent = "🎤 Tap to speak"; setVoiceStatus("Voice chat on — tap the mic, talk, then tap it again when you're done.", "ready"); break;
      case "listening": btn.textContent = "⏹ Stop & send"; setVoiceStatus("Listening… tap Stop when you're finished talking.", "listening"); break;
      case "thinking": btn.textContent = "…"; setVoiceStatus("Thinking…", "thinking"); break;
      case "speaking": btn.textContent = "🎤 Tap to interrupt"; setVoiceStatus("Speaking… tap the mic to interrupt and reply.", "speaking"); break;
    }
  }

  function enterVoiceMode() {
    if (!speechSupported || !ttsSupported) {
      setVoiceStatus("Hands-free voice chat needs speech recognition and speech synthesis, which this browser doesn't fully support. Try Chrome or Edge.", "error");
      return;
    }
    if (dictating) { stopRecognition(); dictating = false; updateMicButton(); }
    voicePhase = "ready";
    renderVoiceControls();
  }

  function exitVoiceMode() {
    stopRecognition();
    try { window.speechSynthesis.cancel(); } catch {}
    voicePhase = "off";
    renderVoiceControls();
  }

  function startListening() {
    const rec = ensureRecognizer();
    rec.continuous = true;
    voiceFinalText = "";
    const input = $("#bcbaChatInput");
    if (input) { input.value = ""; autoResize(input); }
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) voiceFinalText += (voiceFinalText ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      if (input) { input.value = [voiceFinalText, interim].filter(Boolean).join(" "); autoResize(input); }
    };
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return; // keep listening, user controls stop
      setVoiceStatus(`Mic error: ${esc(ev.error || "unknown")}. Tap the mic to try again.`, "error");
      voicePhase = "ready";
      renderVoiceControls();
    };
    // Some browsers end recognition on their own after a long pause even in
    // continuous mode; if the user hasn't tapped Stop yet, just restart
    // quietly so it never silently drops out of listening.
    rec.onend = () => { if (voicePhase === "listening") { try { rec.start(); } catch {} } };
    voicePhase = "listening";
    renderVoiceControls();
    try { rec.start(); } catch { voicePhase = "ready"; renderVoiceControls(); }
  }

  function stopListeningAndSend() {
    stopRecognition();
    const input = $("#bcbaChatInput");
    const text = (input?.value || "").trim();
    if (!text) { voicePhase = "ready"; renderVoiceControls(); return; }
    voicePhase = "thinking";
    renderVoiceControls();
    submitChat();
  }

  function interruptSpeaking() {
    try { window.speechSynthesis.cancel(); } catch {}
    startListening();
  }

  function onVoiceModeBtnClick() {
    if (voicePhase === "off") return enterVoiceMode();
    if (voicePhase === "ready") return startListening();
    if (voicePhase === "listening") return stopListeningAndSend();
    if (voicePhase === "speaking") return interruptSpeaking();
    // "thinking": ignore taps until the response comes back
  }

  // Called once an assistant reply is ready. Only speaks (and only takes
  // over the mic) if the user is in voice mode; otherwise a no-op.
  function speakIfVoiceMode(text) {
    if (voicePhase === "off") return;
    stopRecognition();
    voicePhase = "speaking";
    renderVoiceControls();
    speak(text, () => { if (voicePhase !== "off") { voicePhase = "ready"; renderVoiceControls(); } });
  }

  function autoResize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }

  // ---------------------------------------------------------------------
  // Message rendering — plain, minimal, Claude/ChatGPT-style
  // ---------------------------------------------------------------------
  function lite(text) {
    let t = esc(text || "");
    t = t.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/^- (.*)$/gm, "• $1");
    t = t.replace(/\n/g, "<br>");
    return t;
  }

  function recordCardHtml(m) {
    const def = RECORD_DEFS[m.resource];
    const r = m.record || {};
    const bits = [];
    if (m.resource === "sessions") { if (r.session_date) bits.push(`Date: ${esc(r.session_date)}`); if (r.location) bits.push(`Location: ${esc(r.location)}`); }
    if (m.resource === "behaviors") { if (r.behavior) bits.push(`Behavior: ${esc(r.behavior)}`); if (r.intensity) bits.push(`Intensity: ${esc(r.intensity)}`); }
    if (m.resource === "incidents") { if (r.category) bits.push(`Category: ${esc(r.category)}`); if (r.severity) bits.push(`Severity: ${esc(r.severity)}`); }
    if (m.resource === "plans") { if (r.title) bits.push(esc(r.title)); }
    return `<div class="tac-msg assistant"><div class="tac-record-card">
        <div class="tac-record-icon">📋</div>
        <div class="tac-record-body">
          <div class="tac-record-title">${esc(def?.label || "Record")} saved as draft</div>
          <div class="tac-record-meta">${bits.join(" · ") || "Open it to review the details."}</div>
        </div>
        <button class="tac-record-open" type="button" data-open-record="${esc(m.resource)}" data-record-id="${esc(r.id || "")}">Open</button>
      </div></div>`;
  }

  function renderBcbaChatMessagesPro() {
    const mount = $("#bcbaChatTranscript");
    if (!mount) return;
    const state = window.loadBcbaChatState();
    const msgs = state.messages || [];
    if (!msgs.length) {
      mount.innerHTML = `<div class="tac-empty">
        <h3>BCBA Chat</h3>
        <p>Ask about behavior patterns, plan review prep, staff/caregiver training, or documentation gaps. Or just say what you need — like <em>"log a session for this patient"</em> or <em>"create an incident report"</em> — and I'll ask what's needed and save it as a draft.</p>
      </div>`;
      return;
    }
    let lastRole = null;
    mount.innerHTML = msgs.map((m) => {
      if (m.kind === "record_card") { lastRole = "assistant"; return recordCardHtml(m); }
      const role = m.role === "user" ? "user" : "assistant";
      const showLabel = role !== lastRole;
      lastRole = role;
      const label = role === "user" ? "You" : "TherapyAgent";
      return `<div class="tac-msg ${role}">
        ${showLabel ? `<div class="tac-msg-label">${esc(label)}</div>` : ""}
        <div class="tac-msg-body">${lite(m.text || "")}</div>
      </div>`;
    }).join("");
    mount.scrollTop = mount.scrollHeight;
    $$("[data-open-record]", mount).forEach((b) => b.onclick = () => {
      const resource = b.dataset.openRecord, id = b.dataset.recordId;
      window.panel(RECORD_DEFS[resource]?.panel || resource);
      if (id) setTimeout(() => window.openResourceDetail && window.openResourceDetail(resource, id), 350);
    });
  }

  // ---------------------------------------------------------------------
  // Chat send flow — record-creation guided draft, or normal AI turn
  // ---------------------------------------------------------------------
  function pushAssistant(state, msg) {
    state.messages.push({ role: "assistant", at: now(), ...msg });
    window.saveBcbaChatState();
    window.renderBcbaChatMessages();
    speakIfVoiceMode(msg.text || "");
  }

  function patientLabel(state) {
    const opt = document.querySelector("#bcbaChatPatient option:checked");
    if (opt && opt.value) return opt.textContent.replace(/—.*/, "").trim();
    return "this patient";
  }

  function isAffirmative(text) {
    return /^\s*(yes|yep|yeah|yup|sure|correct|that'?s\s+right|looks?\s+good|sounds?\s+good|go\s+ahead|save\s+it|save\s+that|save\s+this|confirm(ed)?|do\s+it|perfect|good|ok|okay)\b/i.test(String(text || "").trim());
  }

  function truncate(s, n = 160) {
    const v = String(s || "").trim();
    return v.length > n ? `${v.slice(0, n - 1)}…` : v;
  }

  // A plain-language recap of a draft, shown for confirmation before saving
  // — so the person is reviewing what the assistant understood, not just
  // trusting it blindly, and mistakes get caught before they're written.
  function summarizeDraft(resource, f) {
    if (resource === "sessions") {
      const when = [f.session_date, f.location && `at ${f.location}`].filter(Boolean).join(" ");
      let s = `a session${when ? ` ${when}` : ""}`;
      if (f.activities) s += `. Activities: ${truncate(f.activities)}`;
      if (f.response_to_intervention) s += `. Client response: ${truncate(f.response_to_intervention)}`;
      return s;
    }
    if (resource === "behaviors") {
      let s = `a behavior event — ${truncate(f.behavior)}`;
      if (f.antecedent) s += `. Antecedent: ${truncate(f.antecedent)}`;
      if (f.consequence) s += `. Consequence: ${truncate(f.consequence)}`;
      if (f.intensity) s += `. Intensity: ${f.intensity}/5`;
      return s;
    }
    if (resource === "incidents") {
      let s = `a${/^[aeiou]/i.test(f.severity || "") ? "n" : ""} ${f.severity || "low"}-severity ${f.category || "general"} incident — ${truncate(f.description)}`;
      if (f.immediate_actions) s += `. Immediate actions: ${truncate(f.immediate_actions)}`;
      return s;
    }
    if (resource === "plans") {
      let s = `a therapy plan titled "${truncate(f.title, 60)}"`;
      if (f.goals) s += `. Goals: ${truncate(f.goals)}`;
      if (f.interventions) s += `. Interventions: ${truncate(f.interventions)}`;
      return s;
    }
    return "the record";
  }

  async function extractAndAskOrCreate(state, msgEl, latestReply) {
    const draft = state.pendingRecord;
    const def = RECORD_DEFS[draft.resource];

    // If we're just waiting on a yes/no, handle that first — no need to
    // re-run extraction on "yes".
    if (draft.awaitingConfirm) {
      if (isAffirmative(latestReply)) { await saveDraftRecord(state, msgEl); return; }
      draft.awaitingConfirm = false; // treat the reply as a correction and fall through
    }

    window.setMessage && window.setMessage(msgEl, "Reading through what you shared…", "info");
    try {
      const out = await window.api("/api/ai/extract-fields", {
        method: "POST",
        body: JSON.stringify({ resource_type: draft.resource, text: draft.collectedText })
      });
      for (const [k, v] of Object.entries(out.fields || {})) {
        if (v !== undefined && v !== null && String(v).trim() !== "") draft.fields[k] = v;
      }
    } catch (e) {
      console.warn("[chat] extract-fields failed", e.message);
    }

    let missing = def.target.filter((f) => !draft.fields[f.name] || !String(draft.fields[f.name]).trim());

    // Guaranteed-progress safety net: the local extractor does simple text
    // matching and can miss valid answers (e.g. "the client responded
    // positively" doesn't literally contain the word "response"). If we
    // asked about this exact set of fields last turn and the user replied
    // but extraction still didn't fill any of them, don't ask the same
    // question again — take their literal reply as the answer to the first
    // field we asked about. This guarantees the conversation always moves
    // forward instead of looping.
    if (
      missing.length && latestReply && !isCancelPhrase(latestReply) &&
      draft.lastMissing && draft.lastMissing.length === missing.length &&
      missing.every((f, i) => f.name === draft.lastMissing[i])
    ) {
      draft.fields[missing[0].name] = latestReply.trim();
      missing = def.target.filter((f) => !draft.fields[f.name] || !String(draft.fields[f.name]).trim());
    }

    if (missing.length) {
      draft.lastMissing = missing.map((f) => f.name);
      window.saveBcbaChatState();
      const ask = missing.slice(0, 3).map((f) => f.label).join(", ");
      pushAssistant(state, { text: `Got it — I've filled in what I could for the ${def.label.toLowerCase()}. I still need: ${ask}. Feel free to answer all at once, or say "cancel" to drop this.` });
      window.setMessage && window.setMessage(msgEl, "Waiting on a few more details.", "info");
      return;
    }

    // Everything needed is filled — recap it in plain language and ask
    // before writing anything, rather than saving blind and only finding
    // out something was wrong (or unparseable) after the fact.
    draft.lastMissing = [];
    draft.awaitingConfirm = true;
    window.saveBcbaChatState();
    const summary = summarizeDraft(draft.resource, draft.fields);
    pushAssistant(state, { text: `Here's what I've got — I'll save this as ${summary}. Want me to save it as a draft? Say "yes" to confirm, or tell me what to change.` });
    window.setMessage && window.setMessage(msgEl, "Waiting on your confirmation.", "info");
  }

  async function saveDraftRecord(state, msgEl) {
    const draft = state.pendingRecord;
    const def = RECORD_DEFS[draft.resource];
    window.setMessage && window.setMessage(msgEl, `Saving the ${def.label.toLowerCase()} draft…`, "info");
    try {
      const payload = { ...draft.fields, patient_id: state.patient_id, status: "draft" };
      const out = await window.api(def.endpoint, { method: "POST", body: JSON.stringify(payload) });
      const created = out[def.singular];
      state.pendingRecord = null;
      const who = patientLabel(state);
      pushAssistant(state, {
        kind: "record_card",
        resource: draft.resource,
        record: created,
        text: `Created a draft ${def.label.toLowerCase()} for ${who}. It's saved as a draft — open it to review, fill in any optional details, and submit it for review when you're ready.`
      });
      window.setMessage && window.setMessage(msgEl, `${def.label} draft created.`, "success");
    } catch (e) {
      pushAssistant(state, { text: `I couldn't save that yet — ${e.message}. Want to try again, or say "cancel"?` });
      window.setMessage && window.setMessage(msgEl, e.message, "error");
    }
  }

  async function normalWorkbenchTurn(state, question, msgEl) {
    window.setMessage && window.setMessage(msgEl, "Thinking with TherapyAgent context…", "info");
    try {
      const out = await window.api("/api/ai/workbench", {
        method: "POST",
        body: JSON.stringify({
          patient_id: state.patient_id || "",
          date_range_days: state.date_range_days || "90",
          mode: "general",
          question: window.bcbaChatHistoryPrompt ? window.bcbaChatHistoryPrompt(question) : question
        })
      });
      pushAssistant(state, { text: out.answer || "No answer returned.", mode: out.mode || "" });
      window.setMessage && window.setMessage(msgEl, out.message || "Response generated.", "success");
    } catch (err) {
      state.messages.push({ role: "system", text: `Chat failed: ${err.message}`, at: now() });
      window.saveBcbaChatState();
      window.renderBcbaChatMessages();
      window.setMessage && window.setMessage(msgEl, err.message, "error");
      speakIfVoiceMode(`Sorry, that didn't go through: ${err.message}`);
    }
  }

  async function submitChat() {
    const msgEl = $("#bcbaChatMsg");
    const input = $("#bcbaChatInput");
    const question = String(input?.value || "").trim();
    if (!question) return;

    const state = window.loadBcbaChatState();
    state.patient_id = $("#bcbaChatPatient")?.value || state.patient_id || "";
    state.date_range_days = $("#bcbaChatRange")?.value || state.date_range_days || "90";
    state.messages.push({ role: "user", text: question, at: now() });
    if (input) { input.value = ""; autoResize(input); }
    window.saveBcbaChatState();
    window.renderBcbaChatMessages();

    if (state.pendingRecord) {
      if (isCancelPhrase(question)) {
        state.pendingRecord = null;
        window.saveBcbaChatState();
        pushAssistant(state, { text: "No problem — canceled that draft. What else can I help with?" });
        return;
      }
      const draft = state.pendingRecord;
      if (!(draft.awaitingConfirm && isAffirmative(question))) {
        draft.collectedText += `\n${question}`;
      }
      window.saveBcbaChatState();
      await extractAndAskOrCreate(state, msgEl, question);
      return;
    }

    const intent = detectRecordIntent(question);
    if (intent) {
      if (!state.patient_id) {
        pushAssistant(state, { text: `I can do that. Which patient is this for? Pick one from the patient dropdown above, then tell me again.` });
        return;
      }
      state.pendingRecord = { resource: intent, collectedText: question, fields: {}, lastMissing: [], awaitingConfirm: false };
      window.saveBcbaChatState();
      await extractAndAskOrCreate(state, msgEl, null);
      return;
    }

    await normalWorkbenchTurn(state, question, msgEl);
  }

  function sendBcbaChatMessagePro(e) {
    e?.preventDefault?.();
    submitChat();
  }

  // ---------------------------------------------------------------------
  // Shell — Claude/ChatGPT-style layout
  // ---------------------------------------------------------------------
  async function loadBcbaChatPro() {
    const mount = $("#bcbaChat .bcbaChatMount") || $("#bcbaChat");
    if (!mount) return;
    try { await window.loadPatients?.(); } catch {}
    const state = window.loadBcbaChatState();

    mount.innerHTML = `
      <div class="tac-shell">
        <aside class="tac-sidebar">
          <button class="tac-new-chat" id="newBcbaChat" type="button">+ New chat</button>
          <label class="tac-field">Patient
            <select id="bcbaChatPatient">${window.bcbaChatPatientOptions ? window.bcbaChatPatientOptions(state.patient_id || "") : ""}</select>
          </label>
          <label class="tac-field">Date range
            <select id="bcbaChatRange">
              <option value="30" ${state.date_range_days === "30" ? "selected" : ""}>Last 30 days</option>
              <option value="90" ${state.date_range_days === "90" ? "selected" : ""}>Last 90 days</option>
              <option value="180" ${state.date_range_days === "180" ? "selected" : ""}>Last 180 days</option>
              <option value="365" ${state.date_range_days === "365" ? "selected" : ""}>Last 365 days</option>
            </select>
          </label>
          <div class="tac-sidebar-title">Recent</div>
          <div class="tac-session-list" id="bcbaChatSessionList">${window.bcbaChatSessionListHtml ? window.bcbaChatSessionListHtml(window.loadBcbaChatSessions(), state.id) : ""}</div>
        </aside>
        <main class="tac-main">
          <div class="tac-topbar">
            <span>ABA-Skilled BCBA Agent · outputs require clinician review</span>
            <button class="tac-isp-btn" id="bcbaChatGenerateIsp" type="button">Generate ISP draft</button>
          </div>
          <div class="tac-transcript" id="bcbaChatTranscript"></div>
          <div class="tac-suggest-row" id="tacSuggestRow">
            <button class="tac-chip" data-chat-suggest="What are the top behavior patterns and data gaps I should review?">Patterns &amp; gaps</button>
            <button class="tac-chip" data-chat-suggest="Help me prepare for a BCBA plan review for this patient.">Plan review</button>
            <button class="tac-chip" data-chat-suggest="Log a session for this patient.">Log a session</button>
            <button class="tac-chip" data-chat-suggest="Create an incident report for this patient.">Report an incident</button>
          </div>
          <form class="tac-composer" id="bcbaChatForm">
            <div id="tacVoiceStatus" class="tac-voice-status" hidden></div>
            <div class="tac-input-row">
              <textarea id="bcbaChatInput" rows="1" placeholder="Message the BCBA Agent, or say what you need…"></textarea>
              <button class="tac-icon-btn" id="bcbaChatMicBtn" type="button" title="Dictate">🎤</button>
              <button class="tac-icon-btn" id="tacVoiceModeBtn" type="button" title="Hands-free voice chat">🎙️ Talk</button>
              <button class="tac-icon-btn tac-exit-btn" id="tacVoiceExitBtn" type="button" title="Exit voice chat" hidden>Exit</button>
              <button class="tac-send-btn" type="submit" title="Send">➤</button>
            </div>
          </form>
          <div class="message" id="bcbaChatMsg"></div>
        </main>
      </div>`;

    window.renderBcbaChatMessages();
    window.bindBcbaChatSessionListEvents && window.bindBcbaChatSessionListEvents();
    updateMicButton();
    renderVoiceControls();

    const input = $("#bcbaChatInput");
    input?.addEventListener("input", () => autoResize(input));
    input?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); submitChat(); }
    });

    $("#bcbaChatPatient")?.addEventListener("change", (e) => { window.startNewBcbaChatSession(e.target.value || ""); });
    $("#bcbaChatRange")?.addEventListener("change", (e) => { state.date_range_days = e.target.value || "90"; window.saveBcbaChatState(); });
    $("#newBcbaChat")?.addEventListener("click", () => window.startNewBcbaChatSession(""));
    $("#bcbaChatForm")?.addEventListener("submit", sendBcbaChatMessagePro);
    $("#bcbaChatGenerateIsp")?.addEventListener("click", () => window.generateIspFromBcbaChat && window.generateIspFromBcbaChat());
    $("#bcbaChatMicBtn")?.addEventListener("click", toggleDictation);
    $("#tacVoiceModeBtn")?.addEventListener("click", onVoiceModeBtnClick);
    $("#tacVoiceExitBtn")?.addEventListener("click", exitVoiceMode);
    $$("[data-chat-suggest]", mount).forEach((b) => b.onclick = () => {
      if (input) { input.value = b.dataset.chatSuggest || ""; autoResize(input); input.focus(); }
    });
  }

  window.loadBcbaChat = loadBcbaChatPro;
  window.renderBcbaChatMessages = renderBcbaChatMessagesPro;
  window.sendBcbaChatMessage = sendBcbaChatMessagePro;
})();
