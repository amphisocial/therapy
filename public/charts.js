/*!
 * TherapyAgent chart engine — dependency-free SVG chart primitives.
 * No CDN, no external requests: everything a clinical workspace renders
 * stays inside the app bundle, which matters for HIPAA-conscious deployments.
 *
 * Exposes window.TACharts with pure functions that return SVG/HTML markup
 * strings. Callers just do: el.innerHTML = TACharts.line(...);
 */
(function (window) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#2563eb", "#0d9488", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#65a30d", "#db2777"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) {
    const v = Number(n) || 0;
    return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
  }
  function uid(prefix) {
    return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
  }
  function niceMax(max) {
    if (max <= 0) return 4;
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    const norm = max / mag;
    let step;
    if (norm <= 1) step = 1; else if (norm <= 2) step = 2; else if (norm <= 5) step = 5; else step = 10;
    return step * mag;
  }

  // ---------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------
  function emptyState(label = "No data for this period yet.") {
    return `<div class="ta-chart-empty">${esc(label)}</div>`;
  }

  // ---------------------------------------------------------------------
  // Multi-series line / area chart with a light grid, used for trend cards.
  // opts: { labels:[str], series:[{name,color,values:[num]}], height, area }
  // ---------------------------------------------------------------------
  function line(opts) {
    const { labels = [], series = [], height = 220, area = true } = opts;
    const allVals = series.flatMap((s) => s.values || []);
    if (!labels.length || !allVals.length) return emptyState();
    const w = 640, h = height, padL = 34, padR = 14, padT = 16, padB = 28;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const maxV = niceMax(Math.max(1, ...allVals));
    const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
    const xAt = (i) => padL + stepX * i;
    const yAt = (v) => padT + innerH - (v / maxV) * innerH;

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = padT + innerH * (1 - f);
      const val = fmt(maxV * f);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="ta-chart-grid"/><text x="${padL - 8}" y="${y + 4}" class="ta-chart-axis" text-anchor="end">${val}</text>`;
    }).join("");

    const everyN = Math.ceil(labels.length / 7);
    const xLabels = labels.map((l, i) => (i % everyN === 0 || i === labels.length - 1)
      ? `<text x="${xAt(i)}" y="${h - 6}" class="ta-chart-axis" text-anchor="middle">${esc(l)}</text>` : "").join("");

    const seriesSvg = series.map((s, si) => {
      const color = s.color || PALETTE[si % PALETTE.length];
      const pts = (s.values || []).map((v, i) => [xAt(i), yAt(v)]);
      const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      const areaPath = area ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${padT + innerH} L${pts[0][0].toFixed(1)},${padT + innerH} Z` : "";
      const dots = pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${color}"><title>${esc(labels[i])}: ${fmt(s.values[i])}</title></circle>`).join("");
      const gid = uid("grad");
      return `
        ${area ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.22"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
        <path d="${areaPath}" fill="url(#${gid})" stroke="none"/>` : ""}
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" class="ta-chart-line"/>
        ${dots}`;
    }).join("");

    const legend = series.length > 1 ? `<div class="ta-chart-legend">${series.map((s, si) => `<span class="ta-legend-item"><i style="background:${s.color || PALETTE[si % PALETTE.length]}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";

    return `<div class="ta-chart-wrap">
      <svg viewBox="0 0 ${w} ${h}" class="ta-chart-svg" role="img" aria-label="Trend chart" preserveAspectRatio="xMidYMid meet">
        ${gridLines}${seriesSvg}${xLabels}
      </svg>${legend}</div>`;
  }

  // ---------------------------------------------------------------------
  // Horizontal / vertical bar chart. opts: {data:[{label,value,color}], horizontal, height}
  // ---------------------------------------------------------------------
  function bars(opts) {
    const { data = [], horizontal = true, height, unit = "" } = opts;
    const clean = data.filter((d) => d && d.label);
    if (!clean.length) return emptyState();
    const maxV = niceMax(Math.max(1, ...clean.map((d) => Number(d.value) || 0)));

    if (horizontal) {
      const rowH = 30;
      const h = clean.length * rowH + 8;
      const w = 640, padL = 148, padR = 46;
      const innerW = w - padL - padR;
      const rows = clean.map((d, i) => {
        const val = Number(d.value) || 0;
        const bw = Math.max(2, (val / maxV) * innerW);
        const y = i * rowH + 6;
        const color = d.color || PALETTE[i % PALETTE.length];
        return `
          <text x="${padL - 10}" y="${y + 14}" class="ta-chart-rowlabel" text-anchor="end">${esc(d.label)}</text>
          <rect x="${padL}" y="${y}" width="${innerW}" height="18" rx="4" class="ta-chart-track"/>
          <rect x="${padL}" y="${y}" width="${bw}" height="18" rx="4" fill="${color}"><title>${esc(d.label)}: ${fmt(val)}${unit}</title></rect>
          <text x="${padL + bw + 8}" y="${y + 14}" class="ta-chart-value">${fmt(val)}${unit}</text>`;
      }).join("");
      return `<div class="ta-chart-wrap"><svg viewBox="0 0 ${w} ${h}" class="ta-chart-svg" role="img" aria-label="Bar chart" preserveAspectRatio="xMidYMid meet">${rows}</svg></div>`;
    }

    const w = 640, h = height || 240, padL = 34, padR = 10, padT = 14, padB = 34;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const bw = innerW / clean.length;
    const bars_ = clean.map((d, i) => {
      const val = Number(d.value) || 0;
      const bh = Math.max(2, (val / maxV) * innerH);
      const x = padL + i * bw + bw * 0.18;
      const bwid = bw * 0.64;
      const y = padT + innerH - bh;
      const color = d.color || PALETTE[i % PALETTE.length];
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bwid.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${color}"><title>${esc(d.label)}: ${fmt(val)}${unit}</title></rect>
        <text x="${(x + bwid / 2).toFixed(1)}" y="${h - 10}" class="ta-chart-axis" text-anchor="middle">${esc(d.label)}</text>
        <text x="${(x + bwid / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="ta-chart-value" text-anchor="middle">${fmt(val)}</text>`;
    }).join("");
    const grid = [0, 0.5, 1].map((f) => `<line x1="${padL}" y1="${padT + innerH * (1 - f)}" x2="${w - padR}" y2="${padT + innerH * (1 - f)}" class="ta-chart-grid"/>`).join("");
    return `<div class="ta-chart-wrap"><svg viewBox="0 0 ${w} ${h}" class="ta-chart-svg" role="img" aria-label="Bar chart" preserveAspectRatio="xMidYMid meet">${grid}${bars_}</svg></div>`;
  }

  // ---------------------------------------------------------------------
  // Donut chart. opts: {data:[{label,value,color}], size, centerLabel, centerValue}
  // ---------------------------------------------------------------------
  function donut(opts) {
    const { data = [], size = 200, centerLabel = "", centerValue = "" } = opts;
    const clean = data.filter((d) => d && Number(d.value) > 0);
    const total = clean.reduce((s, d) => s + Number(d.value), 0);
    if (!clean.length || !total) return emptyState();
    const r = 70, cx = 90, cy = 90, sw = 26;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const segs = clean.map((d, i) => {
      const frac = Number(d.value) / total;
      const dash = frac * circ;
      const color = d.color || PALETTE[i % PALETTE.length];
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" class="ta-donut-seg"><title>${esc(d.label)}: ${fmt(d.value)} (${Math.round(frac * 100)}%)</title></circle>`;
      offset += dash;
      return seg;
    }).join("");
    const legend = clean.map((d, i) => `<span class="ta-legend-item"><i style="background:${d.color || PALETTE[i % PALETTE.length]}"></i>${esc(d.label)} <b>${fmt(d.value)}</b></span>`).join("");
    return `<div class="ta-donut-wrap" style="--donut-size:${size}px">
      <svg viewBox="0 0 180 180" class="ta-donut-svg" role="img" aria-label="Donut chart">
        ${segs}
        <text x="90" y="86" text-anchor="middle" class="ta-donut-value">${esc(centerValue || total)}</text>
        <text x="90" y="106" text-anchor="middle" class="ta-donut-label">${esc(centerLabel || "Total")}</text>
      </svg>
      <div class="ta-chart-legend ta-donut-legend">${legend}</div>
    </div>`;
  }

  // ---------------------------------------------------------------------
  // Radial progress ring for a single ratio, e.g. compliance %.
  // opts: {value, max, label, color, size}
  // ---------------------------------------------------------------------
  function ring(opts) {
    const { value = 0, max = 100, label = "", color, size = 128 } = opts;
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const r = 52, cx = 64, cy = 64, sw = 12;
    const circ = 2 * Math.PI * r;
    const dash = pct * circ;
    const c = color || (pct >= 0.8 ? "#0d9488" : pct >= 0.5 ? "#f59e0b" : "#dc2626");
    return `<div class="ta-ring-wrap" style="--ring-size:${size}px">
      <svg viewBox="0 0 128 128" class="ta-ring-svg" role="img" aria-label="${esc(label)}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${sw}" class="ta-chart-track"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>
        <text x="64" y="70" text-anchor="middle" class="ta-ring-value">${Math.round(pct * 100)}%</text>
      </svg>
      <div class="ta-ring-label">${esc(label)}</div>
    </div>`;
  }

  window.TACharts = { line, bars, donut, ring, emptyState, escapeHtml: esc };
})(window);
