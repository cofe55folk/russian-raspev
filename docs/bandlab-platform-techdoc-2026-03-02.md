# BandLab Platform Techdoc (Studio + Fork)

Date: 2026-03-02  
Prepared for: russian-raspev studio roadmap  
Scope: all collected BandLab data with priority focus on Studio and Fork flows.

## 1) Executive Summary

1. Data collection over BandLab is sufficient to lock product decisions for the first implementation cycle.
2. Studio mechanics are confirmed at UI, behavior, and API-signal levels: transport, loop, zoom, timeline edits, automation curve, mastering presets/intensity, device switching, MIDI input baseline, hotkeys, and invite/collab surfaces.
3. Fork flow is confirmed end-to-end: feed/player -> fork modal -> save/open-in-studio -> revision in studio.
4. Critical risk is reproduced multiple times: heavy multi-track auto-mastering plus navigation "Back" can freeze UI/session (VPN worsens symptoms).
5. In this repo, core multitrack/recording reliability foundation is already strong; Studio backend model (projects/revisions/clips), storage abstraction, and full fork/collab control-plane are still missing.
6. Product focus update: advanced chord/arpeggio parity is intentionally deprioritized and moved to non-blocking P2 scope.
7. Cross-platform player benchmark decision (2026-03-03):
   1. use SoundCloud as transport-control baseline,
   2. use VK mini-player as continuity/telemetry baseline,
   3. keep BandLab as DAW/studio workflow baseline.
8. Timed comments benchmark decision (2026-03-03):
   1. use SoundCloud timed-comment UX as reference for marker-on-timeline behavior (`atMs` anchored marker + contextual preview + seek binding),
   2. treat timed comments as `P1` collaboration core, not optional `P2`.

## 2) Evidence Base (What Was Analyzed)

### 2.1 Crawls and captures

1. Deepcrawl state summary:
   1. `/Users/evgenij/russian-raspev/tmp/bandlab-deepcrawl/AUTONOMOUS_SUMMARY.md`
   2. updatedAt: `2026-03-02T15:15:01.975Z`
   3. runsTracked: `7`
   4. uniqueUrls: `125`
   5. uniqueApiPaths: `220`
   6. uniqueHosts: `10`
2. Key deepcrawl runs:
   1. `/Users/evgenij/russian-raspev/tmp/bandlab-deepcrawl/20260302-151216/SUMMARY.md`
      1. actions `871/871`, visitedUrls `50`, newApiPaths `56`
   2. `/Users/evgenij/russian-raspev/tmp/bandlab-deepcrawl/20260302-160105/SUMMARY.md`
      1. actions `543/543`, snapshots `244`, studio-heavy traversal
   3. `/Users/evgenij/russian-raspev/tmp/bandlab-deepcrawl/20260302-180542/SUMMARY.md`
      1. actions `104/104`, visitedUrls `27`, newApiPaths `16`
3. Autopilot studio run:
   1. `/Users/evgenij/russian-raspev/tmp/bandlab-autopilot/20260302-181556/SUMMARY.md`
   2. actions `44/44`, snapshots `44`, consoleErrors `8`
4. Manual long session:
   1. `/Users/evgenij/russian-raspev/tmp/bandlab-manual-session/20260302-185532/SUMMARY.md`
   2. snapshots `121`, visitedUrls `5`, networkRows `1199`
5. Manual partial sessions (interrupted/crash-like exits):
   1. `20260302-171357`, `20260302-182450`, `20260302-194016`, `20260302-202536`, `20260302-203706`
6. Aggregated run completeness snapshot (filesystem audit at 2026-03-02):
   1. autopilot: `29` complete, `4` partial
   2. deepcrawl: `9` complete, `6` partial
   3. manual-session: `1` complete, `6` partial

### 2.2 Voice transcripts (manual test narration)

1. `/Users/evgenij/russian-raspev/tmp/transcripts/novaya-zapis-41.txt`
2. `/Users/evgenij/russian-raspev/tmp/transcripts/novaya-zapis-44.txt`
3. `/Users/evgenij/russian-raspev/tmp/transcripts/novaya-zapis-45.txt`
4. `/Users/evgenij/russian-raspev/tmp/transcripts/novaya-zapis-46.txt`
5. `/Users/evgenij/russian-raspev/tmp/transcripts/novaya-zapis-47.txt`
6. `/Users/evgenij/russian-raspev/tmp/transcripts/novaya-zapis-48.txt`

### 2.3 Data quality and limitations

1. Complete runs exist for all three capture modes (deepcrawl/autopilot/manual).
2. Some manual sessions are partial due UI freeze or app instability; this is itself useful evidence for failure scenarios.
3. Manual-capture script was hardened to reduce artifact loss on screenshot timeout:
   1. `/Users/evgenij/russian-raspev/scripts/devtools-bandlab-manual-session.mjs`
   2. adds `snapshotErrors` persistence and safer shutdown path.

### 2.4 Cross-platform player benchmark (2026-03-03)

1. Canonical comparison packet:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/player-comparison-bandlab-soundcloud-vk-2026-03-03.md`
2. Source artifacts:
   1. BandLab probe:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/bandlab/20260303-002841/report.json`
   2. SoundCloud probe:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/soundcloud/20260303-004038/report.json`
   3. VK mini-player baseline:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/vk-collapse-expand-closure-check-sanitized.json`
3. Decision for implementation baseline:
   1. Transport controls (play/seek/volume/next/prev/pause): model on SoundCloud behavior because probe coverage is complete in this run.
   2. Playback continuity + telemetry cadence: model on VK mini-player because continuity and heartbeat patterns are proven in sanitized evidence.
   3. Studio/DAW interaction layer (timeline, tracks, automation, fork workflow): model on BandLab evidence.

## 3) BandLab Platform Architecture (Observed)

### 3.1 Surface map

1. Public/product surfaces observed:
   1. feed and profiles,
   2. track/song/post pages,
   3. community/feedback exchange,
   4. library and projects,
   5. studio entry from multiple entry points.
2. Host set from state:
   1. `www.bandlab.com`, `bandlab.com`, `static.bandlab.com`, `storage.bandlab.com`,
   2. `help.bandlab.com`, `blog.bandlab.com`,
   3. `amplitude.bandlab.com`, `amplitude-experiment.bandlab.com`,
   4. `apk.bandlab.com`, `strapi.bandlab.com`.

### 3.2 Studio frontend composition signals

From autopilot/deepcrawl network and partial templates:

1. Mix editor partials detected:
   1. `_mix-editor-grid`,
   2. `_mix-editor-automation`,
   3. `_mix-editor-ruler`,
   4. `_mix-editor-region`,
   5. `_mix-editor-track-header`,
   6. `_mix-editor-toolbar`,
   7. `_mix-editor-sidetabs`.
2. Input/editor partials detected:
   1. `_virtual-piano`,
   2. `_drum-machine`,
   3. `_midi-editor-grid`,
   4. `_audio-input`.
3. This strongly indicates modular studio UI with separate timeline/automation/track-header/editor subsystems.

## 4) Studio Mechanics: Confirmed Behavior

### 4.1 Transport and timeline

1. Play/stop/pause and return-to-start behavior confirmed.
2. Loop (cycle) region creation and playback confirmed.
3. Timeline zoom in/out and hotkeys (`+`, `-`, reset `0`) confirmed.
4. Ruler click/seek confirmed.
5. Snap/grid and time-stretch toggles detected in UI and actions.
6. Noted behavior nuance (from transcript `45`):
   1. multiple "return positions" depending on playback context (current fragment/loop/global start).

### 4.2 Track controls and mix interaction

1. Per-track controls confirmed:
   1. mute,
   2. solo,
   3. volume fader,
   4. pan.
2. Track order changes and drag behavior confirmed.
3. Region-level interactions confirmed:
   1. moving regions on timeline,
   2. loop-extension handle on region tail,
   3. right-click context menu (split/copy/export/stretch/pitch/speed utilities).

### 4.3 Automation curve and fades

1. Automation lane editing was successfully exercised in deepcrawl:
   1. automation points increase observed (`before`/`after` deltas in action detail),
   2. automation path count growth observed.
2. Manual observations confirm point-based volume shaping per region/track.
3. Region fade-in handle at clip edge confirmed by user narration (`novaya-zapis-45`).

### 4.4 Mastering, EQ, and effects

1. Mastering preset cluster confirmed:
   1. Universal,
   2. Fire,
   3. Clarity,
   4. Tape,
   5. Natural,
   6. Space,
   7. Cinematic,
   8. Character.
2. Preset intensity control confirmed (light/normal/heavy-like behavior).
3. Effects chain panel and preset browsing confirmed.
4. Additional effect primitives observed (compressor/noise gate/EQ blocks).

### 4.5 Input devices and MIDI/piano/chord

1. Microphone input source switching confirmed live, without full reload.
2. Monitoring behavior and perceived latency effects confirmed.
3. MIDI device presence and mapping confirmed; some sessions required manual source selection.
4. Virtual piano interaction confirmed:
   1. mouse note triggers,
   2. keyboard mapping,
   3. chord mode and chord complexity mode interactions.
5. MIDI API availability signal seen in probes.
6. Priority decision for our roadmap:
   1. keep MIDI/device baseline in core scope,
   2. keep chord/arpeggio depth as deferred P2 parity.

### 4.6 Hotkeys

Detected hotkey families include:

1. transport (`Space`, `Shift+Space`, `R`, `Enter`),
2. cycle (`C`),
3. automation (`A`, `Shift+A`),
4. mute/solo (`Shift+M`, `Shift+S`),
5. add/duplicate track (`Shift+T`, `Shift+D`),
6. zoom (`Cmd/Ctrl +/-`, `Cmd/Ctrl+0`),
7. metronome (`M`),
8. grid snap (`G`),
9. sounds browser (`L`).

## 5) Fork and Collaboration Flows

### 5.1 Fork path (confirmed)

1. Feed/player fork CTA opens fork modal.
2. Fork modal supports at least:
   1. save for later,
   2. open in studio.
3. Opening in studio leads to editable revision context in Studio.
4. Network signals (manual + deepcrawl):
   1. `POST /api/v1.3/songs/forks`,
   2. `GET /api/v1.3/revisions/{id}`,
   3. `POST /api/v1.3/revisions` (observed in manual run).

### 5.2 Collaboration surfaces (confirmed)

1. Invite and collaborator endpoints appear repeatedly:
   1. `GET /api/v1.3/songs/{id}/collaborators`,
   2. `GET /api/v1.3/songs/{id}/invite-link`,
   3. `GET /api/v1.3/songs/{id}/invites`.
2. "Invite" UI action is available in studio toolbar.
3. Publication settings mention fork permission semantics (from transcript `48`):
   1. enabling/disabling fork for public revisions,
   2. warning that disabling does not affect existing forks.

### 5.3 Timed comments anchored to playback (benchmark note)

1. SoundCloud model (guided manual benchmark):
   1. comment markers are tied to timeline positions (timestamp/`atMs` semantics),
   2. hover/focus reveals contextual comment preview,
   3. marker click is coupled with playback context at the same timestamp.
2. Evidence confidence:
   1. behavior-level confidence is high from guided session walkthrough,
   2. authenticated low-level network/DOM dump for marker operations is not attached in this packet due auth/session limitations.
3. Implementation implication for this repo:
   1. keep timed comments in `P1` as collaboration core over waveform/timeline,
   2. separate `P1` baseline (marker + seek + list sync) from `P2` enrichments (threads/reactions/moderation automation).

## 6) Stability Findings (Critical)

### 6.1 Reproduced failure pattern

1. Scenario:
   1. heavy project (6+ loud tracks),
   2. auto mastering/equalization processing,
   3. user presses Back/navigates away during long processing.
2. Result:
   1. UI freeze/hang,
   2. session instability or exit.
3. Evidence sources:
   1. `novaya-zapis-46.txt`,
   2. `novaya-zapis-47.txt`,
   3. user incident notes during manual runs.

### 6.2 Contributing factors

1. VPN/high latency likely amplifies duration and perceived hangs.
2. Missing explicit cancel/abort semantics in long mastering operation is a UX and reliability risk.
3. Weak progress feedback (stalled-looking progress bar) increases forced navigation risk.

## 7) Mapping to This Repo: What Is Implemented vs Not

### 7.0 Functional comparison matrix (BandLab vs current repo)

| Capability | BandLab | Current repo | Status |
|---|---|---|---|
| Multitrack transport + loop + zoom + mute/solo/pan | yes | yes | implemented |
| Guest recording + sync calibration | yes | yes | implemented |
| Chunked recording reliability (resume/idempotency/finalize) | yes | yes | implemented |
| Fork to studio lineage model | yes | partial | partial |
| MIDI baseline (device detect/input) | yes | yes | implemented |
| Chord/arpeggio depth | yes | limited | deferred P2 |
| Advanced mastering parity | yes | limited | partial/deferred |
| Timed comments on waveform (`atMs`) | yes (SoundCloud benchmark) | partial | partial |
| Studio project/revision/clip backend | yes | no | missing |
| Storage abstraction local+object backend | yes | no | missing |
| Realtime collaboration control-plane | yes | no | missing |

### 7.1 Already implemented (high confidence)

1. Multitrack runtime with loop/mute/solo/pan/master/tempo/pitch/transport:
   1. `/Users/evgenij/russian-raspev/app/components/MultiTrackPlayer.tsx`
2. Guest sync calibration, drift correction, sync telemetry:
   1. `/Users/evgenij/russian-raspev/app/components/MultiTrackPlayer.tsx`
   2. `/Users/evgenij/russian-raspev/app/api/analytics/guest-sync/route.ts`
   3. `/Users/evgenij/russian-raspev/app/lib/analytics/guest-sync-summary.ts`
3. Recording-v2 ingest with checksum/idempotency + finalize integrity guards:
   1. `/Users/evgenij/russian-raspev/app/api/ugc/recording-v2/takes/[takeId]/chunks/route.ts`
   2. `/Users/evgenij/russian-raspev/app/api/ugc/recording-v2/takes/[takeId]/finalize/route.ts`
   3. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-file.ts`
4. OPFS writer and upload queue client:
   1. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-opfs-client.ts`
   2. `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-upload-client.ts`
5. UGC creator-track model with stems and alignment recompute:
   1. `/Users/evgenij/russian-raspev/app/api/ugc/tracks/route.ts`
   2. `/Users/evgenij/russian-raspev/app/api/ugc/tracks/[trackId]/stems/route.ts`
   3. `/Users/evgenij/russian-raspev/app/api/ugc/tracks/[trackId]/stems/[stemId]/recompute-align/route.ts`
   4. `/Users/evgenij/russian-raspev/app/lib/ugc/tracks-store-file.ts`
   5. `/Users/evgenij/russian-raspev/app/lib/ugc/tracks-store-prisma.ts`

### 7.2 Partially implemented

1. BandLab-like "fork outcome" is partially covered by existing UGC track and publishing concepts, but no direct social fork graph.
2. MIDI keyboard UX exists in our player (virtual piano + key mapping), but no full DAW-like chord mode parity.
3. Effects/mastering parity is partial:
   1. we have multitrack controls and export pipeline,
   2. no full preset catalog and cloud mastering workflow equivalent.
4. Timed comments are partial:
   1. community room `atMs` flow exists (API + UI seek context),
   2. studio timeline/waveform marker integration is not yet implemented as unified studio feature.

### 7.3 Not implemented (clear gaps)

1. Studio backend model and API contract are absent:
   1. missing `/Users/evgenij/russian-raspev/app/api/studio/**`
   2. missing `/Users/evgenij/russian-raspev/app/lib/studio/**`
2. Recording Prisma source-of-truth layer planned in packets is absent as named:
   1. missing `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store.ts`
   2. missing `/Users/evgenij/russian-raspev/app/lib/ugc/recording-v2-store-prisma.ts`
3. Storage adapter abstraction planned in packets is absent:
   1. missing `/Users/evgenij/russian-raspev/app/lib/media/storage.ts`
   2. missing `/Users/evgenij/russian-raspev/app/lib/media/storage-local.ts`
   3. missing `/Users/evgenij/russian-raspev/app/lib/media/storage-s3.ts`
4. No dedicated fork/collab control-plane equivalent to BandLab invites/fork graph model.

## 8) Core vs Stub Decision (Recommended)

### 8.1 Core (implement in current cycle)

1. Stable multitrack transport and timeline controls.
2. Track-level mix controls: volume/pan/mute/solo.
3. Loop region and zoom behavior.
4. Reliable recording-v2 ingest/finalize with resume/idempotency.
5. Device switching baseline: microphone + MIDI detection and manual selection.
6. UGC track creation/stems/publish baseline and alignment recompute.
7. Minimal fork entry flow in product UX:
   1. "create derived project from source track" contract,
   2. revision lineage field.
8. Crash-safe handling for heavy processing:
   1. cancellable long ops,
   2. navigation guard,
   3. resumable job state.
9. Player control baseline contract:
   1. adopt SoundCloud-like transport semantics for control mapping and fallback behavior,
   2. adopt VK-like continuity telemetry contract (`playback proven`, heartbeat-like cadence, route continuity checks).
10. Timed comments collaboration baseline:
   1. implement marker-on-waveform/timeline comments with deterministic `atMs` seek behavior,
   2. align interaction model with SoundCloud benchmark (marker visibility + contextual preview + direct seek).

### 8.2 Stub (add interfaces now, full behavior later)

1. Full mastering preset engine parity (BandLab-like cloud DSP behavior).
2. Full automation-lane editing model parity.
3. Rich chord/arpeggio mode system parity (explicitly deferred; non-blocking).
4. Realtime collab presence + lock ownership + project event stream.
5. Full social fork graph and invite orchestration backend.
6. Advanced effect marketplace/preset sharing.
7. Advanced timed-comment enrichment (threads/replies/resolution workflows, moderation automation, marker-density summaries).

## 9) P0 / P1 / P2 Work Breakdown and Current Readiness

### 9.1 P0 (ship-capable foundation)

1. Studio runtime stability and controls:
   1. status: `ready/mostly implemented`
2. Recording reliability and fallback:
   1. status: `implemented and test-covered`
   2. evidence:
      1. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-reliability.spec.ts`
      2. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-fallback-ui.spec.ts`
      3. `/Users/evgenij/russian-raspev/tests/e2e/recording-v2-latency-envelope.spec.ts`
3. Immediate gap to close in P0:
   1. heavy-processing cancel/back safety and freeze prevention.
   2. lock transport + continuity contract against the 2026-03-03 comparison baseline.

### 9.2 P1 (backend hardening and product contracts)

1. Prisma recording source-of-truth adapter:
   1. status: `not implemented`
2. Storage abstraction local + S3-compatible:
   1. status: `not implemented`
3. Studio project/revision baseline:
   1. status: `not implemented`
4. Timed comments for studio timeline:
   1. status: `partial` (`community room baseline implemented`, `studio-level marker integration pending`)

### 9.3 P2 (advanced parity)

1. Realtime collaboration control-plane:
   1. status: `not implemented`
2. Deep DAW parity:
   1. advanced automation UX,
   2. richer mastering/effects semantics,
   3. mature fork/collab social model.
3. Advanced timed-comment lifecycle:
   1. threaded workflows and moderation tooling over timeline comments.

## 10) Recommended Next Implementation Sequence

1. Freeze P0 scope as `core` list above and lock acceptance tests.
2. Freeze player contract baseline from cross-platform packet (`SoundCloud transport + VK continuity`) before new transport rewrites.
3. Add crash-safe async processing model first (before new heavy DSP work).
4. Implement P1 storage + recording store adapter behind feature switches.
5. Implement minimal studio project/revision API contract.
6. Implement P1 timed comments over waveform/timeline (marker + seek + context preview) using existing `atMs` collaboration baseline.
7. Add fork lineage contract in our backend model, then UI entry points.
8. Move advanced DAW parity features and advanced comment enrichment to P2 stubs with explicit extension points.

## 11) Canonical Planning References in Repo

1. Program definition:
   1. `/Users/evgenij/russian-raspev/WORK_BRIEF.md` section `311` (`BandLab-like web studio implementation program`).
2. Packet plan:
   1. `/Users/evgenij/russian-raspev/docs/parallel-work-packets-2026-02-25-bandlab.md`
3. Step model:
   1. `/Users/evgenij/russian-raspev/docs/studio-bandlab-step-model-2026-02-25.md`
