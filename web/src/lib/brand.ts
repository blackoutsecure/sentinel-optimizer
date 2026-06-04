// Derived brand identity surface. Edit values in src/lib/config.ts.

import { CONFIG } from "./config.js";

export const BRAND = {
  // Identity
  name: CONFIG.name,
  tagline: CONFIG.tagline,
  owner: CONFIG.owner,
  repo: CONFIG.repo,

  // Colors — hex codes without leading # for PDF/PowerPoint use (Sentinel colors)
  navy: "243A5E",           // Sentinel signature navy
  teal: "30E5D0",           // Sentinel signature teal
  blue: "0078D4",           // Microsoft blue (secondary)
  cyan: "50E6FF",           // Bright cyan
  green: "107C10",          // Microsoft green
  lime: "9BF00B",           // Bright lime
  amber: "FFB900",          // Microsoft amber
  purple: "D59DFF",         // Light purple
  ink: "1B1B1B",            // Dark ink
  grey: "737373",           // Grey
  light: "F3F6FB",          // Light
  white: "FFFFFF",          // White

  // Color palette exports for CSS/styling (with # for CSS)
  sentinelTeal: CONFIG.colors.sentinelTeal,
  sentinelNavy: CONFIG.colors.sentinelNavy,
  colorBlue: CONFIG.colors.blue,
  colorCyan: CONFIG.colors.cyan,
  colorGreen: CONFIG.colors.green,
  colorAmber: CONFIG.colors.amber,
} as const;
