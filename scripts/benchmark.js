#!/usr/bin/env node
/**
 * EnvGuard Benchmark Script
 *
 * Fetches N real GitHub repositories, runs the EnvGuard scanner against each,
 * and produces a detailed statistics report.
 *
 * Usage:
 *   node scripts/benchmark.js [options]
 *
 * Options:
 *   --count, -n      Number of repos to SUCCESSFULLY scan (default: 20)
 *   --lang           Language filter: js, python, ruby, all (default: all)
 *   --min-stars      Minimum star count (default: 100)
 *   --output         Output file for JSON results (default: benchmark-results.json)
 *   --token          GitHub personal access token (or set GITHUB_TOKEN env var)
 *   --no-clone       Skip cloning — only fetch file tree via API (slower, no token needed)
 *   --keep           Keep cloned repos after scan (default: delete them)
 *   --verbose        Print per-file details
 *
 * Example:
 *   GITHUB_TOKEN=ghp_xxx node scripts/benchmark.js --count 30 --lang js
 */

'use strict';

const { spawnSync } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const https = require('https');

// ── Resolve scanner from sibling package ─────────────────────────────────────
const SCANNER_PATH = path.resolve(__dirname, '../packages/cli/src/scanner/index.js');

if (!fs.existsSync(SCANNER_PATH)) {
  console.error('ERROR: Cannot find packages/cli/src/scanner/index.js');
  console.error('Run this script from the repo root: node scripts/benchmark.js');
  process.exit(1);
}

const { scanDirectory, uniqueVarNames } = require(SCANNER_PATH);

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = parseArgs(process.argv.slice(2));
const COUNT     = parseInt(args.count || args.n || '20', 10);
const LANG      = (args.lang || 'all').toLowerCase();
const MIN_STARS = parseInt(args['min-stars'] || '100', 10);
const OUTPUT    = args.output || 'benchmark-results.json';
const TOKEN     = args.token || process.env.GITHUB_TOKEN || '';
const KEEP      = Boolean(args.keep);
const VERBOSE   = Boolean(args.verbose);
const NO_CLONE  = Boolean(args['no-clone']);

// ── Dynamic access pattern catalog ───────────────────────────────────────────
// These explain WHY a pattern can't be auto-documented
const DYNAMIC_CATEGORIES = [
  {
    id:      'computed_variable',
    label:   'Computed variable key',
    example: 'process.env[varName]',
    why:     'Key is a runtime variable — value unknown at static analysis time',
    patterns: [
      /process\.env\[([a-z_$][a-zA-Z0-9_$]*)\]/,
      /os\.environ\[([a-z_$][a-zA-Z0-9_$]*)\]/,
      /\bENV\[([a-z_$][a-zA-Z0-9_$]*)\]/,
    ],
  },
  {
    id:      'template_literal',
    label:   'Template literal key',
    example: 'process.env[`${prefix}_KEY`]',
    why:     'Key is constructed at runtime from a template — infinite possible names',
    patterns: [
      /process\.env\[`[^`]*\$\{/,
      /os\.environ\[f['"][^'"]*\{/,
    ],
  },
  {
    id:      'function_call',
    label:   'Function call key',
    example: 'process.env[getKey()]',
    why:     'Key is the return value of a function — requires full program analysis',
    patterns: [
      /process\.env\[[a-zA-Z_$][a-zA-Z0-9_$.]*\([^)]*\)\]/,
      /os\.environ\[[a-zA-Z_$][a-zA-Z0-9_$.]*\([^)]*\)\]/,
    ],
  },
  {
    id:      'property_access',
    label:   'Property/index access key',
    example: 'process.env[config.key]  or  process.env[keys[i]]',
    why:     'Key comes from an object or array — requires data flow analysis',
    patterns: [
      /process\.env\[[a-zA-Z_$][a-zA-Z0-9_$.]*\.[a-zA-Z_$][a-zA-Z0-9_$]*\]/,
      /process\.env\[[^\]]*\[[^\]]*\]\]/,
    ],
  },
  {
    id:      'spread_destructure',
    label:   'Spread / destructure',
    example: 'const { DB_URL } = process.env',
    why:     'Destructuring does not produce a scannable process.env.VAR reference',
    patterns: [
      /const\s*\{[^}]+\}\s*=\s*process\.env/,
      /let\s*\{[^}]+\}\s*=\s*process\.env/,
    ],
  },
];

// ── GitHub search queries per language ───────────────────────────────────────
const QUERIES = {
  js:     ['language:JavaScript', 'language:TypeScript'],
  python: ['language:Python'],
  ruby:   ['language:Ruby'],
  all:    ['language:JavaScript', 'language:TypeScript', 'language:Python', 'language:Ruby'],
};

const LANG_EXTENSIONS = {
  'JavaScript': ['.js', '.jsx', '.mjs', '.cjs'],
  'TypeScript': ['.ts', '.tsx'],
  'Python':     ['.py'],
  'Ruby':       ['.rb'],
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║     EnvGuard Benchmark — Real-World Scan   ║');
  console.log('╚════════════════════════════════════════════╝\n');

  if (!TOKEN) {
    console.warn('⚠  No GITHUB_TOKEN set. GitHub API rate limit: 60 req/hour.');
    console.warn('   Set GITHUB_TOKEN=ghp_xxx to get 5000 req/hour.\n');
  }

  if (COUNT > 100) {
    console.warn(`⚠  --count ${COUNT} is large. Cloning alone will take ~${Math.round(COUNT * 12 / 60)} minutes.\n`);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-bench-'));

  // Lazy candidate pool — fetch one page of 30 at a time, only when needed.
  // Avoids firing 50+ Search API calls upfront which triggers secondary rate limits.
  const pool     = [];
  const seen     = new Set();
  let   poolPage = 1;
  let   poolDone = false;
  const queries  = QUERIES[LANG] || QUERIES.all;
  let   queryIdx = 0;

  async function refillPool() {
    if (poolDone) return;
    const q     = queries[queryIdx % queries.length];
    const batch = await searchGitHub(q, MIN_STARS, 30, poolPage);
    poolPage++;
    if (batch.length < 30) {
      queryIdx++;    // exhausted this query — move to next language
      poolPage = 1;
      if (queryIdx >= queries.length) { poolDone = true; return; }
    }
    for (const r of batch) {
      if (!seen.has(r.full_name)) { seen.add(r.full_name); pool.push(r); }
    }
    await sleep(2200); // 2.2s between Search API pages avoids secondary rate limit
  }

  console.log(`🔍 Fetching candidates from GitHub (lang: ${LANG}, min-stars: ${MIN_STARS})...`);
  try { await refillPool(); } catch (e) { console.warn(`   Search fetch warning: ${e.message}`); }
  console.log(`   Got first batch. Scanning until ${COUNT} repos succeed.\n`);

  // ── Scan loop: keep going until COUNT successes ───────────────────────────
  const results  = [];   // successful scans only
  const skipped  = [];   // too large, clone failed, etc.
  let   poolIdx  = 0;

  while (results.length < COUNT) {
    // Refill pool when running low (keep at least 5 ahead)
    if (poolIdx >= pool.length - 5 && !poolDone) {
      try { await refillPool(); } catch (e) { /* transient network error — keep going with what we have */ }
    }
    if (poolIdx >= pool.length) {
      console.warn('\nRan out of candidates. Try lowering --min-stars.');
      break;
    }
    const repo = pool[poolIdx++];
    const n    = results.length + 1;

    process.stdout.write(
      `[${String(n).padStart(2)}/${COUNT}] ${repo.full_name.padEnd(48)}`
    );

    let result;
    try {
      result = await scanRepo(repo, tmpBase);
    } catch (err) {
      // Distingush skippable failures from unexpected errors
      const isSkippable = err.message.includes('too large') ||
                          err.message.includes('Clone failed') ||
                          err.message.includes('timeout') ||
                          err.message.includes('socket hang up') ||
                          err.message.includes('ECONNRESET') ||
                          err.message.includes('ECONNREFUSED') ||
                          err.message.includes('ETIMEDOUT') ||
                          err.message.includes('network');

      if (isSkippable) {
        process.stdout.write(`⏭  SKIP  ${err.message.slice(0, 50)}\n`);
        skipped.push({ repo: repo.full_name, reason: err.message });
        continue;   // ← doesn't count toward total
      }

      // Non-skippable (API errors, etc.) — still count as attempted, stop loop
      process.stdout.write(`✗  ERROR ${err.message.slice(0, 50)}\n`);
      skipped.push({ repo: repo.full_name, reason: err.message });
      continue;
    }

    const dynamicSummary = result.dynamicRefs.length > 0
      ? `  ⚡ ${result.dynamicRefs.length} dynamic`
      : '';
    const status = result.totalVars > 0
      ? `✓  ${String(result.totalVars).padStart(3)} vars${dynamicSummary}`
      : '✓  no env vars';

    process.stdout.write(`${status}\n`);

    if (VERBOSE) {
      for (const v of result.staticVars.slice(0, 4)) {
        console.log(`       ${v.name.padEnd(30)} ${v.file}:${v.line}`);
      }
      if (result.staticVars.length > 4) {
        console.log(`       ...and ${result.staticVars.length - 4} more static`);
      }
      for (const d of result.dynamicRefs.slice(0, 2)) {
        console.log(`       ⚡ ${d.category.padEnd(24)} ${d.file}:${d.line}  →  ${d.sourceLine.trim().slice(0, 60)}`);
      }
    }

    results.push(result);
  }

  if (skipped.length > 0) {
    console.log(`\n   Skipped ${skipped.length} repos (too large / clone failed) — not counted in total`);
  }

  // Cleanup
  if (!KEEP) {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } else {
    console.log(`\n  Cloned repos kept at: ${tmpBase}`);
  }

  // ── Build stats & report ──────────────────────────────────────────────────
  const stats = buildStats(results, skipped);
  printReport(stats, results, skipped);

  fs.writeFileSync(OUTPUT, JSON.stringify({
    meta: {
      generatedAt:    new Date().toISOString(),
      reposSuccessful: results.length,
      reposSkipped:   skipped.length,
      langFilter:     LANG,
      minStars:       MIN_STARS,
    },
    stats,
    repos:   results,
    skipped,
  }, null, 2));

  console.log(`\n💾 Full results written to ${OUTPUT}\n`);
}

// ── Repo fetching ─────────────────────────────────────────────────────────────
async function fetchRepos(count, lang, minStars) {
  const queries  = QUERIES[lang] || QUERIES.all;
  const perQuery = Math.ceil(count / queries.length);
  const all      = [];
  const seen     = new Set();

  for (const q of queries) {
    // Fetch in pages of 30 (GitHub max per page)
    let page = 1;
    while (all.length < count) {
      const batch = await searchGitHub(q, minStars, Math.min(perQuery, 30), page++);
      if (batch.length === 0) break;
      for (const r of batch) {
        if (!seen.has(r.full_name)) {
          seen.add(r.full_name);
          all.push(r);
        }
      }
      if (batch.length < 30) break; // no more pages
    }
  }

  return all.slice(0, count);
}

async function searchGitHub(langQuery, minStars, perPage, page = 1) {
  const q   = encodeURIComponent(`${langQuery} stars:>=${minStars} fork:false`);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=${perPage}&page=${page}`;
  const data = await githubGet(url);
  return (data.items || []).map(r => ({
    full_name:      r.full_name,
    name:           r.name,
    clone_url:      r.clone_url,
    stars:          r.stargazers_count,
    language:       r.language,
    size_kb:        r.size,
    default_branch: r.default_branch,
  }));
}

// ── Repo scanning ─────────────────────────────────────────────────────────────
async function scanRepo(repo, tmpBase) {
  if (repo.size_kb > 50000) {
    throw new Error(`Repo too large (${Math.round(repo.size_kb / 1024)}MB)`);
  }

  if (NO_CLONE) return scanViaAPI(repo);

  const repoDir = path.join(tmpBase, repo.name + '-' + Math.random().toString(36).slice(2, 7));

  const cloneResult = spawnSync('git', [
    'clone', '--depth', '1', '--quiet', '--filter=blob:none',
    repo.clone_url, repoDir,
  ], { timeout: 60000, encoding: 'utf8' });

  if (cloneResult.status !== 0) {
    throw new Error(`Clone failed: ${(cloneResult.stderr || '').slice(0, 80)}`);
  }

  try {
    return buildRepoResult(repo, repoDir);
  } finally {
    if (!KEEP) fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function buildRepoResult(repo, repoDir) {
  const allRefs    = scanDirectory(repoDir);
  const staticRefs = allRefs.filter(r => !r.dynamic);
  const rawDynamic = allRefs.filter(r => r.dynamic);
  const varNames   = uniqueVarNames(allRefs);

  // ── Enrich dynamic refs with source line + category ──────────────────────
  const dynamicRefs = rawDynamic.map(ref => enrichDynamicRef(ref, repoDir));

  // ── Documentation check ───────────────────────────────────────────────────
  const hasEnvExample = ['.env.example', '.env.sample', '.env.template']
    .some(f => fs.existsSync(path.join(repoDir, f)));
  const hasEnvSchema = fs.existsSync(path.join(repoDir, '.env.schema'));

  return {
    repo:          repo.full_name,
    stars:         repo.stars,
    language:      repo.language,
    languagesFound: detectLanguages(repoDir),
    sizeKb:        repo.size_kb,
    totalVars:     varNames.length,
    hasEnvExample,
    hasEnvSchema,
    filesWithVars: [...new Set(staticRefs.map(r => r.file))].length,
    varNames,
    staticVars:    staticRefs.map(r => ({
      name: r.name,
      file: r.file.replace(repoDir + path.sep, ''),
      line: r.line,
    })),
    dynamicRefs,                  // ← detailed, categorised
    dynamicCount:  dynamicRefs.length,
  };
}

// ── Dynamic ref enrichment ────────────────────────────────────────────────────
function enrichDynamicRef(ref, repoDir) {
  // Read the actual source line from disk
  let sourceLine = '';
  try {
    const lines = fs.readFileSync(ref.file, 'utf8').split('\n');
    sourceLine = lines[ref.line - 1] || '';
  } catch { /* unreadable — leave empty */ }

  const category = categorizeDynamicRef(sourceLine, ref.file);

  return {
    file:       ref.file.replace(repoDir + path.sep, ''),
    line:       ref.line,
    sourceLine: sourceLine.trim(),
    category:   category.id,
    label:      category.label,
    why:        category.why,
    example:    category.example,
  };
}

function categorizeDynamicRef(sourceLine, filePath) {
  for (const cat of DYNAMIC_CATEGORIES) {
    for (const pattern of cat.patterns) {
      if (pattern.test(sourceLine)) return cat;
    }
  }
  // Fallback — unknown dynamic pattern
  return {
    id:      'unknown_dynamic',
    label:   'Unknown dynamic pattern',
    example: 'process.env[expr]',
    why:     'Expression too complex for static analysis',
  };
}

// ── API-only scan (no clone) ──────────────────────────────────────────────────
async function scanViaAPI(repo) {
  const { scanFile } = require(SCANNER_PATH);
  const treeUrl = `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`;
  const tree    = await githubGet(treeUrl);

  const supportedExts = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb'];
  const files = (tree.tree || [])
    .filter(f => f.type === 'blob' && supportedExts.some(e => f.path.endsWith(e)))
    .filter(f => !f.path.includes('node_modules') && !f.path.includes('vendor'))
    .slice(0, 100);

  const allRefs = [];
  for (const file of files) {
    try {
      const content = await githubGet(
        `https://api.github.com/repos/${repo.full_name}/contents/${file.path}`
      );
      if (content.encoding === 'base64' && content.content) {
        const source = Buffer.from(content.content, 'base64').toString('utf8');
        allRefs.push(...scanFile(file.path, source));
      }
    } catch { /* skip unreadable */ }
    await sleep(120);
  }

  const staticRefs = allRefs.filter(r => !r.dynamic);
  const rawDynamic = allRefs.filter(r => r.dynamic);
  const varNames   = uniqueVarNames(allRefs);

  // For API mode we have the source in memory — enrich inline
  const dynamicRefs = rawDynamic.map(ref => {
    const category = categorizeDynamicRef('', ref.file); // no source line in API mode
    return {
      file:       ref.file,
      line:       ref.line,
      sourceLine: '(source not available in API mode)',
      category:   category.id,
      label:      category.label,
      why:        category.why,
    };
  });

  return {
    repo:          repo.full_name,
    stars:         repo.stars,
    language:      repo.language,
    languagesFound: [{ lang: repo.language, fileCount: files.length }],
    sizeKb:        repo.size_kb,
    totalVars:     varNames.length,
    hasEnvExample: false,
    hasEnvSchema:  false,
    filesWithVars: [...new Set(staticRefs.map(r => r.file))].length,
    varNames,
    staticVars:    staticRefs.map(r => ({ name: r.name, file: r.file, line: r.line })),
    dynamicRefs,
    dynamicCount:  dynamicRefs.length,
    apiOnly:       true,
    filesChecked:  files.length,
  };
}

// ── Language detection ────────────────────────────────────────────────────────
function detectLanguages(dir) {
  const counts = {};
  function walk(d) {
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'vendor', '__pycache__'].includes(entry.name)) continue;
          walk(path.join(d, entry.name));
        } else {
          const ext = path.extname(entry.name);
          for (const [lang, exts] of Object.entries(LANG_EXTENSIONS)) {
            if (exts.includes(ext)) { counts[lang] = (counts[lang] || 0) + 1; break; }
          }
        }
      }
    } catch {}
  }
  walk(dir);
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([lang, fileCount]) => ({ lang, fileCount }));
}

// ── Statistics ────────────────────────────────────────────────────────────────
function buildStats(results, skipped) {
  const withVars   = results.filter(r => r.totalVars > 0);
  const withDoc    = results.filter(r => r.hasEnvExample || r.hasEnvSchema);
  const withSchema = results.filter(r => r.hasEnvSchema);

  const allVarCounts = withVars.map(r => r.totalVars);
  const allVarNames  = results.flatMap(r => r.varNames || []);
  const varFrequency = frequency(allVarNames);

  // Distribution buckets
  const distribution = { '0': 0, '1-5': 0, '6-15': 0, '16-30': 0, '31+': 0 };
  for (const r of results) {
    const n = r.totalVars;
    if      (n === 0)  distribution['0']++;
    else if (n <= 5)   distribution['1-5']++;
    else if (n <= 15)  distribution['6-15']++;
    else if (n <= 30)  distribution['16-30']++;
    else               distribution['31+']++;
  }

  // Language breakdown
  const byLanguage = {};
  for (const r of results) {
    const lang = r.language || 'Unknown';
    if (!byLanguage[lang]) byLanguage[lang] = { repos: 0, totalVars: 0, withVars: 0, withDoc: 0, dynamicCount: 0 };
    byLanguage[lang].repos++;
    byLanguage[lang].totalVars    += r.totalVars;
    byLanguage[lang].dynamicCount += r.dynamicCount;
    if (r.totalVars > 0)                          byLanguage[lang].withVars++;
    if (r.hasEnvExample || r.hasEnvSchema)        byLanguage[lang].withDoc++;
  }

  // ── Dynamic access detailed stats ─────────────────────────────────────────
  const allDynamicRefs  = results.flatMap(r => r.dynamicRefs || []);
  const reposWithDynamic = results.filter(r => r.dynamicCount > 0);

  // Count by category
  const dynamicByCategory = {};
  for (const ref of allDynamicRefs) {
    const cat = ref.category || 'unknown_dynamic';
    if (!dynamicByCategory[cat]) {
      dynamicByCategory[cat] = {
        id:       cat,
        label:    ref.label,
        why:      ref.why,
        example:  ref.example,
        count:    0,
        repos:    new Set(),
        examples: [],  // up to 5 real source lines
      };
    }
    dynamicByCategory[cat].count++;
    dynamicByCategory[cat].repos.add(ref.file.split('/')[0] || ref.file);
    if (dynamicByCategory[cat].examples.length < 5 && ref.sourceLine && ref.sourceLine !== '(source not available in API mode)') {
      dynamicByCategory[cat].examples.push({
        file: ref.file,
        line: ref.line,
        code: ref.sourceLine.trim().slice(0, 100),
      });
    }
  }

  // Serialize sets to counts
  const dynamicCategoryReport = Object.values(dynamicByCategory)
    .sort((a, b) => b.count - a.count)
    .map(c => ({ ...c, repoCount: c.repos.size, repos: undefined }));

  return {
    reposScanned:        results.length,
    reposSkipped:        skipped.length,
    reposWithEnvVars:    withVars.length,
    reposNoEnvVars:      results.length - withVars.length,
    reposWithAnyDoc:     withDoc.length,
    reposWithSchema:     withSchema.length,
    docCoverageRate:     pct(withDoc.length, withVars.length),
    avgVarsPerRepo:      avg(allVarCounts),
    medianVarsPerRepo:   median(allVarCounts),
    maxVarsInRepo:       Math.max(0, ...allVarCounts),
    totalUniqueVarNames: Object.keys(varFrequency).length,
    distribution,
    topVarNames: Object.entries(varFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, count]) => ({ name, count, pct: pct(count, withVars.length) })),
    byLanguage,
    dynamic: {
      totalDynamicRefs:    allDynamicRefs.length,
      reposWithDynamic:    reposWithDynamic.length,
      dynamicRate:         pct(reposWithDynamic.length, withVars.length),
      avgDynamicPerRepo:   reposWithDynamic.length
                             ? (allDynamicRefs.length / reposWithDynamic.length).toFixed(1)
                             : '0',
      byCategory:          dynamicCategoryReport,
    },
  };
}

// ── Report printing ───────────────────────────────────────────────────────────
function printReport(s, results, skipped) {
  const bar = (n, max, width = 20) => {
    const filled = Math.round((n / Math.max(max, 1)) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  };

  console.log('\n\n══════════════════════════════════════════════════════════════');
  console.log('  ENVGUARD BENCHMARK REPORT');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Overview ───────────────────────────────────────────────────────────────
  console.log('OVERVIEW');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Successfully scanned:   ${s.reposScanned}  (target: ${COUNT})`);
  console.log(`  Skipped (not counted):  ${s.reposSkipped}  (too large / clone failed)`);
  console.log(`  Repos with env vars:    ${s.reposWithEnvVars} (${pct(s.reposWithEnvVars, s.reposScanned)}%)`);
  console.log(`  Repos with ANY docs:    ${s.reposWithAnyDoc} (${s.docCoverageRate}% of repos that use env vars)`);
  console.log(`  Repos with .env.schema: ${s.reposWithSchema}`);

  // ── Env var counts ─────────────────────────────────────────────────────────
  console.log('\nENV VAR COUNTS (static references only)');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Average per repo:       ${s.avgVarsPerRepo.toFixed(1)}`);
  console.log(`  Median per repo:        ${s.medianVarsPerRepo}`);
  console.log(`  Max in a single repo:   ${s.maxVarsInRepo}`);
  console.log(`  Total unique var names: ${s.totalUniqueVarNames}`);

  // ── Distribution ───────────────────────────────────────────────────────────
  console.log('\nDISTRIBUTION (env vars per repo)');
  console.log('──────────────────────────────────────────────────────────────');
  const maxBucket = Math.max(...Object.values(s.distribution));
  for (const [label, count] of Object.entries(s.distribution)) {
    console.log(`  ${label.padEnd(6)} ${bar(count, maxBucket)}  ${count} repos`);
  }

  // ── Dynamic access — the main new section ─────────────────────────────────
  console.log('\nDYNAMIC ACCESS — PATTERNS ENVGUARD CANNOT AUTO-DOCUMENT');
  console.log('──────────────────────────────────────────────────────────────');
  const d = s.dynamic;
  console.log(`  Total dynamic references:  ${d.totalDynamicRefs}`);
  console.log(`  Repos affected:            ${d.reposWithDynamic} (${d.dynamicRate}% of repos using env vars)`);
  console.log(`  Avg dynamic refs per repo: ${d.avgDynamicPerRepo}`);

  if (d.byCategory.length === 0) {
    console.log('  (none found)\n');
  } else {
    console.log('');
    for (const cat of d.byCategory) {
      console.log(`  ┌─ ${cat.label}  [${cat.count} refs in ${cat.repoCount} repos]`);
      console.log(`  │  Pattern:  ${cat.example}`);
      console.log(`  │  Why it's hard: ${cat.why}`);
      if (cat.examples && cat.examples.length > 0) {
        console.log(`  │  Real examples from scanned repos:`);
        for (const ex of cat.examples) {
          console.log(`  │    ${ex.file}:${ex.line}`);
          console.log(`  │    → ${ex.code}`);
        }
      }
      console.log(`  └${'─'.repeat(60)}`);
      console.log('');
    }
  }

  // ── Language breakdown ─────────────────────────────────────────────────────
  console.log('BY LANGUAGE');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  Language       Repos  WithVars  WithDoc  AvgVars  Dynamic');
  for (const [lang, ld] of Object.entries(s.byLanguage).sort((a, b) => b[1].repos - a[1].repos)) {
    const avgV   = ld.withVars > 0 ? (ld.totalVars / ld.withVars).toFixed(1) : '—';
    const docP   = ld.withVars > 0 ? `${pct(ld.withDoc, ld.withVars)}%` : '—';
    const dynStr = ld.dynamicCount > 0 ? String(ld.dynamicCount) : '—';
    console.log(
      `  ${lang.padEnd(14)} ${String(ld.repos).padEnd(7)} ${String(ld.withVars).padEnd(10)}` +
      ` ${docP.padEnd(9)} ${avgV.padEnd(9)} ${dynStr}`
    );
  }

  // ── Top var names ──────────────────────────────────────────────────────────
  console.log('\nTOP 25 MOST COMMON ENV VAR NAMES (static)');
  console.log('──────────────────────────────────────────────────────────────');
  const maxCount = s.topVarNames[0]?.count || 1;
  for (const { name, count, pct: p } of s.topVarNames) {
    console.log(`  ${name.padEnd(36)} ${bar(count, maxCount, 14)}  ${count} repos (${p}%)`);
  }

  // ── Repo detail table ──────────────────────────────────────────────────────
  console.log('\nREPO DETAILS');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  Repo                                           Stars  Vars  Dyn  Doc');
  const sorted = [...results].sort((a, b) => (b.totalVars || 0) - (a.totalVars || 0));
  for (const r of sorted) {
    const flags = [
      r.hasEnvSchema  ? '✓schema'  : '',
      r.hasEnvExample ? '✓example' : '',
    ].filter(Boolean).join(' ') || '✗ none';
    const stars = String(r.stars || '?').padStart(6);
    console.log(
      `  ${r.repo.padEnd(47)} ${stars}` +
      `  ${String(r.totalVars).padStart(3)}  ${String(r.dynamicCount || 0).padStart(3)}  ${flags}`
    );
  }

  if (skipped.length > 0) {
    console.log('\nSKIPPED (not counted in totals)');
    console.log('──────────────────────────────────────────────────────────────');
    for (const s of skipped) {
      console.log(`  ${s.repo.padEnd(50)} ${s.reason.slice(0, 50)}`);
    }
  }

  // ── Key finding ────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  KEY FINDINGS (for Show HN / comparison page)');
  console.log('══════════════════════════════════════════════════════════════');
  const undocRate = (100 - parseFloat(s.docCoverageRate)).toFixed(0);
  console.log(`  ${undocRate}% of repos using env vars have NO documentation`);
  console.log(`  Average: ${s.avgVarsPerRepo.toFixed(1)} undocumented env vars per repo`);
  console.log(`  ${d.dynamicRate}% of repos also use dynamic access EnvGuard can't auto-document`);
  if (d.byCategory.length > 0) {
    console.log(`  Most common unanswerable pattern: "${d.byCategory[0].label}"`);
    console.log(`    → ${d.byCategory[0].why}`);
  }
  console.log(`  Top undocumented vars: ${s.topVarNames.slice(0, 4).map(v => v.name).join(', ')}`);
  console.log('══════════════════════════════════════════════════════════════\n');
}

// ── GitHub API helper (with retry on rate limit) ─────────────────────────────
async function githubGet(url, attempt = 1) {
  const MAX_RETRIES = 4;
  const opts = {
    headers: {
      'User-Agent': 'envguard-benchmark/0.1',
      'Accept':     'application/vnd.github+json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  };

  const { status, headers, body } = await httpGet(url, opts);

  // Rate limited — wait for reset then retry
  if (status === 403 || status === 429) {
    if (attempt > MAX_RETRIES) {
      throw new Error(`GitHub rate limit hit after ${MAX_RETRIES} retries.`);
    }
    const reset   = headers['x-ratelimit-reset'];
    const retryMs = headers['retry-after']
      ? parseInt(headers['retry-after'], 10) * 1000
      : reset
        ? Math.max((parseInt(reset, 10) * 1000) - Date.now() + 2000, 5000)
        : 60000;

    const waitSec = Math.ceil(retryMs / 1000);
    process.stdout.write(`\n   ⏳ Rate limited. Waiting ${waitSec}s (attempt ${attempt}/${MAX_RETRIES})...`);
    await sleep(retryMs);
    process.stdout.write(` retrying\n`);
    return githubGet(url, attempt + 1);
  }

  if (status >= 400) {
    throw new Error(`GitHub API ${status}: ${body.slice(0, 100)}`);
  }

  try   { return JSON.parse(body); }
  catch (e) { throw new Error(`JSON parse error: ${e.message}`); }
}

async function httpGet(url, opts, attempt = 1) {
  const MAX_NET_RETRIES = 3;
  try {
    return await new Promise((resolve, reject) => {
      const req = https.get(url, opts, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(new Error('Request timeout')); });
    });
  } catch (err) {
    if (attempt < MAX_NET_RETRIES) {
      await sleep(2000 * attempt);
      return httpGet(url, opts, attempt + 1);
    }
    throw err;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key  = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { out[key] = next; i++; }
      else                               { out[key] = true; }
    } else if (a.startsWith('-') && a.length === 2) {
      const key  = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { out[key] = next; i++; }
      else                               { out[key] = true; }
    }
  }
  return out;
}

function frequency(arr) {
  const map = {};
  for (const v of arr) map[v] = (map[v] || 0) + 1;
  return map;
}

function avg(arr)    { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function pct(n, total) { return total === 0 ? '0' : ((n / total) * 100).toFixed(1); }
function sleep(ms)     { return new Promise(r => setTimeout(r, ms)); }

// ── Run ───────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\nFATAL:', err.message);
  if (err.message.includes('rate limit')) {
    console.error('Tip: set GITHUB_TOKEN env var for 5000 req/hour instead of 60');
  }
  process.exit(1);
});
