# Player Comparison: BandLab / SoundCloud / VK

Updated: 2026-03-03

## Scope

1. Compare web-player behavior across three platforms using captured probe artifacts.
2. Keep Studio/DAW logic out of scope for this packet (player layer only).
3. Include behavior-level benchmark for timed comments anchored to track time (SoundCloud model).

## Files

1. Comparison table:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/player-comparison-bandlab-soundcloud-vk-2026-03-03.md`
2. BandLab artifacts:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/bandlab/20260303-002841/report.json`
   2. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/bandlab/20260303-002841/SUMMARY.md`
   3. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/bandlab/20260303-002841/bandlab-player-probe-20260303-002847.har`
3. SoundCloud artifacts:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/soundcloud/20260303-004038/report.json`
   2. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/soundcloud/20260303-004038/SUMMARY.md`
   3. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-03-03-player-comparison/artifacts/soundcloud/20260303-004038/soundcloud-player-probe-20260303-004038.har`
4. VK baseline source artifacts:
   1. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/vk-collapse-expand-closure-check-sanitized.json`
   2. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/miniplayer-har-refresh-sanitized.json`
   3. `/Users/evgenij/russian-raspev/docs/research/devtools/2026-02-22-vk-miniplayer-music/artifacts/miniplayer-network-snapshot-sanitized.json`

## Key note

1. SoundCloud probe reached full transport success in this run (`play/seek/volume/next/prev/pause` all true).
2. BandLab probe confirms audio streaming and seek/play/pause in web-player context, but transport parity is partial in this run.
3. VK metrics are from a prior sanitized capture package and confirm continuity + proven playback in the mini-player flow.

## Timed comments benchmark note

1. SoundCloud behavior baseline (manual guided run):
   1. comment markers are anchored to track timeline positions (`atMs`-like semantics),
   2. hover on marker reveals comment preview (author/text/time),
   3. marker interaction is tied to playback context at that timestamp.
2. Evidence level:
   1. behavior-level observation is `proven` from guided interactive session,
   2. authenticated network/DOM export for comment markers is not attached in this packet due entry/auth constraints.
3. Product implication:
   1. keep timed comments in `P1` as core collaboration feature for waveform/timeline UX, not as late optional `P2`.
