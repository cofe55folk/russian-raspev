# Triad Week-1 P0-First Mode

## Applied modernization

Updated:
- `/Users/evgenij/russian-raspev/scripts/triad-control-plane.mjs`

What changed:
1. `resume-next` now supports and defaults to `P0-first` policy.
2. Task filtering is auto-enabled when P0 risk is present:
   - source: `tmp/p0p1-monitor.json` (fallback: `tmp/WORK_BRIEF_IMPORTANT.json`),
   - rule: while `P0 blocked > threshold` or `P0 inProgress > cap`, triad only picks tasks with `priority <= maxPriority`.
3. Policy metadata is persisted into `control.autonomous.policy` and `resume_next` event details.

## New `resume-next` flags

1. `--p0-first-policy=true|false` (default `true`)
2. `--p0-first-blocked-threshold=<n>` (default `0`)
3. `--p0-first-in-progress-cap=<n>` (default `3`)
4. `--p0-first-max-priority=<n>` (default `1`)

## Week-1 operational profile (recommended)

1. Keep defaults:
   - `--p0-first-policy=true`
   - `--p0-first-blocked-threshold=0`
   - `--p0-first-in-progress-cap=3`
   - `--p0-first-max-priority=1`
2. For stricter mode (P0-only): set `--p0-first-max-priority=0`.

## Daily control commands

1. `npm run brief:important`
2. `npm run brief:next`
3. `npm run ops:p0p1:status:strict`
4. `npm run triad:status`

