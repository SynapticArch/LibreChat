#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- 1. Log UI (ANSI Colors) ---
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIRNAME = 'backend';
const MANIFEST_FILENAME = 'package.json';
const CARGO_MANIFEST_FILENAME = 'Cargo.toml';
const CARGO_LOCK_FILENAME = 'Cargo.lock';
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const COREPACK_COMMAND = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const CARGO_COMMAND = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const IS_WINDOWS = process.platform === 'win32';
const WINDOWS_POWERSHELL_COMMAND = IS_WINDOWS
  ? path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  : null;
const CRATES_IO_API_ROOT = 'https://crates.io/api/v1/crates';
const CRATES_IO_USER_AGENT = 'geograba-dependabot-alert-fixer';
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const PINNED_DEPENDENCY_RANGES_BY_TARGET = {
  'frontend/docs/package.json': {
    webpack: '5.99.9',
  },
};

const RUST_DEPENDENCY_FIELDS = [
  'dependencies',
  'dev-dependencies',
  'build-dependencies',
];
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.vercel',
  'coverage',
  'dist',
  'node_modules',
]);

function parseCliArgs(argv) {
  const targets = [];
  let dryRun = false;
  let repairOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--target' && argv[index + 1]) {
      targets.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument.startsWith('--target=')) {
      targets.push(argument.slice('--target='.length));
      continue;
    }

    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (argument === '--repair' || argument === '--repair-only') {
      repairOnly = true;
      continue;
    }
  }

  return { repairOnly, targets, dryRun };
}

function printDivider() {
  console.log('==========================================');
}

function printHeader(title) {
  printDivider();
  console.log(`  ${title}`);
  printDivider();
}

function printSection(index, total, title) {
  console.log(`\n${colors.cyan}[${index}/${total}] ${title}${colors.reset}`);
}

function quoteWindowsShellArgument(argument) {
  return /^[A-Za-z0-9_./:\\@%+=,~-]+$/.test(argument)
    ? argument
    : `'${argument.replace(/'/g, "''")}'`;
}

function quotePosixShellArgument(argument) {
  return /^[A-Za-z0-9_./:@%+=,~-]+$/.test(argument)
    ? argument
    : `'${argument.replace(/'/g, `'\\''`)}'`;
}

function quoteShellArgument(argument) {
  return IS_WINDOWS
    ? quoteWindowsShellArgument(argument)
    : quotePosixShellArgument(argument);
}

function formatShellCommand(cwd, command, args = []) {
  const prompt = IS_WINDOWS ? '>' : '$';
  return `${cwd}${prompt} ${[command, ...args].map(quoteShellArgument).join(' ')}`;
}

function printAction(cwd, command, args = [], dryRun = false) {
  const prefix = dryRun ? `${colors.yellow}[DRY-RUN]${colors.reset} ` : '';
  console.log(`${prefix}${colors.cyan}${formatShellCommand(cwd, command, args)}${colors.reset}`);
}

function createSpawnError(commandLabel, cwd, error) {
  return Object.assign(
    new Error(`Unable to execute ${commandLabel} in ${cwd}: ${error.message}`),
    { code: error.code }
  );
}

function executeCommand(cwd, command, commandArgs, commandLabel, dryRun = false) {
  if (dryRun) {
    return Promise.resolve(); // 2. 安全演练模式拦截
  }

  return new Promise((resolve, reject) => {
    const child = IS_WINDOWS
      ? spawn(
        WINDOWS_POWERSHELL_COMMAND,
        ['-NoProfile', '-Command', [command, ...commandArgs].map(quoteWindowsShellArgument).join(' ')],
        { cwd, stdio: 'inherit', env: process.env, windowsHide: true }
      )
      : spawn(command, commandArgs, { cwd, stdio: 'inherit', env: process.env });

    child.on('error', (error) => reject(createSpawnError(commandLabel, cwd, error)));
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${commandLabel} exited abnormally in ${cwd}: ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

async function getPackageManager() {
  try {
    const rootManifestPath = path.join(ROOT_DIR, MANIFEST_FILENAME);
    if (existsSync(rootManifestPath)) {
      const rootManifestText = await readFile(rootManifestPath, 'utf8');
      const rootManifest = JSON.parse(rootManifestText);
      if (rootManifest.packageManager?.startsWith('npm')) return 'npm';
      if (rootManifest.packageManager?.startsWith('pnpm')) return 'pnpm';
    }
  } catch (error) {}

  if (existsSync(path.join(ROOT_DIR, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

function collectDependencyNames(manifest) {
  return Array.from(
    new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})))
  ).sort((left, right) => left.localeCompare(right));
}

function collectDependencyCounts(manifest) {
  return DEPENDENCY_FIELDS.reduce((counts, field) => {
    counts[field] = Object.keys(manifest[field] ?? {}).length;
    return counts;
  }, {});
}

function cloneDependencySnapshot(manifest) {
  return DEPENDENCY_FIELDS.reduce((snapshot, field) => {
    snapshot[field] = { ...(manifest[field] ?? {}) };
    return snapshot;
  }, {});
}

function cloneOverrideSnapshot(manifest) {
  return { ...(manifest?.pnpm?.overrides ?? {}) };
}

function collectRangeChanges(beforeSnapshot, afterManifest) {
  const changes = [];
  for (const field of DEPENDENCY_FIELDS) {
    const beforeEntries = beforeSnapshot[field] ?? {};
    const afterEntries = afterManifest[field] ?? {};
    const dependencyNames = Array.from(new Set([...Object.keys(beforeEntries), ...Object.keys(afterEntries)])).sort();

    for (const dependencyName of dependencyNames) {
      if (beforeEntries[dependencyName] !== afterEntries[dependencyName]) {
        changes.push({
          field,
          name: dependencyName,
          beforeRange: beforeEntries[dependencyName],
          afterRange: afterEntries[dependencyName],
        });
      }
    }
  }
  return changes;
}

function collectOverrideChanges(beforeSnapshot, afterManifest) {
  const beforeEntries = beforeSnapshot ?? {};
  const afterEntries = afterManifest?.pnpm?.overrides ?? {};
  const overrideNames = Array.from(new Set([...Object.keys(beforeEntries), ...Object.keys(afterEntries)])).sort();
  const changes = [];

  for (const overrideName of overrideNames) {
    if (beforeEntries[overrideName] !== afterEntries[overrideName]) {
      changes.push({
        name: overrideName,
        beforeRange: beforeEntries[overrideName],
        afterRange: afterEntries[overrideName],
      });
    }
  }
  return changes;
}

function describeCounts(counts) {
  return DEPENDENCY_FIELDS.filter((field) => counts[field] > 0).map((field) => `${field}:${counts[field]}`).join(', ');
}

function formatChange(change) {
  return `${change.name} (${change.field}) ${change.beforeRange ?? '<missing>'} -> ${change.afterRange ?? '<removed>'}`;
}

function formatOverrideChange(change) {
  return `${change.name} (pnpm.overrides) ${change.beforeRange ?? '<missing>'} -> ${change.afterRange ?? '<removed>'}`;
}

async function readManifest(packageJsonPath) {
  const manifestText = await readFile(packageJsonPath, 'utf8');
  return JSON.parse(manifestText);
}

function collectDirectDependencyRanges(manifest) {
  const dependencyRanges = new Map();
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dependencyName, dependencyRange] of Object.entries(manifest[field] ?? {})) {
      if (!dependencyRanges.has(dependencyName)) dependencyRanges.set(dependencyName, dependencyRange);
    }
  }
  return dependencyRanges;
}

function normalizePnpmOverrides(manifest) {
  const overrides = manifest?.pnpm?.overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return [];

  const directDependencyRanges = collectDirectDependencyRanges(manifest);
  const changes = [];

  for (const [overrideName, overrideRange] of Object.entries(overrides)) {
    if (!directDependencyRanges.has(overrideName)) continue;
    const nextOverrideRange = `$${overrideName}`;
    if (overrideRange === nextOverrideRange) continue;

    overrides[overrideName] = nextOverrideRange;
    changes.push({ name: overrideName, beforeRange: overrideRange, afterRange: nextOverrideRange });
  }
  return changes;
}

async function rewriteManifest(packageJsonPath, manifest, dryRun = false) {
  if (dryRun) return; // 2. 安全演练模式拦截
  const currentManifestText = await readFile(packageJsonPath, 'utf8');
  const newline = currentManifestText.includes('\r\n') ? '\r\n' : '\n';
  await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2).replace(/\n/g, newline)}${newline}`);
}

function applyPinnedDependencyRanges(target, manifest) {
  const pinnedRanges = PINNED_DEPENDENCY_RANGES_BY_TARGET[target.packageJsonLabel];
  if (!pinnedRanges) return [];

  const changes = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== 'object') continue;

    for (const [dependencyName, pinnedRange] of Object.entries(pinnedRanges)) {
      if (!(dependencyName in dependencies) || dependencies[dependencyName] === pinnedRange) continue;
      changes.push({ field, name: dependencyName, beforeRange: dependencies[dependencyName], afterRange: pinnedRange });
      dependencies[dependencyName] = pinnedRange;
    }
  }
  return changes;
}

function createPnpmExecutor(target, dryRun) {
  return async (args) => {
    printAction(target.dir, 'pnpm', args, dryRun);
    try {
      await executeCommand(target.dir, PNPM_COMMAND, args, `pnpm for ${target.packageJsonLabel}`, dryRun);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      console.log(`${colors.yellow}  - pnpm was not found on PATH, retrying with corepack.${colors.reset}`);
      printAction(target.dir, 'corepack', ['pnpm', ...args], dryRun);
      try {
        await executeCommand(target.dir, COREPACK_COMMAND, ['pnpm', ...args], `corepack pnpm for ${target.packageJsonLabel}`, dryRun);
      } catch (corepackError) {
        if (corepackError?.code === 'ENOENT') throw new Error(`Neither pnpm nor corepack is available in ${target.dir}.`);
        throw corepackError;
      }
    }
  };
}

function shouldUpgradeNpmDependency(range) {
  if (!range || range === '*') return false;
  if (range.startsWith('workspace:') || range.startsWith('file:') || range.startsWith('link:')) return false;
  if (/^(git\+|http|https):\/\//.test(range)) return false;
  return true;
}

async function runJsUpgrade(target, options = {}, packageManager) {
  if (packageManager === 'npm') {
    await runNpmUpgrade(target, options);
  } else {
    await runPnpmUpgrade(target, options);
  }
}

async function runNpmUpgrade(target, options = {}) {
  const isRoot = target.dir === ROOT_DIR;
  
  if (!options.repairOnly) {
    const manifest = await readManifest(target.packageJsonPath);
    const dependenciesToUpgrade = [];

    // 合併 npm 和 pnpm 的 overrides，讓我們知道哪些依賴需要跳過
    const overrides = { 
      ...(manifest.overrides || {}), 
      ...(manifest?.pnpm?.overrides || {}) 
    };

    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field] || {};
      for (const [name, range] of Object.entries(deps)) {
        // 跳過在 overrides 中有明確設定的依賴項，以避免 EOVERRIDE 衝突
        if (shouldUpgradeNpmDependency(range) && !overrides[name]) {
          dependenciesToUpgrade.push(`${name}@latest`);
        }
      }
    }

    if (dependenciesToUpgrade.length > 0) {
      // 在 npm 中，推薦在根目錄加上 workspace 參數來統籌升級並更新根 package-lock.json
      const args = ['install', '--package-lock-only', '--legacy-peer-deps', ...dependenciesToUpgrade];
      if (!isRoot) {
        const relativePath = path.relative(ROOT_DIR, target.dir);
        args.push(`--workspace=${relativePath}`);
      }

      printAction(ROOT_DIR, 'npm', args);
      try {
        await executeCommand(ROOT_DIR, NPM_COMMAND, args, `npm install for ${target.packageJsonLabel}`);
      } catch (e) {
        console.warn(`  - [Warning] npm install failed for specific versions, falling back to basic npm update.`);
        
        // 修復：在備用方案中加入 --legacy-peer-deps，以防止 ERESOLVE 對等依賴衝突
        const updateArgs = ['update', '--package-lock-only', '--legacy-peer-deps'];
        
        if (!isRoot) updateArgs.push(`--workspace=${path.relative(ROOT_DIR, target.dir)}`);
        await executeCommand(ROOT_DIR, NPM_COMMAND, updateArgs, `npm update for ${target.packageJsonLabel}`);
      }
    }
  }

  const nextManifest = await readManifest(target.packageJsonPath);
  const pinnedRangeChanges = applyPinnedDependencyRanges(target, nextManifest);
  const overrideChanges = normalizePnpmOverrides(nextManifest); // 仅针对 pnpm.overrides

  if (pinnedRangeChanges.length > 0 || overrideChanges.length > 0) {
    await rewriteManifest(target.packageJsonPath, nextManifest);
    if (pinnedRangeChanges.length > 0) {
      console.log(
        `  - Reapplied ${pinnedRangeChanges.length} pinned dependency range${pinnedRangeChanges.length === 1 ? '' : 's'}.`
      );
    }
    if (overrideChanges.length > 0) {
      console.log(
        `  - Normalized ${overrideChanges.length} overlapping pnpm override${overrideChanges.length === 1 ? '' : 's'} to $dependency references.`
      );
    }
    
    // 如果修改了文件，重新生成 lockfile
    const finalArgs = ['install', '--package-lock-only', '--legacy-peer-deps'];
    await executeCommand(ROOT_DIR, NPM_COMMAND, finalArgs, `Final npm install for ${target.packageJsonLabel}`);
  }
}

async function runPnpmUpgrade(target, options = {}) {
  const runPnpmCommand = createPnpmExecutor(target, options.dryRun);
  let hasChanges = false;

  if (!options.repairOnly && target.dependencyNames.length > 0) {
    hasChanges = true;
    try {
      await runPnpmCommand(['up', '--latest', '--lockfile-only', ...target.dependencyNames]);
    } catch (e) {
      // 3. “自我疗愈”式的错误回退 (Graceful Fallback)
      console.warn(`${colors.yellow}  - [Warning] Batch pnpm up failed. Entering fallback mode...${colors.reset}`);
      for (const dep of target.dependencyNames) {
        try {
          await runPnpmCommand(['up', '--latest', '--lockfile-only', dep]);
          console.log(`${colors.green}  - [Success] Upgraded ${dep}${colors.reset}`);
        } catch (fallbackErr) {
          console.error(`${colors.red}  - [Error] Failed to upgrade ${dep}, skipping.${colors.reset}`);
        }
      }
    }
  }

  const nextManifest = await readManifest(target.packageJsonPath);
  const pinnedRangeChanges = applyPinnedDependencyRanges(target, nextManifest);
  const overrideChanges = normalizePnpmOverrides(nextManifest);

  if (pinnedRangeChanges.length > 0 || overrideChanges.length > 0) {
    hasChanges = true;
    await rewriteManifest(target.packageJsonPath, nextManifest, options.dryRun);
    if (pinnedRangeChanges.length > 0) console.log(`${colors.green}  - Reapplied ${pinnedRangeChanges.length} pinned dependency range(s).${colors.reset}`);
    if (overrideChanges.length > 0) console.log(`${colors.green}  - Normalized ${overrideChanges.length} pnpm override(s).${colors.reset}`);
  }

  // 4. 智能过滤无意义的工作 (Smart Diff)
  if (hasChanges) {
    await runPnpmCommand(['install', '--lockfile-only']);
  } else {
    console.log(`${colors.green}  - Smart Diff: No changes detected, skipping install.${colors.reset}`);
  }
}

// ... [Rust 解析与帮助函数保持不变] ...
function isRustDependencySection(sectionName) { return RUST_DEPENDENCY_FIELDS.some((field) => sectionName === field || sectionName.endsWith(`.${field}`)); }
function getRustDependencyField(sectionName) { return (RUST_DEPENDENCY_FIELDS.find((field) => sectionName === field || sectionName.endsWith(`.${field}`)) ?? 'dependencies'); }

function collectRustDependencyEntries(manifestText) {
  const lines = manifestText.split(/\r?\n/);
  const dependencyEntries = [];
  let currentSectionName = '';
  for (const [lineIndex, line] of lines.entries()) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const sectionMatch = trimmedLine.match(/^\[(.+)\]$/);
    if (sectionMatch) { currentSectionName = sectionMatch[1].trim(); continue; }
    if (!isRustDependencySection(currentSectionName)) continue;

    const stringDependencyMatch = line.match(/^(\s*)([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"(\s*(#.*)?)?$/);
    if (stringDependencyMatch) {
      dependencyEntries.push({
        lineIndex, dependencyName: stringDependencyMatch[2], crateName: stringDependencyMatch[2], section: currentSectionName, versionSpec: stringDependencyMatch[3],
        updateLine(nextVersionSpec) { return `${stringDependencyMatch[1] ?? ''}${stringDependencyMatch[2]} = "${nextVersionSpec}"${stringDependencyMatch[4] ?? ''}`; },
      });
      continue;
    }

    const inlineTableMatch = line.match(/^(\s*)([A-Za-z0-9_-]+)\s*=\s*\{(.*)\}(\s*(#.*)?)?$/);
    if (!inlineTableMatch) continue;
    const packageNameMatch = inlineTableMatch[3].match(/\bpackage\s*=\s*"([^"]+)"/);
    const versionMatch = inlineTableMatch[3].match(/\bversion\s*=\s*"([^"]+)"/);
    if (!versionMatch) continue;
    dependencyEntries.push({
      lineIndex, dependencyName: inlineTableMatch[2], crateName: packageNameMatch?.[1] ?? inlineTableMatch[2], section: currentSectionName, versionSpec: versionMatch[1],
      updateLine(nextVersionSpec) { return line.replace(versionMatch[0], versionMatch[0].replace(versionMatch[1], nextVersionSpec)); },
    });
  }
  return dependencyEntries;
}

function collectRustDependencyCounts(dependencyEntries) {
  return dependencyEntries.reduce((counts, entry) => { counts[getRustDependencyField(entry.section)] += 1; return counts; }, { dependencies: 0, 'dev-dependencies': 0, 'build-dependencies': 0 });
}

function describeRustCounts(counts) { return RUST_DEPENDENCY_FIELDS.filter((field) => counts[field] > 0).map((field) => `${field}:${counts[field]}`).join(', '); }
function buildRustDependencyKey(entry) { return `${entry.section}:${entry.dependencyName}`; }

function collectRustRangeChanges(beforeEntries, afterEntries) {
  const beforeEntriesByKey = new Map(beforeEntries.map((e) => [buildRustDependencyKey(e), e]));
  const afterEntriesByKey = new Map(afterEntries.map((e) => [buildRustDependencyKey(e), e]));
  const dependencyKeys = Array.from(new Set([...beforeEntriesByKey.keys(), ...afterEntriesByKey.keys()])).sort();
  const changes = [];
  for (const key of dependencyKeys) {
    const beforeEntry = beforeEntriesByKey.get(key);
    const afterEntry = afterEntriesByKey.get(key);
    if (beforeEntry?.versionSpec !== afterEntry?.versionSpec) {
      changes.push({ section: beforeEntry?.section ?? afterEntry?.section ?? 'dependencies', dependencyName: beforeEntry?.dependencyName ?? afterEntry?.dependencyName ?? key, crateName: beforeEntry?.crateName ?? afterEntry?.crateName ?? key, beforeRange: beforeEntry?.versionSpec, afterRange: afterEntry?.versionSpec });
    }
  }
  return changes;
}

function formatRustChange(change) { return `${change.dependencyName === change.crateName ? change.dependencyName : `${change.dependencyName} => ${change.crateName}`} (${getRustDependencyField(change.section)}) ${change.beforeRange ?? '<missing>'} -> ${change.afterRange ?? '<removed>'}`; }

function parseSimpleRustVersion(version) {
  const match = `${version}`.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]+)?$/);
  return match ? { major: Number.parseInt(match[1], 10), minor: Number.parseInt(match[2], 10), patch: Number.parseInt(match[3], 10), raw: match[0] } : null;
}

function compareSimpleRustVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function isCompatibleRustVersion(current, candidate) {
  if (current.major === 0) return candidate.major === 0 && candidate.minor === current.minor;
  return candidate.major === current.major;
}

function buildLatestRustVersionSpec(currentSpec, nextVersion) {
  const match = currentSpec.trim().match(/^([~^=]?)(\d+(?:\.\d+)*(?:-[0-9A-Za-z.+-]+)?)$/);
  return match ? `${match[1]}${nextVersion}` : null;
}

async function fetchLatestCompatibleCrateVersion(crateName, currentSpec, cache) {
  const match = `${currentSpec}`.trim().match(/^[~^=]?(\d+\.\d+\.\d+|\d+\.\d+|\d+)$/);
  if (!match) return null;
  const currentVersionText = match[1].split('.').concat(['0', '0']).slice(0, 3).join('.');
  const currentVersion = parseSimpleRustVersion(currentVersionText);
  if (!currentVersion) return null;

  const cacheKey = `${crateName}@${currentVersion.major}.${currentVersion.minor}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const response = await fetch(`${CRATES_IO_API_ROOT}/${encodeURIComponent(crateName)}/versions`, { headers: { 'user-agent': CRATES_IO_USER_AGENT, accept: 'application/json' } });
  if (!response.ok) throw new Error(`Unable to query crates.io for ${crateName}: HTTP ${response.status}`);

  const payload = await response.json();
  const latestVersion = (payload?.versions ?? [])
    .filter((v) => v?.yanked !== true)
    .map((v) => ({ raw: typeof v?.num === 'string' ? v.num.trim() : '', parsed: parseSimpleRustVersion(v?.num) }))
    .filter((v) => v.raw.length > 0 && v.parsed && !v.raw.includes('-') && isCompatibleRustVersion(currentVersion, v.parsed))
    .sort((left, right) => compareSimpleRustVersions(right.parsed, left.parsed))[0]?.raw ?? null;

  if (typeof latestVersion !== 'string' || latestVersion.trim().length === 0) return null;
  cache.set(cacheKey, latestVersion.trim());
  return latestVersion.trim();
}

async function collectPackageJsonPaths(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const packageJsonPaths = [];
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) packageJsonPaths.push(...(await collectPackageJsonPaths(entryPath)));
    } else if (entry.isFile() && entry.name === MANIFEST_FILENAME) {
      packageJsonPaths.push(entryPath);
    }
  }
  return packageJsonPaths;
}

function normalizeTargetFilter(targetFilter) { return `${targetFilter}`.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''); }

function filterTargetsByCliArgs(targets, cliArgs) {
  if (cliArgs.targets.length === 0) return targets;
  const normalizedFilters = cliArgs.targets.map(normalizeTargetFilter);
  return targets.filter((target) => {
    const normalizedLabel = normalizeTargetFilter(target.packageJsonLabel);
    const normalizedDirectory = normalizeTargetFilter(path.relative(ROOT_DIR, target.dir) || '.');
    return normalizedFilters.some((filter) => filter === normalizedLabel || filter === normalizedDirectory || normalizedLabel.endsWith(`/${filter}`) || normalizedDirectory.endsWith(`/${filter}`));
  });
}

async function discoverTargets(packageManager) {
  const packageJsonPaths = await collectPackageJsonPaths(ROOT_DIR);
  const targets = [];
  const lockfileName = packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
  for (const packageJsonPath of packageJsonPaths.sort()) {
    const manifest = await readManifest(packageJsonPath);
    const dependencyNames = collectDependencyNames(manifest);
    if (dependencyNames.length === 0) continue;
    const directoryPath = path.dirname(packageJsonPath);
    targets.push({
      dir: directoryPath, packageJsonPath, packageJsonLabel: path.relative(ROOT_DIR, packageJsonPath) || MANIFEST_FILENAME, lockfilePath: path.join(directoryPath, lockfileName),
      dependencyNames, dependencyCounts: collectDependencyCounts(manifest), beforeSnapshot: cloneDependencySnapshot(manifest), beforeOverrideSnapshot: cloneOverrideSnapshot(manifest),
    });
  }
  return targets;
}

async function discoverRustTarget() {
  const backendDirectoryPath = path.join(ROOT_DIR, BACKEND_DIRNAME);
  const cargoManifestPath = path.join(backendDirectoryPath, CARGO_MANIFEST_FILENAME);
  if (!existsSync(cargoManifestPath)) return null;
  const manifestText = await readFile(cargoManifestPath, 'utf8');
  const dependencyEntries = collectRustDependencyEntries(manifestText);
  return { dir: backendDirectoryPath, cargoManifestPath, cargoManifestLabel: path.relative(ROOT_DIR, cargoManifestPath) || CARGO_MANIFEST_FILENAME, cargoLockPath: path.join(backendDirectoryPath, CARGO_LOCK_FILENAME), dependencyEntries, dependencyCounts: collectRustDependencyCounts(dependencyEntries), beforeManifestText: manifestText };
}

async function runRustUpgrade(target, options = {}) {
  const newline = target.beforeManifestText.includes('\r\n') ? '\r\n' : '\n';
  const manifestLines = target.beforeManifestText.split(/\r?\n/);
  const latestVersionCache = new Map();
  let updatedRangeCount = 0;
  let skippedRangeCount = 0;

  for (const entry of target.dependencyEntries) {
    const latestVersion = await fetchLatestCompatibleCrateVersion(entry.crateName, entry.versionSpec, latestVersionCache);
    if (!latestVersion) { skippedRangeCount += 1; continue; }
    const nextVersionSpec = buildLatestRustVersionSpec(entry.versionSpec, latestVersion);
    if (!nextVersionSpec || nextVersionSpec === entry.versionSpec) { skippedRangeCount += 1; continue; }

    manifestLines[entry.lineIndex] = entry.updateLine(nextVersionSpec);
    updatedRangeCount += 1;
  }

  // 4. Smart Diff
  if (updatedRangeCount > 0) {
    if (!options.dryRun) await writeFile(target.cargoManifestPath, manifestLines.join(newline));
    console.log(`${colors.green}  - Updated ${updatedRangeCount} Cargo.toml dependency ranges.${colors.reset}`);
    const args = ['update'];
    printAction(target.dir, 'cargo', args, options.dryRun);
    await executeCommand(target.dir, CARGO_COMMAND, args, `cargo for ${target.cargoManifestLabel}`, options.dryRun);
  } else {
    console.log(`${colors.green}  - Smart Diff: Cargo.toml ranges are already current, skipping cargo update.${colors.reset}`);
  }

  if (skippedRangeCount > 0) console.log(`  - Skipped ${skippedRangeCount} Cargo dependency entries with unsupported syntax.`);
}

async function verifyTarget(target, packageManager, dryRun) {
  if (dryRun) {
    console.log(`${colors.yellow}[dry-run ok] ${target.packageJsonLabel} -> Verification skipped during dry-run.${colors.reset}`);
    return;
  }
  
  const nextManifest = await readManifest(target.packageJsonPath);
  const changedRanges = collectRangeChanges(target.beforeSnapshot, nextManifest);
  const changedOverrides = collectOverrideChanges(target.beforeOverrideSnapshot, nextManifest);
  const lockfileExists = existsSync(target.lockfilePath) || existsSync(path.join(ROOT_DIR, 'package-lock.json'));
  const lockfileName = packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';

  console.log(`${colors.green}[ok] ${target.packageJsonLabel} -> ${target.dependencyNames.length} dependencies inspected, ${changedRanges.length} updated, ${changedOverrides.length} override fixes, lockfile: ${lockfileExists ? 'Updated' : 'Missing'}${colors.reset}`);

  if (changedRanges.length > 0) {
    const preview = changedRanges.slice(0, 10).map(formatChange);
    preview.forEach((line) => console.log(`  - ${line}`));
    if (changedRanges.length > preview.length) console.log(`  - ... ${changedRanges.length - preview.length} more`);
  }
}

async function verifyRustTarget(target, dryRun) {
  if (dryRun) return;
  const nextManifestText = await readFile(target.cargoManifestPath, 'utf8');
  const nextDependencyEntries = collectRustDependencyEntries(nextManifestText);
  const changedRanges = collectRustRangeChanges(target.dependencyEntries, nextDependencyEntries);
  const lockfileExists = existsSync(target.cargoLockPath);
  console.log(`${colors.green}[ok] ${target.cargoManifestLabel} -> ${target.dependencyEntries.length} dependencies inspected, ${changedRanges.length} updated, lockfile: ${lockfileExists ? 'Updated' : 'Missing'}${colors.reset}`);
}

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  printHeader(cliArgs.repairOnly ? 'Repair Dependabot Dependency State' : 'Upgrade Package Dependencies For Dependabot');

  const packageManager = await getPackageManager();
  const jsTargets = await discoverTargets(packageManager);
  const filteredJsTargets = filterTargetsByCliArgs(jsTargets, cliArgs);
  const rustTarget = await discoverRustTarget();
  const includeRustTarget = !cliArgs.repairOnly && rustTarget;
  const totalTargets = filteredJsTargets.length + (includeRustTarget ? 1 : 0);

  if (totalTargets === 0) throw new Error(cliArgs.targets.length > 0 ? `No target matched: ${cliArgs.targets.join(', ')}` : 'No valid manifests found.');

  console.log(`Repository root: ${ROOT_DIR}`);
  console.log(`Package Manager: ${packageManager}`);
  console.log(`Targets: ${totalTargets}`);
  console.log(`Mode: ${cliArgs.repairOnly ? 'repair-only' : 'upgrade'} ${cliArgs.dryRun ? colors.yellow + '(DRY RUN ACTIVATED)' + colors.reset : ''}`);
  
  for (const [index, target] of filteredJsTargets.entries()) {
    printSection(index + 1, totalTargets, `${cliArgs.repairOnly ? 'repair' : 'upgrade'} ${target.packageJsonLabel}`);
    await runJsUpgrade(target, cliArgs, packageManager);
    await verifyTarget(target, packageManager, cliArgs.dryRun);
  }

  if (includeRustTarget) {
    printSection(filteredJsTargets.length + 1, totalTargets, `upgrade ${rustTarget.cargoManifestLabel}`);
    await runRustUpgrade(rustTarget, cliArgs);
    await verifyRustTarget(rustTarget, cliArgs.dryRun);
  }

  console.log(`\n${colors.green}Done.${colors.reset}`);
}

main().catch((error) => {
  console.error(`\n${colors.red}[failed] ${error.message}${colors.reset}`);
  process.exitCode = 1;
});