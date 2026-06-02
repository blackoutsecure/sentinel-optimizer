/** Number / currency / volume formatting helpers (pure, locale: en-US). */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function money(n: number): string {
  return Math.abs(n) >= 100 ? usd.format(n) : usd2.format(n);
}

export function number(n: number): string {
  return int.format(n);
}

/** GB/day with sensible precision and unit roll-up to TB/day for big numbers. */
export function gbPerDay(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} TB/day`;
  if (n >= 100) return `${n.toFixed(0)} GB/day`;
  if (n >= 1) return `${n.toFixed(1)} GB/day`;
  return `${n.toFixed(3)} GB/day`;
}

export function gb(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} TB`;
  if (n >= 1) return `${n.toFixed(1)} GB`;
  return `${n.toFixed(3)} GB`;
}

/** Human-readable byte count (decimal, matching SIEM billing conventions). */
export function bytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
