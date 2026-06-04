/**
 * Cloudflare Pages Function — POST /api/example
 *
 * Generates a realistic example paste payload for a given SIEM vendor, shaped
 * exactly like that vendor's expected export. It is a convenience/demo helper:
 * no user data is involved — the client sends only the vendor label, a plain-
 * language schema hint, and a canonical template (all non-sensitive, app-owned
 * strings). The function asks Workers AI to emit a NEW payload with different
 * but plausible source names and volumes, then validates it is parseable JSON
 * before returning it.
 *
 * If the Workers AI binding (env.AI) is not configured, it returns HTTP 501 so
 * the client can gracefully fall back to its built-in static example.
 */

interface ExampleRequest {
  vendor: string;
  label: string;
  schemaHint: string;
  template: string;
}

interface Env {
  AI?: {
    run: (model: string, input: unknown) => Promise<{ response?: string }>;
  };
  AI_MODEL?: string;
}

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_TEMPLATE_CHARS = 4000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isExampleRequest(v: unknown): v is ExampleRequest {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.vendor === "string" &&
    typeof o.label === "string" &&
    typeof o.schemaHint === "string" &&
    typeof o.template === "string" &&
    o.template.length <= MAX_TEMPLATE_CHARS
  );
}

/** Pull the first JSON object/array out of a model response (tolerate fences). */
function extractJson(raw: string): string | null {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  return s.slice(start, end + 1);
}

function buildPrompt(req: ExampleRequest): string {
  return [
    `You generate sample data for a SIEM cost calculator. Produce ONE realistic EXAMPLE export for "${req.label}".`,
    `It must match the exact JSON structure and field names of the template below — only change the values.`,
    ``,
    `Schema notes: ${req.schemaHint}`,
    ``,
    `Template (copy this structure exactly):`,
    req.template,
    ``,
    `Rules:`,
    `- Output ONLY valid JSON. No prose, no markdown, no code fences.`,
    `- Keep the same keys and nesting as the template.`,
    `- Use 4-6 plausible, well-known log source names for this platform (e.g. firewalls, identity, EDR, cloud audit).`,
    `- Use realistic byte/volume magnitudes (a busy enterprise: hundreds of MB to tens of GB per day per source).`,
    `- Keep "windowDays" at 30 if present.`,
    `- Do not include comments or trailing commas.`,
  ].join("\n");
}

export const onRequestPost = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = ctx;

  if (!env.AI || typeof env.AI.run !== "function") {
    return json({ error: "AI example generation is not enabled for this deployment." }, 501);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "Payload too large." }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!isExampleRequest(parsed)) {
    return json({ error: "Expected a vendor example request." }, 400);
  }

  const model = env.AI_MODEL || DEFAULT_MODEL;
  try {
    const out = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "You output only valid JSON that matches the requested structure. Never include prose or code fences.",
        },
        { role: "user", content: buildPrompt(parsed) },
      ],
    });

    const candidate = extractJson(out.response ?? "");
    if (!candidate) {
      return json({ error: "The AI service did not return usable JSON." }, 502);
    }
    // Validate it parses, then re-serialize for clean, pretty formatting.
    let obj: unknown;
    try {
      obj = JSON.parse(candidate);
    } catch {
      return json({ error: "The AI service returned malformed JSON." }, 502);
    }
    return json({ text: JSON.stringify(obj, null, 2), model });
  } catch {
    return json({ error: "The AI service failed to generate an example." }, 502);
  }
};