# DevTools Streams Index

Updated: 2026-03-03

## Consolidated registry

1. Human-readable registry:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/ARTIFACT_REGISTRY.md`
2. Machine-readable manifest:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/MANIFEST_2026-02-22.json`
3. Current totals:
   1. streams: `7`
   2. artifact files: `47`
   3. bytes: `5,546,880`

## Active streams

1. VK mini-player music:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/README.md`
   2. Status: baseline + refresh extraction (`authenticated HAR + trace metrics + marker counters`)
   3. Targeted guest/headless collapse probe added:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/vk-collapse-expand-targeted.json`
      2. result: no `FCThumb` controls on guest `vk.com`; `vkvideo.ru` probe failed with `ERR_CONNECTION_RESET`
   4. User trace-based collapse probe added:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/vk-collapse-expand-trace-20260222T084313-sanitized.json`
      2. result: `FCThumb__link`/`FCThumb__close` + collapsed state observed
   5. HAR sequence probe added:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/vk-collapse-expand-har-vk-com-01-sanitized.json`
      2. result: repeated `play/pause` + `show/hide/toggle` transition markers and stop-reason telemetry confirmed for manual run
      3. generation path is automated in:
         1. `/Users/evgenij/russian-raspev/scripts/devtools-miniplayer-refresh.mjs`
         2. artifact pattern: `vk-collapse-expand-har-<har-token>-sanitized.json`
   6. Current closure state:
      1. event-side collapse/expand transitions: inferred,
      2. full visual DOM transition graph: still partial.
2. VK video player:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-video-player/README.md`
   2. Status: baseline filled from sanitized artifacts (`guest landing flow`)
3. VK articles parity:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-articles-parity/README.md`
   2. Status: baseline captured (`Porushka mobile+desktop packs + HAR + parity jsons`)
4. RR mini-player packet-loss:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-rr-miniplayer-packet-loss/README.md`
   2. Status: capture closed (`offline failures + screenshot + analytics reconnect sequence transport_stalled/retry/recovered`)
5. RR mini-player collapse/expand:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-rr-miniplayer-collapse-expand/README.md`
   2. Status: capture recorded (`collapsed/expanded screenshots + panel actions telemetry`)
6. RR mini-player route-switch degraded:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-rr-miniplayer-route-switch-degraded/README.md`
   2. Status: capture recorded (`/sound -> /video -> /sound` under offline window + continuity analytics)
7. VK DevTools sanitation queue:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/README.md`
   2. Status: refresh pass completed (`2 HAR + 3 Trace` re-sanitized from Downloads into intake package)
   3. Refresh manifest:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/intake-manifest-refresh-20260222t165641.json`
   4. Refresh artifacts:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/artifacts/refresh-20260222t165641-vk.com-summary-sanitized.json`
      2. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/artifacts/refresh-20260222t165641-vk.com.01-summary-sanitized.json`
      3. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/artifacts/refresh-20260222t165641-trace-20260222t011025-markers-sanitized.json`
      4. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/artifacts/refresh-20260222t165641-trace-20260222t011453-markers-sanitized.json`
      5. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/artifacts/refresh-20260222t165641-trace-20260222t084313-markers-sanitized.json`
8. Player comparison (BandLab / SoundCloud / VK):
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/README.md`
   2. Status: comparative packet recorded (`player control reliability + stream network evidence + cross-platform table + timed-comments behavior note`)
   3. Core table:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/player-comparison-bandlab-soundcloud-vk-2026-03-03.md`

## Process docs

1. Hub:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/README.md`
2. Intake template:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/INTAKE_TEMPLATE.md`

## Append Log (2026-02-22)

1. Added sanitation queue stream:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/README.md`
2. Queue scope:
   1. intake + sanitation for two HAR and three trace files from Downloads.
3. Output class:
   1. sanitized JSON artifacts,
   2. machine manifest,
   3. network/events/dom summaries.
4. Refresh pass added:
   1. `2 HAR + 3 Trace` from Downloads re-processed into sanitized refresh artifacts.
   2. no raw tokens/cookies/private payload values published.
   3. refresh package anchored by:
      1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-devtools-sanitation-queue/intake-manifest-refresh-20260222t165641.json`
EVIDENCE: micro-docs-s25-seed-mm5ld503-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T02-40-33-397Z
EVIDENCE: micro-docs-s25-seed-mm5ldesl-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T05-32-12-799Z
EVIDENCE: micro-docs-s25-seed-mm5ldwnn-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T08-24-47-303Z
EVIDENCE: micro-docs-s25-seed-mm5lellz-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T09-32-54-087Z
EVIDENCE: micro-docs-s25-seed-mm5lfw48-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T11-12-30-534Z
EVIDENCE: micro-docs-s25-seed-mm5lgb99-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T12-48-12-234Z
EVIDENCE: micro-docs-s25-seed-mm5mcewb-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T15-02-32-040Z
EVIDENCE: micro-docs-s25-seed-mm5mge3k-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T16-13-07-934Z
EVIDENCE: micro-docs-s25-seed-mm5mgwrz-9 | PASS: one-file docs update with bounded scope | FAIL: no new files or refactor introduced | WINDOW: p0-window-2026-02-28T17-55-02-283Z
EVIDENCE: micro-research-auto-mm7lqbbs-01 | CHECK: PASS (test -e docs/research/devtools/INDEX.md) | INSIGHT: bounded research delta captured in-file | IMPLICATION: next packet can build on this baseline without rework.
