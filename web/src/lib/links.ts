// Shared link list for nav, footer, sitemap helpers.
import { BRAND } from "./brand.js";

export type NavLink = { href: string; label: string; external?: boolean };

export function siteLinks(base: string): NavLink[] {
  const b = base.replace(/\/$/, "");
  return [
    { href: `${b}/`, label: "Home" },
  ];
}

export function externalSources(): NavLink[] {
  return [
    { href: "https://learn.microsoft.com/azure/sentinel/", label: "Azure Sentinel Docs", external: true },
    { href: "https://azure.microsoft.com/pricing/details/microsoft-sentinel/", label: "Sentinel Pricing", external: true },
  ];
}

export function repoLinks(): NavLink[] {
  return [
    { href: `https://github.com/${BRAND.repo}`, label: "GitHub", external: true },
    { href: `https://github.com/${BRAND.repo}/issues`, label: "Issues", external: true },
    { href: `https://github.com/${BRAND.repo}/blob/dev/LICENSE`, label: "MIT License", external: true },
  ];
}
