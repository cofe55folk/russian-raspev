# QA Test Report

- Generated at: `2026-02-25 00:19:48 MSK`
- Workspace: `/Users/evgenij/russian-raspev`
- Base commit: `f0f8ec3`
- Report scope: smoke + critical quality gates

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | PASS |
| TypeScript | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS |
| Critical E2E | `npm run test:e2e:critical` | PASS (`11 passed`, `9 skipped`) |
| i18n audit | `npm run i18n:audit` | PASS |
| Fast quality gate | `npm run quality:gate:fast` | PASS |

## Key outputs

- `test:e2e:critical`: Playwright executed 20 tests, result `11 passed`, `9 skipped`, no failures.
- `i18n:audit`: ru keys `913`, en keys `913`, missing keys `0`, unknown keys `0`, unused keys `0`.
- `quality:gate:fast`: required step `typecheck` passed.

## Access

- Stable latest pointer: `reports/qa/LATEST.md`
- This run report: `reports/qa/2026-02-25-smoke-critical.md`

