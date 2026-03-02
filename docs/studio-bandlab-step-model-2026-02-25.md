# Step-by-Step Model: BandLab-like Studio Rollout

Date: 2026-02-25
Audience: orchestrator + execution windows.

## 1) Goal and non-goals

Goal:

1. Deliver production-safe BandLab-like studio mode incrementally on top of existing multitrack engine.

Non-goals for this rollout:

1. No big-bang rewrite of `MultiTrackPlayer`.
2. No full internet live-jam audio transport in MVP.
3. No chord/arpeggio deep parity in `P0/P1`; defer this to optional late `P2`.

## 2) Inputs (must read first)

1. Main brief update:
   1. `/Users/evgenij/russian-raspev/WORK_BRIEF.md` (section `311`).
2. Packet plan:
   1. `/Users/evgenij/russian-raspev/docs/parallel-work-packets-2026-02-25-bandlab.md`.
3. Existing reliability baseline:
   1. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-reliability.spec.ts`
   2. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-fallback-ui.spec.ts`
   3. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-latency-envelope.spec.ts`
4. Cross-platform player baseline packet (must apply):
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/player-comparison-bandlab-soundcloud-vk-2026-03-03.md`
   2. baseline decision:
      1. SoundCloud for transport control semantics,
      2. VK for continuity/telemetry semantics,
      3. BandLab for studio/DAW workflow semantics.
5. Timed feedback baseline already delivered in collaboration domain:
   1. `/Users/evgenij/russian-raspev/WORK_BRIEF.md` sections `67` and `68` (`atMs` API + marker click -> seek UI).
   2. rollout target in this studio program:
      1. promote the same `atMs` semantics to studio timeline/waveform comments in `P1`.

## 3) Execution model

1. Stage 0: Baseline lock.
   1. Capture current green/red state for recording-v2 suites.
   2. Freeze acceptance gates for this program.
   3. Freeze player control baseline contract from cross-platform packet before transport rewrites.
2. Stage 1: P0 packet chain.
   1. `P0-1` Binary chunk ingest contract.
   2. `P0-2` Durable chunk persistence.
   3. `P0-3` Compatibility + envelope safety.
3. Stage 2: P1 packet chain.
   1. `P1-1` Prisma recording source-of-truth.
   2. `P1-2` Storage adapter local + S3-compatible.
   3. `P1-3` Studio project/revision baseline.
   4. `P1-4` Timed comments marker-seek baseline in studio timeline.
4. Stage 3: P2 packet.
   1. `P2-1` Realtime collaboration + advanced feedback control-plane.
   2. `P2-2` Optional chord/arpeggio parity extension.
5. Stage 4: readiness checkpoint.
   1. Confirm no regressions in multitrack guest-sync and recording paths.

## 4) Commands per stage

Stage 0:

1. `cd /Users/evgenij/russian-raspev && npm run quality:gate:fast`
2. `cd /Users/evgenij/russian-raspev && npx playwright test tests/e2e/recording-v2-reliability.spec.ts tests/e2e/recording-v2-fallback-ui.spec.ts tests/e2e/recording-v2-latency-envelope.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`

After each packet:

1. `cd /Users/evgenij/russian-raspev && npm run quality:gate:fast`

After each phase (`P0`, `P1`, `P2`):

1. `cd /Users/evgenij/russian-raspev && npm run quality:gate:strict`

## 5) Evidence contract (mandatory)

Every packet completion report must include:

1. `RESULT`: pass/fail + short scope statement.
2. `CHANGED_FILES`: full absolute paths.
3. `VALIDATION`: exact commands + pass/fail.
4. `RISKS`: known residual risks.
5. `NEXT_PACKET`: exact next packet ID.

If fail:

1. stop chain,
2. document blocker,
3. attach last green commit/working-state reference,
4. do not continue to next packet.

## 6) Rollback and guardrails

1. If reliability gate fails:
   1. keep `recording_engine_v2` path disabled for impacted slice,
   2. retain compatibility `media_recorder_v1` path.
2. If storage adapter fails:
   1. switch back to local file backend.
3. If Prisma path fails:
   1. fallback to file backend via env switch.

## 7) Deliverables expected by orchestrator

1. Updated backend contracts for binary ingest.
2. Durable recording metadata + binary persistence model.
3. Prisma-backed recording source-of-truth with fallback.
4. Storage abstraction for object backends.
5. Minimal studio project/revision backend contract.
6. Player control + continuity contract document aligned with baseline packet.
7. Timed comments contract in studio timeline (`marker + preview + deterministic seek`) aligned with `atMs` baseline.

## 8) Handoff message template to orchestrator

```text
BandLab-like studio rollout is now codified.
Read and execute in this order:
1) /Users/evgenij/russian-raspev/WORK_BRIEF.md (section 311)
2) /Users/evgenij/russian-raspev/docs/parallel-work-packets-2026-02-25-bandlab.md
3) /Users/evgenij/russian-raspev/docs/studio-bandlab-step-model-2026-02-25.md

Run packets strictly in sequence (P0-1..P2-2).
Report each packet with: RESULT / CHANGED_FILES / VALIDATION / RISKS / NEXT_PACKET.
Do not advance phase if quality gate or reliability suites fail.
```

## 9) Completion criteria for this program

1. P0, P1, and P2 packet chains are complete.
2. Required validation gates are green at each phase boundary.
3. No regression in existing multitrack guest sync baseline.
4. Orchestrator has complete evidence trail for each packet.
5. Player behavior in implementation matches baseline contract (`SoundCloud transport + VK continuity`).
6. Timed comments behavior in implementation matches baseline contract (`atMs` marker + marker click -> seek).

## 10) Section 17 addendum: mini-player execution stream

Scope note:

1. This addendum extends the existing 2-sprint roadmap and does not replace packet order.

Design-check (mandatory) before edits:

1. A) Polling patch-only:
   1. Keep current architecture and tune `setInterval` loops only.
   2. Pros: fastest local edit.
   3. Cons: weak reliability under concurrent controllers; no single source of truth.
2. B) Event bus only:
   1. Add event bus between controllers without centralized state store.
   2. Pros: lower complexity than full store migration.
   3. Cons: replay/recovery and operability remain fragmented.
3. C) State-store first (selected):
   1. Introduce `MiniPlayerStateStore` as canonical state owner.
   2. Replace polling in `GlobalMiniPlayer`, `app/sound/page.tsx`, `SoundCardHeroAction`.
   3. Emit updates from active controller on play/pause/seek and consume via store subscriptions.
   4. Pros: strongest reliability and rollback operability.
   5. Cons: moderate migration effort.

Decision:

1. Selected `C` because it is the only option that preserves single source of truth and deterministic recovery semantics.
2. Rejected `A` due to persistent race/churn risk.
3. Rejected `B` due to split-brain state risk and harder incident debugging.

Execution extension (Sprint A, P0, 1 week):

1. Create `MiniPlayerStateStore` contract and state transitions.
2. Cut over three polling consumers to store subscription model.
3. Wire controller update emission on play/pause/seek.
4. Keep rollback toggle to compatibility polling path during rollout window.
