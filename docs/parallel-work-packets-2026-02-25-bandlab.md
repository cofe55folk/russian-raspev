# Parallel Work Packets: BandLab-like Studio Program

Date: 2026-02-25
Mode: no-conflict packet execution for orchestrator-driven delivery.

Purpose:

1. Execute BandLab-like studio rollout in small isolated packets.
2. Preserve runtime stability while moving backend/storage model forward.
3. Keep player behavior anchored to the cross-platform baseline decision:
   1. SoundCloud transport controls,
   2. VK continuity/telemetry,
   3. BandLab studio workflow.
4. Keep timed-comment behavior anchored to collaboration baseline:
   1. `atMs` marker semantics,
   2. marker interaction coupled to deterministic seek.

## Global execution policy (mandatory)

1. Packet order is strict: `P0-1 -> P0-2 -> P0-3 -> P1-1 -> P1-2 -> P1-3 -> P1-4 -> P2-1 -> P2-2`.
2. One packet per execution window.
3. Do not edit files outside packet allowlist.
4. Quality gate per packet:
   1. `cd /Users/evgenij/russian-raspev && npm run quality:gate:fast`
5. Control-point gate after each phase (`P0`, `P1`, `P2`):
   1. `cd /Users/evgenij/russian-raspev && npm run quality:gate:strict`
6. Report format (mandatory):
   1. `RESULT`
   2. `CHANGED_FILES`
   3. `VALIDATION`
   4. `RISKS`
   5. `NEXT_PACKET`
7. Scope lock:
   1. Chord/arpeggio parity work is out of scope for `P0/P1` and must not block those gates.
8. Baseline lock:
   1. do not introduce transport-control behavior that violates the baseline packet:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/player-comparison-bandlab-soundcloud-vk-2026-03-03.md`
   2. continuity checks must remain explicit in packet validation notes.
   3. timed comments must preserve `atMs` marker semantics and deterministic seek behavior.

## P0-1: Binary chunk ingest contract

Scope:

1. Add binary ingest path for `recording-v2` chunk upload.

Allowed paths:

1. `/Users/evgenij/russian-raspev/app/api/ugc/recording-v2/takes/[takeId]/chunks/route.ts`
2. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-contract.ts`
3. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-upload-client.ts`
4. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-reliability.spec.ts`

Forbidden:

1. `app/components/**`
2. `prisma/**`
3. `docs/**` except worklog append.

DoD:

1. Chunk endpoint accepts binary payload + metadata and enforces checksum/idempotency.
2. Existing metadata validations remain intact.

Validation:

1. `npx playwright test tests/e2e/recording-v2-reliability.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`

## P0-2: Durable chunk persistence

Scope:

1. Persist uploaded chunk binary data in durable local storage namespace.

Allowed paths:

1. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-file.ts`
2. `/Users/evgenij/russian-raspev/app/api/ugc/recording-v2/takes/[takeId]/finalize/route.ts`
3. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-reliability.spec.ts`

Forbidden:

1. `app/components/**`
2. `prisma/**`

DoD:

1. Chunk persistence is durable and sequence integrity checks still pass.
2. Finalize remains idempotent and gap-aware.

Validation:

1. `npx playwright test tests/e2e/recording-v2-reliability.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`

## P0-3: Compatibility and envelope safety

Scope:

1. Confirm `media_recorder_v1` fallback and latency envelope remain stable.

Allowed paths:

1. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-fallback-ui.spec.ts`
2. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-latency-envelope.spec.ts`
3. `/Users/evgenij/russian-raspev/app/lib/feature-flags/preview.ts` (only if required)

DoD:

1. Fallback path is green with `recording_engine_v2` disabled.
2. Envelope test remains green.

Validation:

1. `npx playwright test tests/e2e/recording-v2-fallback-ui.spec.ts tests/e2e/recording-v2-latency-envelope.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`

## P1-1: Prisma recording source-of-truth

Scope:

1. Add Prisma entities and store adapter for recording take/chunks/finalization.

Allowed paths:

1. `/Users/evgenij/russian-raspev/prisma/schema.prisma`
2. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store.ts`
3. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-prisma.ts`
4. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-file.ts` (adapter integration only)
5. `/Users/evgenij/russian-raspev/README.md`

DoD:

1. `RR_RECORDING_STORE=file|prisma` switch exists.
2. Prisma path supports same integrity semantics as file path.

Validation:

1. `npm run typecheck`
2. `npm run quality:gate:fast`

## P1-2: Storage adapter (local + S3-compatible)

Scope:

1. Abstract storage backend for recording binary objects.

Allowed paths:

1. `/Users/evgenij/russian-raspev/app/lib/media/storage.ts`
2. `/Users/evgenij/russian-raspev/app/lib/media/storage-local.ts`
3. `/Users/evgenij/russian-raspev/app/lib/media/storage-s3.ts`
4. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-prisma.ts`
5. `/Users/evgenij/russian-raspev/docs/infra-phase1-bootstrap.md`

DoD:

1. Storage backend chosen by env.
2. Recording objects are written/read through adapter.

Validation:

1. `npm run typecheck`
2. targeted ingest tests or contract tests.

## P1-3: Studio project + revision baseline

Scope:

1. Add minimal server model for project/revision/track/clip and APIs.

Allowed paths:

1. `/Users/evgenij/russian-raspev/prisma/schema.prisma`
2. `/Users/evgenij/russian-raspev/app/api/studio/**`
3. `/Users/evgenij/russian-raspev/app/lib/studio/**`
4. `/Users/evgenij/russian-raspev/tests/e2e/**` (studio API contract tests)

Forbidden:

1. Deep rewrite of `MultiTrackPlayer` transport.

DoD:

1. Project creation + revision save + clip attach contract exists.
2. Recording take can be linked to revision clip reference.

Validation:

1. new studio API contract tests pass.
2. existing multitrack critical tests unaffected.

## P1-4: Timed comments waveform marker contract

Scope:

1. Promote existing collaboration `atMs` baseline to studio timeline/waveform marker behavior.

Allowed paths:

1. `/Users/evgenij/russian-raspev/app/api/studio/**`
2. `/Users/evgenij/russian-raspev/app/lib/studio/**`
3. `/Users/evgenij/russian-raspev/app/components/**` (timeline marker rendering only)
4. `/Users/evgenij/russian-raspev/app/community/rooms/[roomId]/page.tsx` (if shared marker utilities are reused)
5. `/Users/evgenij/russian-raspev/app/components/community/CollabRoomFeedbackTimelineClient.tsx` (if shared marker utilities are reused)
6. `/Users/evgenij/russian-raspev/tests/e2e/**` (timed-comment marker and seek assertions)

DoD:

1. Timed comment marker is visible at deterministic timeline position.
2. Marker interaction seeks playback context to exact target time.
3. Marker preview contract (author/body/time) is stable in UI.

Validation:

1. `npx playwright test tests/e2e/community-collab-feedback-api.spec.ts tests/e2e/community-collab-feedback-seek-ui.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
2. studio-timeline timed-comment e2e checks (if added in same packet) pass under same config.

## P2-1: Realtime collaboration + advanced feedback control-plane

Scope:

1. Add realtime collaboration transport for studio sessions and advanced feedback lifecycle.

Allowed paths:

1. `/Users/evgenij/russian-raspev/app/api/studio/**`
2. `/Users/evgenij/russian-raspev/app/lib/studio/**`
3. `/Users/evgenij/russian-raspev/app/components/**` (collaboration state surfaces only)
4. `/Users/evgenij/russian-raspev/tests/e2e/**` (collaboration and feedback lifecycle assertions)

DoD:

1. Presence/session events are deterministic under multi-user simulation.
2. Timed comments support advanced states (thread/reply/resolve) without breaking baseline marker-seek behavior.

Validation:

1. targeted collaboration e2e pack for session + feedback lifecycle.

## P2-2: Optional chord/arpeggio parity extension

Scope:

1. Add advanced chord and arpeggio tools only after `P0/P1` gates are green.

Allowed paths:

1. `/Users/evgenij/russian-raspev/app/components/**`
2. `/Users/evgenij/russian-raspev/tests/e2e/**` (only parity/regression coverage additions)

DoD:

1. Chord/arpeggio feature can be enabled without changing core transport/recording behavior.
2. No regressions in recording-v2 reliability and multitrack motion/sync suites.

Validation:

1. `npx playwright test tests/e2e/recording-v2-reliability.spec.ts tests/e2e/multitrack-motion.spec.ts tests/e2e/guest-sync.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`

## Orchestrator handoff checklist

1. Read:
   1. `/Users/evgenij/russian-raspev/WORK_BRIEF.md` section `311`.
   2. `/Users/evgenij/russian-raspev/docs/studio-bandlab-step-model-2026-02-25.md`.
2. Execute packets strictly in order.
3. Stop and report if any packet breaches allowlist or breaks P0 gates.
4. Do not start `P1-1` before `P0-1..P0-3` are green.
5. Do not start `P2-1` before `P1-1..P1-4` are green.
6. For any packet touching player behavior, include baseline alignment note:
   1. SoundCloud transport semantics parity status,
   2. VK continuity telemetry parity status.
7. For any packet touching timed comments, include baseline alignment note:
   1. `atMs` marker parity status,
   2. click-marker-to-seek parity status.
