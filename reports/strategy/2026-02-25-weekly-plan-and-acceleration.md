# Weekly Execution Plan And Acceleration Options

- Generated at: `2026-02-25 00:24:48 MSK`
- Horizon: next 7 days
- Baseline references:
  - `/Users/evgenij/russian-raspev/reports/strategy/2026-02-25-brief-alignment-and-acceleration.md`
  - `/Users/evgenij/russian-raspev/reports/qa/2026-02-25-smoke-critical.md`
  - `/Users/evgenij/russian-raspev/tmp/WORK_BRIEF_IMPORTANT.md`
  - `/Users/evgenij/russian-raspev/tmp/brief-next.md`

## Weekly target

Close the highest-risk P0 control gaps while preserving green quality gates:

1. close section `17` execution delta,
2. operationally unblock sections `4` and `11`,
3. start deterministic Prisma hardening for section `7`,
4. launch section `25` Phase-1 server-authoritative article draft skeleton.

## 7-day plan (execution-ready)

## Day 1 (control reset)

1. Build single active queue from brief:
   - confirm top P0 items with owner and ETA.
2. Enforce WIP cap:
   - max 3 active PR streams.
3. Freeze non-P0 starts unless explicitly approved.

Deliverables:
- `tmp/brief-next.md` refreshed.
- `tmp/WORK_BRIEF_IMPORTANT.md` refreshed.
- short decision log in `docs/codex-worklog.md`.

Gate commands:
- `npm run brief:important`
- `npm run brief:next`
- `npm run ops:p0p1:status:strict`

## Day 2 (section 17 closure sprint)

1. Finish mini-player/control-plane P0 delta (event-driven state flow).
2. Keep behavior parity while reducing polling hotspots.

Deliverables:
- code delta for section `17`,
- artifact path documented in brief/codex worklog.

Gate commands:
- `npm run quality:gate:delta`
- `npx playwright test tests/e2e/miniplayer-regressions.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
- `npm run test:e2e:critical`

## Day 3 (sections 4 and 11 unblocking)

1. Convert policy/checklist into enforceable workflow:
   - map checklist steps to runnable commands.
2. Remove ambiguity in handoff and merge checks.

Deliverables:
- updated control mapping in brief/worklog,
- explicit pre-merge checklist with command outputs.

Gate commands:
- `npm run brief:lint`
- `npm run blocked:triage`
- `npm run quality:gate:fast`

## Day 4 (section 7 hardening: Prisma path)

1. Define and apply first deterministic cutover checkpoint for critical domain writes.
2. Reduce hidden dependency on file fallback for production-relevant paths.

Deliverables:
- checkpoint note (`scope`, `fallback policy`, `rollback condition`),
- first parity patch set.

Gate commands:
- `npm run prisma:generate`
- `npm run quality:gate:delta`
- `npm run test:e2e:critical`

## Day 5 (section 25 start: articles server-authoritative draft skeleton)

1. Create server-first draft API skeleton behind feature flag.
2. Keep current editor UX; local storage remains fallback cache only.

Deliverables:
- draft API contract + minimal adapter path,
- migration note for read/write authority rules.

Gate commands:
- `npm run quality:gate:delta`
- `npx playwright test tests/e2e/articles-create-ui.spec.ts tests/e2e/articles-hydration.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`

## Day 6 (integration and stabilization)

1. Integrate week changes, resolve coupling regressions.
2. Run strict end-to-end readiness pass.

Deliverables:
- consolidated status report,
- resolved regressions list.

Gate commands:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run i18n:audit`
- `npm run test:e2e:critical:flake`

## Day 7 (release readiness and carry-forward)

1. Prepare carry-forward queue for next week with strict priority.
2. Lock evidence artifacts and weekly outcome summary.

Deliverables:
- weekly summary in `reports/strategy/`,
- refreshed `Next 3` queue and blocked map.

Gate commands:
- `npm run brief:important`
- `npm run brief:next`
- `npm run ops:p0p1:status:strict`
- `npm run ops:orchestration:health:strict`

## Acceleration options

## Option A: Safe acceleration (recommended default)

Rules:
1. WIP cap `3`.
2. PR size cap `<=400` changed lines (excluding generated/binary).
3. Mandatory gates on every PR: `quality:gate:delta + critical e2e`.

Expected effect:
1. steady throughput with minimal regression risk.

Risk:
1. slower visible feature velocity.

## Option B: Balanced acceleration

Rules:
1. WIP cap `4`.
2. Parallel lanes:
   - lane 1: section `17` + playback reliability,
   - lane 2: section `7` + backend parity,
   - lane 3: section `25` + articles draft foundation.
3. Delta gates per lane, nightly full e2e unchanged.

Expected effect:
1. faster P0 burn-down with controlled risk.

Risk:
1. integration conflicts near end of week.

## Option C: Aggressive acceleration

Rules:
1. WIP cap `5`.
2. Daily merge window with same-day integration.
3. Two gate tiers:
   - pre-merge: `quality:gate:delta`,
   - post-merge: `critical e2e + flake`.

Expected effect:
1. maximum short-term output.

Risk:
1. high probability of flake/noise and rollback churn.

## Decision matrix

1. Choose **Option A** if target is reliability and predictable closure.
2. Choose **Option B** if target is closing `17 + 7 + 25` in one week.
3. Choose **Option C** only if you accept weekly instability and rollback overhead.

## Recommended for this week

Use **Option B (Balanced)** with hard stop:

1. if `test:e2e:critical` fails, immediately downgrade to Option A for 24h stabilization.

