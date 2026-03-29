import { jsPDF } from 'jspdf';

import type { DisasterType } from '../hooks/useSimulation';

const MARGIN = 14;
const LINE = 4.8;
const TITLE = 18;
const HEAD = 11;
const BODY = 9;

/** Theme: crisis / operations dashboard */
const C = {
  heroTop: [15, 23, 42] as [number, number, number],
  heroBottom: [30, 58, 138] as [number, number, number],
  heroAccent: [56, 189, 248] as [number, number, number],
  textOnDark: [248, 250, 252] as [number, number, number],
  textMuted: [148, 163, 184] as [number, number, number],
  body: [51, 65, 85] as [number, number, number],
  label: [71, 85, 105] as [number, number, number],
  sections: {
    context: { bar: [59, 130, 246] as [number, number, number], bg: [239, 246, 255] as [number, number, number] },
    metrics: { bar: [14, 165, 233] as [number, number, number], bg: [224, 242, 254] as [number, number, number] },
    infra: { bar: [168, 85, 247] as [number, number, number], bg: [250, 245, 255] as [number, number, number] },
    roads: { bar: [245, 158, 11] as [number, number, number], bg: [255, 251, 235] as [number, number, number] },
    hazard: { bar: [239, 68, 68] as [number, number, number], bg: [254, 242, 242] as [number, number, number] },
    response: { bar: [16, 185, 129] as [number, number, number], bg: [236, 253, 245] as [number, number, number] },
  },
};

export interface LastRunMeta {
  radius_km: number;
  rainfall_mm?: number;
  ef_scale?: number;
  direction_deg?: number;
}

/** Tune PDF weight: smaller max edge / lower quality = smaller files. */
export const PDF_MAP_MAX_EDGE_PX = 1000;
export const PDF_MAP_JPEG_QUALITY = 0.62;
export const PDF_LOGO_MAX_WIDTH_PX = 200;
export const PDF_LOGO_JPEG_QUALITY = 0.86;

export interface ResponsePdfParams {
  logoDataUrl: string | null;
  logoWidthPx: number;
  logoHeightPx: number;
  disasterType: DisasterType;
  scenarioId: string | null;
  generatedAt: Date;
  location: { lat: number; lng: number } | null;
  radiusKm: number;
  lastRun: LastRunMeta | null;
  stats: Record<string, unknown> | null;
  agent1Text: string;
  agent1Data: Record<string, unknown> | null;
  agent2Text: string;
  agent2Data: Record<string, unknown> | null;
  blockedRoads: { blocked: number; partial: number; total: number };
  infrastructureCounts: Record<string, number>;
}

export async function fetchUrlAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Downscales a raster data URL and re-encodes as JPEG for much smaller PDFs than full PNG canvas dumps.
 */
export function compressRasterForPdf(
  imageDataUrl: string,
  maxEdgePx: number,
  jpegQuality: number
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (!w || !h) {
        resolve(null);
        return;
      }
      const edge = Math.max(w, h);
      const scale = edge > maxEdgePx ? maxEdgePx / edge : 1;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
        resolve({ dataUrl, width: w, height: h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

const MAX_NARRATIVE_CHARS = 14_000;

function truncatePdfText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[...truncated for PDF size]`;
}

/** Remove fenced ```json ... ``` blocks often echoed in model output (no raw JSON in PDF). */
function stripJsonCodeFences(text: string): string {
  return text
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pageInnerWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - MARGIN * 2;
}

function ensureSpace(doc: jsPDF, y: number, neededMm: number): number {
  const h = doc.internal.pageSize.getHeight();
  if (y + neededMm > h - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function pageW(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth();
}

/** Colored section title with left accent bar + tinted band */
function sectionHeader(
  doc: jsPDF,
  title: string,
  y: number,
  theme: { bar: [number, number, number]; bg: [number, number, number] }
): number {
  const w = pageW(doc) - MARGIN * 2;
  const barH = 9;
  y = ensureSpace(doc, y, barH + 5);
  doc.setFillColor(...theme.bg);
  doc.roundedRect(MARGIN, y, w, barH, 1.2, 1.2, 'F');
  doc.setFillColor(...theme.bar);
  doc.rect(MARGIN, y, 3.2, barH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(HEAD);
  doc.setTextColor(...theme.bar);
  doc.text(title, MARGIN + 5, y + 6.2);
  y += barH + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY);
  doc.setTextColor(...C.body);
  return y;
}

function writeLines(doc: jsPDF, text: string, y: number, _maxW: number, xPad = MARGIN + 3): number {
  if (!text.trim()) return y;
  const innerW = pageW(doc) - xPad - MARGIN;
  const lines = doc.splitTextToSize(text.replace(/\r\n/g, '\n'), innerW);
  for (const line of lines) {
    y = ensureSpace(doc, y, LINE);
    doc.text(line, xPad, y);
    y += LINE;
  }
  return y;
}

function writeLinesColored(
  doc: jsPDF,
  text: string,
  y: number,
  maxW: number,
  rgb: [number, number, number],
  xPad = MARGIN + 3
): number {
  doc.setTextColor(...rgb);
  y = writeLines(doc, text, y, maxW, xPad);
  doc.setTextColor(...C.body);
  return y;
}

function formatStats(disasterType: DisasterType, stats: Record<string, unknown> | null): string[] {
  if (!stats) return ['No quantitative statistics returned.'];
  if (disasterType === 'flood') {
    return [
      `Search area: ${stats.search_area_km2} km\u00B2`,
      `Flooded / hazard zone area: ${stats.total_area_km2} km\u00B2`,
      `High-risk area: ${stats.high_risk_area_km2} km\u00B2`,
      `Flood coverage: ${stats.flood_coverage_pct}% of search area`,
      `Flood zone features: ${stats.num_flood_zones}`,
      `Risk summary: ${stats.risk_summary}`,
    ];
  }
  return [
    `EF scale: EF${stats.ef_scale}`,
    `Path length: ${stats.path_length_km} km`,
    `Path width: ${stats.path_width_m} m`,
    `Affected area: ${stats.affected_area_km2} km\u00B2`,
    `Risk summary: ${stats.risk_summary}`,
  ];
}

function stringifyAgentData(data: Record<string, unknown> | null, label: string): string {
  if (!data) return '';
  const parts: string[] = [];
  const summary = data.summary;
  if (typeof summary === 'string' && summary.trim()) {
    parts.push(`${label} summary:\n${summary}`);
  }
  const riskZones = data.risk_zones;
  if (Array.isArray(riskZones) && riskZones.length) {
    parts.push('Risk zones:');
    for (const z of riskZones as Array<{ level?: string; description?: string }>) {
      parts.push(`  - [${z.level ?? '?'}] ${z.description ?? ''}`);
    }
  }
  const priority = data.priority_actions;
  if (Array.isArray(priority) && priority.length) {
    parts.push('Priority actions:');
    for (const a of priority as Array<{
      rank?: number;
      action?: string;
      reason?: string;
      urgency?: string;
    }>) {
      parts.push(
        `  ${a.rank ?? '-'}. (${a.urgency ?? 'n/a'}) ${a.action ?? ''}\n     Reason: ${a.reason ?? ''}`
      );
    }
  }
  const timeline = data.action_timeline;
  if (Array.isArray(timeline) && timeline.length) {
    parts.push('Action timeline:');
    for (const t of timeline as Array<{ timeframe?: string; actions?: string[] }>) {
      parts.push(`  ${t.timeframe ?? 'Period'}:`);
      for (const act of t.actions ?? []) {
        parts.push(`    - ${act}`);
      }
    }
  }

  const ar = data.affected_roads;
  if (Array.isArray(ar) && ar.length) {
    parts.push('Affected roads:');
    for (const x of ar) {
      if (typeof x === 'string') {
        parts.push(`  - ${x}`);
      } else if (x && typeof x === 'object') {
        const r = x as Record<string, unknown>;
        parts.push(`  - ${r.name ?? 'Unknown road'} (${r.status ?? 'unknown status'})`);
      }
    }
  } else if (typeof data.affected_roads === 'string' && data.affected_roads.trim()) {
    parts.push(`Affected roads: ${data.affected_roads}`);
  }

  const af = data.at_risk_facilities;
  if (Array.isArray(af) && af.length) {
    parts.push('At-risk facilities:');
    for (const x of af) {
      if (typeof x === 'string') {
        parts.push(`  - ${x}`);
      } else if (x && typeof x === 'object') {
        const f = x as Record<string, unknown>;
        parts.push(`  - ${f.name ?? 'Unknown'} (${f.type ?? 'facility'}) — risk: ${f.risk ?? 'unknown'}`);
      }
    }
  }

  if (typeof data.blocked_routes === 'string' && data.blocked_routes.trim()) {
    parts.push(`Blocked routes: ${data.blocked_routes}`);
  }

  const ev = data.evacuation_routes;
  if (Array.isArray(ev) && ev.length) {
    parts.push('Evacuation routes:');
    for (const r of ev as Array<Record<string, string | undefined>>) {
      parts.push(
        `  - ${r.from ?? '?'} -> ${r.to ?? '?'} via ${r.via ?? '?'} (${r.status ?? 'n/a'})`
      );
    }
  }

  const sh = data.shelter_assignments;
  if (Array.isArray(sh) && sh.length) {
    parts.push('Shelter assignments:');
    for (const s of sh as Array<Record<string, string | undefined>>) {
      parts.push(
        `  - ${s.facility ?? 'Facility'}: ${s.capacity_note ?? ''} Priority: ${s.priority_populations ?? ''}`
      );
    }
  }

  const rd = data.resource_deployment;
  if (Array.isArray(rd) && rd.length) {
    parts.push('Resource deployment:');
    for (const r of rd as Array<Record<string, string | undefined>>) {
      parts.push(`  - ${r.resource ?? 'Resource'} @ ${r.location ?? '?'} — ${r.purpose ?? ''}`);
    }
  }

  return parts.join('\n\n');
}

function drawHeroBanner(doc: jsPDF, p: ResponsePdfParams): number {
  const W = pageW(doc);
  const H = 46;
  doc.setFillColor(...C.heroTop);
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...C.heroBottom);
  doc.rect(0, H - 4, W, 4, 'F');

  let logoBottom = 10;
  if (p.logoDataUrl && p.logoWidthPx > 0 && p.logoHeightPx > 0) {
    try {
      const logoWmm = 34;
      const logoHmm = logoWmm * (p.logoHeightPx / p.logoWidthPx);
      doc.addImage(p.logoDataUrl, 'JPEG', MARGIN, 10, logoWmm, logoHmm);
      logoBottom = 10 + logoHmm + 2;
    } catch {
      /* skip logo */
    }
  }

  const titleY = Math.max(logoBottom + 6, 24);
  doc.setTextColor(...C.textOnDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TITLE);
  doc.text('Crisis response report', MARGIN, titleY);

  doc.setFontSize(9);
  doc.setTextColor(...C.heroAccent);
  const ts = p.generatedAt.toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  doc.text(ts, MARGIN, titleY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.textMuted);
  if (p.scenarioId) {
    const idText = `Scenario ID: ${p.scenarioId}`;
    const idMaxW = W - MARGIN * 2;
    const idLines = doc.splitTextToSize(idText, idMaxW);
    doc.text(idLines, MARGIN, titleY + 13);
  }

  const badge = p.disasterType === 'flood' ? 'FLOOD' : 'TORNADO';
  const bx = W - MARGIN - 30;
  doc.setFillColor(p.disasterType === 'flood' ? 59 : 217, p.disasterType === 'flood' ? 130 : 119, p.disasterType === 'flood' ? 246 : 6);
  doc.roundedRect(bx, 12, 30, 9, 1.2, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(badge, bx + 5.5, 18.2);

  doc.setTextColor(...C.body);
  doc.setFont('helvetica', 'normal');
  return H + 8;
}

function drawMetricRows(doc: jsPDF, y: number, lines: string[]): number {
  const w = pageW(doc) - MARGIN * 2;
  const rowH = 6.8;
  for (let i = 0; i < lines.length; i++) {
    y = ensureSpace(doc, y, rowH + 1);
    const fill: [number, number, number] =
      i % 2 === 0 ? [224, 242, 254] : [241, 245, 249];
    doc.setFillColor(...fill);
    doc.setDrawColor(191, 219, 254);
    doc.rect(MARGIN, y, w, rowH, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(BODY);
    doc.setTextColor(...C.body);
    doc.text(lines[i], MARGIN + 2.5, y + 4.8);
    y += rowH;
  }
  return y + 4;
}

export async function generateResponsePdf(p: ResponsePdfParams): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const maxW = pageInnerWidth(doc);
  let y = drawHeroBanner(doc, p);

  y = sectionHeader(doc, 'Scenario context', y, C.sections.context);
  const valX = MARGIN + 45;
  const ctxRow = (label: string, value: string, valueColor?: [number, number, number]) => {
    y = ensureSpace(doc, y, LINE + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(BODY);
    doc.setTextColor(...C.label);
    doc.text(label, MARGIN + 3, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...(valueColor ?? C.body));
    doc.text(value, valX, y);
    doc.setTextColor(...C.body);
    y += LINE + 1;
  };

  ctxRow('Disaster type', p.disasterType.charAt(0).toUpperCase() + p.disasterType.slice(1));
  if (p.location) {
    ctxRow('Center (lat, lng)', `${p.location.lat.toFixed(5)}, ${p.location.lng.toFixed(5)}`);
  }
  ctxRow('Analysis radius', `${p.radiusKm} km`);
  if (p.lastRun) {
    ctxRow('Run radius', `${p.lastRun.radius_km} km`);
    if (p.disasterType === 'flood' && p.lastRun.rainfall_mm != null) {
      ctxRow('Rainfall', `${p.lastRun.rainfall_mm} mm`, [37, 99, 235]);
    }
    if (p.disasterType === 'tornado') {
      if (p.lastRun.ef_scale != null) {
        ctxRow('EF scale', `EF${p.lastRun.ef_scale}`, [217, 119, 6]);
      }
      if (p.lastRun.direction_deg != null) {
        ctxRow('Direction', `${p.lastRun.direction_deg}\u00B0`);
      }
    }
  }
  y += 3;

  y = sectionHeader(doc, 'Key metrics', y, C.sections.metrics);
  y = drawMetricRows(doc, y, formatStats(p.disasterType, p.stats));

  y = sectionHeader(doc, 'Infrastructure in study area', y, C.sections.infra);
  const entries = Object.entries(p.infrastructureCounts).filter(([, n]) => n > 0);
  if (entries.length === 0) {
    y = writeLinesColored(
      doc,
      'No infrastructure points listed in the response payload.',
      y,
      maxW,
      [100, 116, 139]
    );
  } else {
    for (const [k, n] of entries) {
      const rowTop = y;
      y = ensureSpace(doc, y, 9);
      doc.setFillColor(250, 245, 255);
      doc.setDrawColor(233, 213, 255);
      doc.roundedRect(MARGIN, rowTop, maxW, 7.5, 0.9, 0.9, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(126, 34, 206);
      const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      doc.text(label, MARGIN + 2.5, rowTop + 5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.body);
      doc.text(String(n), MARGIN + 75, rowTop + 5);
      y = rowTop + 9;
    }
  }
  y += 2;

  y = sectionHeader(doc, 'Road network impact (modeled)', y, C.sections.roads);
  doc.setFillColor(255, 251, 235);
  doc.roundedRect(MARGIN, y, maxW, 18, 1.2, 1.2, 'F');
  doc.setDrawColor(251, 191, 36);
  doc.roundedRect(MARGIN, y, maxW, 18, 1.2, 1.2, 'S');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY);
  doc.setTextColor(...C.body);
  const roadTxt = `Affected segments: ${p.blockedRoads.total}    Blocked: ${p.blockedRoads.blocked}    Partial: ${p.blockedRoads.partial}`;
  doc.text(roadTxt, MARGIN + 3, y + 7);
  doc.setFontSize(8);
  doc.setTextColor(180, 83, 9);
  doc.text('Modeled from FEMA hazard intersection with road network.', MARGIN + 3, y + 13);
  y += 22;

  const structured1 = stringifyAgentData(p.agent1Data, 'Hazard');
  const structured2 = stringifyAgentData(p.agent2Data, 'Response');

  y = sectionHeader(
    doc,
    p.disasterType === 'tornado' ? 'Tornado hazard analysis' : 'Flood hazard analysis',
    y,
    C.sections.hazard
  );
  if (structured1) {
    y = writeLines(doc, structured1, y, maxW, MARGIN + 3);
    y += 2;
  }
  const narrative1 = truncatePdfText(stripJsonCodeFences((p.agent1Text || '').trim()), MAX_NARRATIVE_CHARS);
  if (narrative1) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text('Detailed analysis', MARGIN + 3, y);
    y += LINE + 1;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    y = writeLines(doc, narrative1, y, maxW, MARGIN + 3);
    doc.setTextColor(...C.body);
  } else if (!structured1) {
    y = writeLinesColored(doc, 'No hazard analysis text was returned.', y, maxW, [100, 116, 139]);
  }

  y += 3;
  y = sectionHeader(doc, 'Response and evacuation planning', y, C.sections.response);
  if (structured2) {
    y = writeLines(doc, structured2, y, maxW, MARGIN + 3);
    y += 2;
  }
  const narrative2 = truncatePdfText(stripJsonCodeFences((p.agent2Text || '').trim()), MAX_NARRATIVE_CHARS);
  if (narrative2) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text('Detailed plan', MARGIN + 3, y);
    y += LINE + 1;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    y = writeLines(doc, narrative2, y, maxW, MARGIN + 3);
    doc.setTextColor(...C.body);
  } else if (!structured2) {
    y = writeLinesColored(doc, 'No response plan text was returned.', y, maxW, [100, 116, 139]);
  }

  const discText =
    'This report is generated from simulation and AI-assisted analysis for planning purposes only. Verify all decisions against live conditions and official sources.';
  doc.setFontSize(8);
  const discLines = doc.splitTextToSize(discText, maxW - 5);
  const lineGap = 3.6;
  const discH = discLines.length * lineGap + 7;
  y = ensureSpace(doc, y, discH + 3);
  doc.setFillColor(254, 252, 232);
  doc.setDrawColor(251, 191, 36);
  doc.setLineWidth(0.35);
  doc.roundedRect(MARGIN, y, maxW, discH, 1.5, 1.5, 'FD');
  doc.setTextColor(146, 64, 14);
  let dy = y + 5;
  for (const ln of discLines) {
    doc.text(ln, MARGIN + 2.5, dy);
    dy += lineGap;
  }
  y += discH;

  const name = `crisispath-response-${p.scenarioId ?? p.generatedAt.getTime()}.pdf`;
  doc.save(name);
}

export function countBlockedRoads(geojson: GeoJSON.FeatureCollection | null): {
  blocked: number;
  partial: number;
  total: number;
} {
  if (!geojson?.features?.length) return { blocked: 0, partial: 0, total: 0 };
  let blocked = 0;
  let partial = 0;
  for (const f of geojson.features) {
    const s = f.properties?.status as string | undefined;
    if (s === 'blocked') blocked++;
    else if (s === 'partial') partial++;
  }
  return { blocked, partial, total: geojson.features.length };
}

export function infrastructureCountsFromPayload(
  infra: Record<string, unknown[]> | null
): Record<string, number> {
  if (!infra) return {};
  const keys = [
    'hospitals',
    'shelters',
    'fire_stations',
    'police',
    'ambulance_stations',
    'fuel_stations',
    'power',
    'disaster_infrastructure',
  ] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const arr = infra[k];
    out[k] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}
