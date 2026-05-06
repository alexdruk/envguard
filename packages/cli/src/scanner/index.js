const path = require('path');
const fs = require('fs');
const { scanJS } = require('./js');
const { scanPython } = require('./python');
const { scanRuby } = require('./ruby');

// File extensions → scanner function
const SCANNERS = {
  '.js': scanJS,
  '.jsx': scanJS,
  '.ts': scanJS,
  '.tsx': scanJS,
  '.mjs': scanJS,
  '.cjs': scanJS,
  '.py': scanPython,
  '.rb': scanRuby,
};

// Directories to always skip
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'env',          // Python virtual env — different from .env files
  '.env',         // could be a directory in some setups
  'coverage',
  '.nyc_output',
  'vendor',
  'tmp',
  'log',
]);

/**
 * Scans a single file and returns env var references found.
 *
 * @param {string} filePath  — absolute or relative path to file
 * @param {string} [source]  — optional: file contents (skips disk read, useful for diff scanning)
 * @returns {{ name: string, file: string, line: number, dynamic: boolean }[]}
 */
function scanFile(filePath, source) {
  const ext = path.extname(filePath).toLowerCase();
  const scanner = SCANNERS[ext];
  if (!scanner) return [];

  try {
    const content = source !== undefined ? source : fs.readFileSync(filePath, 'utf8');
    return scanner(content, filePath);
  } catch (err) {
    // Unreadable files are skipped silently — binary files, permissions issues, etc.
    return [];
  }
}

/**
 * Recursively scans a directory, returning all env var references found.
 *
 * @param {string} dir  — directory to scan
 * @param {object} [options]
 * @param {string[]} [options.ignore]  — additional glob-style patterns to skip
 * @returns {{ name: string, file: string, line: number, dynamic: boolean }[]}
 */
function scanDirectory(dir, options = {}) {
  const results = [];
  const extraIgnore = new Set(options.ignore || []);

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || extraIgnore.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SCANNERS[ext]) {
          const refs = scanFile(fullPath);
          results.push(...refs);
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Given a unified diff string (from a GitHub PR), scan only added lines.
 * Returns references found in lines beginning with '+' (excluding the +++ header).
 *
 * @param {string} diff  — raw unified diff text
 * @param {string} [filePathHint]  — override filename for reporting
 * @returns {{ name: string, file: string, line: number, dynamic: boolean }[]}
 */
function scanDiff(diff, filePathHint) {
  const results = [];
  const fileBlocks = splitDiffByFile(diff);

  for (const block of fileBlocks) {
    const filePath = filePathHint || block.filePath;
    const ext = path.extname(filePath).toLowerCase();
    const scanner = SCANNERS[ext];
    if (!scanner) continue;

    // Reconstruct the added-lines-only "source" with correct line numbers
    // We track the target file line number from @@ headers
    let targetLine = 0;
    const addedLineMap = []; // { lineNumber, content }

    for (const line of block.lines) {
      if (line.startsWith('@@')) {
        // Parse @@ -a,b +c,d @@
        const m = line.match(/\+(\d+)/);
        if (m) targetLine = parseInt(m[1], 10) - 1;
        continue;
      }
      if (line.startsWith('+++') || line.startsWith('---')) continue;

      if (line.startsWith('+')) {
        targetLine++;
        addedLineMap.push({ lineNumber: targetLine, content: line.slice(1) });
      } else if (!line.startsWith('-')) {
        targetLine++;
      }
    }

    // Build a synthetic source from added lines only — separated by newlines
    // but track which output line maps to which target line
    const syntheticSource = addedLineMap.map(l => l.content).join('\n');
    const rawRefs = scanner(syntheticSource, filePath);

    // Remap synthetic line numbers back to actual PR line numbers
    for (const ref of rawRefs) {
      if (ref.line >= 1 && ref.line <= addedLineMap.length) {
        results.push({ ...ref, line: addedLineMap[ref.line - 1].lineNumber });
      }
    }
  }

  return results;
}

/**
 * Split a unified diff into per-file blocks.
 */
function splitDiffByFile(diff) {
  const blocks = [];
  let current = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) blocks.push(current);
      current = { filePath: '', lines: [] };
    } else if (line.startsWith('+++ b/') && current) {
      current.filePath = line.slice(6);
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks;
}

/**
 * Collect unique variable names from a list of references.
 */
function uniqueVarNames(refs) {
  return [...new Set(refs.filter(r => !r.dynamic).map(r => r.name))].sort();
}

module.exports = { scanFile, scanDirectory, scanDiff, uniqueVarNames };
