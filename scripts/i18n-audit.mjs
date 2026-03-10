import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MESSAGES_PATH = path.join(ROOT, "app", "lib", "i18n", "messages.ts");

const FAIL_ON_UNUSED = process.env.I18N_AUDIT_FAIL_ON_UNUSED === "1";
const FAIL_ON_HARDCODED = process.env.I18N_AUDIT_FAIL_ON_HARDCODED === "1";
const FAIL_ON_UNKNOWN = process.env.I18N_AUDIT_FAIL_ON_UNKNOWN === "1";
const HARD_CODED_TOP_N = 25;
const HARD_CODED_SCOPE = process.env.I18N_AUDIT_HARDCODED_SCOPE === "all" ? "all" : "ui";
const UNKNOWN_BUDGET_DEFAULT_PATH = path.join(ROOT, "config", "i18n-audit-budget.json");

const HARD_CODED_ALWAYS_IGNORE_PREFIXES = [
  ".backup/",
  ".codex/",
  "tmp/",
  "public/",
  "data/",
  "tests/",
  "scripts/",
  "node_modules/",
];

const HARD_CODED_UI_INCLUDE_PREFIXES = [
  "app/components/",
  "app/podcast/",
  "app/layout.tsx",
  "app/page.tsx",
  "app/account/",
  "app/admin/",
  "app/auth/",
  "app/search/",
  "app/premium/",
  "app/materials/",
  "app/video/",
  "app/events/",
  "app/donate/",
  "app/map/",
  "app/education/",
  "app/articles/create/",
];

const I18N_AUDIT_FORCE_INCLUDE_FILES = [
  "app/components/community/CollabRoomFeedbackTimelineClient.tsx",
  "app/components/community/CommunityProjectsWorkspaceClient.tsx",
  "app/components/community/CommunityOpenSlotsDiscoveryClient.tsx",
  "app/podcast/[showSlug]/page.tsx",
  "app/podcast/[showSlug]/[episodeSlug]/page.tsx",
];

const EXACT_HARDCODED_SIGNAL_IGNORE = new Set([
  "app/components/YandexArchiveMap.tsx",
  "app/components/SoundRoutePlayer.tsx",
  "app/components/GlobalFloatingVideoPlayer.tsx",
  "app/components/articles/ArticleBlocksRenderer.tsx",
  "app/components/articles/ArticleAudioRow.tsx",
  "app/components/ArticleRouteAudioPlayer.tsx",
  "app/components/admin/AdminEventsClient.tsx",
]);

const HARD_CODED_LITERAL_ALLOWLIST = new Map([
  [
    "app/components/MultiTrackPlayer.tsx",
    [
      /const PIANO_WHITE_KEYS_RU = \[[^\n]+\] as const/g,
      /const PIANO_BLACK_KEYS_RU = \[[^\n]+\] as const/g,
      /const OCTAVE_NAMES = \[[^\n]+\] as const/g,
      /const CYRILLIC_VOWEL = "[^"]+"/g,
      /\{ name: "Селезень 0[1-3]", src: "[^"]+" \},?/g,
    ],
  ],
]);

const FILE_SCAN_ROOTS = ["app"];
const FILE_SCAN_IGNORE_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "playwright-report",
  "test-results",
  ".backup",
  ".codex",
  "tmp",
]);

function walkSourceFiles(absDir, relPrefix = "") {
  let out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (FILE_SCAN_IGNORE_DIRS.has(entry.name)) continue;
    const nextAbs = path.join(absDir, entry.name);
    const nextRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out = out.concat(walkSourceFiles(nextAbs, nextRel));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      out.push(nextRel);
    }
  }
  return out;
}

function parseObjectLiteralSection(source, startToken) {
  const start = source.indexOf(startToken);
  if (start === -1) return "";
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) return "";

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  return "";
}

function extractKeysFromSection(section) {
  const keys = new Set();
  const re = /^\s*"([^"]+)":\s*/gm;
  let match;
  while ((match = re.exec(section)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function listTrackedFiles() {
  const scanned = FILE_SCAN_ROOTS.flatMap((rootDir) => walkSourceFiles(path.join(ROOT, rootDir), rootDir)).filter(Boolean);
  const forceIncluded = I18N_AUDIT_FORCE_INCLUDE_FILES.filter((relPath) =>
    /\.(ts|tsx|js|jsx|mjs)$/.test(relPath) && fs.existsSync(path.join(ROOT, relPath))
  );
  return Array.from(new Set([...scanned, ...forceIncluded]));
}

function readFileSafe(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

function collectUsedI18nKeys(files) {
  const keyToFiles = new Map();
  const literalCallRe = /\bt\(\s*["'`]([^"'`]+)["'`]/g;
  const dynamicKeyHintRe = /\b(?:labelKey|i18nKey|messageKey)\s*:\s*["'`]([^"'`]+)["'`]/g;
  for (const relPath of files) {
    if (relPath === "app/lib/i18n/messages.ts") continue;
    const text = readFileSafe(relPath);
    if (!text) continue;
    let match;
    while ((match = literalCallRe.exec(text)) !== null) {
      const key = match[1];
      if (!keyToFiles.has(key)) keyToFiles.set(key, new Set());
      keyToFiles.get(key).add(relPath);
    }
    while ((match = dynamicKeyHintRe.exec(text)) !== null) {
      const key = match[1];
      if (!key.includes(".")) continue;
      if (!keyToFiles.has(key)) keyToFiles.set(key, new Set());
      keyToFiles.get(key).add(relPath);
    }
  }
  return keyToFiles;
}

function collectHardcodedCyrillicSignals(files) {
  const out = [];
  const exactIgnore = new Set([
    "app/lib/i18n/messages.ts",
    "app/lib/articlesCatalog.ts",
    "app/lib/soundCatalog.ts",
    "app/lib/videosCatalog.ts",
    "tests/e2e/vk-articles-parity-capture.spec.ts"
  ]);
  const cyrillicRe = /[\u0400-\u04FF]{2,}/g;

  const eligibleFiles = files.filter((relPath) => {
    if (HARD_CODED_ALWAYS_IGNORE_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
    if (EXACT_HARDCODED_SIGNAL_IGNORE.has(relPath)) return false;
    if (exactIgnore.has(relPath)) return false;
    if (HARD_CODED_SCOPE === "all") return true;
    return HARD_CODED_UI_INCLUDE_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(prefix));
  });

  for (const relPath of eligibleFiles) {
    const text = readFileSafe(relPath);
    if (!text) continue;
    const allowlist = HARD_CODED_LITERAL_ALLOWLIST.get(relPath);
    const normalizedText = allowlist
      ? allowlist.reduce((acc, pattern) => acc.replace(pattern, " "), text)
      : text;
    const matches = normalizedText.match(cyrillicRe);
    if (!matches || matches.length === 0) continue;
    out.push({ file: relPath, count: matches.length });
  }
  out.sort((a, b) => b.count - a.count);
  return {
    scope: HARD_CODED_SCOPE,
    scannedFiles: eligibleFiles.length,
    signals: out,
  };
}

function setDiff(a, b) {
  const out = [];
  for (const value of a) {
    if (!b.has(value)) out.push(value);
  }
  return out.sort();
}

function sortedFromSet(set) {
  return Array.from(set).sort();
}

function readUnknownBudget() {
  const rawFromEnv = process.env.I18N_AUDIT_UNKNOWN_BUDGET;
  if (rawFromEnv !== undefined) {
    const parsed = Number(rawFromEnv);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  const budgetPath = process.env.I18N_AUDIT_UNKNOWN_BUDGET_PATH
    ? path.resolve(process.env.I18N_AUDIT_UNKNOWN_BUDGET_PATH)
    : UNKNOWN_BUDGET_DEFAULT_PATH;
  try {
    const payload = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
    const parsed = Number(payload?.maxUnknownUsedKeys);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  } catch {
    return null;
  }
  return null;
}

function main() {
  const messagesSource = fs.readFileSync(MESSAGES_PATH, "utf8");
  const ruSection = parseObjectLiteralSection(messagesSource, "const RU_MESSAGES = {");
  const enSection = parseObjectLiteralSection(messagesSource, "const EN_MESSAGES: MessageMap = {");

  const ruKeys = extractKeysFromSection(ruSection);
  const enKeys = extractKeysFromSection(enSection);

  const missingInEn = setDiff(ruKeys, enKeys);
  const missingInRu = setDiff(enKeys, ruKeys);

  const trackedFiles = listTrackedFiles();
  const keyToFiles = collectUsedI18nKeys(trackedFiles);
  const usedKeys = new Set(keyToFiles.keys());
  const unknownUsedKeys = setDiff(usedKeys, ruKeys);
  const unusedKeys = setDiff(ruKeys, usedKeys);
  const unknownBudget = readUnknownBudget();
  const unknownOverBudget =
    Number.isFinite(unknownBudget) && unknownBudget !== null ? unknownUsedKeys.length > unknownBudget : false;

  const hardcodedSignals = collectHardcodedCyrillicSignals(trackedFiles);

  const summary = {
    generatedAt: new Date().toISOString(),
    messagesPath: path.relative(ROOT, MESSAGES_PATH),
    metrics: {
      ruKeys: ruKeys.size,
      enKeys: enKeys.size,
      missingInEn: missingInEn.length,
      missingInRu: missingInRu.length,
      usedKeys: usedKeys.size,
      unusedKeys: unusedKeys.length,
      unknownUsedKeys: unknownUsedKeys.length,
      hardcodedSignalFiles: hardcodedSignals.signals.length,
      unknownBudget,
      unknownOverBudget
    },
    hardcodedScope: hardcodedSignals.scope,
    hardcodedScannedFiles: hardcodedSignals.scannedFiles,
    missingInEn,
    missingInRu,
    unknownUsedKeys,
    unusedKeys: unusedKeys.slice(0, 200),
    hardcodedSignalsTop: hardcodedSignals.signals.slice(0, HARD_CODED_TOP_N),
    sampleKeyUsage: sortedFromSet(ruKeys)
      .slice(0, 40)
      .map((key) => ({
        key,
        files: keyToFiles.has(key) ? sortedFromSet(keyToFiles.get(key)) : []
      }))
  };

  const outputPath = process.env.I18N_AUDIT_OUTPUT_PATH
    ? path.resolve(process.env.I18N_AUDIT_OUTPUT_PATH)
    : path.join(ROOT, "tmp", "i18n-audit.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");

  console.log("i18n audit summary:");
  console.log(`- ru keys: ${ruKeys.size}`);
  console.log(`- en keys: ${enKeys.size}`);
  console.log(`- missing in en: ${missingInEn.length}`);
  console.log(`- missing in ru: ${missingInRu.length}`);
  console.log(`- unknown used keys: ${unknownUsedKeys.length}`);
  if (Number.isFinite(unknownBudget) && unknownBudget !== null) {
    console.log(`- unknown budget: ${unknownBudget}`);
    console.log(`- unknown over budget: ${unknownOverBudget ? "yes" : "no"}`);
  }
  console.log(`- unused keys: ${unusedKeys.length}`);
  console.log(`- hardcoded scope: ${hardcodedSignals.scope}`);
  console.log(`- hardcoded scanned files: ${hardcodedSignals.scannedFiles}`);
  console.log(`- hardcoded cyrillic signal files: ${hardcodedSignals.signals.length}`);
  console.log(`- output: ${outputPath}`);

  const shouldFail =
    missingInEn.length > 0 ||
    missingInRu.length > 0 ||
    (FAIL_ON_UNKNOWN && unknownUsedKeys.length > 0) ||
    unknownOverBudget ||
    (FAIL_ON_UNUSED && unusedKeys.length > 0) ||
    (FAIL_ON_HARDCODED && hardcodedSignals.signals.length > 0);

  if (shouldFail) {
    console.error("i18n audit failed");
    process.exit(1);
  }
}

main();
