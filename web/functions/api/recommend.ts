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
  summaryStyle?: "executive" | "technical" | "board";
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
  const style = s.summaryStyle ?? "executive";
  const styleInstruction =
    style === "technical"
      ? "Style: technical leadership brief with concrete implementation language, explicit assumptions, and operational dependencies."
      : style === "board"
        ? "Style: board-ready narrative focused on risk, business impact, governance, and decision gates with minimal jargon."
        : "Style: executive summary for CISO/SOC leadership with concise strategic framing and clear next steps.";
  const sources = s.topSources.map((t) => `- ${t.name}: ${t.sharePct}% of ingest`).join("\n");
  const breakdown = Object.entries(s.breakdown)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `- ${k}: $${v.toFixed(2)}/mo`)
    .join("\n");
  const recs = s.recommendations
    .map((r) => `- [${r.severity}] ${r.title}${r.monthlySavings ? ` (~$${r.monthlySavings}/mo)` : ""}`)
    .join("\n");

  return [
    `You are a Microsoft Sentinel migration and cost-optimization advisor. Write a concise executive summary (170-260 words) for a security leader persona (CISO/SOC Director).`,
    `Use only the aggregated figures below. Do not invent specific log contents or customer names.`,
    styleInstruction,
    `Write in clear, plain business language with a confident but neutral tone.`,
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
    `Write this exact flow in plain prose (no markdown headers):`,
    `1) Story + posture: one sentence framing current state and risk/cost pressure.`,
    `2) Persona-aware rationale: why a security leader should act now (cost, detection quality, operational control).`,
    `3) Migration recommendation: phased approach (pilot high-volume source, validate detections, then expand).`,
    `4) Enhancement recommendation: include DCR/workspace transformations, tiering, retention optimization, and commitment tier where relevant.`,
    `5) Worst-case fallback: if full migration cannot proceed now, recommend running Microsoft Sentinel in parallel with the current SIEM for a defined validation window, with explicit success criteria and cutover decision point.`,
    `6) Close with one sentence that figures are planning estimates and should be validated against actual billing and detection outcomes.`,
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
        {
          role: "system",
          content:
            "You are a precise, vendor-neutral cloud security and cost advisor. Optimize for executive clarity, migration practicality, and measurable outcomes.",
        },
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
