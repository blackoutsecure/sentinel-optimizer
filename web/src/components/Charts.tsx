import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostBreakdown } from "@engine/pricing/sentinelPricing.js";
import type { ProviderComparisonModel } from "../lib/providerComparison.js";
import { money, gbPerDay } from "../lib/format.js";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

/** Reads a CSS custom property from :root (theme-aware). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Re-render hook: bumps a counter whenever the theme toggles. */
function useThemeKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const onChange = () => setKey((k) => k + 1);
    window.addEventListener("themechange", onChange);
    return () => window.removeEventListener("themechange", onChange);
  }, []);
  return key;
}

const SOURCE_PALETTE = [
  "--c-ingest",
  "--c-lake",
  "--c-retention",
  "--c-storage",
  "--c-search",
  "--c-soar",
  "--c-copilot",
  "--c-sap",
];

export function SourceBreakdownChart({ result }: { result: NormalizedResult }) {
  const themeKey = useThemeKey();
  const text = cssVar("--text-muted", "#b7b7b7");
  const border = cssVar("--surface", "#1f2937");

  const sorted = [...result.sources]
    .filter((s) => (s.gbPerDay ?? 0) > 0)
    .sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0));

  const top = sorted.slice(0, 7);
  const restGb = sorted.slice(7).reduce((a, s) => a + (s.gbPerDay ?? 0), 0);
  const labels = [...top.map((s) => s.name), ...(restGb > 0 ? ["Other"] : [])];
  const values = [...top.map((s) => s.gbPerDay ?? 0), ...(restGb > 0 ? [restGb] : [])];
  const colors = labels.map((_, i) => cssVar(SOURCE_PALETTE[i % SOURCE_PALETTE.length]!, "#30E5D0"));

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderColor: border,
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { position: "right", labels: { color: text, boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (c) => ` ${c.label}: ${gbPerDay(c.parsed)}`,
        },
      },
    },
  };

  return (
    <div className="chart-box">
      <Doughnut key={themeKey} data={data} options={options} />
    </div>
  );
}

const BREAKDOWN_LABELS: { key: keyof SentinelCostBreakdown; label: string; color: string }[] = [
  { key: "analyticsIngestion", label: "Analytics ingest", color: "--c-ingest" },
  { key: "dataLakeIngestion", label: "Data Lake ingest", color: "--c-lake" },
  { key: "interactiveRetention", label: "Interactive retention", color: "--c-retention" },
  { key: "dataStorage", label: "Long-term storage", color: "--c-storage" },
  { key: "dataSearch", label: "Search", color: "--c-search" },
  { key: "soar", label: "SOAR", color: "--c-soar" },
  { key: "securityCopilot", label: "Security Copilot", color: "--c-copilot" },
  { key: "sap", label: "Sentinel for SAP", color: "--c-sap" },
];

export function CostBreakdownChart({ breakdown }: { breakdown: SentinelCostBreakdown }) {
  const themeKey = useThemeKey();
  const text = cssVar("--text-muted", "#b7b7b7");
  const grid = cssVar("--border", "#4b5563");

  const present = BREAKDOWN_LABELS.filter((b) => (breakdown[b.key] ?? 0) > 0);

  const data = {
    labels: present.map((b) => b.label),
    datasets: [
      {
        label: "Monthly cost",
        data: present.map((b) => breakdown[b.key]),
        backgroundColor: present.map((b) => cssVar(b.color, "#30E5D0")),
        borderRadius: 6,
        maxBarThickness: 34,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.x ?? 0)} / mo` } },
    },
    scales: {
      x: {
        ticks: { color: text, callback: (v) => money(Number(v)) },
        grid: { color: grid },
      },
      y: { ticks: { color: text }, grid: { display: false } },
    },
  };

  return (
    <div className="chart-box">
      <Bar key={themeKey} data={data} options={options} />
    </div>
  );
}

export function ProviderSpendComparisonChart({ comparison }: { comparison: ProviderComparisonModel }) {
  const themeKey = useThemeKey();
  const text = cssVar("--text-muted", "#b7b7b7");
  const grid = cssVar("--border", "#4b5563");
  const sentinelColor = cssVar("--c-ingest", "#30E5D0");
  const otherColor = cssVar("--c-retention", "#243A5E");

  const top = comparison.rows.slice(0, 6).sort((a, b) => b.monthlyListSpend - a.monthlyListSpend);
  const data = {
    labels: top.map((r) => r.label),
    datasets: [
      {
        label: "Estimated monthly spend",
        data: top.map((r) => r.monthlyListSpend),
        backgroundColor: top.map((r) => (r.vendor === "sentinel" ? sentinelColor : otherColor)),
        borderRadius: 6,
        maxBarThickness: 34,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c) => ` ${money(c.parsed.x ?? 0)} / mo`,
          afterLabel: (c) => {
            const r = top[c.dataIndex];
            if (!r || r.vendor === "sentinel") return " Modeled Sentinel baseline";
            return ` Delta vs Sentinel: ${r.deltaVsSentinelMonthly > 0 ? "+" : ""}${money(r.deltaVsSentinelMonthly)} / mo`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: text, callback: (v) => money(Number(v)) },
        grid: { color: grid },
      },
      y: { ticks: { color: text }, grid: { display: false } },
    },
  };

  return (
    <div className="chart-box">
      <Bar key={themeKey} data={data} options={options} />
    </div>
  );
}
