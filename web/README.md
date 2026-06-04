# Sentinel Optimizer — Web App

Interactive analyzer for SIEM ingestion and Microsoft Sentinel cost. Built with
Astro + a single React island, deployed as a static site to Cloudflare Pages.
All parsing and cost math run **client-side** — raw data never leaves the
browser. The optional "Enhance with AI" feature sends only an **aggregated
numeric summary** to a Cloudflare Pages Function.

## Architecture

- `src/components/Optimizer.tsx` — the interactive island (mounted `client:load`).
- `src/lib/*` — formatting, examples, deterministic recommendation engine, AI client.
- The island imports the engine directly via the `@engine` Vite alias, e.g.
  `@engine/parsers/index.js`, `@engine/pricing/index.js`. No publish step — the
  engine source lives one directory up (the repo root).
- `functions/api/recommend.ts` — optional Cloudflare Pages Function (Workers AI).

## Develop

```sh
cd web
npm install
npm run dev        # http://localhost:4321
npm run build      # static output → web/dist
npm run typecheck  # astro check
```

## Optional AI enhancement

The `/api/recommend` function needs a Workers AI binding named `AI`. In the
Cloudflare Pages project: **Settings → Functions → Bindings → add "Workers AI"
as `AI`**. Optionally set `AI_MODEL` to override the default model
(`@cf/meta/llama-3.1-8b-instruct`).

If the binding is absent, the function returns HTTP 501 and the UI falls back to
its always-on deterministic recommendations.

If the UI is not served from the same origin as the Pages Function (or you are
running a local function endpoint), set `PUBLIC_AI_API_BASE` so the client can
target the correct host:

```sh
cd web
PUBLIC_AI_API_BASE="http://127.0.0.1:8788/" npm run dev
```

When this variable is unset, the client defaults to the app origin + base path
(`BASE_URL`) and calls `/api/recommend` and `/api/example` there.

### Functions + static deploy

Cloudflare Pages reads the `functions/` directory from the **working directory**
of the deploy, not from inside the asset folder. Deploy with the asset directory
as `web/dist` while running from `web/` so `web/functions` is picked up:

```sh
cd web && npx wrangler pages deploy dist --project-name sentinel-optimizer-site
```
