// Central configuration — every user-editable knob lives here.
// All other modules derive from CONFIG.

export const CONFIG = Object.freeze({
  // Site identity
  name: "Sentinel Optimizer",
  tagline: "SIEM cost & migration estimator",
  owner: "Dr. Bill Mcilhargey",
  repo: "blackoutsecure/sentinel-optimizer",

  // Brand colors — Microsoft Sentinel signature palette; also mirrored in src/styles/global.css; keep in sync.
  colors: Object.freeze({
    sentinelTeal: "#30E5D0",        // Sentinel signature teal
    sentinelNavy: "#243A5E",        // Sentinel navy
    blue: "#0078D4",                // Microsoft blue (secondary)
    cyan: "#50E6FF",                // Bright cyan accent
    green: "#107C10",               // Microsoft green
    lime: "#9BF00B",                // Bright lime
    amber: "#FFB900",               // Microsoft amber
    purple: "#D59DFF",              // Light purple
  }),

  // Page metadata defaults
  defaultDescription:
    "Analyze SIEM ingestion, estimate Microsoft Sentinel cost, and get optimization recommendations — entirely in your browser. Zero trust, zero credentials, independent community tool.",
  language: "en",
  direction: "ltr",
  titleSeparator: " — ",
});
