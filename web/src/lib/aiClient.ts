/**
 * Optional AI enhancement client.
 *
 * IMPORTANT — zero-trust boundary: this NEVER sends raw logs, exported JSON, or
 * source-level detail. It sends only an aggregated, non-identifying numeric
 * summary (total GB/day, monthly cost, the cost breakdown by category, and the
 * deterministic recommendation titles) to a same-origin Cloudflare Pages
 * Function, which calls Workers AI server-side and returns prose. The raw paste
 * never leaves the browser.
 */

import type { Recommendation } from "./recommendations.js";

const CONFIGURED_AI_API_BASE = readConfiguredAiApiBase();

/** The ONLY shape that crosses the network for AI enhancement. */
export interface AggregatedSummary {
  vendor: string;
  summaryStyle?: "executive" | "technical" | "board";
  totalGbPerDay: number;
  sourceCount: number;
  /** Top sources by GB/day — names + share only, no raw values/bytes. */
  topSources: { name: string; sharePct: number }[];
  monthlyCost: number;
  breakdown: Record<string, number>;
  billableAnalyticsGbPerDay: number;
  benefitGbPerDay: number;
  recommendations: { title: string; severity: string; monthlySavings?: number }[];
}

export interface AiResult {
  text: string;
  model?: string;
}

export function getAiSummaryEndpoint(): string {
  return resolveApiEndpoint("recommend");
}

export function getAiExampleEndpoint(): string {
  return resolveApiEndpoint("example");
}

export function buildSummary(args: {
  vendor: string;
  summaryStyle?: "executive" | "technical" | "board";
  totalGbPerDay: number;
  sources: { name: string; gbPerDay?: number }[];
  monthlyCost: number;
  breakdown: Record<string, number>;
  billableAnalyticsGbPerDay: number;
  benefitGbPerDay: number;
  recommendations: Recommendation[];
}): AggregatedSummary {
  const total = args.totalGbPerDay || 1;
  const topSources = [...args.sources]
    .sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0))
    .slice(0, 5)
    .map((s) => ({
      name: s.name,
      sharePct: Math.round(((s.gbPerDay ?? 0) / total) * 1000) / 10,
    }));

  return {
    vendor: args.vendor,
    summaryStyle: args.summaryStyle ?? "executive",
    totalGbPerDay: round(args.totalGbPerDay),
    sourceCount: args.sources.length,
    topSources,
    monthlyCost: round(args.monthlyCost),
    breakdown: args.breakdown,
    billableAnalyticsGbPerDay: round(args.billableAnalyticsGbPerDay),
    benefitGbPerDay: round(args.benefitGbPerDay),
    recommendations: args.recommendations.map((r) => ({
      title: r.title,
      severity: r.severity,
      ...(r.monthlySavings !== undefined ? { monthlySavings: r.monthlySavings } : {}),
    })),
  };
}

/**
 * Request an AI-written executive summary. Resolves with prose, or throws with
 * a friendly message the UI can surface (e.g. when AI isn't configured for the
 * deployment, in which case the deterministic recommendations still stand).
 */
export async function requestAiSummary(summary: AggregatedSummary, signal?: AbortSignal): Promise<AiResult> {
  const endpoint = resolveApiEndpoint("recommend");
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(summary),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new Error(
      `Could not reach the AI service at ${endpoint}. Your deterministic recommendations above are unaffected.`,
    );
  }

  if (res.status === 501 || res.status === 404) {
    throw new Error("AI enhancement isn't enabled for this deployment. The deterministic recommendations above are fully usable.");
  }
  if (!res.ok) {
    throw new Error(`AI service returned an error (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as Partial<AiResult> & { error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.text) throw new Error("AI service returned an empty response.");
  return { text: data.text, ...(data.model ? { model: data.model } : {}) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ask the server to generate a realistic EXAMPLE paste for a vendor, shaped
 * like that vendor's expected export. Sends only app-owned, non-sensitive
 * strings (vendor label, schema hint, canonical template). Throws with a
 * friendly message when AI isn't enabled so the UI can fall back to its
 * built-in static example.
 */
export async function requestAiExample(
  req: { vendor: string; label: string; schemaHint: string; template: string },
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = resolveApiEndpoint("example");
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new Error(`Could not reach the AI service at ${endpoint}.`);
  }

  if (res.status === 501 || res.status === 404) {
    throw new Error("AI example generation isn't enabled for this deployment.");
  }
  if (!res.ok) {
    throw new Error(`AI service returned an error (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { text?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.text) throw new Error("AI service returned an empty example.");
  return data.text;
}

/**
 * Compute the AI endpoint URL in this order:
 * 1) PUBLIC_AI_API_BASE override (for split-host or local function dev)
 * 2) App base path + /api/* on the current origin
 */
function resolveApiEndpoint(route: "recommend" | "example"): string {
  const path = `api/${route}`;

  if (CONFIGURED_AI_API_BASE) {
    return new URL(path, ensureTrailingSlash(CONFIGURED_AI_API_BASE)).toString();
  }

  if (typeof window !== "undefined") {
    const baseUrl = readBaseUrl();
    return new URL(path, new URL(baseUrl, window.location.origin)).toString();
  }

  return `/${path}`;
}

function readConfiguredAiApiBase(): string | null {
  const raw = (import.meta.env.PUBLIC_AI_API_BASE ?? "").trim();
  return raw ? raw : null;
}

function readBaseUrl(): string {
  const raw = (import.meta.env.BASE_URL ?? "/").trim();
  return ensureTrailingSlash(raw || "/");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
