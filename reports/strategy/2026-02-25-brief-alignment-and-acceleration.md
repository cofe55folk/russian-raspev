# Brief Alignment And Acceleration Plan

- Generated at: `2026-02-25 00:19:48 MSK`
- Workspace: `/Users/evgenij/russian-raspev`
- Brief source of truth: `/Users/evgenij/russian-raspev/WORK_BRIEF.md`
- Supporting briefs: `WORK_BRIEF_*`
- Fact baseline source: local quality checks and E2E runs from current workspace state

## 1) What the brief says now (control layer)

- P0 summary: `open=8`, `in_progress=1`, `blocked=2`, completion `54.2%`.
- P1 summary: `100%` closed.
- Active triad task: section `17` (`in_progress`).
- Next actionable queue from brief tooling:
  - `17` (continue),
  - `51` (continue),
  - `5` (open).
- Current risk level in brief: `high`.

Sources:
- `/Users/evgenij/russian-raspev/tmp/WORK_BRIEF_IMPORTANT.md`
- `/Users/evgenij/russian-raspev/tmp/brief-next.md`

## 2) Fact baseline from code and checks

- Engineering checks: PASS
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm run test:e2e:critical` (`11 passed`, `9 skipped`)
  - `npm run i18n:audit`
  - `npm run quality:gate:fast`
- CI and nightly E2E are configured:
  - `/Users/evgenij/russian-raspev/.github/workflows/ci.yml`
  - `/Users/evgenij/russian-raspev/.github/workflows/nightly-e2e.yml`
- Current engineering friction:
  - very large active WIP (`49 M`, `91 ??`);
  - very large hot files (`MultiTrackPlayer.tsx`, `triad-control-plane.mjs`);
  - runtime is still mixed `file|prisma` with file fallback in key domains;
  - Prisma schema exists, but repository has no `prisma/migrations` directory.

## 3) Alignment matrix (brief vs fact)

1. Section `4` (priority policy `P0->P1->P2`): aligned in intent, weak in execution discipline due oversized concurrent WIP.
2. Section `5` (2-sprint roadmap): partially aligned. Quality gates are green, but decomposition and parity hardening are unfinished.
3. Section `7` (Prisma parity as P0 when Prisma mode is on): partially aligned. Parity layer exists, but fallback-to-file remains broad.
4. Section `17` (mini-player/control-plane hardening): in progress and broadly aligned; tests and telemetry scaffolding exist.
5. Section `25` (articles server-authoritative lifecycle): not yet aligned. Core authoring flow still localStorage-heavy.
6. Section `55` (collab-first modernization): strongly progressing. Large community/collab API surface is present.
7. Section `61` (events/ticketing modernization): progressing. Event routes and APIs exist; full ticket lifecycle still staged.
8. Section `306` (photo archive foundation): progressing. Photo archive schema/contracts and upload/publish APIs exist.

## 4) Work strategy (execution model)

## Stage A (next 72 hours): stabilize control

1. Freeze new non-P0 streams until P0 blocked/open map is refreshed with owner + ETA per item.
2. Split current large WIP into mergeable batches by domain:
   - playback/control-plane,
   - data/backend parity,
   - content domains (articles/events/photo/community).
3. Lock one canonical gate set for each batch:
   - `lint + typecheck + build + critical e2e`.

Exit criteria:
- each active batch has explicit owner, gate commands, and expected artifact path.

## Stage B (week 1-2): close P0 backlog debt

1. Prisma convergence for critical write paths (remove hidden file-store dependency for production paths).
2. Mini-player/control-plane finish for section `17` with event-driven flow completion.
3. Articles P0 foundation start: server-authoritative drafts behind feature flag, local cache only as fallback.

Exit criteria:
- P0 blocked items reduced to zero or explicitly deferred with documented risk acceptance.

## Stage C (week 3-4): reduce structural risk

1. Decompose largest components/modules into domain slices with invariant tests.
2. Introduce migration discipline:
   - checked-in migrations,
   - backfill scripts with idempotency reports.
3. Keep nightly full E2E and tighten flaky-test triage loop.

Exit criteria:
- top-3 oversized files reduced in effective ownership complexity;
- no release-critical flow depends on implicit file-store fallback.

## Stage D (week 5-8): accelerate without regression

1. Parallel lane execution by stable boundaries:
   - lane 1: playback/recording reliability,
   - lane 2: events/donate/ticket lifecycle,
   - lane 3: articles + search lifecycle,
   - lane 4: photo/archive metadata and map integration.
2. Roll out change-budget policy per lane (small, reversible increments).

Exit criteria:
- predictable weekly throughput with unchanged critical gate pass rate.

## 5) Acceleration options (with effect/risk)

1. **WIP cap + PR size cap**
   - Effect: fewer merge conflicts, faster review cycle.
   - Risk: may temporarily reduce visible feature throughput.

2. **Domain gate templates**
   - Effect: every task has prebound commands/artifacts, less coordination time.
   - Risk: initial setup overhead.

3. **Change-based test selection (delta gate)**
   - Effect: faster inner loop for non-critical edits.
   - Risk: false confidence if mapping misses cross-domain coupling.

4. **Prisma cutover checkpoints**
   - Effect: removes dual-backend ambiguity and hidden production drift.
   - Risk: migration/backfill mistakes without rehearsal dataset.

5. **Hot-file decomposition budget**
   - Effect: lower defect density and easier parallel work.
   - Risk: short-term refactor cost.

6. **Artifact-first reporting (`reports/*`)**
   - Effect: team-wide visibility and reproducible audits.
   - Risk: documentation drift if not tied to CI outputs.

## 6) Immediate next queue (recommended)

1. Close section `17` execution delta with explicit artifact output.
2. Unblock section `4` and section `11` by converting them from static checklist into enforced CI/ops checks.
3. Start section `7` hardening path toward deterministic Prisma behavior for production-critical domains.
4. Launch section `25` Phase-1 implementation skeleton (server-authoritative draft APIs).

