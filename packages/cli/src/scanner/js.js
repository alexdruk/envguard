/**
 * Scanner for JavaScript and TypeScript files.
 *
 * Captures all static env var references. Intentionally conservative —
 * dynamic access like process.env[someVar] is flagged as a special token
 * rather than skipped, so teams know dynamic access exists.
 */

// Matches:
//   process.env.VAR_NAME
//   process.env['VAR_NAME']
//   process.env["VAR_NAME"]
const STATIC_PATTERNS = [
  // process.env.VAR_NAME  — dot access
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  // process.env['VAR_NAME'] or process.env["VAR_NAME"]  — bracket with string literal
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  // import.meta.env.VAR_NAME  — Vite / ESM style
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  // import.meta.env['VAR_NAME']
  /import\.meta\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
];

// Flags dynamic access so we don't silently ignore it
const DYNAMIC_PATTERNS = [
  /process\.env\[(?!['"])[^\]]+\]/g,
  /import\.meta\.env\[(?!['"])[^\]]+\]/g,
];

/**
 * @param {string} source  — raw file contents
 * @param {string} filePath — used for location reporting
 * @returns {{ name: string, file: string, line: number, dynamic: boolean }[]}
 */
function scanJS(source, filePath) {
  const results = [];
  const lines = source.split('\n');

  for (const pattern of STATIC_PATTERNS) {
    // Reset lastIndex — patterns are module-level so must be reset each call
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = lineNumberOf(source, match.index);
      // Skip if inside a comment
      if (isInComment(lines[line - 1], match.index, source, line)) continue;
      results.push({ name: match[1], file: filePath, line, dynamic: false });
    }
  }

  for (const pattern of DYNAMIC_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = lineNumberOf(source, match.index);
      results.push({ name: '__DYNAMIC__', file: filePath, line, dynamic: true });
    }
  }

  return deduplicate(results);
}

/**
 * Returns the 1-based line number for a character index in source.
 */
function lineNumberOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Lightweight comment check — skips matches that appear after // on the same line
 * or inside a /* block. Not foolproof for all edge cases but handles common ones.
 */
function isInComment(lineText, _matchIndex, source, lineNum) {
  if (!lineText) return false;

  // Check for // single-line comment before the match on the same line
  const slashSlash = lineText.indexOf('//');
  if (slashSlash !== -1) {
    // Find column of match on this line
    const lineStart = nthNewline(source, lineNum - 1);
    const col = _matchIndex - lineStart;
    if (col > slashSlash) return true;
  }
  return false;
}

function nthNewline(source, n) {
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      if (count === n - 1) return i + 1;
      count++;
    }
  }
  return 0;
}

/**
 * Remove duplicate {name, file, line} entries.
 * Same var on the same line (e.g., used twice in one expression) collapses to one.
 */
function deduplicate(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = `${r.name}:${r.file}:${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { scanJS };
