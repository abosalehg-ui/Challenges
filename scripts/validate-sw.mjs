#!/usr/bin/env node
// ============================================================
// Service-worker asset validator — zero dependencies.
// Errors (exit 1): an ASSETS entry that doesn't exist on disk, or
// a deployable file missing from ASSETS.
// Warning: cached assets changed vs HEAD without a CACHE_NAME bump.
// ============================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swSrc = readFileSync(join(root, 'sw.js'), 'utf8');

let errors = 0;
const err = (msg) => { errors++; console.error(`❌ ${msg}`); };

const assetsMatch = swSrc.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsMatch) {
  err('could not find "const ASSETS = [...]" in sw.js');
  process.exit(1);
}
const assets = [...assetsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(a => a !== './');

// Every listed asset must exist on disk
for (const a of assets) {
  if (!existsSync(join(root, a))) err(`ASSETS entry not found on disk: ${a}`);
}

// Every deployable file must be listed (game files served to the browser)
const DEPLOY_DIRS = ['js', 'data', 'lib', 'icons'];
const DEPLOY_FILES = ['index.html', 'styles.css', 'manifest.json'];
const deployable = [...DEPLOY_FILES];
for (const dir of DEPLOY_DIRS) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs)) {
    if (statSync(join(abs, f)).isFile()) deployable.push(`${dir}/${f}`);
  }
}
const listed = new Set(assets.map(a => a.replace(/^\.\//, '')));
for (const f of deployable) {
  if (!listed.has(f)) err(`deployable file missing from ASSETS: ${f}`);
}

// Warn when cached assets changed vs HEAD but CACHE_NAME didn't
try {
  const changed = execSync('git diff --name-only HEAD', { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const cachedChanged = changed.filter(f => listed.has(f) || f === 'index.html');
  if (cachedChanged.length && !changed.includes('sw.js')) {
    console.warn(`⚠️  cached assets changed without touching sw.js (bump CACHE_NAME): ${cachedChanged.join(', ')}`);
  }
} catch {
  // not a git checkout — skip the bump check
}

if (errors) {
  console.error(`\n${errors} error(s)`);
  process.exit(1);
}
console.log(`✅ sw.js ASSETS valid — ${assets.length} entries cover ${deployable.length} deployable files`);
