/**
 * Scanner for Python files.
 *
 * Captures:
 *   os.environ['VAR']          os.environ["VAR"]
 *   os.environ.get('VAR')      os.environ.get("VAR")
 *   os.getenv('VAR')           os.getenv("VAR")
 *   os.getenv('VAR', default)  — captures just the key
 *
 * Also handles dotenv-style access via python-dotenv's load_dotenv pattern —
 * after load_dotenv() the same os.environ patterns apply, so no special handling needed.
 */

const STATIC_PATTERNS = [
  // os.environ['VAR'] or os.environ["VAR"]
  /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  // os.environ.get('VAR') — first arg only
  /os\.environ\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  // os.getenv('VAR')
  /os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  // environ['VAR'] — after `from os import environ`
  /\benviron\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  // environ.get('VAR')
  /\benviron\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
];

const DYNAMIC_PATTERNS = [
  /os\.environ\[(?!['"])[^\]]+\]/g,
  /os\.getenv\(\s*(?!['"])[^)]+\)/g,
];

/**
 * @param {string} source
 * @param {string} filePath
 * @returns {{ name: string, file: string, line: number, dynamic: boolean }[]}
 */
function scanPython(source, filePath) {
  const results = [];
  const lines = source.split('\n');

  for (const pattern of STATIC_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = lineNumberOf(source, match.index);
      if (isPythonComment(lines[line - 1], match.index, source, line)) continue;
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

function isPythonComment(lineText, matchIndex, source, lineNum) {
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

module.exports = { scanPython };
