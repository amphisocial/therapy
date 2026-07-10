#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime
import shutil

ROOT = Path.cwd()
STAMP = datetime.now().strftime('%Y%m%d-%H%M%S')


def backup(path: Path):
    if path.exists():
        dest = path.with_suffix(path.suffix + f'.backup.global-search-{STAMP}')
        shutil.copy2(path, dest)
        print(f'Backed up {path} -> {dest}')


def copy_app_js():
    src = ROOT / 'public' / 'app.js'
    package_app = Path(__file__).resolve().parents[1] / 'public' / 'app.js'
    if not package_app.exists():
        raise SystemExit(f'Package app.js missing: {package_app}')
    backup(src)
    if package_app.resolve() == src.resolve():
        print(f"app.js already in place: {src}")
        return
    shutil.copy2(package_app, src)
    print('Installed updated public/app.js with global patient search and clean ISP text rendering.')


def patch_server():
    path = ROOT / 'server.js'
    if not path.exists():
        raise SystemExit('server.js not found. Run this from /opt/apps/therapy')
    s = path.read_text()
    if 'app.get("/api/search/patient-records"' in s:
        print('server.js already has /api/search/patient-records. Skipping server patch.')
        return
    backup(path)

    endpoint = r'''
// Global patient record search
async function tableExists(tableName) {
  const row = (await pool.query(`SELECT to_regclass($1) AS table_name`, [`public.${tableName}`])).rows[0];
  return Boolean(row?.table_name);
}

app.get("/api/search/patient-records", requireAuth, requireMfa, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "search_too_short", message: "Type at least 2 characters to search patients." });
  const orgId = req.user.org_id;
  const like = `%${q.replace(/[%_]/g, "").trim()}%`;
  try {
    const patients = (await pool.query(
      `SELECT p.id, p.first_name, p.last_name, trim(p.first_name || ' ' || p.last_name) AS full_name,
              p.date_of_birth, p.external_id, p.guardian_name, p.guardian_email, p.diagnosis, p.status, p.created_at
       FROM patients p
       WHERE p.org_id=$1
         AND (
           p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR trim(p.first_name || ' ' || p.last_name) ILIKE $2
           OR COALESCE(p.external_id,'') ILIKE $2
           OR COALESCE(p.guardian_name,'') ILIKE $2
           OR COALESCE(p.guardian_email,'') ILIKE $2
           OR COALESCE(p.diagnosis,'') ILIKE $2
         )
       ORDER BY lower(p.last_name), lower(p.first_name)
       LIMIT 25`,
      [orgId, like]
    )).rows;

    const patientIds = patients.map(p => p.id);
    const records = [];
    const counts = { sessions: 0, behaviors: 0, incidents: 0, plans: 0, isps: 0, reports: 0, files: 0 };

    if (!patientIds.length) {
      return res.json({ query: q, patients, records, counts, message: "No matching patients found." });
    }

    async function addRows(resource, sql, params) {
      const rows = (await pool.query(sql, params)).rows;
      counts[resource] = rows.length;
      records.push(...rows);
    }

    await addRows("sessions", `
      SELECT 'sessions' AS resource, s.id, s.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
             s.session_date AS record_date,
             COALESCE(NULLIF(s.service_code,''), NULLIF(s.location,''), 'Session log') AS title,
             COALESCE(NULLIF(s.response_to_intervention,''), NULLIF(s.ai_summary,''), NULLIF(s.activities,''), '') AS details,
             s.status, s.created_at, u.full_name AS created_by_name
      FROM session_logs s
      JOIN patients p ON p.id=s.patient_id AND p.org_id=s.org_id
      LEFT JOIN users u ON u.id=s.user_id
      WHERE s.org_id=$1 AND s.patient_id = ANY($2::uuid[])
      ORDER BY COALESCE(s.session_date::timestamptz, s.created_at) DESC LIMIT 120`, [orgId, patientIds]);

    await addRows("behaviors", `
      SELECT 'behaviors' AS resource, b.id, b.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
             b.event_time AS record_date,
             COALESCE(NULLIF(b.behavior,''), 'Behavior event') AS title,
             concat_ws(' | ', NULLIF(b.antecedent,''), NULLIF(b.suspected_function,''), NULLIF(b.location,'')) AS details,
             b.status, b.created_at, u.full_name AS created_by_name
      FROM behavior_events b
      JOIN patients p ON p.id=b.patient_id AND p.org_id=b.org_id
      LEFT JOIN users u ON u.id=b.user_id
      WHERE b.org_id=$1 AND b.patient_id = ANY($2::uuid[])
      ORDER BY COALESCE(b.event_time, b.created_at) DESC LIMIT 120`, [orgId, patientIds]);

    await addRows("incidents", `
      SELECT 'incidents' AS resource, i.id, i.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
             i.incident_date AS record_date,
             COALESCE(NULLIF(i.category,''), 'Incident') AS title,
             concat_ws(' | ', NULLIF(i.severity,''), NULLIF(i.location,''), left(COALESCE(i.description,''), 140)) AS details,
             i.status, i.created_at, u.full_name AS created_by_name
      FROM incidents i
      JOIN patients p ON p.id=i.patient_id AND p.org_id=i.org_id
      LEFT JOIN users u ON u.id=i.reported_by
      WHERE i.org_id=$1 AND i.patient_id = ANY($2::uuid[])
      ORDER BY COALESCE(i.incident_date, i.created_at) DESC LIMIT 120`, [orgId, patientIds]);

    await addRows("plans", `
      SELECT 'plans' AS resource, t.id, t.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
             COALESCE(t.effective_from, t.created_at::date) AS record_date,
             COALESCE(NULLIF(t.title,''), 'Therapy plan') AS title,
             COALESCE(NULLIF(t.plan_type,''), '') AS details,
             t.status, t.created_at, u.full_name AS created_by_name
      FROM therapy_plans t
      JOIN patients p ON p.id=t.patient_id AND p.org_id=t.org_id
      LEFT JOIN users u ON u.id=t.created_by
      WHERE t.org_id=$1 AND t.patient_id = ANY($2::uuid[])
      ORDER BY t.created_at DESC LIMIT 80`, [orgId, patientIds]);

    if (await tableExists('individual_service_plans')) {
      await addRows("isps", `
        SELECT 'isps' AS resource, isp.id, isp.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
               isp.created_at AS record_date,
               COALESCE(NULLIF(isp.title,''), 'Individual Service Plan') AS title,
               COALESCE(NULLIF(isp.plan_purpose,''), NULLIF(isp.behavioral_summary,''), '') AS details,
               isp.status, isp.created_at, u.full_name AS created_by_name
        FROM individual_service_plans isp
        JOIN patients p ON p.id=isp.patient_id AND p.org_id=isp.org_id
        LEFT JOIN users u ON u.id=isp.created_by
        WHERE isp.org_id=$1 AND isp.patient_id = ANY($2::uuid[])
        ORDER BY isp.created_at DESC LIMIT 80`, [orgId, patientIds]);
    }

    await addRows("reports", `
      SELECT 'reports' AS resource, r.id, r.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
             r.created_at AS record_date,
             COALESCE(NULLIF(r.report_type,''), 'AI report') AS title,
             left(COALESCE(r.output, r.prompt, ''), 160) AS details,
             r.status, r.created_at, u.full_name AS created_by_name
      FROM ai_reports r
      JOIN patients p ON p.id=r.patient_id AND p.org_id=r.org_id
      LEFT JOIN users u ON u.id=r.created_by
      WHERE r.org_id=$1 AND r.patient_id = ANY($2::uuid[])
      ORDER BY r.created_at DESC LIMIT 80`, [orgId, patientIds]);

    if (await tableExists('files')) {
      await addRows("files", `
        SELECT 'files' AS resource, f.id, f.patient_id, trim(p.first_name || ' ' || p.last_name) AS patient_name,
               f.created_at AS record_date,
               COALESCE(NULLIF(f.original_filename,''), 'Attachment') AS title,
               concat_ws(' | ', NULLIF(f.category,''), NULLIF(f.entity_type,''), NULLIF(f.mime_type,'')) AS details,
               '' AS status, f.created_at, u.full_name AS created_by_name
        FROM files f
        JOIN patients p ON p.id=f.patient_id AND p.org_id=f.org_id
        LEFT JOIN users u ON u.id=f.uploaded_by
        WHERE f.org_id=$1 AND f.patient_id = ANY($2::uuid[]) AND f.deleted_at IS NULL
        ORDER BY f.created_at DESC LIMIT 80`, [orgId, patientIds]);
    }

    records.sort((a, b) => new Date(b.record_date || b.created_at) - new Date(a.record_date || a.created_at));
    res.json({ query: q, patients, records, counts, message: `Found ${patients.length} patient match(es) and ${records.length} related record(s).` });
  } catch (e) {
    console.error('[patient-search]', e.message);
    res.status(500).json({ error: 'patient_search_failed', message: e.message || 'Patient search failed.' });
  }
});

'''
    marker = '// Admin APIs'
    if marker in s:
        s = s.replace(marker, endpoint + marker, 1)
    else:
        marker2 = 'app.get("/api/admin/users"'
        if marker2 not in s:
            raise SystemExit('Could not find insertion point for patient search endpoint.')
        s = s.replace(marker2, endpoint + marker2, 1)
    path.write_text(s)
    print('Patched server.js with /api/search/patient-records endpoint.')


if __name__ == '__main__':
    copy_app_js()
    patch_server()
    print('Global patient search update applied.')
