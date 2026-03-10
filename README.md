This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

If Turbopack dev mode returns `Internal Server Error` on `/sound` (CSS/PostCSS timeout panic), run stable webpack mode:

```bash
npm run dev:stable
```

## Playwright Autotest (Multitrack / Safari)

Use these commands for repeated multitrack checks in WebKit (Safari engine):

```bash
# single run
npm run test:e2e:multitrack

# stress run: each test 10 times
npm run test:e2e:multitrack:repeat

# continuous loop until Ctrl+C
npm run test:e2e:multitrack:loop
```

Optional loop tuning:

```bash
# run 20 cycles with 2-second gap
PW_LOOP_MAX_RUNS=20 PW_LOOP_INTERVAL_SEC=2 npm run test:e2e:multitrack:loop
```

## Audio TTFP Diagnostics (Opt-In)

Enable lightweight startup timing telemetry for multitrack (`click -> resume -> seek -> engine start -> gate open`):

```bash
# env-flag mode
NEXT_PUBLIC_AUDIO_TTFP=1 npm run dev:stable
```

Or from browser console:

```js
localStorage.setItem("rr_audio_ttfp", "1")
```

Disable again:

```js
localStorage.removeItem("rr_audio_ttfp")
```

Current multitrack change ledger / handoff:

- `docs/multitrack-p0-ledger-2026-03-04.md`

## Local Production-Like Run (Manual Host)

When local `next build` on Turbopack is unstable (for example PostCSS timeout/panic), use manual host mode:

```bash
# Disable launchd auto-host jobs (one-time; adjust labels if needed)
launchctl bootout gui/$(id -u)/com.russianraspev.app.dev || true
launchctl disable gui/$(id -u)/com.russianraspev.app.dev
launchctl bootout gui/$(id -u)/com.russianraspev.night.front || true
launchctl disable gui/$(id -u)/com.russianraspev.night.front

# Build via webpack fallback
npm run build -- --webpack

# Start manually
npm run start
```

Health check:

```bash
curl -I --max-time 10 -s http://localhost:3000 | head -n 1
```

Detailed runbook:

- `docs/ops/local-manual-host-runbook.md`

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Audio Architecture Rule

- Master playback must use a single engine: `app/components/MultiTrackPlayer.tsx`.
- Do not implement parallel/duplicate master transport logic on pages (for example, separate multi-`HTMLAudioElement` playback in `app/sound/page.tsx`).
- The `/sound` page may control playlist/navigation, but actual master playback must be delegated to `MultiTrackPlayer` to keep tracks phase-aligned and avoid drift.

## Storage Backends

- Auth backend:
  - `RR_AUTH_STORE=file` (default)
  - `RR_AUTH_STORE=prisma` (requires `DATABASE_URL`)
- Community backend:
  - `RR_COMMUNITY_STORE=file` (default)
  - `RR_COMMUNITY_STORE=prisma` (requires `DATABASE_URL`)

Current safe default for local work: both backends in `file` mode.

## Production Secrets

Required production env vars:

- `RR_AUTH_OAUTH_STATE_SECRET`
- `RR_MEDIA_TOKEN_SECRET`

## Prisma Commands

```bash
npm run prisma:generate
npm run prisma:migrate:dev -- --name init_auth_ugc
npm run prisma:studio
```

## Community Backfill (file -> Prisma)

Dry-run:

```bash
npm run prisma:backfill:community:dry
```

Apply:

```bash
npm run prisma:backfill:community
```

Backfill reads:
- `data/community/community-db.json`
- `data/community/profiles-db.json`

## Quality Gate Protocol

Hybrid quality mode is mandatory across all Codex windows:

- run `npm run quality:gate:fast` after each closed block/PR;
- run `npm run quality:gate:strict` on control points only.

Full algorithm and triggers:

- `/Users/evgenij/russian-raspev/docs/quality-gate-protocol.md`

## i18n Audit

- `npm run i18n:audit` - base i18n audit report.
- `npm run i18n:audit:strict` - strict mode for symmetry (`ru/en`), unused keys and hardcoded UI literals.
- `npm run i18n:audit:strict:unknown` - strict mode + fail on unknown used keys.

Unknown-key budget is defined in:

- `/Users/evgenij/russian-raspev/config/i18n-audit-budget.json`

If the unknown count goes above budget, strict audit fails.

## Search Runtime Tuning

- `RR_SEARCH_SUGGEST_CACHE_TTL_MS` - TTL (ms) for in-memory server cache of `/api/search/suggest` and server-side search rendering (`15000` by default).
- `RR_SEARCH_SUGGEST_CACHE_MAX_ENTRIES` - max number of cached search entries (`500` by default).

Set either value to `0` to disable the suggest cache.

## Infrastructure Bootstrap

- Domain + storage + CDN phase-1 checklist:
  - `/Users/evgenij/russian-raspev/docs/infra-phase1-bootstrap.md`
