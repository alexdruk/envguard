/**
 * Scanner for Ruby files.
 *
 * Captures:
 *   ENV['VAR']          ENV["VAR"]
 *   ENV.fetch('VAR')    ENV.fetch("VAR")
 *   ENV.fetch('VAR', default)
 *   Rails credentials fallback patterns are NOT captured here —
 *   Rails.application.credentials is a separate system.
 */

const STATIC_PATTERNS = [
  // ENV['VAR'] or ENV["VAR"]
  /\bENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  // ENV.fetch('VAR') — first arg only
  /\bENV\.fetch\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  // ENV.dig('VAR') — less common but valid
  /\bENV\.dig\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
];

const DYNAMIC_PATTERNS = [
  // ENV[variable] — dynamic key
  /\bENV\[(?!['"])[^\]]+\]/g,
];

/**
 * @param {string} source
 * @param {string} filePath
 * @returns {{ name: string, file: string, line: number, dynamic: boolean }[]}
 */
function scanRuby(source, filePath) {
  const results = [];
  const lines = source.split('\n');

  for (const pattern of STATIC_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = lineNumberOf(source, match.index);
      if (isRubyComment(lines[line - 1], match.index, source, line)) continue;
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

function lineNumberOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function isRubyComment(lineText, matchIndex, source, lineNum) {
  if (!lineText) return false;
  const hash = lineText.indexOf('#');
  if (hash === -1) return false;
  const lineStart = nthNewlineStart(source, lineNum - 1);
  const col = matchIndex - lineStart;
  return col > hash;
}

function nthNewlineStart(source, n) {
  if (n === 0) return 0;
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      count++;
      if (count === n) return i + 1;
    }
  }
  return 0;
}

function deduplicate(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = `${r.name}:${r.file}:${r.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { scanRuby };
