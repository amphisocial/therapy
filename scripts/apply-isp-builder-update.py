#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime
import re
import shutil
import sys

ROOT = Path.cwd()
STAMP = datetime.utcnow().strftime('%Y%m%d-%H%M%S')

FILES = {
    'server': ROOT / 'server.js',
    'schema': ROOT / 'db' / 'schema.sql',
    'workspace': ROOT / 'public' / 'workspace.html',
    'app': ROOT / 'public' / 'app.js',
    'styles': ROOT / 'public' / 'styles.css',
    'skill': ROOT / 'config' / 'aba-bcba-agent.skill.md',
}

def require_files():
    missing = [str(p) for k, p in FILES.items() if k != 'skill' and not p.exists()]
    if missing:
        raise SystemExit('Run this from /opt/apps/therapy. Missing: ' + ', '.join(missing))
    FILES['skill'].parent.mkdir(parents=True, exist_ok=True)
    if not FILES['skill'].exists():
        FILES['skill'].write_text('# ABA-Skilled BCBA Agent Skill\n\n', encoding='utf-8')

def backup(path: Path):
    if path.exists():
        dest = path.with_name(path.name + f'.backup.isp-builder-{STAMP}')
        shutil.copyfile(path, dest)
        print(f'Backed up {path} -> {dest}')

def read(path):
    return path.read_text(encoding='utf-8')

def write(path, text):
    path.write_text(text, encoding='utf-8')
    print(f'Updated {path}')

def append_marker(text, marker_name, block):
    start = f'-- BEGIN {marker_name}'
    end = f'-- END {marker_name}'
    if start in text and end in text:
        return re.sub(re.escape(start) + r'.*?' + re.escape(end), block.strip(), text, flags=re.S)
    return text.rstrip() + '\n\n' + block.strip() + '\n'

def patch_schema():
    path = FILES['schema']
    backup(path)
    s = read(path)
    block = r'''
-- BEGIN ISP_BUILDER_SCHEMA
CREATE TABLE IF NOT EXISTS individual_service_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  title TEXT NOT NULL DEFAULT 'Individual Service Plan',
  plan_purpose TEXT,
  background TEXT,
  strengths TEXT,
  behavioral_summary TEXT,
  target_behaviors JSONB NOT NULL DEFAULT '[]'::jsonb,
  abc_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  suspected_functions JSONB NOT NULL DEFAULT '[]'::jsonb,
  replacement_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  interventions JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety_plan TEXT,
  data_collection_plan TEXT,
  caregiver_training_plan TEXT,
  generalization_plan TEXT,
  review_schedule TEXT,
  bcba_review_notes TEXT,
  source_workbench_history_id UUID,
  source_question TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_by UUID REFERENCES users(id),
  modified_at TIMESTAMPTZ,
  review_assigned_to UUID REFERENCES users(id),
  review_requested_by UUID REFERENCES users(id),
  review_requested_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT
);

-- Repair older partial deployments.
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Individual Service Plan';
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS plan_purpose TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS background TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS strengths TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS behavioral_summary TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS target_behaviors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS abc_patterns JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS suspected_functions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS replacement_skills JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS goals JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS interventions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS safety_plan TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS data_collection_plan TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS caregiver_training_plan TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS generalization_plan TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS review_schedule TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS bcba_review_notes TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS source_workbench_history_id UUID;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS source_question TEXT;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS modified_by UUID REFERENCES users(id);
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS review_assigned_to UUID REFERENCES users(id);
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS review_requested_by UUID REFERENCES users(id);
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE individual_service_plans ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_isps_org_patient ON individual_service_plans(org_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_isps_org_created ON individual_service_plans(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isps_org_status ON individual_service_plans(org_id, status);
-- END ISP_BUILDER_SCHEMA
'''
    write(path, append_marker(s, 'ISP_BUILDER_SCHEMA', block))

def patch_server():
    path = FILES['server']
    backup(path)
    s = read(path)

    if '"isps.view"' not in s:
        s = s.replace('"reports.view", "reports.edit", "reports.delete", "reports.review",', '"reports.view", "reports.edit", "reports.delete", "reports.review",\n  "isps.view", "isps.edit", "isps.delete", "isps.review",')

    permission_repls = {
        '"reports.view", "reports.edit", "reports.review", "audit.view"]': '"reports.view", "reports.edit", "reports.review", "isps.view", "isps.edit", "isps.review", "audit.view"]',
        '"reports.view", "reports.edit", "reports.review"]': '"reports.view", "reports.edit", "reports.review", "isps.view", "isps.edit", "isps.review"]',
        '"reports.view", "reports.edit"]': '"reports.view", "reports.edit", "isps.view"]',
        '"incidents.view", "incidents.edit"]': '"incidents.view", "incidents.edit", "isps.view"]',
        '"reports.view", "audit.view"]': '"reports.view", "isps.view", "audit.view"]',
        '"incidents.view", "reports.view"]': '"incidents.view", "reports.view", "isps.view"]',
    }
    for old, new in permission_repls.items():
        s = s.replace(old, new)

    if 'table: "individual_service_plans"' not in s:
        cfg = r'''
  isps: {
    singular: "isp",
    table: "individual_service_plans",
    listTitle: "Individual Service Plan",
    idField: "id",
    createdByField: "created_by",
    allowedRoles: ["org_admin", "bcba", "supervisor"],
    viewPermission: "isps.view",
    editPermission: "isps.edit",
    deletePermission: "isps.delete",
    reviewPermission: "isps.review",
    insertColumns: ["patient_id", "title", "plan_purpose", "background", "strengths", "behavioral_summary", "target_behaviors", "abc_patterns", "suspected_functions", "replacement_skills", "goals", "interventions", "safety_plan", "data_collection_plan", "caregiver_training_plan", "generalization_plan", "review_schedule", "bcba_review_notes", "source_workbench_history_id", "source_question", "status"],
    updateColumns: ["patient_id", "title", "plan_purpose", "background", "strengths", "behavioral_summary", "target_behaviors", "abc_patterns", "suspected_functions", "replacement_skills", "goals", "interventions", "safety_plan", "data_collection_plan", "caregiver_training_plan", "generalization_plan", "review_schedule", "bcba_review_notes", "source_workbench_history_id", "source_question", "status"],
    jsonColumns: ["target_behaviors", "abc_patterns", "suspected_functions", "replacement_skills", "goals", "interventions"],
    required: ["patient_id", "title"],
    select: `s.*, p.first_name, p.last_name, cu.full_name AS created_by_name, mu.full_name AS modified_by_name, ru.full_name AS reviewed_by_name, au.full_name AS review_assigned_to_name`
  }'''
        marker = '\n};\n\nconst reviewTypeMap ='
        idx = s.find(marker, s.find('const resourceConfigs'))
        if idx == -1:
            raise SystemExit('Could not find resourceConfigs terminator in server.js')
        s = s[:idx] + ',\n' + cfg + s[idx:]

    if 'isp: "isps"' not in s:
        s = s.replace('report: "reports", reports: "reports"', 'report: "reports", reports: "reports",\n  isp: "isps", isps: "isps"')

    if 'function buildLocalIspDraft' not in s:
        block = r'''
// ISP Builder APIs
function listFromCounts(labels) {
  return (labels || []).map(item => {
    const text = String(item || "").trim();
    const label = text.replace(/\s*\(\d+\)$/, "") || "Unspecified";
    return { label, evidence: text };
  });
}

function buildLocalIspDraft(ctx, question = "") {
  const patient = ctx.patient || {};
  const patientName = `${patient.first_name || ""} ${patient.last_name || ""}`.trim() || "Patient";
  const behaviors = ctx.behaviors || [];
  const incidents = ctx.incidents || [];
  const sessions = ctx.sessions || [];
  const plans = ctx.plans || [];
  const reports = ctx.reports || [];
  const topBehaviors = topCounts(behaviors, "behavior", 6);
  const topAntecedents = topCounts(behaviors, "antecedent", 6);
  const topConsequences = topCounts(behaviors, "consequence", 6);
  const topFunctions = topCounts(behaviors, "suspected_function", 6);
  const recentPlan = plans[0];
  const avgIntensity = behaviors.filter(b => b.intensity != null).length
    ? (behaviors.reduce((sum, b) => sum + Number(b.intensity || 0), 0) / behaviors.filter(b => b.intensity != null).length).toFixed(1)
    : "not enough data";
  const severeIncidents = incidents.filter(i => ["high", "critical"].includes(String(i.severity || "").toLowerCase())).length;
  const behaviorLabels = listFromCounts(topBehaviors);
  const functionLabels = listFromCounts(topFunctions);
  const antecedentLabels = listFromCounts(topAntecedents);
  const consequenceLabels = listFromCounts(topConsequences);

  return {
    title: `ISP Draft - ${patientName} - ${new Date().toISOString().slice(0, 10)}`,
    plan_purpose: `Draft Individual Service Plan generated from TherapyAgent records for BCBA review. User request: ${question || "Prepare an ISP draft."}`,
    background: `${patientName} is documented in TherapyAgent with diagnosis/program context: ${patient.diagnosis || "not specified"}. This draft uses the last ${ctx.days || 90} days of available records: ${sessions.length} session logs, ${behaviors.length} behavior events, ${incidents.length} incidents, ${plans.length} therapy plans, and ${reports.length} reports.`,
    strengths: `Review session notes and caregiver/staff input to confirm strengths, preferences, motivators, communication style, and reinforcing activities. TherapyAgent can summarize documented response-to-intervention notes, but BCBA confirmation is required before finalizing this section.`,
    behavioral_summary: `Recent records show ${behaviors.length} behavior event(s) and ${incidents.length} incident(s) in the selected window. Top documented behaviors: ${topBehaviors.join(", ") || "not enough behavior-event data"}. Average documented intensity: ${avgIntensity}. High/critical incidents: ${severeIncidents}. Most recent plan: ${recentPlan ? recentPlan.title || "Untitled plan" : "no existing plan found"}.`,
    target_behaviors: behaviorLabels.length ? behaviorLabels.map(x => ({ behavior: x.label, definition: "BCBA to operationally define using observable, measurable terms.", baseline_evidence: x.evidence })) : [{ behavior: "To be defined", definition: "Not enough behavior-event data in TherapyAgent records.", baseline_evidence: "Missing or insufficient data" }],
    abc_patterns: [{ antecedents: antecedentLabels.map(x => x.evidence), consequences: consequenceLabels.map(x => x.evidence), note: "ABC patterns require BCBA validation through direct observation and data-quality review." }],
    suspected_functions: functionLabels.length ? functionLabels.map(x => ({ function: x.label, evidence: x.evidence, caution: "Hypothesis only; validate through assessment." })) : [{ function: "Undetermined", evidence: "Not enough suspected-function documentation.", caution: "Do not finalize without BCBA assessment." }],
    replacement_skills: [
      { skill: "Functional communication response", rationale: "Teach a safer, socially appropriate way to request attention, escape, access, or assistance based on validated function." },
      { skill: "Tolerance/waiting or transition skill", rationale: "Consider if antecedent data shows transition, denial, or waiting patterns." },
      { skill: "Self-regulation or coping routine", rationale: "Consider when records show escalation, incident risk, or high intensity." }
    ],
    goals: [
      { goal: "Reduce target behavior frequency/intensity", measurement: "Frequency, duration, intensity, and context per occurrence", review: "BCBA to set baseline and mastery criteria." },
      { goal: "Increase replacement communication/skill use", measurement: "Percent of opportunities or independent responses", review: "BCBA to define prompt levels and mastery criteria." }
    ],
    interventions: [
      { strategy: "Antecedent strategies", detail: "Use validated antecedent patterns to adjust environment, task demand, choices, visual supports, transitions, and reinforcement schedule." },
      { strategy: "Differential reinforcement", detail: "Reinforce replacement skills and appropriate alternatives aligned to validated function." },
      { strategy: "Response strategy", detail: "Define safe, least-restrictive responses for escalation. Crisis or restrictive procedures require separate policy/legal/clinical review." }
    ],
    safety_plan: incidents.length ? `Review ${incidents.length} incident record(s), including ${severeIncidents} high/critical incident(s), to confirm safety steps, notification requirements, and escalation protocol.` : "No incidents found in selected context. Confirm safety planning requirements with BCBA and organization policy.",
    data_collection_plan: "Collect ABC data, frequency, duration, intensity, location, time of day, intervention used, response to intervention, prompting level, replacement skill opportunities, and incident follow-up. Review data quality weekly during implementation.",
    caregiver_training_plan: "Train caregivers/staff on target behavior definitions, antecedent strategies, replacement-skill prompting, reinforcement procedures, data collection, and escalation/safety steps. Document training completion and competency checks.",
    generalization_plan: "Plan for use across people, settings, materials, and routines once skills are stable. Track maintenance and generalization separately from initial acquisition.",
    review_schedule: "BCBA review recommended at least every 30 days during active implementation, sooner if incidents increase, intensity rises, or plan data suggests insufficient progress.",
    bcba_review_notes: "Draft only. Requires BCBA review, editing, approval, and alignment with payer/state/organizational ISP requirements before use."
  };
}

function buildIspPrompt(ctx, question) {
  return `${loadAbaAgentSkill ? loadAbaAgentSkill() : "You are the ABA-Skilled BCBA Agent inside TherapyAgent."}\n\nGenerate a structured JSON draft for an Individual Service Plan. Use only the provided TherapyAgent context. Do not diagnose, determine medical necessity, or make final treatment decisions. Return JSON with these keys only: title, plan_purpose, background, strengths, behavioral_summary, target_behaviors, abc_patterns, suspected_functions, replacement_skills, goals, interventions, safety_plan, data_collection_plan, caregiver_training_plan, generalization_plan, review_schedule, bcba_review_notes. Arrays should be JSON arrays of objects.\n\nUser request: ${question}\n\nTherapyAgent context JSON:\n${JSON.stringify(ctx, null, 2).slice(0, 22000)}`;
}

app.post("/api/ai/workbench/isp", requireAuth, requireMfa, requireAiWorkbenchAccess, async (req, res) => {
  const patientId = String(req.body?.patient_id || "").trim();
  const question = String(req.body?.question || "Prepare an ISP draft based on the current AI Workbench conversation and patient history.").trim();
  const days = parseDays(req.body?.date_range_days, 90);
  if (!patientId) return res.status(400).json({ error: "patient_required", message: "Select a patient before generating an ISP draft." });
  if (!["org_admin", "bcba", "supervisor"].includes(req.user?.role)) {
    return res.status(403).json({ error: "forbidden", message: "ISP generation is available to Org Admin, BCBA, and Supervisor roles." });
  }
  try {
    const ctx = await loadWorkbenchContext(req.user.org_id, patientId, days);
    let draft = buildLocalIspDraft(ctx, question);
    let llmMode = "local_no_phi";
    let message = "ISP draft generated in local no-PHI mode and saved for BCBA review.";
    if (ALLOW_PHI_TO_LLM && process.env.OPENAI_API_KEY) {
      try {
        const raw = await callOpenAI(buildIspPrompt(ctx, question), true);
        const parsed = JSON.parse(raw);
        draft = { ...draft, ...parsed };
        llmMode = "llm";
        message = "ISP draft generated with patient context and saved. BCBA review is required.";
      } catch (e) {
        console.error("[ai-workbench-isp-llm]", e.message);
        message = `LLM ISP generation failed, so TherapyAgent used local no-PHI mode: ${e.message}`;
      }
    }
    const historyRow = (await pool.query(
      `INSERT INTO ai_workbench_history (org_id, user_id, patient_id, mode, date_range_days, question, response_summary, context_snapshot, llm_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.org_id, req.user.id, patientId, "isp_builder", days, question, JSON.stringify(draft).slice(0, 4000), JSON.stringify({ counts: { sessions: ctx.sessions?.length || 0, behaviors: ctx.behaviors?.length || 0, incidents: ctx.incidents?.length || 0, plans: ctx.plans?.length || 0, reports: ctx.reports?.length || 0 } }), llmMode]
    )).rows[0];
    const cfg = getResourceConfig("isps");
    const row = await insertRecord(req, cfg, { ...draft, patient_id: patientId, source_workbench_history_id: historyRow?.id || null, source_question: question, status: "draft" });
    await audit(req, "isp_draft_generated", "isp", row.id, { patient_id: patientId, days, llmMode });
    res.json({ isp: row, draft, mode: llmMode, message });
  } catch (e) {
    console.error("[ai-workbench-isp]", e.message);
    res.status(e.status || 500).json({ error: "isp_generation_failed", message: e.message || "Could not generate ISP draft." });
  }
});
'''
        marker = '\n// Admin APIs'
        if marker not in s:
            raise SystemExit('Could not find // Admin APIs marker in server.js')
        s = s.replace(marker, '\n' + block + marker)

    write(path, s)

def patch_workspace():
    path = FILES['workspace']
    backup(path)
    s = read(path)
    if 'data-panel="isps"' not in s:
        s = s.replace('<button data-panel="aiWorkbench">AI Workbench</button>', '<button data-panel="aiWorkbench">AI Workbench</button>\n        <button data-panel="isps">ISP Builder</button>')
    if 'data-patient-tab="isps"' not in s:
        s = s.replace('<button data-patient-tab="plans">Plans</button>', '<button data-patient-tab="plans">Plans</button>\n            <button data-patient-tab="isps">ISP</button>')
    if 'id="isps" data-resource="isps"' not in s:
        s = s.replace('<section class="panel resource-panel" id="plans" data-resource="plans"><div class="resourceMount"></div></section>', '<section class="panel resource-panel" id="plans" data-resource="plans"><div class="resourceMount"></div></section>\n      <section class="panel resource-panel" id="isps" data-resource="isps"><div class="resourceMount"></div></section>')
    if 'id="generateIspFromWorkbench"' not in s:
        s = s.replace('<button class="btn" id="runAiWorkbench" type="button">Ask ABA-Skilled BCBA Agent</button>', '<button class="btn" id="runAiWorkbench" type="button">Ask ABA-Skilled BCBA Agent</button>\n            <button class="btn secondary" id="generateIspFromWorkbench" type="button">Generate ISP Draft</button>')
    write(path, s)

def patch_app():
    path = FILES['app']
    backup(path)
    s = read(path)

    if 'endpoint: "/api/isps"' not in s:
        block = r'''
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
      { name: "target_behaviors", label: "Target behaviors JSON", type: "textarea", wide: true },
      { name: "abc_patterns", label: "ABC patterns JSON", type: "textarea", wide: true },
      { name: "suspected_functions", label: "Suspected functions JSON", type: "textarea", wide: true },
      { name: "replacement_skills", label: "Replacement skills JSON", type: "textarea", wide: true },
      { name: "goals", label: "Measurable goals and objectives JSON", type: "textarea", wide: true },
      { name: "interventions", label: "Interventions and teaching strategies JSON", type: "textarea", wide: true },
      { name: "safety_plan", label: "Crisis / safety / incident response plan", type: "textarea", wide: true },
      { name: "data_collection_plan", label: "Data collection plan", type: "textarea", wide: true },
      { name: "caregiver_training_plan", label: "Caregiver / staff training plan", type: "textarea", wide: true },
      { name: "generalization_plan", label: "Generalization and maintenance plan", type: "textarea", wide: true },
      { name: "review_schedule", label: "Review schedule", type: "textarea", wide: true },
      { name: "bcba_review_notes", label: "BCBA review notes / sign-off", type: "textarea", wide: true }
    ]
  },'''
        marker = '\n  incidents: {'
        if marker not in s:
            raise SystemExit('Could not find incidents resourceDef marker in public/app.js')
        s = s.replace(marker, '\n' + block + marker)

    if 'function generateIspFromWorkbench' not in s:
        block = r'''
async function generateIspFromWorkbench() {
  const msg = $("#aiWorkbenchMsg");
  const patient_id = $("#aiWorkbenchPatient")?.value || "";
  const question = ($("#aiWorkbenchQuestion")?.value || "Prepare an Individual Service Plan draft based on this patient history and the current conversation.").trim();
  if (!patient_id) return setMessage(msg, "Select a patient before generating an ISP draft.", "error");
  try {
    setMessage(msg, "Generating structured ISP draft from patient context...", "info");
    const out = await api("/api/ai/workbench/isp", {
      method: "POST",
      body: JSON.stringify({
        patient_id,
        date_range_days: $("#aiWorkbenchRange")?.value || "90",
        question
      })
    });
    setMessage(msg, out.message || "ISP draft generated and saved.", "success");
    if (out.isp?.id) {
      panel("isps");
      setTimeout(() => openResourceDetail("isps", out.isp.id), 350);
    }
  } catch (e) {
    setMessage(msg, e.message, "error");
  }
}
'''
        marker = '\nasync function loadInbox()'
        if marker not in s:
            raise SystemExit('Could not find loadInbox marker in public/app.js')
        s = s.replace(marker, '\n' + block + marker)

    if 'generateIspFromWorkbench' not in s.split('// Event bindings', 1)[-1]:
        s = s.replace('$("runAiWorkbench")?.addEventListener("click", runAiWorkbench);', '$("runAiWorkbench")?.addEventListener("click", runAiWorkbench);')
    if '$("#generateIspFromWorkbench")?.addEventListener("click", generateIspFromWorkbench);' not in s:
        s = s.replace('$("#runAiWorkbench")?.addEventListener("click", runAiWorkbench);', '$("#runAiWorkbench")?.addEventListener("click", runAiWorkbench);\n$("#generateIspFromWorkbench")?.addEventListener("click", generateIspFromWorkbench);')

    write(path, s)

def patch_styles():
    path = FILES['styles']
    backup(path)
    s = read(path)
    block = r'''

/* ISP Builder */
.isp-draft-note{background:#f8fafc;border:1px solid var(--line);border-radius:16px;padding:14px 16px;color:#334155;line-height:1.55}
#isps textarea{min-height:120px}
#isps .detail-card .form-grid label:nth-child(n+7) textarea{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px}
'''
    if '/* ISP Builder */' not in s:
        s = s.rstrip() + block
    write(path, s)

def patch_skill():
    path = FILES['skill']
    backup(path)
    s = read(path)
    block = r'''

## ISP Builder

When the user asks to create an ISP, Individual Service Plan, Individualized Support Plan, support plan, or care plan, generate a structured draft using only the selected patient's TherapyAgent records, organization-approved knowledge base, and the current AI Workbench conversation.

The ISP must include:

1. Patient / Client Information
2. Reason for Plan
3. Background and Current Status
4. Strengths, Preferences, and Motivators
5. Behavioral Summary
6. Target Behaviors
7. Antecedent / Behavior / Consequence Patterns
8. Suspected Function(s)
9. Replacement Skills
10. Measurable Goals and Objectives
11. Interventions and Teaching Strategies
12. Crisis / Safety Plan
13. Data Collection Plan
14. Caregiver / Staff Training Plan
15. Generalization and Maintenance
16. Review Schedule
17. BCBA Review Notes

Rules:
- Do not diagnose.
- Do not prescribe treatment.
- Do not determine medical necessity.
- Do not fabricate missing patient details.
- If evidence is missing, say "Not enough data in TherapyAgent records."
- Cite supporting record types such as sessions, behavior events, incidents, plans, and reports.
- Write in professional BCBA-reviewable language.
- End with: "Draft only. Requires BCBA review and approval."
'''
    if '## ISP Builder' not in s:
        s = s.rstrip() + block
    write(path, s)

def main():
    require_files()
    patch_schema()
    patch_server()
    patch_workspace()
    patch_app()
    patch_styles()
    patch_skill()
    print('\nISP Builder update applied. Next:')
    print('  node --check server.js')
    print('  node --check public/app.js')
    print('  set -a; source .env; set +a')
    print('  psql "$DATABASE_URL" -f db/schema.sql')
    print('  pm2 restart therapyagent --update-env')

if __name__ == '__main__':
    main()
