import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_RUNS = 5;
const DEFAULT_MAX_FLAKE_RATE = 0.02;
const DEFAULT_REPORT_PATH = path.join(process.cwd(), 'tmp', 'e2e-flake-report.json');
const JSON_OUTPUT_DIR = path.join(process.cwd(), 'tmp', 'e2e-flake-json');

const CRITICAL_TESTS = [
  'tests/e2e/donate-checkout.spec.ts',
  'tests/e2e/billing-webhook.spec.ts',
  'tests/e2e/events-page.spec.ts',
  'tests/e2e/map-filters.spec.ts',
  'tests/e2e/search-page.spec.ts',
];

const INFRA_PATTERNS = [
  {
    signature: 'infra.webserver.start_failed',
    regex: /Process from config\.webServer was not able to start\./i,
  },
  {
    signature: 'infra.bind.eperm_or_eacces',
    regex: /listen E(?:PERM|ACCES)[^\n]*/i,
  },
  {
    signature: 'infra.bind.address_in_use',
    regex: /listen EADDRINUSE[^\n]*/i,
  },
  {
    signature: 'infra.connection.refused',
    regex: /ECONNREFUSED[^\n]*/i,
  },
  {
    signature: 'infra.connection.reset',
    regex: /ERR_CONNECTION_RESET[^\n]*/i,
  },
  {
    signature: 'infra.browser.crash_or_closed',
    regex: /(Target page, context or browser has been closed|SIGTRAP|browserType\.launch)/i,
  },
];

function readIntArg(flag, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${flag}=`));
  if (!arg) return fallback;
  const value = Number(arg.split('=')[1]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function readFloatArg(flag, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${flag}=`));
  if (!arg) return fallback;
  const value = Number(arg.split('=')[1]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function readStringArg(flag, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${flag}=`));
  if (!arg) return fallback;
  const value = arg.split('=').slice(1).join('=').trim();
  return value || fallback;
}

function isFailureStatus(status) {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

function collectFailedFromSpec(spec, parentTitle = '') {
  const out = [];
  const specTitle = spec?.title || '';
  const prefix = [parentTitle, specTitle].filter(Boolean).join(' › ');

  for (const test of spec?.tests || []) {
    const results = Array.isArray(test?.results) ? test.results : [];
    const failed = results.some((result) => isFailureStatus(result?.status));
    if (!failed) continue;

    const file = spec?.file || test?.location?.file || null;
    const line = test?.location?.line ?? spec?.line ?? null;
    const projects = [...new Set(results.map((result) => result?.projectName).filter(Boolean))];
    const title = [prefix, test?.title].filter(Boolean).join(' › ');

    out.push({
      file,
      line,
      title,
      projects,
      signature: `${file || 'unknown'}:${line || 0}:${title || 'unknown'}`,
    });
  }

  return out;
}

function collectFailedFromSuite(suite, parentTitle = '') {
  const suiteTitle = suite?.title || '';
  const nextPrefix = [parentTitle, suiteTitle].filter(Boolean).join(' › ');
  const out = [];

  for (const spec of suite?.specs || []) {
    out.push(...collectFailedFromSpec(spec, nextPrefix));
  }

  for (const child of suite?.suites || []) {
    out.push(...collectFailedFromSuite(child, nextPrefix));
  }

  return out;
}

async function parseJsonReport(jsonPath) {
  let raw = '';
  try {
    raw = await readFile(jsonPath, 'utf8');
  } catch {
    return { failedTests: [], runErrors: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { failedTests: [], runErrors: [] };
  }

  const failedTests = [];
  for (const suite of parsed?.suites || []) {
    failedTests.push(...collectFailedFromSuite(suite, ''));
  }

  const runErrors = (parsed?.errors || [])
    .map((item) => item?.message)
    .filter((item) => typeof item === 'string' && item.length > 0)
    .map((item) => item.trim());

  return { failedTests, runErrors };
}

function extractInfraSignatures(logText) {
  const out = [];
  for (const pattern of INFRA_PATTERNS) {
    if (!pattern.regex.test(logText)) continue;
    const match = logText.match(pattern.regex);
    out.push({
      signature: pattern.signature,
      detail: match ? String(match[0]).trim().slice(0, 240) : null,
    });
  }

  const unique = new Map();
  for (const item of out) {
    if (!unique.has(item.signature)) unique.set(item.signature, item);
  }

  return [...unique.values()];
}

function classifyAttemptFailure({ ok, failedTests, infraSignatures }) {
  const hasTests = Array.isArray(failedTests) && failedTests.length > 0;
  const hasInfra = Array.isArray(infraSignatures) && infraSignatures.length > 0;

  if (ok && !hasTests && !hasInfra) return 'none';
  if (hasTests && hasInfra) return 'test_and_infra_failure';
  if (hasTests) return 'test_failure';
  if (hasInfra) return 'infra_failure';
  return ok ? 'none' : 'unknown_failure';
}

function runOnce(runIndex) {
  return new Promise((resolve) => {
    const jsonName = `run-${String(runIndex).padStart(2, '0')}-${Date.now()}.json`;
    const args = [
      'playwright',
      'test',
      ...CRITICAL_TESTS,
      '--config=playwright.webpack.config.ts',
      '--project=chromium',
      '--workers=1',
      '--reporter=line,json',
    ];

    const child = spawn('npx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      shell: false,
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_DIR: JSON_OUTPUT_DIR,
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonName,
      },
    });

    let logBuffer = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      logBuffer += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      logBuffer += text;
      process.stderr.write(text);
    });

    child.on('exit', async (code) => {
      const jsonPath = path.join(JSON_OUTPUT_DIR, jsonName);
      const parsed = await parseJsonReport(jsonPath);
      const infraSignatures = extractInfraSignatures(logBuffer);

      const runErrors = [...parsed.runErrors];
      for (const item of infraSignatures) {
        runErrors.push(item.detail ? `${item.signature} :: ${item.detail}` : item.signature);
      }

      const hasDiagnostics = parsed.failedTests.length > 0 || runErrors.length > 0;
      if (code !== 0 && !hasDiagnostics) {
        const fallback = 'infra.unknown_non_test_failure';
        runErrors.push(fallback);
        infraSignatures.push({ signature: fallback, detail: null });
      }

      const failureKind = classifyAttemptFailure({
        ok: code === 0,
        failedTests: parsed.failedTests,
        infraSignatures,
      });

      resolve({
        ok: code === 0,
        exitCode: code,
        jsonPath,
        failedTests: parsed.failedTests,
        runErrors,
        infraSignatures,
        failureKind,
      });
    });
  });
}

function aggregateFailures(attempts) {
  const map = new Map();

  for (const attempt of attempts) {
    for (const failure of attempt.failedTests || []) {
      const key = failure.signature;
      const current = map.get(key) || {
        signature: key,
        file: failure.file,
        line: failure.line,
        title: failure.title,
        hits: 0,
        projects: new Set(),
      };
      current.hits += 1;
      for (const project of failure.projects || []) current.projects.add(project);
      map.set(key, current);
    }
  }

  return [...map.values()]
    .map((item) => ({
      signature: item.signature,
      file: item.file,
      line: item.line,
      title: item.title,
      hits: item.hits,
      projects: [...item.projects],
    }))
    .sort((a, b) => b.hits - a.hits || a.signature.localeCompare(b.signature));
}

function aggregateInfraFailures(attempts) {
  const map = new Map();

  for (const attempt of attempts) {
    for (const infra of attempt.infraSignatures || []) {
      const key = infra.signature;
      const current = map.get(key) || {
        signature: key,
        hits: 0,
        examples: new Set(),
      };
      current.hits += 1;
      if (infra.detail) current.examples.add(infra.detail);
      map.set(key, current);
    }
  }

  return [...map.values()]
    .map((item) => ({
      signature: item.signature,
      hits: item.hits,
      examples: [...item.examples].slice(0, 3),
    }))
    .sort((a, b) => b.hits - a.hits || a.signature.localeCompare(b.signature));
}

async function main() {
  const runs = readIntArg('--runs', DEFAULT_RUNS);
  const maxFlakeRate = readFloatArg('--maxFlakeRate', DEFAULT_MAX_FLAKE_RATE);
  const reportPath = path.resolve(readStringArg('--reportPath', DEFAULT_REPORT_PATH));

  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(JSON_OUTPUT_DIR, { recursive: true });

  const attempts = [];
  for (let index = 0; index < runs; index += 1) {
    console.log(`\n[e2e-flake-check] run ${index + 1}/${runs}`);
    const result = await runOnce(index + 1);
    attempts.push({
      run: index + 1,
      ok: result.ok,
      exitCode: result.exitCode,
      at: new Date().toISOString(),
      jsonPath: result.jsonPath,
      failedTests: result.failedTests,
      runErrors: result.runErrors,
      infraSignatures: result.infraSignatures,
      failureKind: result.failureKind,
    });
  }

  const failedRuns = attempts.filter((item) => !item.ok).length;
  const infraFailedRuns = attempts.filter((item) => item.failureKind === 'infra_failure' || item.failureKind === 'test_and_infra_failure').length;
  const testFailedRuns = attempts.filter((item) => item.failureKind === 'test_failure' || item.failureKind === 'test_and_infra_failure').length;
  const flakeRate = runs > 0 ? failedRuns / runs : 0;

  const topFailingTests = aggregateFailures(attempts);
  const topInfraSignatures = aggregateInfraFailures(attempts);

  const report = {
    generatedAt: new Date().toISOString(),
    reportPath,
    runs,
    failedRuns,
    infraFailedRuns,
    testFailedRuns,
    flakeRate,
    maxFlakeRate,
    tests: CRITICAL_TESTS,
    attempts,
    topFailingTests,
    topInfraSignatures,
    // Backward-compatible alias
    topInfraFailures: topInfraSignatures,
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[e2e-flake-check] report: ${reportPath}`);
  console.log(`[e2e-flake-check] failed runs: ${failedRuns}/${runs}, flakeRate=${flakeRate.toFixed(4)}`);
  if (topFailingTests.length > 0) {
    console.log('[e2e-flake-check] top failing signatures:');
    topFailingTests.slice(0, 10).forEach((item) => {
      console.log(`  - hits=${item.hits} ${item.file || 'unknown'}:${item.line || 0} :: ${item.title}`);
    });
  }
  if (topInfraSignatures.length > 0) {
    console.log('[e2e-flake-check] top infra signatures:');
    topInfraSignatures.slice(0, 10).forEach((item) => {
      console.log(`  - hits=${item.hits} ${item.signature}`);
    });
  }

  if (flakeRate > maxFlakeRate) {
    process.exitCode = 1;
  }
}

await main();
