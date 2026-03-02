# BandLab Studio Execution Backlog

Date: 2026-03-02
Scope: implementation execution plan after BandLab platform analysis.
Source baseline: `/Users/evgenij/russian-raspev/docs/bandlab-platform-techdoc-2026-03-02.md`

## 1) Program Objective

Deliver a production-safe BandLab-like Studio core with clear phase gates:

1. `P0`: harden current core, remove freeze-class failures, lock UX baseline.
2. `P1`: add missing backend contracts (recording store, storage adapter, studio model).
3. `P2`: implement advanced parity (automation UX, mastering depth, realtime collab).
4. Scope decision: chord/arpeggio depth is not a blocker for P0/P1 and stays deferred to late P2.

### Concept focus map

| Stream | Priority | Notes |
|---|---|---|
| Transport/recording/fork/revision reliability | core now | blocks product stability |
| Player control baseline (SoundCloud transport + VK continuity) | core now | locks control semantics and stability contract |
| Timed comments over timeline (`atMs`) | core in P1 | collaboration baseline for async review |
| Storage + backend studio contracts | core now | blocks cloud project model |
| Realtime collab control-plane | after core | P2 stream |
| Chord/arpeggio depth | deferred | optional parity, non-blocking |

## 2) Current State Snapshot

### Implemented and usable now

1. Multitrack runtime and guest sync:
   1. `/Users/evgenij/russian-raspev/app/components/MultiTrackPlayer.tsx`
2. Recording-v2 chunk/finalize reliability:
   1. `/Users/evgenij/russian-raspev/app/api/ugc/recording-v2/takes/[takeId]/chunks/route.ts`
   2. `/Users/evgenij/russian-raspev/app/api/ugc/recording-v2/takes/[takeId]/finalize/route.ts`
3. OPFS writer and upload client:
   1. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-opfs-client.ts`
   2. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-upload-client.ts`
4. UGC tracks/stems/alignment:
   1. `/Users/evgenij/russian-raspev/app/api/ugc/tracks/route.ts`
   2. `/Users/evgenij/russian-raspev/app/api/ugc/tracks/[trackId]/stems/route.ts`
   3. `/Users/evgenij/russian-raspev/app/api/ugc/tracks/[trackId]/stems/[stemId]/recompute-align/route.ts`

### Missing contracts for planned program

1. Missing recording store adapter entrypoints:
   1. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store.ts`
   2. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-prisma.ts`
2. Missing storage abstraction:
   1. `/Users/evgenij/russian-raspev/app/lib/media/storage.ts`
   2. `/Users/evgenij/russian-raspev/app/lib/media/storage-local.ts`
   3. `/Users/evgenij/russian-raspev/app/lib/media/storage-s3.ts`
3. Missing studio project/revision API layer:
   1. `/Users/evgenij/russian-raspev/app/api/studio/**`
   2. `/Users/evgenij/russian-raspev/app/lib/studio/**`

## 3) Phase Plan and Ticket Queue

## P0 - Core Stabilization and Safety

Goal: ship-safe Studio core on top of existing runtime.

### P0-00: Player baseline contract lock (cross-platform)

1. Status: `not started`
2. Priority: `critical`
3. Scope:
   1. lock transport semantics using SoundCloud evidence (`play/seek/volume/next/prev/pause` parity targets).
   2. lock continuity/telemetry semantics using VK evidence (`playback continuity`, heartbeat-like cadence, route continuity).
   3. keep DAW UX decisions aligned with BandLab studio evidence.
4. Deliverables:
   1. player control contract checklist with pass/fail probes.
   2. continuity telemetry checklist for runtime and analytics.
   3. cross-link to canonical packet:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/player-comparison-bandlab-soundcloud-vk-2026-03-03.md`
5. Validation:
   1. run probe scripts and confirm no regression vs baseline packet metrics.
6. Done criteria:
   1. transport controls and continuity checks are explicit acceptance criteria for P0 delivery.

### P0-01: Heavy processing safety and cancel model

1. Status: `not started`
2. Priority: `critical`
3. Problem:
   1. BandLab benchmark shows freeze risk on long mastering-like operations and navigation back.
4. Scope:
   1. Introduce cancellable async job controller for long audio processing flows.
   2. Add explicit UI states: `queued`, `running`, `cancel_requested`, `cancelled`, `completed`, `failed`.
   3. Add route-leave guard when long job is active.
5. Deliverables:
   1. processing state model in Studio-facing runtime layer.
   2. cancel action and graceful abort wiring.
   3. telemetry events for abort and completion timing.
6. Validation:
   1. add e2e scenario: start long process -> navigate -> cancel -> UI remains responsive.
   2. existing critical suite remains green.
7. Done criteria:
   1. no hard freeze in synthetic stress run.
   2. user receives deterministic result on back/cancel path.

### P0-02: Core interaction parity lock

1. Status: `not started`
2. Priority: `high`
3. Scope:
   1. lock behavior for transport, loop, zoom, mute/solo/pan, region drag, track volume.
   2. add regression assertions for keyboard shortcuts currently supported.
4. Deliverables:
   1. interaction contract doc and test matrix.
   2. e2e additions under `tests/e2e`.
5. Validation:
   1. `npx playwright test tests/e2e/multitrack-motion.spec.ts tests/e2e/guest-sync.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
6. Done criteria:
   1. deterministic baseline for all core controls.

### P0-03: Device onboarding hardening

1. Status: `not started`
2. Priority: `high`
3. Scope:
   1. improve microphone and MIDI source switching UX.
   2. enforce reconnect path without page reload where possible.
   3. expose clear error prompts for disconnected devices.
4. Deliverables:
   1. source-selection UI polish.
   2. reconnect handlers and fallback prompts.
5. Validation:
   1. add e2e smoke for source switching and re-selection.
6. Done criteria:
   1. no dead-end path after disconnect/reconnect in supported browser scenarios.

## P1 - Backend Contracts and Data Model

Goal: remove architectural gaps and enable durable studio workflows.

### P1-01: Recording-v2 store adapter abstraction

1. Status: `not started`
2. Priority: `critical`
3. Scope:
   1. implement:
      1. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store.ts`
      2. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-prisma.ts`
   2. keep compatibility with current file backend.
4. Deliverables:
   1. unified store interface.
   2. runtime switch via env.
5. Validation:
   1. recording-v2 reliability tests pass against file mode.
   2. targeted adapter tests for prisma mode.
6. Done criteria:
   1. feature parity on append/finalize/idempotency semantics.

### P1-02: Media storage abstraction (local + s3-compatible)

1. Status: `not started`
2. Priority: `critical`
3. Scope:
   1. implement:
      1. `/Users/evgenij/russian-raspev/app/lib/media/storage.ts`
      2. `/Users/evgenij/russian-raspev/app/lib/media/storage-local.ts`
      3. `/Users/evgenij/russian-raspev/app/lib/media/storage-s3.ts`
   2. move recording binary persistence through storage adapter boundary.
4. Deliverables:
   1. storage backend selector by env.
   2. signed URL/read stream policy for remote mode.
5. Validation:
   1. contract tests for put/get/delete and checksum match.
   2. ingest flow test with remote adapter mock.
6. Done criteria:
   1. no direct file writes outside storage adapter for recording payloads.

### P1-03: Studio project/revision baseline

1. Status: `not started`
2. Priority: `critical`
3. Scope:
   1. add minimal studio domain:
      1. project,
      2. revision,
      3. track lane,
      4. clip reference to uploaded assets/takes.
   2. implement API layer:
      1. `/Users/evgenij/russian-raspev/app/api/studio/**`
      2. `/Users/evgenij/russian-raspev/app/lib/studio/**`
4. Deliverables:
   1. create project,
   2. save revision,
   3. append clip to revision,
   4. fetch revision timeline snapshot.
5. Validation:
   1. API contract tests for create/save/read roundtrip.
6. Done criteria:
   1. revision graph persists and can reconstruct timeline.

### P1-04: Minimal fork lineage contract

1. Status: `not started`
2. Priority: `high`
3. Scope:
   1. introduce lineage fields:
      1. source track id,
      2. source revision id,
      3. fork depth.
   2. expose create-derived-project endpoint.
4. Deliverables:
   1. backend contract for fork creation.
   2. UI entrypoint in existing flow.
5. Validation:
   1. fork create -> open in studio -> lineage metadata present.
6. Done criteria:
   1. deterministic parent-child relation for derived projects.

### P1-05: Timed comments over waveform/timeline

1. Status: `not started` (`community atMs API/UI baseline already exists outside studio domain`)
2. Priority: `high`
3. Scope:
   1. add studio-level timed comment model linked to revision timeline (`atMs`, author, body, optional clip/track reference).
   2. expose create/list endpoints for timeline comments in studio flow.
   3. render marker layer on timeline/waveform with contextual preview and deterministic seek binding.
4. Deliverables:
   1. backend contract for timed comment CRUD baseline (create/list minimum in this phase).
   2. studio UI markers with comment preview and seek-on-marker interaction.
   3. telemetry for marker open/click/seek.
5. Validation:
   1. e2e scenario: create timed comment -> marker visible -> click marker -> playback context seeks to exact target.
   2. no regressions in existing collaboration feedback API/UI tests.
6. Done criteria:
   1. timed comments operate as first-class collaboration primitive in studio timeline.

## P2 - Advanced Parity and Scale Features

Goal: close high-level parity gaps after core architecture is safe.

### P2-01: Automation lane productization

1. Status: `stub`
2. Scope:
   1. editable automation lanes with point insertion/removal and curve interpolation.
   2. per-parameter lane selection.
3. Exit criteria:
   1. stable timeline redraw and undo/redo support.

### P2-02: Mastering and effects depth

1. Status: `stub`
2. Scope:
   1. advanced mastering presets and configurable intensity pipeline.
   2. asynchronous render jobs with resumable state.
3. Exit criteria:
   1. long-job UX remains responsive under stress.

### P2-03: Realtime collaboration control-plane

1. Status: `stub`
2. Scope:
   1. presence,
   2. transport ownership locks,
   3. project events stream,
   4. conflict resolution policy.
3. Exit criteria:
   1. deterministic merge/lock semantics in multi-user session.

### P2-04: Chord/arpeggio parity (deferred)

1. Status: `stub`
2. Scope:
   1. advanced chord mode behavior,
   2. arpeggio pattern tooling,
   3. harmony complexity controls.
3. Exit criteria:
   1. implementation does not regress core recording/transport flows,
   2. remains optional until all G0/G1 gates are closed.

### P2-05: Advanced timed-comment enrichment

1. Status: `stub`
2. Scope:
   1. comment threads/replies and resolution states,
   2. moderation hooks and anti-abuse controls for collaborative sessions,
   3. summary layers (density heatmap / unresolved markers filters).
3. Exit criteria:
   1. advanced comment UX does not regress P1 baseline marker-seek determinism.

## 4) Dependency Graph

1. `P0-00` before `P0-01` and `P0-02` (baseline contract first).
2. `P0-01` before any heavy DSP expansion.
3. `P1-01` before `P1-02`.
4. `P1-02` before full `P1-03` clip storage linkage.
5. `P1-03` before `P1-04`.
6. `P1-03` before `P1-05` (timeline comments need revision timeline contract).
7. `P1` completion before `P2` feature activation.

## 5) Release Gates

### Gate G0 (after P0)

1. No freeze on cancel/back in long process simulation.
2. Core interaction regressions absent.
3. Existing reliability and sync suites green.
4. Player baseline contract checks pass:
   1. transport control parity target,
   2. continuity telemetry target.

### Gate G1 (after P1)

1. Recording store adapter parity validated.
2. Storage adapter contract validated.
3. Studio project/revision create-save-read roundtrip validated.
4. Fork lineage created and queryable.
5. Timed comments gate:
   1. marker-visible + click-to-seek behavior passes deterministic e2e checks.

### Gate G2 (after P2 candidate)

1. Advanced features pass deterministic e2e and stress checks.
2. No regression against G0 and G1 criteria.

## 6) Required Validation Commands

1. `npx playwright test tests/e2e/recording-v2-reliability.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
2. `npx playwright test tests/e2e/recording-v2-fallback-ui.spec.ts tests/e2e/recording-v2-latency-envelope.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
3. `npx playwright test tests/e2e/multitrack-motion.spec.ts tests/e2e/guest-sync.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
4. `npx playwright test tests/e2e/community-collab-feedback-api.spec.ts tests/e2e/community-collab-feedback-seek-ui.spec.ts --config=playwright.webpack.config.ts --project=chromium --workers=1`
5. `npx tsc --noEmit`

## 7) Execution Mode

1. Run one ticket at a time inside each phase.
2. Do not start `P1-*` until all `P0-*` tickets meet Gate G0.
3. Do not start `P2-*` until Gate G1 is complete.
4. Each ticket closure report must include:
   1. RESULT,
   2. CHANGED_FILES,
   3. VALIDATION,
   4. RISKS,
   5. NEXT_TICKET.
