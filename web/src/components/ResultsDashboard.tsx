import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostEstimate, SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { money, gbPerDay, gb, pct } from "../lib/format.js";

interface Props {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  input: SentinelCostInput;
  vendorLabel: string;
}

export default function ResultsDashboard({ result, cost, input, vendorLabel }: Props) {
  const totalGbDay = result.totals?.gbPerDay ?? result.sources.reduce((a, s) => a + (s.gbPerDay ?? 0), 0);
  const sorted = [...result.sources].sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0));
  const basicAuxGbDay = Math.max(0, input.basicAuxGbPerDay ?? 0);
  const dataLakeGbDay = Math.max(0, input.dataLakeGbPerDay ?? 0);
  const analyticsMonthlyGb = Math.max(0, input.analyticsGbPerDay) * cost.rates.daysPerMonth;
  const basicAuxMonthlyGb = basicAuxGbDay * cost.rates.daysPerMonth;
  const dataLakeMonthlyGb = dataLakeGbDay * cost.rates.daysPerMonth;
  const commitment = cost.commitment;
  const selectedOption = commitment?.options.find((o) => o.selected);
  const recommendedOption = commitment?.options.find((o) => o.recommended);

  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Daily ingest</span>
          <span className="stat-value">{gbPerDay(totalGbDay)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Est. monthly cost</span>
          <span className="stat-value">{money(cost.monthlyCost)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Billable analytics</span>
          <span className="stat-value">{gbPerDay(cost.billableAnalyticsGbPerDay)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Covered by benefits</span>
          <span className="stat-value">{gbPerDay(cost.benefitGbPerDay)}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <caption className="sr-only">Ingestion pricing lanes</caption>
          <thead>
            <tr>
              <th>Ingestion lane</th>
              <th className="num">GB/day</th>
              <th className="num">GB/month</th>
              <th className="num">Rate/GB</th>
              <th className="num">Est. ingest/mo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Analytics</td>
              <td className="num">{gbPerDay(Math.max(0, input.analyticsGbPerDay))}</td>
              <td className="num">{gb(analyticsMonthlyGb)}</td>
              <td className="num">${cost.rates.analyticsIngestPerGb.toFixed(3)}</td>
              <td className="num">{money(cost.breakdown.analyticsIngestion)}</td>
            </tr>
            <tr>
              <td>Basic / Auxiliary</td>
              <td className="num">{gbPerDay(basicAuxGbDay)}</td>
              <td className="num">{gb(basicAuxMonthlyGb)}</td>
              <td className="num">${cost.rates.basicIngestPerGb.toFixed(3)}</td>
              <td className="num">{money(basicAuxMonthlyGb * cost.rates.basicIngestPerGb)}</td>
            </tr>
            <tr>
              <td>Data Lake</td>
              <td className="num">{gbPerDay(dataLakeGbDay)}</td>
              <td className="num">{gb(dataLakeMonthlyGb)}</td>
              <td className="num">${cost.rates.dataLakeIngestPerGb.toFixed(3)}</td>
              <td className="num">{money(dataLakeMonthlyGb * cost.rates.dataLakeIngestPerGb)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table>
          <caption className="sr-only">{vendorLabel} sources by daily volume</caption>
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">GB/day</th>
              <th className="num">GB/month</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const g = s.gbPerDay ?? 0;
              const share = totalGbDay > 0 ? g / totalGbDay : 0;
              return (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="num">{gbPerDay(g)}</td>
                  <td className="num">{gb(g * (365 / 12))}</td>
                  <td className="num">{(share * 100).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {commitment && (
        <div className="stack">
          <div className="region-best">
            <span>
              Commitment model: <strong>{commitment.mode === "off" ? "PAYG" : commitment.mode === "auto" ? "Auto" : "Manual"}</strong>
            </span>
            {recommendedOption && (
              <span>
                Recommended tier: <strong>{recommendedOption.label}</strong>
                {recommendedOption.estimatedMonthlySavingsVsPayg > 0 && (
                  <> · save <span className="save-pill">{money(recommendedOption.estimatedMonthlySavingsVsPayg)}/mo</span></>
                )}
              </span>
            )}
            {selectedOption && selectedOption.tierGbPerDay != null && (
              <span>
                Selected: <strong>{selectedOption.label}</strong>
              </span>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <caption className="sr-only">Commitment tier modeling options</caption>
              <thead>
                <tr>
                  <th>Option</th>
                  <th className="num">Discount</th>
                  <th className="num">Analytics/mo</th>
                  <th className="num">Total/mo</th>
                  <th className="num">Savings vs PAYG</th>
                  <th className="num">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {commitment.options.map((opt) => (
                  <tr key={opt.tierGbPerDay ?? "payg"} className={opt.selected ? "row-selected" : ""}>
                    <td>
                      {opt.label}
                      {opt.recommended ? " ★ recommended" : ""}
                      {opt.selected ? " (selected)" : ""}
                    </td>
                    <td className="num">{opt.discountPct > 0 ? pct(opt.discountPct) : "—"}</td>
                    <td className="num">{money(opt.analyticsMonthlyCost)}</td>
                    <td className="num">{money(opt.estimatedMonthlyTotalCost)}</td>
                    <td className="num">
                      {opt.estimatedMonthlySavingsVsPayg === 0
                        ? "—"
                        : `${opt.estimatedMonthlySavingsVsPayg > 0 ? "+" : ""}${money(opt.estimatedMonthlySavingsVsPayg)}`}
                    </td>
                    <td className="num">{opt.utilizationPct != null ? pct(opt.utilizationPct) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
