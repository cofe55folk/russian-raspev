import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inferPriority,
  inferSectionStatus,
  isActionableSection,
  parseBriefSectionsFromText,
} from "./lib/brief-parser.mjs";

const ROOT = process.cwd();
const BRIEF_PATH = path.join(ROOT, "WORK_BRIEF.md");
const BRIEF_NEXT_JSON = path.join(ROOT, "tmp", "brief-next.json");
const HEALTH_JSON = path.join(ROOT, "tmp", "orchestration-health.json");
const OUTPUT_JSON = path.join(ROOT, "tmp", "p0p1-monitor.json");
const OUTPUT_MD = path.join(ROOT, "tmp", "p0p1-monitor.md");
const RECOVERY_METRICS_PATH = path.join(ROOT, "tmp", "recovery-core", "metrics.json");
const P0_BOARD_PATH = path.join(ROOT, "p0-board.json");

function parseArgs(argv) {
  const out = {
    strict: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--strict") out.strict = true;
  }
  return out;
}

async function safeReadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function completionPct(closed, total) {
  if (!total) return 100;
  return Number((Math.min(100, (closed / total) * 100)).toFixed(1));
}

function normalizeStatus(status) {
  const raw = String(status || "").toLowerCase().trim();
  if (raw === "in_progress" || raw === "in-progress") return "in_progress";
  if (raw === "blocked") return "blocked";
  if (raw === "closed" || raw === "done" || raw === "completed") return "closed";
  return "open";
}

function buildP0MetricsFromBoard(board) {
  if (!board || !Array.isArray(board.p0)) return null;
  const out = { open: 0, inProgress: 0, blocked: 0, closed: 0, completionPct: 0 };
  for (const section of board.p0) {
    const status = normalizeStatus(section?.status);
    if (status === "closed") out.closed += 1;
    else if (status === "blocked") out.blocked += 1;
    else if (status === "in_progress") out.inProgress += 1;
    else out.open += 1;
  }
  out.completionPct = completionPct(out.closed, board.p0.length);
  return out;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildNext3FromBoard(board) {
  if (!board || !Array.isArray(board.p0)) return null;
  return board.p0
    .filter((section) => normalizeStatus(section?.status) !== "closed")
    .sort((a, b) => {
      const byPriority = toNumber(a?.priority, 99) - toNumber(b?.priority, 99);
      if (byPriority !== 0) return byPriority;
      return toNumber(a?.sectionNumber, 99999) - toNumber(b?.sectionNumber, 99999);
    })
    .slice(0, 3)
    .map((section) => ({
      sectionNumber: toNumber(section?.sectionNumber, 0),
      priority: toNumber(section?.priority, 0),
      status: normalizeStatus(section?.status),
      title: String(section?.title || section?.id || "Untitled section"),
    }));
}

function filterBriefNextAgainstBoard(nextTasks, board) {
  if (!Array.isArray(nextTasks)) return [];
  if (!board || !Array.isArray(board.p0)) return nextTasks;

  const closedP0Sections = new Set(
    board.p0
      .filter((section) => normalizeStatus(section?.status) === "closed")
      .map((section) => toNumber(section?.sectionNumber, NaN))
      .filter((sectionNumber) => Number.isFinite(sectionNumber))
  );

  return nextTasks.filter((task) => {
    const priority = toNumber(task?.priority, 0);
    if (priority !== 0) return true;
    const sectionNumber = toNumber(task?.sectionNumber, NaN);
    if (!Number.isFinite(sectionNumber)) return true;
    return !closedP0Sections.has(sectionNumber);
  });
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# P0P1 Monitor");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- verdict: ${report.verdict}`);
  lines.push(`- strict: ${report.strict ? "on" : "off"}`);
  lines.push("");
  lines.push("## Scoreboard");
  lines.push("");
  lines.push("| Priority | Open | In Progress | Blocked | Closed | Completion |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  lines.push(
    `| P0 | ${report.metrics.p0.open} | ${report.metrics.p0.inProgress} | ${report.metrics.p0.blocked} | ${report.metrics.p0.closed} | ${report.metrics.p0.completionPct}% |`
  );
  lines.push(
    `| P1 | ${report.metrics.p1.open} | ${report.metrics.p1.inProgress} | ${report.metrics.p1.blocked} | ${report.metrics.p1.closed} | ${report.metrics.p1.completionPct}% |`
  );
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity}] ${finding.message}`);
    }
  }
  lines.push("");
  lines.push("## Actions");
  lines.push("");
  for (const action of report.actions) {
    lines.push(`${action.rank}. ${action.message}`);
  }
  lines.push("");
  lines.push("## Triad");
  lines.push("");
  lines.push(`- runId: ${report.triad.runId || "n/a"}`);
  lines.push(`- phase: ${report.triad.phase || "n/a"}`);
  lines.push(`- owner: ${report.triad.owner || "n/a"}`);
  lines.push(`- severity: ${report.triad.severity || "n/a"}`);
  lines.push("");
  lines.push("## Next 3");
  lines.push("");
  if (report.next3.length === 0) {
    lines.push("- none");
  } else {
    for (const task of report.next3) {
      lines.push(`- [${task.sectionNumber}] P${task.priority} ${task.title} (${task.status})`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const text = await readFile(BRIEF_PATH, "utf8");
  const sections = parseBriefSectionsFromText(text).filter(isActionableSection);
  const p0p1 = sections
    .map((section) => ({
      sectionNumber: section.number,
      title: section.title,
      priority: inferPriority(section),
      status: inferSectionStatus(section),
    }))
    .filter((item) => item.priority <= 1);

  const metrics = {
    p0: { open: 0, inProgress: 0, blocked: 0, closed: 0, completionPct: 0 },
    p1: { open: 0, inProgress: 0, blocked: 0, closed: 0, completionPct: 0 },
  };

  for (const item of p0p1) {
    const bucket = item.priority === 0 ? metrics.p0 : metrics.p1;
    if (item.status === "open") bucket.open += 1;
    else if (item.status === "in_progress") bucket.inProgress += 1;
    else if (item.status === "blocked") bucket.blocked += 1;
    else bucket.closed += 1;
  }

  const p0Board = await safeReadJson(P0_BOARD_PATH);
  const boardP0Metrics = buildP0MetricsFromBoard(p0Board);
  if (boardP0Metrics) {
    metrics.p0 = boardP0Metrics;
  }

  const recoveryMetrics = await safeReadJson(RECOVERY_METRICS_PATH);
  const p0MicroClosedCreditsRaw = Number(recoveryMetrics?.p0MicroClosedCredits || 0);
  const p0MicroClosedCredits =
    Number.isFinite(p0MicroClosedCreditsRaw) && p0MicroClosedCreditsRaw > 0
      ? Math.floor(p0MicroClosedCreditsRaw)
      : 0;
  if (!boardP0Metrics) {
    metrics.p0.completionPct = completionPct(metrics.p0.closed, p0p1.filter((x) => x.priority === 0).length);
  }
  metrics.p1.completionPct = completionPct(metrics.p1.closed, p0p1.filter((x) => x.priority === 1).length);

  const health = await safeReadJson(HEALTH_JSON);
  const briefNext = await safeReadJson(BRIEF_NEXT_JSON);
  const triad = health?.triad || {};
  const briefNextTasks = Array.isArray(briefNext?.nextTasks) ? briefNext.nextTasks : [];
  const boardNext3 = buildNext3FromBoard(p0Board);
  const next3Source = boardNext3 ? "p0-board" : "brief-next";
  const next3 = boardNext3 ?? filterBriefNextAgainstBoard(briefNextTasks, p0Board).slice(0, 3);

  const findings = [];
  if (metrics.p0.blocked > 0) findings.push({ severity: "high", message: `P0 blocked items: ${metrics.p0.blocked}` });
  if (metrics.p0.open + metrics.p0.inProgress > 6) {
    findings.push({ severity: "high", message: `P0 backlog pressure high: ${metrics.p0.open + metrics.p0.inProgress}` });
  }
  if (metrics.p1.blocked > 0) findings.push({ severity: "medium", message: `P1 blocked items: ${metrics.p1.blocked}` });
  if (String(triad.phase || "").toUpperCase() === "BLOCKED") {
    findings.push({ severity: "high", message: `Triad phase is BLOCKED for run ${triad.runId || "n/a"}` });
  }

  let verdict = "ok";
  if (findings.some((f) => f.severity === "high")) verdict = "at_risk";
  else if (findings.length > 0) verdict = "warning";

  const report = {
    generatedAt: new Date().toISOString(),
    strict: args.strict,
    verdict,
    metrics,
    triad,
    next3: next3.map((item) => ({
      sectionNumber: item.sectionNumber,
      priority: item.priority,
      status: item.status,
      title: item.title,
    })),
    findings,
    recoveryCoreOverlay: {
      p0MicroClosedCredits,
      source: RECOVERY_METRICS_PATH,
    },
    metricSources: {
      p0: boardP0Metrics ? P0_BOARD_PATH : BRIEF_PATH,
      p1: BRIEF_PATH,
      next3: next3Source,
    },
    actions: [
      { rank: 1, message: "Fix blocked P0 items before opening new P3 branches." },
      { rank: 2, message: "Keep triad assigned to P0/P1 until P0 blocked=0 and P0 in_progress<=3." },
      { rank: 3, message: "Regenerate brief-important and brief-next after each close/block transition." },
    ],
  };

  await mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_MD, toMarkdown(report), "utf8");

  process.stdout.write(`[p0p1-monitor] json: ${OUTPUT_JSON}\n`);
  process.stdout.write(`[p0p1-monitor] md: ${OUTPUT_MD}\n`);
  process.stdout.write(`[p0p1-monitor] verdict=${verdict}\n`);

  if (args.strict && verdict !== "ok") {
    process.exitCode = 2;
  }
}

await main();
