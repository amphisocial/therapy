/*!
 * TherapyAgent — professional BCBA dashboard.
 * Loaded after app.js and charts.js. Reuses app.js globals ($, $$, api,
 * escapeHtml, panel, startNewBcbaChatSession) which are plain top-level
 * function/const declarations in a classic (non-module) script, so they
 * live on window and are safe to reuse here without editing app.js.
 *
 * This file intentionally overrides two existing globals rather than
 * patching app.js in place:
 *   - refreshDashboard()  -> renders the new KPI + chart dashboard
 *   - renderAnalytics()   -> renders the new chart-driven analytics deep-dive
 * Every call site in app.js (login, refresh button, etc.) calls these by
 * name at runtime, so reassigning them here fully replaces the old
 * plain-number/table rendering without touching the original file.
 */
(function () {
  "use strict";

  const ICONS = {
    users: '<path d="M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="10" cy="7" r="3.4"/><path d="M20.5 20v-1a3.6 3.6 0 0 0-2.6-3.5"/><path d="M15 3.6A3.6 3.6 0 0 1 15 10.7"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 9.5h17"/><path d="M8 3v3.6"/><path d="M16 3v3.6"/><path d="m8.3 14 2 2 3.6-4"/>',
    activity: '<path d="M3 12h4l2.2 6.5L13.4 5l2.4 7H21"/>',
    alertTri: '<path d="M12 4 2.4 20.5h19.2Z"/><path d="M12 10v4.4"/><circle cx="12" cy="17.6" r="0.8" fill="currentColor" stroke="none"/>',
    alertOct: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
    file: '<path d="M6 3.4h8l4.6 4.6v12.6H6Z"/><path d="M14 3.4V8h4.6"/><path d="M9 13h6M9 16.4h6"/>',
    inbox: '<path d="M4 12.5 6.4 4h11.2l2.4 8.5"/><path d="M4 12.5v6.1h16v-6.1"/><path d="M4 12.5h4.6l1.2 2.3h4.4l1.2-2.3H20"/>'
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
  }

  function esc(s) { return (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? "" : s)); }
  function num(n) { return Number(n || 0).toLocaleString("en-US"); }

  function riskTier(score) {
    const s = Number(score) || 0;
    if (s >= 6) return { cls: "badge-high", label: "High" };
    if (s >= 3) return { cls: "badge-med", label: "Moderate" };
    return { cls: "badge-low", label: "Low" };
  }

  // ---------------------------------------------------------------------
  // KPI card
  // ---------------------------------------------------------------------
  function kpiCard({ icon: ic, accent, accentSoft, value, label, sub }) {
    return `<div class="kpi-card" style="--kpi-accent:${accent};--kpi-accent-soft:${accentSoft}">
      <div class="kpi-top">
        <div class="kpi-icon">${icon(ic)}</div>
      </div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-label">${esc(label)}</div>
      ${sub ? `<div class="kpi-trend flat">${esc(sub)}</div>` : ""}
    </div>`;
  }

  function kpiRow(m) {
    const cards = [
      kpiCard({ icon: "users", accent: "#2563eb", accentSoft: "#eaf1ff", value: num(m.active_patients), label: "Active caseload", sub: "Patients currently in service" }),
      kpiCard({ icon: "calendar", accent: "#0d9488", accentSoft: "#e6f6f4", value: num(m.sessions_30), label: "Sessions (30d)", sub: "Logged or drafted" }),
      kpiCard({ icon: "activity", accent: "#7c3aed", accentSoft: "#f1eafe", value: num(m.behaviors_30), label: "Behavior events (30d)", sub: "All intensities" }),
      kpiCard({ icon: "alertOct", accent: "#b91c1c", accentSoft: "#fdeaea", value: num(m.open_incidents), label: "Open incidents", sub: `${num(m.incidents_30)} logged in 30d` }),
      kpiCard({ icon: "clock", accent: "#b45309", accentSoft: "#fef3e0", value: num(m.plans_expiring_30), label: "Plans expiring (30d)", sub: "Need renewal review" }),
      kpiCard({ icon: "file", accent: "#2563eb", accentSoft: "#eaf1ff", value: num(m.reports_30), label: "AI reports (30d)", sub: "Clinician review required" }),
      kpiCard({ icon: "inbox", accent: "#334155", accentSoft: "#eef1f7", value: num(m.under_review), label: "Pending review", sub: "Across all record types" }),
      kpiCard({ icon: "alertTri", accent: "#0d9488", accentSoft: "#e6f6f4", value: num((m.active_patients || 0) - (m.plans_expiring_30 || 0) < 0 ? 0 : m.active_patients), label: "Caseload continuity", sub: "See care-plan coverage below" })
    ];
    return `<div class="kpi-grid">${cards.join("")}</div>`;
  }

  // ---------------------------------------------------------------------
  // Main dashboard (glanceable)
  // ---------------------------------------------------------------------
  function riskRowsHtml(rows) {
    if (!rows || !rows.length) return `<div class="ta-chart-empty">No active patients meet a risk threshold right now.</div>`;
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Patient</th><th>Signal</th><th>Behaviors (30d)</th><th>Incidents (30d)</th><th>High-severity</th><th>Avg intensity</th><th>Sessions (30d)</th><th>Evidence</th></tr></thead>
      <tbody>${rows.map((r) => {
        const t = riskTier(r.risk_score);
        return `<tr>
          <td><button class="link-btn" type="button" data-ai-patient-risk="${esc(r.patient_id)}">${esc(r.patient_name || "Patient")}</button></td>
          <td><span class="badge ${t.cls}">${t.label} · ${esc(r.risk_score ?? 0)}</span></td>
          <td>${num(r.behavior_30)}</td>
          <td>${num(r.incident_30)}</td>
          <td>${num(r.high_incident_30)}</td>
          <td>${esc(Number(r.avg_intensity_30 || 0).toFixed(1))}</td>
          <td>${num(r.sessions_30)}</td>
          <td class="muted">${esc((r.signals || []).join("; ") || "—")}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function wireRiskButtons(root) {
    (root.querySelectorAll ? [...root.querySelectorAll("[data-ai-patient-risk]")] : []).forEach((b) => {
      b.onclick = () => {
        window.panel && window.panel("bcbaChat");
        setTimeout(() => {
          window.startNewBcbaChatSession && window.startNewBcbaChatSession(b.dataset.aiPatientRisk || "");
          const input = document.getElementById("bcbaChatInput");
          if (input) { input.value = "Prepare a BCBA plan review briefing for this patient. Highlight behavior trends, incident risk, possible antecedent/function patterns, intervention response, and data gaps."; input.focus(); }
        }, 300);
      };
    });
  }

  async function renderProDashboard() {
    const mount = document.getElementById("dashboardMount");
    if (!mount) return;
    mount.innerHTML = `<div class="loading-state">Loading BCBA dashboard…</div>`;
    try {
      const [dash, trends] = await Promise.all([
        window.api("/api/analytics/dashboard"),
        window.api("/api/analytics/trends?weeks=12").catch(() => null)
      ]);
      window.analyticsCache = dash;
      const m = dash.metrics || {};

      const planCoverageIssue = (dash.data_quality || []).find((d) => /active.*therapy plan/i.test(d.label || ""));
      const withoutPlan = planCoverageIssue ? Number(planCoverageIssue.count) || 0 : 0;
      const coveragePct = m.active_patients ? Math.max(0, Math.min(100, Math.round(((m.active_patients - withoutPlan) / m.active_patients) * 100))) : 100;

      const trendChart = trends
        ? window.TACharts.line({
            labels: trends.labels,
            series: [
              { name: "Sessions", color: "#2563eb", values: trends.series.sessions },
              { name: "Behavior events", color: "#7c3aed", values: trends.series.behaviors },
              { name: "Incidents", color: "#b91c1c", values: trends.series.incidents }
            ]
          })
        : window.TACharts.emptyState();

      const behaviorDonut = window.TACharts.donut({
        data: (dash.behavior_functions || []).map((r) => ({ label: r.label, value: r.count })),
        centerLabel: "Events (90d)",
        centerValue: (dash.behavior_functions || []).reduce((s, r) => s + Number(r.count || 0), 0)
      });
      const severityDonut = window.TACharts.donut({
        data: (dash.incident_severity || []).map((r) => ({
          label: r.label, value: r.count,
          color: /high|critical/i.test(r.label) ? "#b91c1c" : /moderate|medium/i.test(r.label) ? "#b45309" : "#0d9488"
        })),
        centerLabel: "Incidents (90d)",
        centerValue: (dash.incident_severity || []).reduce((s, r) => s + Number(r.count || 0), 0)
      });
      const staffBars = window.TACharts.bars({
        horizontal: true,
        data: (dash.staff_workload || []).slice(0, 8).map((r) => ({ label: r.full_name, value: r.sessions_30, color: "#2563eb" }))
      });

      mount.innerHTML = `
        ${kpiRow(m)}
        <div class="chart-grid">
          <div class="chart-card span-8">
            <div class="chart-card-head">
              <div><h3>Documentation &amp; activity trend</h3><p>Sessions, behavior events, and incidents logged per week — last 12 weeks.</p></div>
              <span class="chip">Weekly</span>
            </div>
            ${trendChart}
          </div>
          <div class="chart-card span-4">
            <div class="chart-card-head"><div><h3>Care-plan coverage</h3><p>Active caseload with a current therapy plan on file.</p></div></div>
            <div style="display:flex;justify-content:center;padding:8px 0 4px">${window.TACharts.ring({ value: coveragePct, max: 100, label: `${m.active_patients || 0} active patients` })}</div>
            ${withoutPlan ? `<div class="notice" style="margin-top:8px">${withoutPlan} patient${withoutPlan === 1 ? "" : "s"} without a current plan on file.</div>` : ""}
          </div>

          <div class="chart-card span-4">
            <div class="chart-card-head"><div><h3>Behavior — suspected function</h3><p>Last 90 days, organization-wide.</p></div></div>
            ${behaviorDonut}
          </div>
          <div class="chart-card span-4">
            <div class="chart-card-head"><div><h3>Incidents by severity</h3><p>Last 90 days, organization-wide.</p></div></div>
            ${severityDonut}
          </div>
          <div class="chart-card span-4">
            <div class="chart-card-head"><div><h3>Staff workload</h3><p>Sessions logged, last 30 days.</p></div></div>
            ${staffBars}
          </div>

          <div class="chart-card span-12">
            <div class="chart-card-head">
              <div><h3>Patient risk signals</h3><p>Transparent, evidence-based indicators from recent behaviors, incidents, intensity, session consistency, and plan currency. Decision-support only — requires BCBA review, not a diagnosis or autonomous treatment decision.</p></div>
              <span class="chip">Top ${(dash.risk_signals || []).length}</span>
            </div>
            ${riskRowsHtml(dash.risk_signals)}
          </div>
        </div>`;
      wireRiskButtons(mount);
    } catch (e) {
      mount.innerHTML = `<div class="error">${esc(e.message || "Could not load the dashboard.")}</div>`;
    }
  }

  // ---------------------------------------------------------------------
  // Analytics deep-dive (detailed tables + full-size charts)
  // ---------------------------------------------------------------------
  function dataQualityHtml(rows) {
    if (!rows || !rows.length) return `<div class="ta-chart-empty">No data-quality flags.</div>`;
    const max = Math.max(1, ...rows.map((r) => Number(r.count) || 0));
    return `<div class="data-quality-list">${rows.map((r) => {
      const c = Number(r.count) || 0;
      const pct = Math.round((c / max) * 100);
      return `<div class="dq-row">
        <span class="dq-label">${esc(r.label)}<br><span class="muted" style="font-weight:500">${esc(r.recommendation || "")}</span></span>
        <span class="dq-track"><span class="dq-fill ${c === 0 ? "ok" : ""}" style="width:${c === 0 ? 4 : pct}%"></span></span>
        <span class="dq-count">${c}</span>
      </div>`;
    }).join("")}</div>`;
  }

  function staffTableHtml(rows) {
    if (!rows || !rows.length) return `<div class="ta-chart-empty">No active staff found.</div>`;
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>User</th><th>Role</th><th>Sessions (30d)</th><th>Behaviors (30d)</th><th>Incidents (30d)</th><th>AI reports (30d)</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.full_name)}</td><td>${esc(r.role)}</td><td>${num(r.sessions_30)}</td><td>${num(r.behaviors_30)}</td><td>${num(r.incidents_30)}</td><td>${num(r.reports_30)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }

  function renderAnalyticsPro(out) {
    const mount = document.getElementById("analyticsContent");
    if (!mount) return;
    const m = out.metrics || {};

    mount.innerHTML = `
      <div class="kpi-grid" style="margin-bottom:18px">
        ${kpiCard({ icon: "users", accent: "#2563eb", accentSoft: "#eaf1ff", value: num(m.active_patients), label: "Active patients" })}
        ${kpiCard({ icon: "calendar", accent: "#0d9488", accentSoft: "#e6f6f4", value: num(m.sessions_30), label: "Sessions / 30d" })}
        ${kpiCard({ icon: "activity", accent: "#7c3aed", accentSoft: "#f1eafe", value: num(m.behaviors_30), label: "Behavior events / 30d" })}
        ${kpiCard({ icon: "inbox", accent: "#334155", accentSoft: "#eef1f7", value: num(m.under_review), label: "Under review" })}
      </div>
      <div class="chart-grid">
        <div class="chart-card span-6">
          <div class="chart-card-head"><div><h3>Behavior — suspected function</h3><p>Last 90 days.</p></div></div>
          ${window.TACharts.bars({ horizontal: true, data: (out.behavior_functions || []).map((r) => ({ label: r.label, value: r.count, color: "#7c3aed" })) })}
        </div>
        <div class="chart-card span-6">
          <div class="chart-card-head"><div><h3>Incidents by severity</h3><p>Last 90 days.</p></div></div>
          ${window.TACharts.bars({ horizontal: true, data: (out.incident_severity || []).map((r) => ({ label: r.label, value: r.count, color: /high|critical/i.test(r.label) ? "#b91c1c" : /moderate|medium/i.test(r.label) ? "#b45309" : "#0d9488" })) })}
        </div>

        <div class="chart-card span-12">
          <div class="chart-card-head"><div><h3>Staff workload — last 30 days</h3><p>Sessions, behavior events, incidents, and AI reports logged per staff member.</p></div></div>
          ${window.TACharts.bars({ horizontal: true, data: (out.staff_workload || []).map((r) => ({ label: r.full_name, value: r.sessions_30, color: "#2563eb" })) })}
          ${staffTableHtml(out.staff_workload)}
        </div>

        <div class="chart-card span-12">
          <div class="chart-card-head">
            <div><h3>Patient risk signals</h3><p>Decision-support indicators only — requires BCBA review before any plan or treatment decision.</p></div>
            <span class="chip">Top ${(out.risk_signals || []).length}</span>
          </div>
          ${riskRowsHtml(out.risk_signals)}
        </div>

        <div class="chart-card span-12">
          <div class="chart-card-head"><div><h3>Compliance &amp; documentation quality</h3><p>Lower is better. These checks flag records that likely need clinician attention.</p></div></div>
          ${dataQualityHtml(out.data_quality)}
        </div>
      </div>`;
    wireRiskButtons(mount);
  }

  async function loadAnalyticsPro() {
    const mount = document.getElementById("analyticsContent");
    if (!mount) return;
    mount.innerHTML = `<div class="loading-state">Loading analytics…</div>`;
    try {
      const out = await window.api("/api/analytics/dashboard");
      window.analyticsCache = out;
      renderAnalyticsPro(out);
    } catch (e) {
      mount.innerHTML = `<div class="error">${esc(e.message || "Could not load analytics.")}</div>`;
    }
  }

  // Override the old plain-number dashboard + text-table analytics renderers.
  window.refreshDashboard = renderProDashboard;
  window.renderAnalytics = renderAnalyticsPro;
  window.loadAnalytics = loadAnalyticsPro;

  // If the dashboard panel is already the active one when this script runs
  // (e.g. a hard refresh while logged in), render immediately once auth
  // has resolved. app.js's own init calls refreshDashboard() too, so this
  // is a harmless best-effort first paint for the mount's empty state.
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.getElementById("dashboardMount");
    if (mount && !mount.innerHTML.trim()) mount.innerHTML = `<div class="loading-state">Loading BCBA dashboard…</div>`;
  });
})();
