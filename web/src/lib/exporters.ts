/**
 * Client-side report exporters (PDF + PowerPoint).
 *
 * Zero-trust friendly: everything runs in the browser. The PowerPoint deck is
 * modeled on the official "Microsoft Sentinel — pricing offer" template
 * (16:9, brand palette below) but is clearly marked as an unofficial,
 * community-generated estimate. The heavy libraries (jspdf, pptxgenjs) are
 * dynamically imported so they only load when the user actually exports.
 */

import type { NormalizedResult } from "@engine/schema/normalization.js";
import type {
  SentinelCostEstimate,
  SentinelCostBreakdown,
} from "@engine/pricing/sentinelPricing.js";
import type { Recommendation } from "./recommendations.js";
// Type-only import (erased at build time — does NOT bundle the library; the
// runtime copy is pulled in via dynamic import() inside exportPptx).
import type PptxGenJS from "pptxgenjs";

/** Microsoft Sentinel template brand palette (hex, no leading #). */
const BRAND = {
  navy: "243A5E",
  blue: "0078D4",
  cyan: "50E6FF",
  teal: "30E5D0",
  green: "107C10",
  lime: "9BF00B",
  amber: "FFB900",
  purple: "D59DFF",
  ink: "1B1B1B",
  grey: "737373",
  light: "F3F6FB",
  white: "FFFFFF",
} as const;

const BREAKDOWN_LABELS: { key: keyof SentinelCostBreakdown; label: string }[] = [
  { key: "analyticsIngestion", label: "Analytics ingest" },
  { key: "dataLakeIngestion", label: "Data Lake ingest" },
  { key: "interactiveRetention", label: "Interactive retention" },
  { key: "dataStorage", label: "Long-term storage" },
  { key: "dataSearch", label: "Search" },
  { key: "soar", label: "SOAR" },
  { key: "securityCopilot", label: "Security Copilot" },
  { key: "sap", label: "Sentinel for SAP" },
];

export interface ReportData {
  vendorLabel: string;
  generatedAt: Date;
  totalGbPerDay: number;
  monthlyCost: number;
  annualCost: number;
  billableAnalyticsGbPerDay: number;
  benefitGbPerDay: number;
  estimatedMonthlyBenefitValue: number;
  breakdown: { label: string; value: number }[];
  sources: { name: string; gbPerDay: number; sharePct: number }[];
  recommendations: Recommendation[];
  totalSavings: number;
  aiSummary?: string;
  aiModel?: string;
  /** PNG data URLs captured from the on-page charts. */
  charts: { sources?: string; cost?: string };
}

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function money(n: number): string {
  return usd0.format(n);
}

function gbDay(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)} TB/day`;
  if (n >= 100) return `${n.toFixed(0)} GB/day`;
  if (n >= 1) return `${n.toFixed(1)} GB/day`;
  return `${n.toFixed(3)} GB/day`;
}

/** Grab an on-page Chart.js canvas as a white-backed PNG data URL. */
export function captureChart(containerId: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const src = document.querySelector<HTMLCanvasElement>(`#${containerId} canvas`);
  if (!src || src.width === 0 || src.height === 0) return undefined;
  const out = document.createElement("canvas");
  // 2x for crisp output in print/slides.
  const scale = 2;
  out.width = src.width * scale;
  out.height = src.height * scale;
  const ctx = out.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  try {
    return out.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

/** Aggregate everything the exporters need from the current app state. */
export function buildReportData(args: {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  vendorLabel: string;
  recommendations: Recommendation[];
  totalSavings: number;
  aiSummary?: string;
  aiModel?: string;
}): ReportData {
  const { result, cost, vendorLabel, recommendations, totalSavings } = args;
  const totalGbPerDay =
    result.totals?.gbPerDay ?? result.sources.reduce((a, s) => a + (s.gbPerDay ?? 0), 0);

  const sources = [...result.sources]
    .map((s) => ({
      name: s.name,
      gbPerDay: s.gbPerDay ?? 0,
      sharePct: totalGbPerDay > 0 ? ((s.gbPerDay ?? 0) / totalGbPerDay) * 100 : 0,
    }))
    .sort((a, b) => b.gbPerDay - a.gbPerDay);

  const breakdown = BREAKDOWN_LABELS.map((b) => ({
    label: b.label,
    value: cost.breakdown[b.key] ?? 0,
  })).filter((b) => b.value > 0);

  return {
    vendorLabel,
    generatedAt: new Date(),
    totalGbPerDay,
    monthlyCost: cost.monthlyCost,
    annualCost: cost.monthlyCost * 12,
    billableAnalyticsGbPerDay: cost.billableAnalyticsGbPerDay,
    benefitGbPerDay: cost.benefitGbPerDay,
    estimatedMonthlyBenefitValue: cost.estimatedMonthlyBenefitValue,
    breakdown,
    sources,
    recommendations,
    totalSavings,
    ...(args.aiSummary ? { aiSummary: args.aiSummary } : {}),
    ...(args.aiModel ? { aiModel: args.aiModel } : {}),
    charts: {
      sources: captureChart("export-chart-sources"),
      cost: captureChart("export-chart-cost"),
    },
  };
}

function stamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fileSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
}

const DISCLAIMER =
  "Unofficial estimate. This document is generated by Sentinel Optimizer, an independent community tool, and is not affiliated with, endorsed by, or produced by Microsoft. Figures are directional estimates based on public list rates and the data you provided — they are not a quote and create no commitment. Validate against the Azure Pricing Calculator and your Microsoft agreement before making decisions.";

/* ----------------------------- PDF export ----------------------------- */

export async function exportPdf(data: ReportData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const navy: [number, number, number] = [36, 58, 94];
  const blue: [number, number, number] = [0, 120, 212];
  const ink: [number, number, number] = [27, 27, 27];
  const grey: [number, number, number] = [115, 115, 115];

  function ensureSpace(needed: number): void {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function heading(text: string): void {
    ensureSpace(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...navy);
    doc.text(text, margin, y);
    y += 8;
    doc.setDrawColor(...blue);
    doc.setLineWidth(1.5);
    doc.line(margin, y, margin + 46, y);
    y += 18;
  }

  function paragraph(text: string, size = 10, color: [number, number, number] = ink): void {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
  }

  // ---- Title band ----
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, 132, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Microsoft Sentinel — cost optimization", margin, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(`Source platform: ${data.vendorLabel}`, margin, 84);
  doc.setFontSize(10);
  doc.setTextColor(160, 200, 240);
  doc.text(`Generated ${stamp(data.generatedAt)} · Sentinel Optimizer (unofficial)`, margin, 104);
  y = 160;

  // ---- Headline stats ----
  heading("Estimate summary");
  const stats: [string, string][] = [
    ["Daily ingest", gbDay(data.totalGbPerDay)],
    ["Est. monthly cost", money(data.monthlyCost)],
    ["Est. annual cost", money(data.annualCost)],
    ["Billable analytics", gbDay(data.billableAnalyticsGbPerDay)],
    ["Covered by benefits", gbDay(data.benefitGbPerDay)],
    ["Est. savings identified", `${money(data.totalSavings)}/mo`],
  ];
  const cardW = (contentW - 16) / 3;
  const cardH = 54;
  stats.forEach((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (col === 0) ensureSpace(cardH + 12);
    const cx = margin + col * (cardW + 8);
    const cy = y + row * (cardH + 8);
    doc.setFillColor(243, 246, 251);
    doc.roundedRect(cx, cy, cardW, cardH, 6, 6, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(s[0].toUpperCase(), cx + 12, cy + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...navy);
    doc.text(s[1], cx + 12, cy + 40);
  });
  y += cardH * 2 + 8 + 18;

  // ---- Charts ----
  if (data.charts.sources || data.charts.cost) {
    heading("Visual breakdown");
    const imgW = (contentW - 16) / 2;
    const imgH = imgW * 0.62;
    ensureSpace(imgH + 16);
    if (data.charts.sources) {
      doc.addImage(data.charts.sources, "PNG", margin, y, imgW, imgH);
      doc.setFontSize(8);
      doc.setTextColor(...grey);
      doc.text("Ingest by source", margin, y + imgH + 12);
    }
    if (data.charts.cost) {
      doc.addImage(data.charts.cost, "PNG", margin + imgW + 16, y, imgW, imgH);
      doc.setFontSize(8);
      doc.setTextColor(...grey);
      doc.text("Cost by category", margin + imgW + 16, y + imgH + 12);
    }
    y += imgH + 28;
  }

  // ---- Cost breakdown table ----
  if (data.breakdown.length) {
    heading("Monthly cost by category");
    simpleTable(
      ["Category", "Monthly"],
      data.breakdown.map((b) => [b.label, money(b.value)]),
      [contentW * 0.7, contentW * 0.3],
    );
  }

  // ---- Top sources table ----
  if (data.sources.length) {
    heading("Top sources by daily volume");
    simpleTable(
      ["Source", "GB/day", "Share"],
      data.sources.slice(0, 12).map((s) => [s.name, gbDay(s.gbPerDay), `${s.sharePct.toFixed(1)}%`]),
      [contentW * 0.55, contentW * 0.25, contentW * 0.2],
    );
  }

  // ---- Recommendations ----
  if (data.recommendations.length) {
    heading("Recommendations");
    for (const r of data.recommendations) {
      ensureSpace(40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...navy);
      const tag = r.severity === "high" ? "[HIGH] " : r.severity === "med" ? "[MED] " : "[LOW] ";
      const save = r.monthlySavings && r.monthlySavings > 0 ? `  (~${money(r.monthlySavings)}/mo)` : "";
      const titleLines = doc.splitTextToSize(tag + r.title + save, contentW) as string[];
      for (const line of titleLines) {
        ensureSpace(14);
        doc.text(line, margin, y);
        y += 14;
      }
      paragraph(r.detail, 9, ink);
      y += 6;
    }
  }

  // ---- AI summary ----
  if (data.aiSummary) {
    heading("AI executive summary");
    paragraph(data.aiSummary, 10, ink);
    if (data.aiModel) {
      paragraph(`Model: ${data.aiModel}`, 8, grey);
    }
  }

  // ---- Disclaimer footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...grey);
    const dis = doc.splitTextToSize(DISCLAIMER, contentW) as string[];
    let dy = pageH - margin + 14;
    for (const line of dis.slice(0, 3)) {
      doc.text(line, margin, dy);
      dy += 8;
    }
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 14, { align: "right" });
  }

  doc.save(`sentinel-optimizer-${fileSlug(data.vendorLabel)}-${stamp(data.generatedAt)}.pdf`);

  function simpleTable(headers: string[], rows: string[][], widths: number[]): void {
    const rowH = 18;
    ensureSpace(rowH * 2);
    // header
    doc.setFillColor(...navy);
    doc.rect(margin, y, contentW, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    let cx = margin;
    headers.forEach((h, i) => {
      const align = i === 0 ? "left" : "right";
      const tx = i === 0 ? cx + 8 : cx + widths[i] - 8;
      doc.text(h, tx, y + 12, { align: align as "left" | "right" });
      cx += widths[i];
    });
    y += rowH;
    // body
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...ink);
    rows.forEach((row, ri) => {
      ensureSpace(rowH);
      if (ri % 2 === 1) {
        doc.setFillColor(243, 246, 251);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      cx = margin;
      row.forEach((cell, i) => {
        const align = i === 0 ? "left" : "right";
        const tx = i === 0 ? cx + 8 : cx + widths[i] - 8;
        const clipped = (doc.splitTextToSize(cell, widths[i] - 16) as string[])[0] ?? cell;
        doc.text(clipped, tx, y + 12, { align: align as "left" | "right" });
        cx += widths[i];
      });
      y += rowH;
    });
    y += 14;
  }
}

/* -------------------------- PowerPoint export -------------------------- */

export async function exportPptx(data: ReportData): Promise<void> {
  const pptxMod = await import("pptxgenjs");
  const PptxGen = pptxMod.default;
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.author = "Sentinel Optimizer";
  pptx.company = "Sentinel Optimizer (unofficial)";
  pptx.title = "Microsoft Sentinel — cost optimization";

  const W = 13.333;
  const H = 7.5;

  /** Branded header used on content slides. */
  function header(slide: PptxGenJS.Slide, title: string): void {
    slide.background = { color: BRAND.white };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.95, fill: { color: BRAND.navy } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.95, w: W, h: 0.06, fill: { color: BRAND.cyan } });
    slide.addText(title, {
      x: 0.5, y: 0.12, w: W - 2.5, h: 0.7, color: BRAND.white, fontSize: 22, bold: true,
      fontFace: "Segoe UI", valign: "middle",
    });
    slide.addText("Microsoft Sentinel", {
      x: W - 3.2, y: 0.12, w: 2.7, h: 0.7, color: BRAND.cyan, fontSize: 12, align: "right",
      valign: "middle", fontFace: "Segoe UI",
    });
    slide.addText("Unofficial estimate — generated by Sentinel Optimizer. Not affiliated with Microsoft.", {
      x: 0.5, y: H - 0.42, w: W - 1, h: 0.32, color: BRAND.grey, fontSize: 8, fontFace: "Segoe UI",
    });
  }

  // ---- Slide 1: Title ----
  const s1 = pptx.addSlide();
  s1.background = { color: BRAND.navy };
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 5.0, w: W, h: 0.08, fill: { color: BRAND.cyan } });
  s1.addText("Microsoft Sentinel", {
    x: 0.8, y: 1.7, w: W - 1.6, h: 0.9, color: BRAND.white, fontSize: 44, bold: true, fontFace: "Segoe UI",
  });
  s1.addText("Cost optimization & pricing estimate", {
    x: 0.8, y: 2.7, w: W - 1.6, h: 0.7, color: BRAND.cyan, fontSize: 24, fontFace: "Segoe UI",
  });
  s1.addText(
    [
      { text: `Source platform: ${data.vendorLabel}\n`, options: { fontSize: 16, color: BRAND.white } },
      { text: `Generated ${stamp(data.generatedAt)}`, options: { fontSize: 13, color: "ABC8E8" } },
    ],
    { x: 0.8, y: 3.6, w: W - 1.6, h: 1.0, fontFace: "Segoe UI" },
  );
  s1.addText("Unofficial — independent community tool. Not affiliated with or endorsed by Microsoft.", {
    x: 0.8, y: 6.6, w: W - 1.6, h: 0.5, color: "ABC8E8", fontSize: 11, fontFace: "Segoe UI",
  });

  // ---- Slide 2: Disclaimer ----
  const s2 = pptx.addSlide();
  header(s2, "Disclaimer");
  s2.addText(DISCLAIMER, {
    x: 0.6, y: 1.5, w: W - 1.2, h: 4.5, color: BRAND.ink, fontSize: 16, fontFace: "Segoe UI",
    valign: "top", lineSpacingMultiple: 1.2,
  });

  // ---- Slide 3: Estimate summary ----
  const s3 = pptx.addSlide();
  header(s3, "Estimate summary");
  const cards: [string, string, string][] = [
    ["Daily ingest", gbDay(data.totalGbPerDay), BRAND.blue],
    ["Est. monthly cost", money(data.monthlyCost), BRAND.navy],
    ["Est. annual cost", money(data.annualCost), BRAND.navy],
    ["Billable analytics", gbDay(data.billableAnalyticsGbPerDay), BRAND.teal],
    ["Covered by benefits", gbDay(data.benefitGbPerDay), BRAND.green],
    ["Savings identified", `${money(data.totalSavings)}/mo`, BRAND.amber],
  ];
  const cw = 3.9;
  const ch = 1.7;
  const gapX = 0.35;
  const gapY = 0.35;
  const startX = (W - (cw * 3 + gapX * 2)) / 2;
  cards.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (cw + gapX);
    const yy = 1.45 + row * (ch + gapY);
    s3.addShape(pptx.ShapeType.roundRect, { x, y: yy, w: cw, h: ch, fill: { color: BRAND.light }, line: { color: "D9E2EF", width: 1 }, rectRadius: 0.08 });
    s3.addShape(pptx.ShapeType.rect, { x, y: yy, w: 0.1, h: ch, fill: { color: c[2] } });
    s3.addText(c[0].toUpperCase(), { x: x + 0.3, y: yy + 0.22, w: cw - 0.5, h: 0.4, color: BRAND.grey, fontSize: 11, fontFace: "Segoe UI" });
    s3.addText(c[1], { x: x + 0.3, y: yy + 0.6, w: cw - 0.5, h: 0.9, color: c[2], fontSize: 28, bold: true, fontFace: "Segoe UI" });
  });

  // ---- Slide 4: Visual breakdown (charts) ----
  if (data.charts.sources || data.charts.cost) {
    const s4 = pptx.addSlide();
    header(s4, "Visual breakdown");
    if (data.charts.sources) {
      s4.addText("Ingest by source", { x: 0.6, y: 1.3, w: 5.9, h: 0.4, color: BRAND.navy, fontSize: 14, bold: true, fontFace: "Segoe UI" });
      s4.addImage({ data: data.charts.sources, x: 0.6, y: 1.8, w: 5.9, h: 3.66 });
    }
    if (data.charts.cost) {
      s4.addText("Cost by category", { x: 6.8, y: 1.3, w: 5.9, h: 0.4, color: BRAND.navy, fontSize: 14, bold: true, fontFace: "Segoe UI" });
      s4.addImage({ data: data.charts.cost, x: 6.8, y: 1.8, w: 5.9, h: 3.66 });
    }
  }

  // ---- Slide 5: Cost breakdown + top sources tables ----
  if (data.breakdown.length || data.sources.length) {
    const s5 = pptx.addSlide();
    header(s5, "Cost & source breakdown");
    if (data.breakdown.length) {
      s5.addText("Monthly cost by category", { x: 0.6, y: 1.25, w: 5.9, h: 0.4, color: BRAND.navy, fontSize: 14, bold: true, fontFace: "Segoe UI" });
      const rows: PptxGenJS.TableRow[] = [
        [
          { text: "Category", options: { bold: true, color: BRAND.white, fill: { color: BRAND.navy } } },
          { text: "Monthly", options: { bold: true, color: BRAND.white, fill: { color: BRAND.navy }, align: "right" } },
        ],
        ...data.breakdown.map((b): PptxGenJS.TableRow => [
          { text: b.label, options: {} },
          { text: money(b.value), options: { align: "right" } },
        ]),
      ];
      s5.addTable(rows, { x: 0.6, y: 1.7, w: 5.9, fontSize: 11, fontFace: "Segoe UI", border: { type: "solid", color: "E2E8F2", pt: 1 }, colW: [4.2, 1.7] });
    }
    if (data.sources.length) {
      s5.addText("Top sources by daily volume", { x: 6.8, y: 1.25, w: 5.9, h: 0.4, color: BRAND.navy, fontSize: 14, bold: true, fontFace: "Segoe UI" });
      const rows: PptxGenJS.TableRow[] = [
        [
          { text: "Source", options: { bold: true, color: BRAND.white, fill: { color: BRAND.navy } } },
          { text: "GB/day", options: { bold: true, color: BRAND.white, fill: { color: BRAND.navy }, align: "right" } },
          { text: "Share", options: { bold: true, color: BRAND.white, fill: { color: BRAND.navy }, align: "right" } },
        ],
        ...data.sources.slice(0, 8).map((s): PptxGenJS.TableRow => [
          { text: s.name, options: {} },
          { text: gbDay(s.gbPerDay), options: { align: "right" } },
          { text: `${s.sharePct.toFixed(1)}%`, options: { align: "right" } },
        ]),
      ];
      s5.addTable(rows, { x: 6.8, y: 1.7, w: 5.9, fontSize: 11, fontFace: "Segoe UI", border: { type: "solid", color: "E2E8F2", pt: 1 }, colW: [3.5, 1.4, 1.0] });
    }
  }

  // ---- Slide 6+: Recommendations ----
  if (data.recommendations.length) {
    const SEV: Record<string, string> = { high: BRAND.green, med: BRAND.amber, low: BRAND.grey };
    const perSlide = 4;
    for (let i = 0; i < data.recommendations.length; i += perSlide) {
      const chunk = data.recommendations.slice(i, i + perSlide);
      const slide = pptx.addSlide();
      header(slide, i === 0 ? "Recommendations" : "Recommendations (cont.)");
      if (i === 0 && data.totalSavings > 0) {
        slide.addText(`Up to ${money(data.totalSavings)}/mo identified`, {
          x: W - 4.2, y: 0.2, w: 3.5, h: 0.5, color: BRAND.cyan, fontSize: 12, align: "right", valign: "middle", fontFace: "Segoe UI",
        });
      }
      chunk.forEach((r, j) => {
        const yy = 1.35 + j * 1.42;
        slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: yy, w: 0.12, h: 1.25, fill: { color: SEV[r.severity] ?? BRAND.grey } });
        const sev = r.severity === "high" ? "HIGH IMPACT" : r.severity === "med" ? "MEDIUM" : "LOW";
        const save = r.monthlySavings && r.monthlySavings > 0 ? `   ~${money(r.monthlySavings)}/mo` : "";
        slide.addText(
          [
            { text: `${sev}${save}\n`, options: { fontSize: 10, bold: true, color: SEV[r.severity] ?? BRAND.grey } },
            { text: `${r.title}\n`, options: { fontSize: 14, bold: true, color: BRAND.navy } },
            { text: r.detail, options: { fontSize: 10, color: BRAND.ink } },
          ],
          { x: 0.85, y: yy, w: W - 1.6, h: 1.25, valign: "top", fontFace: "Segoe UI", lineSpacingMultiple: 1.05 },
        );
      });
    }
  }

  // ---- AI executive summary ----
  if (data.aiSummary) {
    const slide = pptx.addSlide();
    header(slide, "AI executive summary");
    slide.addText(data.aiSummary, {
      x: 0.6, y: 1.4, w: W - 1.2, h: 4.6, color: BRAND.ink, fontSize: 14, fontFace: "Segoe UI", valign: "top", lineSpacingMultiple: 1.15,
    });
    if (data.aiModel) {
      slide.addText(`Model: ${data.aiModel}`, { x: 0.6, y: 6.1, w: W - 1.2, h: 0.3, color: BRAND.grey, fontSize: 9, fontFace: "Segoe UI" });
    }
  }

  // ---- Closing ----
  const sEnd = pptx.addSlide();
  sEnd.background = { color: BRAND.navy };
  sEnd.addText("Next steps", { x: 0.8, y: 1.4, w: W - 1.6, h: 0.8, color: BRAND.white, fontSize: 32, bold: true, fontFace: "Segoe UI" });
  sEnd.addText(
    [
      { text: "Validate this estimate against the Azure Pricing Calculator.\n", options: {} },
      { text: "Confirm eligible M365 E5 / Defender for Servers ingestion benefits.\n", options: {} },
      { text: "Pilot the highest-impact recommendations (tiering, DCR transforms, commitment tiers).\n", options: {} },
      { text: "Re-run after changes to track savings over time.", options: {} },
    ],
    { x: 0.8, y: 2.5, w: W - 1.6, h: 3, color: BRAND.white, fontSize: 18, bullet: { code: "2022", indent: 20 }, fontFace: "Segoe UI", lineSpacingMultiple: 1.3 },
  );
  sEnd.addText("Sentinel Optimizer · unofficial community tool", { x: 0.8, y: 6.7, w: W - 1.6, h: 0.4, color: BRAND.cyan, fontSize: 11, fontFace: "Segoe UI" });

  await pptx.writeFile({ fileName: `sentinel-optimizer-${fileSlug(data.vendorLabel)}-${stamp(data.generatedAt)}.pptx` });
}
