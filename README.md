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
