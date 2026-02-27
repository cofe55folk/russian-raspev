# P0 Deblock Plan (1 day)

Generated: 2026-02-24 22:10 UTC

## Current snapshot

- P0/P1 monitor: `verdict=at_risk`.
- P0: `open=8`, `inProgress=1`, `blocked=2`, completion `54.2%`.
- Triad: `EXECUTE`, run `triad-auto-s17-20260224t215055`, section `17`, `has_first_packet=false`.
- Prompt queue: `queued=0`, `claimed=0`, `done=141`, `blocked=39`.
- Workers: alive, but idle (`workers_idle=true`, reason: `workers_idle:queue_empty`).
- Factory latest report: `createdCount=0`, skips by `active_in_triad_control_plane` and `terminal_duplicate`.

Source files:
- `/Users/evgenij/russian-raspev/tmp/p0p1-monitor.json`
- `/Users/evgenij/russian-raspev/tmp/orchestration-health.json`
- `/Users/evgenij/russian-raspev/tmp/team-autonomous/signal.json`
- `/Users/evgenij/russian-raspev/tmp/prompt-queue/reports/factory-1771970983745.json`

## Root cause (now)

1. Bottleneck is upstream flow, not worker capacity.
2. Factory creates no new packets (`createdCount=0`) due to dedup + active triad conflict.
3. Triad stays in `EXECUTE` with low intent throughput (`process-intents` often `0`).
4. As a result, workers are healthy but starved (idle).

## Day plan (8 hours)

### Hour 0-1: enforce P0-first and unblock signal loop

Commands:

```bash
npm run brief:important
npm run brief:next
npm run ops:p0p1:status:strict || true
npm run ops:orchestration:health
npm run triad:status
```

Decision gate:
- If `P0 blocked > 0`, keep strict P0-first (`maxPriority=0`) for 24h.

### Hour 1-3: remove queue starvation by controlled packet refill

Goal:
- Keep at least `queued>=1` while P0 is active.

Commands:

```bash
npm run prompt:factory:safe -- --max=5
npm run prompt:dashboard
npm run prompt:claim:solo:switch -- --wait=false
npm run prompt:claim:second:switch -- --wait=false
```

If factory still outputs `createdCount=0`:
- Regenerate candidates and force fresh shortlist:

```bash
npm run brief:next
npm run backlog:night
npm run prompt:factory:safe -- --max=5
```

### Hour 3-5: triad EXECUTE anti-stall cycle

Goal:
- Avoid long EXECUTE loops with zero intent processing.

Commands:

```bash
npm run triad:ctl -- guardrails --night --allow-requeue=true --requeue-cooldown-min=15 --max-attempts-per-section-night=12 --bootstrap-sla-min=1 --execute-starter-sla-min=1 --queue-starvation-min=20 --cold-start-alert-min=20 --execute-no-delta-min=6 --source=manual-day-recovery --bypass-attempt-cap-p0=true
npm run triad:process-intents -- --max=200
npm run triad:status
```

Decision gate:
- If `has_first_packet=false` and phase age grows, force reframe in skeptic before continuing EXECUTE.

### Hour 5-8: stabilize throughput + close blocked P0s

Focus:
- Close 2 blocked P0 sections first (current main risk driver).

Cadence every 30-45 min:

```bash
npm run ops:p0p1:status
npm run ops:orchestration:health
npm run prompt:dashboard
npm run ops:night:signal:json
```

Stop condition for day:
- `P0 blocked=0`
- `queued+claimed >= 1` in at least 2 consecutive checks
- `workers_idle=false` at least once during cycle

## Fast acceleration options

### Option A (recommended for this week): strict P0-first + anti-idle loop

- Keep triad on P0 only.
- Keep worker-second in `solo-only` assist mode.
- Run `ops:night:front` continuously for autonomous healing.

Pros: fastest risk reduction, minimum context switching.
Cons: less progress on P1/P2.

### Option B: add one more worker now

Use only if queue starvation is solved first (`createdCount>0` consistently).

Pros: scales parallel-safe work.
Cons: useless while queue remains empty; adds coordination overhead.

### Option C: temporary dedup relaxation (surgical)

Adjust prompt factory dedup policy only for non-conflicting docs/stabilization packets.

Pros: quickly increases packet issuance.
Cons: duplicate/low-value packet risk if not bounded by lane/scope.

## KPI target by end of day

- `P0 blocked`: `2 -> 0`
- `prompt queue queued`: `0 -> >=1`
- `processIntentsProcessed`: non-zero in at least 3 cycles
- `workers idle cycles`: reduce by 50% vs first 40-cycle sample

## Next code-level modernization (if metrics still stuck tomorrow)

1. In `scripts/prompt-queue-generate.mjs`: soft-dedup mode for docs-only stabilization packets.
2. In `scripts/team-autonomous-supervisor.mjs`: auto-remedy trigger on repeated `queue_empty + zeroIntent` streak for EXECUTE.
3. In `scripts/prompt-queue-claim.mjs`: fallback maintenance bypass when triad is active but queue starvation persists > N cycles.
