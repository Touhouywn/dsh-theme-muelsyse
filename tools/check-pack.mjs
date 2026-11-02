#!/usr/bin/env node
// muelsyse-theme-pack v0.1.0 — pack self-check.
//
//   node tools/check-pack.mjs
//   node --experimental-vm-modules tools/check-pack.mjs   # full JS syntax check, no child processes
//
// Why this exists: smoke-check.mjs (the DSH-side harness) expects a dsh-home
// layout (<home>/themes, <home>/plugins). This pack is an install *source*
// (theme/, plugins/), so it cannot be passed as --dsh-home directly. This
// checker validates the pack as shipped instead:
//   1. VERSION + package.json versions;
//   2. every JSON file parses;
//   3. every .js / .mjs file parses as a script or as a module;
//   4. clip assets: 96 .ogg + refs/*.wav, catalog <-> disk agreement;
//   5. intents: 5 groups / 29 intents;
//   6. pet exe present and looks like a PE binary;
//   7. no non-runtime leftovers (backups, locks, node_modules, _work, .git...).
//
// Exit code: 0 all good, 1 at least one FAIL.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failed = 0;

const EXPECT = {
  packVersion: 'v0.1.0',
  theme: '0.1.0',
  voice: '0.2.0',
  persona: '0.1.0',
  hub: '0.1.0',
  clips: 96,
  groups: 5,
  intents: 29,
};

function record(ok, label, detail) {
  results.push({ ok, label, detail });
  if (ok === false) failed++;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- 1. version
const versionFile = path.join(ROOT, 'VERSION');
if (fs.existsSync(versionFile)) {
  const text = fs.readFileSync(versionFile, 'utf8').trim();
  record(text === EXPECT.packVersion, 'VERSION', `"${text}" (want ${EXPECT.packVersion})`);
} else {
  record(false, 'VERSION', 'missing');
}

const units = [
  ['theme', 'theme/muelsyse'],
  ['voice', 'plugins/muelsyse-voice'],
  ['persona', 'plugins/muelsyse-persona'],
  ['hub', 'plugins/muelsyse-hub'],
];
for (const [key, dir] of units) {
  const pkgPath = path.join(ROOT, dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    record(false, `package.json ${key}`, `missing ${dir}/package.json`);
    continue;
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    record(false, `package.json ${key}`, `unparsable: ${err.message}`);
    continue;
  }
  record(
    pkg.version === EXPECT[key],
    `package.json ${key}`,
    `${pkg.name}@${pkg.version} (want ${EXPECT[key]})`,
  );
}

// ------------------------------------------------------------------ 2. JSON
const jsonFiles = [...walk(path.join(ROOT, 'theme')), ...walk(path.join(ROOT, 'plugins'))]
  .filter((f) => f.endsWith('.json'));
let jsonBad = 0;
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    jsonBad++;
    record(false, 'json', `${rel(f)}: ${err.message}`);
  }
}
if (!jsonBad) record(true, 'json', `${jsonFiles.length} files parsed`);

// -------------------------------------------------------------- 3. JS parse
const canModule = typeof vm.SourceTextModule === 'function';
let spawnBlocked = false;

function parseInVm(file) {
  const src = fs.readFileSync(file, 'utf8');
  const opts = { identifier: rel(file) };
  if (canModule) {
    try {
      new vm.SourceTextModule(src, opts);
      return 'esm';
    } catch (errModule) {
      try {
        new vm.Script(src, { filename: opts.identifier });
        return 'cjs';
      } catch (errScript) {
        // module parse is the stricter message for ESM-looking files
        throw new Error(`module: ${errModule.message}`);
      }
    }
  }
  new vm.Script(src, { filename: opts.identifier });
  return 'cjs';
}

function parseWithNodeCheck(file) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  return 'checked';
}

const jsFiles = [...walk(path.join(ROOT, 'theme')), ...walk(path.join(ROOT, 'plugins'))]
  .filter((f) => /\.(js|mjs|cjs)$/.test(f));
const jsOk = [];
const jsBad = [];
const jsSkipped = [];
for (const f of jsFiles) {
  try {
    jsOk.push(`${rel(f)}:${parseInVm(f)}`);
    continue;
  } catch (vmErr) {
    if (!canModule) {
      try {
        jsOk.push(`${rel(f)}:${parseWithNodeCheck(f)}`);
        continue;
      } catch (nodeErr) {
        if (nodeErr.code === 'EPERM' || nodeErr.code === 'ENOENT') {
          spawnBlocked = true;
          jsSkipped.push(rel(f));
          continue;
        }
        jsBad.push(`${rel(f)}: ${(nodeErr.stderr?.toString() || nodeErr.message).trim()}`);
        continue;
      }
    }
    jsBad.push(`${rel(f)}: ${vmErr.message}`);
  }
}
if (jsBad.length) {
  for (const bad of jsBad) record(false, 'js syntax', bad);
} else {
  const mode = canModule ? 'vm module/script' : spawnBlocked ? 'partial (no vm modules, spawn blocked)' : 'node --check';
  record(
    true,
    'js syntax',
    `${jsOk.length}/${jsFiles.length} parsed via ${mode}` +
      (jsSkipped.length ? `; skipped ${jsSkipped.length} (run with --experimental-vm-modules)` : ''),
  );
}

// ---------------------------------------------------------------- 4. clips
const assets = path.join(ROOT, 'plugins/muelsyse-voice/assets');
const clipsDir = path.join(assets, 'clips');
const refsDir = path.join(clipsDir, 'refs');
const clipFiles = fs.existsSync(clipsDir)
  ? fs.readdirSync(clipsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ogg'))
      .map((e) => e.name)
  : [];
record(clipFiles.length === EXPECT.clips, 'clips', `${clipFiles.length} .ogg (want ${EXPECT.clips})`);

const refWavs = fs.existsSync(refsDir) ? fs.readdirSync(refsDir).filter((n) => n.endsWith('.wav')) : [];
record(refWavs.length >= 1, 'clip refs', `${refWavs.length} wav: ${refWavs.join(', ') || 'none'}`);

let catalog = null;
try {
  catalog = JSON.parse(fs.readFileSync(path.join(assets, 'catalog.json'), 'utf8'));
  record(Array.isArray(catalog.clips) && catalog.clips.length === EXPECT.clips, 'catalog slices', `${catalog.clips?.length} entries (want ${EXPECT.clips})`);
} catch (err) {
  record(false, 'catalog slices', `unreadable: ${err.message}`);
}

if (catalog?.clips?.length) {
  const missing = catalog.clips.filter((c) => !fs.existsSync(path.join(assets, c.file)));
  record(missing.length === 0, 'catalog -> disk', missing.length ? `missing ${missing.length}: ${missing.slice(0, 5).map((c) => c.file).join(', ')}` : 'every catalog file exists');
  const onDisk = new Set(clipFiles);
  const unlisted = clipFiles.filter((n) => !catalog.clips.some((c) => path.basename(c.file) === n));
  record(unlisted.length === 0, 'disk -> catalog', unlisted.length ? `unlisted: ${unlisted.slice(0, 5).join(', ')}` : `all ${onDisk.size} clips listed`);
}

// -------------------------------------------------------------- 5. intents
try {
  const intents = JSON.parse(fs.readFileSync(path.join(assets, 'intents.json'), 'utf8'));
  const groups = Object.keys(intents.groups || {});
  const list = intents.intents;
  const count = Array.isArray(list) ? list.length : Object.keys(list || {}).length;
  record(
    groups.length === EXPECT.groups && count === EXPECT.intents,
    'intents',
    `${groups.length} groups / ${count} intents (want ${EXPECT.groups}/${EXPECT.intents})`,
  );
} catch (err) {
  record(false, 'intents', `unreadable: ${err.message}`);
}

// ------------------------------------------------------------------ 6. pet
const petExe = path.join(ROOT, 'pet/dsh-pet-standalone-webm-chat.exe');
if (fs.existsSync(petExe)) {
  const size = fs.statSync(petExe).size;
  const head = fs.readFileSync(petExe, { encoding: null, flag: 'r' }).subarray(0, 2).toString('latin1');
  record(head === 'MZ' && size > 1_000_000, 'pet exe', `${(size / 1024 / 1024).toFixed(2)} MiB, PE magic ${head === 'MZ' ? 'ok' : 'missing'}`);
} else {
  record(false, 'pet exe', 'missing pet/dsh-pet-standalone-webm-chat.exe');
}

// ------------------------------------------------------------- 7. leftovers
const BAD_NAME = [
  /\.bak/i,
  /\.lock$/i,
  /^\.dsh-ops-update-/i,
  /\.tmp$/i,
  /\.swp$/i,
  /~$/,
];
const BAD_DIR = new Set(['voicekit', 'backups', 'node_modules', '_work', '.git', '__pycache__']);
const leftovers = [];
for (const f of walk(ROOT)) {
  const r = rel(f);
  // <root>/.git is this pack's own repository metadata, not shipped payload.
  if (r === '.git' || r.startsWith('.git/')) continue;
  const name = path.basename(f);
  const parts = r.split('/');
  if (parts.some((p) => BAD_DIR.has(p) || /^SoVITS/i.test(p))) leftovers.push(r);
  else if (BAD_NAME.some((re) => re.test(name))) leftovers.push(r);
}
record(leftovers.length === 0, 'non-runtime leftovers', leftovers.length ? `${leftovers.length}: ${leftovers.slice(0, 8).join(', ')}` : 'none (repo .git excluded)');

// ------------------------------------------------------------------ summary
let totalBytes = 0;
let repoBytes = 0;
for (const f of walk(ROOT)) {
  const size = fs.statSync(f).size;
  totalBytes += size;
  if (rel(f).startsWith('.git/')) repoBytes += size;
}
const parts = {};
for (const [key, dir] of [...units, ['pet', 'pet']]) {
  let sum = 0;
  let n = 0;
  for (const f of walk(path.join(ROOT, dir))) {
    sum += fs.statSync(f).size;
    n++;
  }
  parts[key] = { mb: (sum / 1024 / 1024).toFixed(2), files: n };
}

console.log(`pack root: ${ROOT}`);
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${r.label.padEnd(22)} ${r.detail}`);
}
console.log('');
const payload = totalBytes - repoBytes;
console.log(`size: payload ${(payload / 1024 / 1024).toFixed(2)} MiB (repo .git ${(repoBytes / 1024 / 1024).toFixed(2)} MiB, dir total ${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
for (const [k, v] of Object.entries(parts)) console.log(`  ${k.padEnd(8)} ${v.mb} MiB (${v.files} files)`);
console.log('');
console.log(failed ? `${failed} check(s) FAILED` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
