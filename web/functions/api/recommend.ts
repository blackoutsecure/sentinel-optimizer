/**
 * Cloudflare Pages Function — POST /api/recommend
 *
 * Optional AI enhancement endpoint. It accepts ONLY an aggregated, non-
 * identifying numeric summary (the AggregatedSummary shape from the client),
 * calls Workers AI server-side, and returns prose. It never receives or stores
 * raw logs.
 *
 * If the Workers AI binding (env.AI) is not configured, it returns HTTP 501 so
 * the client can gracefully fall back to its deterministic recommendations.
 *
 * Bind Workers AI in the Pages project settings (Functions → Bindings → AI),
 * or in wrangler.toml:  [ai]  binding = "AI"
 */

interface AggregatedSummary {
  vendor: string;
  totalGbPerDay: number;
  sourceCount: number;
  topSources: { name: string; sharePct: number }[];
  monthlyCost: number;
  breakdown: Record<string, number>;
  billableAnalyticsGbPerDay: number;
  benefitGbPerDay: number;
  recommendations: { title: string; severity: string; monthlySavings?: number }[];
}

interface Env {
  AI?: {
    run: (model: string, input: unknown) => Promise<{ response?: string }>;
  };
  /** Optional override of the model id. */
  AI_MODEL?: string;
}

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Defensive: reject anything that looks like raw log content, not a summary. */
function isAggregatedSummary(v: unknown): v is AggregatedSummary {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.totalGbPerDay === "number" &&
    typeof o.monthlyCost === "number" &&
    typeof o.breakdown === "object" &&
    Array.isArray(o.topSources) &&
    Array.isArray(o.recommendations)
  );
}

function buildPrompt(s: AggregatedSummary): string {
  const sources = s.topSources.map((t) => `- ${t.name}: ${t.sharePct}% of ingest`).join("\n");
  const breakdown = Object.entries(s.breakdown)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `- ${k}: $${v.toFixed(2)}/mo`)
    .join("\n");
  const recs = s.recommendations
    .map((r) => `- [${r.severity}] ${r.title}${r.monthlySavings ? ` (~$${r.monthlySavings}/mo)` : ""}`)
    .join("\n");

  return [
    `You are a Microsoft Sentinel cost-optimization advisor. Write a concise executive summary (120-180 words) for a security leader.`,
    `Use only the aggregated figures below. Do not invent specific log contents or customer names.`,
    ``,
    `SIEM: ${s.vendor}`,
    `Total ingest: ${s.totalGbPerDay} GB/day across ${s.sourceCount} sources`,
    `Billable analytics: ${s.billableAnalyticsGbPerDay} GB/day (benefits cover ${s.benefitGbPerDay} GB/day)`,
    `Estimated monthly cost: $${s.monthlyCost}`,
    ``,
    `Top sources:\n${sources || "- (none)"}`,
    ``,
    `Cost breakdown:\n${breakdown || "- (none)"}`,
    ``,
    `Detected opportunities:\n${recs || "- (none)"}`,
    ``,
    `Write: 1) a one-sentence cost posture assessment, 2) the 2-3 highest-leverage actions with rationale, 3) a closing note that figures are planning estimates. Plain prose, no markdown headers.`,
  ].join("\n");
}

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;

  if (!env.AI || typeof env.AI.run !== "function") {
    return json({ error: "AI enhancement is not enabled for this deployment." }, 501);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "Payload too large; this endpoint accepts aggregated summaries only." }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!isAggregatedSummary(parsed)) {
    return json({ error: "Expected an aggregated summary payload." }, 400);
  }

  const model = env.AI_MODEL || DEFAULT_MODEL;
  try {
    const out = await env.AI.run(model, {
      messages: [
        { role: "system", content: "You are a precise, vendor-neutral cloud cost advisor." },
        { role: "user", content: buildPrompt(parsed) },
      ],
    });
    const text = (out.response ?? "").trim();
    if (!text) return json({ error: "The AI service returned an empty response." }, 502);
    return json({ text, model });
  } catch {
    return json({ error: "The AI service failed to generate a summary." }, 502);
  }
};
