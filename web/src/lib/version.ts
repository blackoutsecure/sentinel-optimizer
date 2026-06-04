// Build version + date. CI sets PUBLIC_APP_VERSION/PUBLIC_BUILD_DATE;
// local builds fall back to "<pkg>-dev".

import pkg from "../../package.json" with { type: "json" };

const ENV_VERSION = (import.meta.env.PUBLIC_APP_VERSION as string | undefined)?.trim();
const ENV_DATE = (import.meta.env.PUBLIC_BUILD_DATE as string | undefined)?.trim();

export const APP_VERSION: string =
  ENV_VERSION && ENV_VERSION.length > 0 ? ENV_VERSION : `${pkg.version}-dev`;

export const BUILD_DATE: string =
  ENV_DATE && ENV_DATE.length > 0 ? ENV_DATE : new Date().toISOString();

export const PKG_VERSION: string = pkg.version;
export const VERSION_LABEL = `v${APP_VERSION.replace(/^v/, "")}`;
