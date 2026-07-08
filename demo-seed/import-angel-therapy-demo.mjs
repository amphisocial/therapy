import dotenv from "dotenv";
dotenv.config({ override: true });

import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const { Pool } = pg;
const PASSWORD = "mishratesting";
const ORG_NAME = "Angel Therapy Services";
const ORG_LEGAL_NAME = "Angel Therapy Services LLC";
const CONTACT_EMAIL = "admin@angeltherapy.com";
const TERMS_VERSION = "2026-07-07";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Run from /opt/apps/therapy or source .env first.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: String(process.env.PGSSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : false,
  max: 4,
});

const uuid = () => crypto.randomUUID();
const isoDate = (daysAgo = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};
const isoTs = (daysAgo = 0, hour = 10, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const time = (hour, minute = 0) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
const pick = (arr, i) => arr[i % arr.length];
const base32Secret = () => crypto.randomBytes(20).toString("base64").replace(/[^A-Z2-7]/gi, "").toUpperCase().slice(0, 32).padEnd(32, "A");
const json = value => JSON.stringify(value);

const demoUsers = [
  { key: "admin", email: "admin@angeltherapy.com", fullName: "Angela Martin", role: "org_admin", active: true },
  { key: "bcba", email: "bcba@angeltherapy.com", fullName: "Dr. Maya Patel", role: "bcba", active: true },
  { key: "supervisor", email: "supervisor@angeltherapy.com", fullName: "Jordan Lee", role: "supervisor", active: true },
  { key: "therapist1", email: "therapist1@angeltherapy.com", fullName: "Emily Chen", role: "therapist", active: true },
  { key: "therapist2", email: "therapist2@angeltherapy.com", fullName: "Carlos Rivera", role: "therapist", active: true },
  { key: "rbt1", email: "rbt1@angeltherapy.com", fullName: "Noah Thompson", role: "rbt", active: true },
  { key: "rbt2", email: "rbt2@angeltherapy.com", fullName: "Priya Shah", role: "rbt", active: true },
  { key: "billing", email: "billing@angeltherapy.com", fullName: "Morgan Brooks", role: "billing_auditor", active: true },
];

const patientSeeds = [
  ["Aiden", "Brooks", "2016-04-12", "ASD Level 2 / Communication"],
  ["Mia", "Carter", "2015-09-28", "ASD Level 1 / Social skills"],
  ["Ethan", "Nguyen", "2014-02-18", "ASD Level 2 / Behavior support"],
  ["Sophia", "Martinez", "2017-11-03", "Developmental delay / ABA"],
  ["Liam", "Johnson", "2013-06-21", "ASD Level 3 / High support"],
  ["Olivia", "Patel", "2016-12-15", "ASD Level 1 / Adaptive skills"],
  ["Noah", "Williams", "2014-08-07", "ASD Level 2 / School readiness"],
  ["Ava", "Rodriguez", "2015-05-30", "ASD Level 2 / Feeding routine"],
  ["Lucas", "Kim", "2012-10-11", "I/DD / Daily living skills"],
  ["Isabella", "Davis", "2018-01-24", "ASD Level 1 / Early intervention"],
  ["Mason", "Brown", "2016-07-16", "ASD Level 2 / Transition support"],
  ["Amelia", "Wilson", "2013-03-19", "ASD Level 1 / Peer interaction"],
  ["Logan", "Anderson", "2017-04-09", "ASD Level 2 / Functional communication"],
  ["Charlotte", "Thomas", "2014-12-02", "ASD Level 2 / Self-regulation"],
  ["Elijah", "Moore", "2015-01-14", "ASD Level 3 / Safety plan"],
  ["Harper", "Taylor", "2016-09-01", "Developmental delay / Social play"],
  ["James", "Hernandez", "2012-05-25", "I/DD / Community skills"],
  ["Evelyn", "Garcia", "2018-08-18", "ASD Level 1 / Language goals"],
  ["Benjamin", "Clark", "2013-11-27", "ASD Level 2 / Task completion"],
  ["Abigail", "Lewis", "2015-06-06", "ASD Level 1 / Emotional regulation"],
  ["Henry", "Lee", "2014-04-01", "ASD Level 2 / Toileting routine"],
  ["Ella", "Walker", "2016-02-10", "ASD Level 1 / Cooperative play"],
  ["Alexander", "Hall", "2012-09-13", "I/DD / Vocational readiness"],
  ["Scarlett", "Allen", "2017-07-22", "ASD Level 2 / Attention goals"],
  ["Daniel", "Young", "2014-01-29", "ASD Level 3 / Crisis prevention"],
  ["Grace", "King", "2015-10-08", "ASD Level 1 / Classroom routines"],
  ["Michael", "Wright", "2016-03-17", "ASD Level 2 / Sensory support"],
  ["Chloe", "Scott", "2013-12-20", "ASD Level 2 / Language expansion"],
  ["Sebastian", "Green", "2018-06-05", "Early intervention / Play skills"],
  ["Lily", "Adams", "2014-07-26", "ASD Level 1 / Independence"],
  ["Jack", "Baker", "2016-11-30", "ASD Level 2 / Compliance goals"],
  ["Zoey", "Gonzalez", "2015-02-03", "ASD Level 1 / Social reciprocity"],
  ["Owen", "Nelson", "2013-08-12", "ASD Level 2 / Communication device"],
  ["Nora", "Mitchell", "2017-05-19", "ASD Level 1 / Family training"],
  ["Samuel", "Perez", "2014-10-24", "I/DD / Life skills"],
  ["Layla", "Roberts", "2016-01-07", "ASD Level 2 / Behavior reduction"],
];

const locations = ["Clinic Room A", "Clinic Room B", "Home session", "School consult room", "Community outing", "Telehealth parent coaching"];
const activities = [
  "functional communication training, token board practice, and transition routine",
  "matching tasks, turn-taking activity, and independent work system",
  "mand training, visual schedule review, and play-based imitation",
  "self-regulation strategy practice, break request training, and caregiver handoff",
  "task analysis for daily living routine and reinforcement schedule review",
  "peer play routine, social greeting practice, and structured choice-making",
];
const interventions = [
  "DRA, visual schedule, first/then board, and verbal prompt fading",
  "functional communication response prompting with differential reinforcement",
  "antecedent modification, environmental arrangement, and planned ignoring when appropriate",
  "modeling, errorless learning, and gradual prompt delay",
  "token economy with scheduled breaks and behavior-specific praise",
  "caregiver coaching with rehearsal and immediate feedback",
];
const responses = [
  "Patient responded well to visual cues and required fewer verbal prompts by end of session.",
  "Patient initially resisted transition but recovered after break request was prompted.",
  "Patient maintained engagement for most tasks and independently requested preferred item twice.",
  "Patient needed moderate support during non-preferred work but completed routine safely.",
  "Patient showed improved tolerance for waiting and accepted delayed reinforcement.",
  "Caregiver demonstrated understanding of the plan and agreed to continue practice between sessions.",
];
const antecedents = [
  "Transition from preferred to non-preferred activity",
  "Demand presented after break period",
  "Denied access to preferred item",
  "Unexpected schedule change",
  "Peer entered activity space",
  "Waiting period before reinforcement",
  "Task difficulty increased",
  "Caregiver attention diverted",
];
const behaviors = [
  "vocal protest and refusal",
  "elopement attempt toward hallway",
  "dropping to floor",
  "throwing small materials",
  "repetitive questioning",
  "property disruption",
  "crying with refusal to respond",
  "minor aggression toward staff arm",
];
const consequences = [
  "prompted break request and redirected to visual schedule",
  "blocked unsafe movement and reinforced return to seat",
  "reduced task demand and reintroduced after calm period",
  "removed materials briefly and reinforced calm hands",
  "provided scripted response and redirected to task",
  "implemented safety protocol and documented caregiver notification",
];
const incidentCategories = ["fall", "elopement-risk", "minor-injury", "aggression", "property-disruption", "medical-observation", "medication-notification", "transportation-delay"];
const reportTypes = ["session_summary", "monthly_progress", "incident_summary", "caregiver_report"];
const statuses = ["Draft", "Reviewed", "Reviewed", "Reviewed", "Draft"];

async function tableColumns(client, tableName) {
  const rows = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  )).rows;
  return new Set(rows.map(r => r.column_name));
}

async function applyOptionalTermsEvidence(client, userId, adminId, usersCols, selfAccepted) {
  const sets = [];
  const vals = [];
  const add = (col, val) => {
    if (usersCols.has(col)) {
      vals.push(val);
      sets.push(`${col}=$${vals.length}`);
    }
  };

  add("terms_accepted", true);
  add("terms_accepted_at", new Date().toISOString());
  add("terms_accepted_version", TERMS_VERSION);
  add("terms_version", TERMS_VERSION);
  add("terms_accepted_ip", "127.0.0.1/demo-seed");
  add("terms_accepted_user_agent", "TherapyAgent demo seed");
  add("terms_attested_at", new Date().toISOString());
  add("terms_attested_by", selfAccepted ? userId : adminId);
  add("terms_attestation_by", selfAccepted ? userId : adminId);
  add("terms_attestation_note", selfAccepted ? "Demo user self-accepted Terms during seed import." : "Demo administrator attested user access under Terms during seed import.");

  if (!sets.length) return;
  vals.push(userId);
  await client.query(`UPDATE users SET ${sets.join(", ")} WHERE id=$${vals.length}`, vals);
}

async function insertRolePermissions(client, orgId) {
  const permissionKeys = [
    "patients.view", "patients.edit",
    "sessions.view", "sessions.edit", "sessions.delete", "sessions.review",
    "behaviors.view", "behaviors.edit", "behaviors.delete", "behaviors.review",
    "plans.view", "plans.edit", "plans.delete", "plans.review",
    "incidents.view", "incidents.edit", "incidents.delete", "incidents.review",
    "reports.view", "reports.edit", "reports.delete", "reports.review",
    "admin.users", "admin.roles", "attachments.setup", "attachments.upload", "audit.view"
  ];
  const roleSets = {
    org_admin: permissionKeys,
    bcba: ["patients.view", "patients.edit", "sessions.view", "sessions.edit", "sessions.review", "behaviors.view", "behaviors.edit", "behaviors.review", "plans.view", "plans.edit", "plans.review", "incidents.view", "incidents.edit", "incidents.review", "reports.view", "reports.edit", "reports.review", "audit.view", "attachments.upload"],
    supervisor: ["patients.view", "patients.edit", "sessions.view", "sessions.edit", "sessions.review", "behaviors.view", "behaviors.edit", "behaviors.review", "plans.view", "plans.edit", "incidents.view", "incidents.edit", "incidents.review", "reports.view", "reports.edit", "reports.review", "attachments.upload"],
    therapist: ["patients.view", "sessions.view", "sessions.edit", "behaviors.view", "behaviors.edit", "incidents.view", "incidents.edit", "reports.view", "reports.edit", "attachments.upload"],
    rbt: ["patients.view", "sessions.view", "sessions.edit", "behaviors.view", "behaviors.edit", "incidents.view", "incidents.edit", "attachments.upload"],
    billing_auditor: ["patients.view", "sessions.view", "reports.view", "audit.view"],
    read_only: ["patients.view", "sessions.view", "behaviors.view", "plans.view", "incidents.view", "reports.view"],
  };
  for (const [role, enabledSet] of Object.entries(roleSets)) {
    for (const permission of permissionKeys) {
      await client.query(
        `INSERT INTO role_permissions (org_id, role, permission_key, enabled) VALUES ($1,$2,$3,$4)
         ON CONFLICT (org_id, role, permission_key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now()`,
        [orgId, role, permission, enabledSet.includes(permission)]
      );
    }
  }
}

async function main() {
  const client = await pool.connect();
  const usersCols = await tableColumns(client, "users");
  try {
    await client.query("BEGIN");
    try { await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'); } catch (e) { console.warn(`uuid-ossp extension check skipped: ${e.message}`); }

    await client.query(
      `DELETE FROM organizations
       WHERE lower(name)=lower($1) OR lower(legal_name)=lower($2) OR lower(contact_email)=lower($3)`,
      [ORG_NAME, ORG_LEGAL_NAME, CONTACT_EMAIL]
    );

    const org = (await client.query(
      `INSERT INTO organizations (name, legal_name, npi, tax_id, address, contact_email, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id, name`,
      [ORG_NAME, ORG_LEGAL_NAME, "1932456789", "DEMO-99-0000000", "125 Care Circle, Boston, MA 02110", CONTACT_EMAIL]
    )).rows[0];

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const users = {};
    for (const u of demoUsers) {
      const id = uuid();
      const invitedBy = u.key === "admin" ? null : users.admin.id;
      const row = (await client.query(
        `INSERT INTO users (id, org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active, must_change_password, created_at, invited_by, invited_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,false,now(),$9,CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END)
         RETURNING id, email, full_name, role`,
        [id, org.id, u.email, u.fullName, passwordHash, u.role, base32Secret(), u.active, invitedBy]
      )).rows[0];
      users[u.key] = row;
      await applyOptionalTermsEvidence(client, row.id, users.admin?.id || row.id, usersCols, u.key === "admin");
    }

    await insertRolePermissions(client, org.id);

    const patients = [];
    for (let i = 0; i < patientSeeds.length; i++) {
      const [first, last, dob, diagnosis] = patientSeeds[i];
      const guardianLast = pick(["Brooks", "Miller", "Reed", "Stone", "Foster", "Hayes", "Cole", "Morgan"], i);
      const guardian = `${pick(["Sarah", "David", "Nina", "Robert", "Leah", "Thomas", "Monica", "Adam"], i)} ${guardianLast}`;
      const row = (await client.query(
        `INSERT INTO patients (id, org_id, first_name, last_name, date_of_birth, external_id, guardian_name, guardian_phone, guardian_email, diagnosis, insurance, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12) RETURNING id, first_name, last_name`,
        [uuid(), org.id, first, last, dob, `ANG-${String(i + 1).padStart(4, "0")}`, guardian, `617-555-${String(1000 + i).slice(-4)}`, `guardian${i + 1}@example.com`, diagnosis, pick(["BlueCross demo plan", "MassHealth demo plan", "Aetna demo plan", "United Behavioral demo plan"], i), isoTs(160 - i, 9)]
      )).rows[0];
      patients.push(row);
    }

    const serviceCodes = ["97153", "97155", "97156", "97151", "0373T"];
    const sessionUsers = [users.therapist1.id, users.therapist2.id, users.rbt1.id, users.rbt2.id, users.bcba.id];
    for (let i = 0; i < 132; i++) {
      const p = patients[i % patients.length];
      const userId = pick(sessionUsers, i);
      const startHour = 8 + (i % 8);
      const duration = 1 + (i % 3);
      const activity = pick(activities, i);
      const intervention = pick(interventions, i + 1);
      const response = pick(responses, i + 2);
      await client.query(
        `INSERT INTO session_logs (id, org_id, patient_id, user_id, session_date, start_time, end_time, location, service_code, participants, activities, interventions_used, response_to_intervention, progress_notes, ai_summary, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [uuid(), org.id, p.id, userId, isoDate(1 + (i % 95)), time(startHour, (i % 2) * 30), time(startHour + duration, (i % 2) * 30), pick(locations, i), pick(serviceCodes, i), pick(["Patient, therapist", "Patient, RBT, caregiver", "Patient, BCBA, caregiver", "Patient and school team"], i), activity, intervention, response, `${p.first_name} participated in ${activity}. Staff used ${intervention}. ${response}`, `Structured summary: ${p.first_name} worked on communication, transition tolerance, and safety routines. Next session should continue prompt fading and reinforce independent requests.`, pick(statuses, i), isoTs(1 + (i % 95), startHour, (i % 2) * 30)]
      );
    }

    const behaviorUsers = [users.rbt1.id, users.rbt2.id, users.therapist1.id, users.therapist2.id, users.bcba.id];
    for (let i = 0; i < 128; i++) {
      const p = patients[(i * 3) % patients.length];
      const ante = pick(antecedents, i);
      const beh = pick(behaviors, i + 1);
      const cons = pick(consequences, i + 2);
      const intensity = 1 + (i % 5);
      const injury = i % 29 === 0;
      const restraint = false;
      await client.query(
        `INSERT INTO behavior_events (id, org_id, patient_id, user_id, event_time, antecedent, behavior, consequence, intensity, duration_seconds, location, suspected_function, deescalation, injury, restraint, notes, created_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [uuid(), org.id, p.id, pick(behaviorUsers, i), isoTs(1 + (i % 90), 9 + (i % 8), (i % 4) * 15), ante, beh, cons, intensity, 30 + (i % 12) * 20, pick(locations, i + 3), pick(["escape", "access", "attention", "sensory", "automatic"], i), pick(["prompted functional communication response", "offered scheduled break", "used calm voice and visual timer", "reduced environmental noise", "provided choices and reinforced calm body"], i), injury, restraint, `${ante} preceded ${beh}. Staff ${cons}. Patient returned to baseline and session continued with adjusted demand level.`, isoTs(1 + (i % 90), 10 + (i % 6), (i % 4) * 15), pick(statuses, i + 1)]
      );
    }

    const incidentUsers = [users.supervisor.id, users.therapist1.id, users.therapist2.id, users.rbt1.id, users.rbt2.id];
    for (let i = 0; i < 118; i++) {
      const p = patients[(i * 5) % patients.length];
      const category = pick(incidentCategories, i);
      const severity = i % 37 === 0 ? "high" : i % 11 === 0 ? "medium" : "low";
      const desc = `${category.replaceAll("-", " ")} observed for ${p.first_name}. Staff followed the active safety and communication plan, documented the event, and confirmed patient returned to baseline.`;
      await client.query(
        `INSERT INTO incidents (id, org_id, patient_id, reported_by, incident_date, category, severity, location, description, immediate_actions, notifications, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [uuid(), org.id, p.id, pick(incidentUsers, i), isoTs(1 + (i % 100), 8 + (i % 9), (i % 4) * 15), category, severity, pick(locations, i + 1), desc, pick(["Provided first aid observation and documented outcome.", "Redirected patient to safe area and notified supervisor.", "Implemented elopement protocol and caregiver update.", "Reduced demands, monitored for escalation, and reviewed plan.", "Completed ABC note and scheduled team review."], i), pick(["Caregiver notified by phone.", "Supervisor notified and reviewed same day.", "BCBA copied for review.", "No external notification required; logged for trend tracking."], i), pick(["Draft", "Reviewed", "Reviewed", "Draft", "Reviewed"], i), isoTs(1 + (i % 100), 9 + (i % 6), (i % 4) * 15)]
      );
    }

    for (let i = 0; i < 42; i++) {
      const p = patients[i % patients.length];
      const focus = pick(["functional communication", "transition tolerance", "adaptive living", "safety awareness", "peer interaction", "behavior reduction", "caregiver generalization"], i);
      const goals = [
        `${p.first_name} will use an appropriate request or break response in 80% of observed opportunities.`,
        `${p.first_name} will complete a transition routine with no more than one prompt across three consecutive sessions.`,
        `${p.first_name} will participate in a structured activity for 10 minutes with reinforcement schedule fading.`
      ];
      const planInterventions = [
        "Use visual schedule and first/then board before transitions.",
        "Reinforce functional communication responses immediately.",
        "Fade prompts from full verbal to gesture/model prompts.",
        "Collect frequency and duration data for target behaviors.",
        "Review caregiver implementation weekly."
      ];
      await client.query(
        `INSERT INTO therapy_plans (id, org_id, patient_id, title, plan_type, goals, interventions, restrictions, effective_from, effective_to, status, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)`,
        [uuid(), org.id, p.id, `${focus[0].toUpperCase()}${focus.slice(1)} plan for ${p.first_name}`, focus.includes("behavior") ? "behavior_support" : "therapy", json(goals), json(planInterventions), json(["Do not use physical prompting except as specified in safety protocol.", "Escalations require supervisor notification and documentation."]), isoDate(120 - (i % 30)), isoDate(-(60 + (i % 90))), pick(["Draft", "Reviewed", "Reviewed"], i), pick([users.bcba.id, users.supervisor.id], i), isoTs(120 - (i % 45), 10)]
      );
    }

    const reportUsers = [users.bcba.id, users.supervisor.id, users.therapist1.id, users.therapist2.id];
    for (let i = 0; i < 56; i++) {
      const p = patients[(i * 2) % patients.length];
      const reportType = pick(reportTypes, i);
      const prompt = `Create a ${reportType.replaceAll("_", " ")} for ${p.first_name} ${p.last_name} using recent sessions, behavior trends, caregiver feedback, and incident notes.`;
      const output = `${p.first_name} continues to make measurable progress in communication and participation goals. Recent documentation shows improved tolerance for transitions, increased use of prompted functional communication, and reduced duration of refusal episodes. Continue current reinforcement plan, review safety supports, and monitor behavior frequency over the next authorization period. This draft requires clinician review before external use.`;
      await client.query(
        `INSERT INTO ai_reports (id, org_id, patient_id, created_by, report_type, source_ids, prompt, output, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
        [uuid(), org.id, p.id, pick(reportUsers, i), reportType, json([]), prompt, output, pick(["Draft", "Reviewed", "Draft", "Reviewed"], i), isoTs(1 + (i % 75), 14, (i % 4) * 10)]
      );
    }

    await client.query(
      `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, details)
       VALUES ($1,$2,'demo_seed_imported','organization',$1,$3::jsonb)`,
      [org.id, users.admin.id, json({ patients: 36, sessions: 132, behavior_events: 128, incidents: 118, plans: 42, reports: 56, seeded_at: new Date().toISOString() })]
    );

    await client.query("COMMIT");

    console.log("✅ Angel Therapy demo org loaded successfully.");
    console.log(`Organization: ${ORG_NAME}`);
    console.log(`Admin: admin@angeltherapy.com / ${PASSWORD}`);
    console.log(`BCBA: bcba@angeltherapy.com / ${PASSWORD}`);
    console.log("Additional users: supervisor@angeltherapy.com, therapist1@angeltherapy.com, therapist2@angeltherapy.com, rbt1@angeltherapy.com, rbt2@angeltherapy.com, billing@angeltherapy.com");
    console.log("Loaded: 36 patients, 132 session logs, 128 behavior events, 118 incidents, 42 plans, 56 reports.");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("❌ Demo seed failed:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
