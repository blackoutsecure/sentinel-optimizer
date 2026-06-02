import { useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostEstimate, SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { generateRecommendations, totalSavings } from "../lib/recommendations.js";
import { buildReportData, exportPdf, exportPptx } from "../lib/exporters.js";

interface Props {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  input: SentinelCostInput;
  vendorLabel: string;
  aiSummary?: string | null;
  aiModel?: string;
  onReset: () => void;
}

type Job = "pdf" | "pptx" | null;

export default function ExportBar({ result, cost, input, vendorLabel, aiSummary, aiModel, onReset }: Props) {
  const [busy, setBusy] = useState<Job>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "pdf" | "pptx") {
    setError(null);
    setBusy(kind);
    try {
      const recs = generateRecommendations({ result, cost, input });
      const data = buildReportData({
        result,
        cost,
        vendorLabel,
        recommendations: recs,
        totalSavings: totalSavings(recs),
        ...(aiSummary ? { aiSummary } : {}),
        ...(aiModel ? { aiModel } : {}),
      });
      if (kind === "pdf") await exportPdf(data);
      else await exportPptx(data);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="section-head">
        <span className="eyebrow">Export & share</span>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => run("pdf")}
          disabled={busy !== null}
        >
          {busy === "pdf" ? "Building PDF…" : "Export PDF report"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => run("pptx")}
          disabled={busy !== null}
        >
          {busy === "pptx" ? "Building deck…" : "Generate PowerPoint"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onReset}
          disabled={busy !== null}
        >
          Start over
        </button>
      </div>
      <p className="ai-note">
        Exports run entirely in your browser — nothing is uploaded. The PDF and PowerPoint include
        the summary, charts, and recommendations
        {aiSummary ? ", plus the AI executive summary you generated." : ". Generate the AI executive summary above to include it."}
        {" "}The PowerPoint follows the Microsoft Sentinel pricing-offer layout and is clearly marked
        as an unofficial, independent estimate.
      </p>
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
