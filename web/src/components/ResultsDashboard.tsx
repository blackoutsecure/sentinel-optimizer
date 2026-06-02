import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostEstimate } from "@engine/pricing/sentinelPricing.js";
import { money, gbPerDay, gb } from "../lib/format.js";

interface Props {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  vendorLabel: string;
}

export default function ResultsDashboard({ result, cost, vendorLabel }: Props) {
  const totalGbDay = result.totals?.gbPerDay ?? result.sources.reduce((a, s) => a + (s.gbPerDay ?? 0), 0);
  const sorted = [...result.sources].sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0));

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
          <caption className="sr-only">{vendorLabel} sources by daily volume</caption>
          <thead>
            <tr>
              <th>Source</th>
              <th style={{ textAlign: "right" }}>GB/day</th>
              <th style={{ textAlign: "right" }}>GB/month</th>
              <th style={{ textAlign: "right" }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const g = s.gbPerDay ?? 0;
              const share = totalGbDay > 0 ? g / totalGbDay : 0;
              return (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td style={{ textAlign: "right" }}>{gbPerDay(g)}</td>
                  <td style={{ textAlign: "right" }}>{gb(g * (365 / 12))}</td>
                  <td style={{ textAlign: "right" }}>{(share * 100).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
