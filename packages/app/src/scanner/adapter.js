/**
 * Adapter between the GitHub App and the CLI scanner package.
 *
 * The CLI's scanDiff() and parseSchemaYaml() live in @envguard/cli.
 * We import them directly from their source paths because they are
 * internal functions not yet re-exported from the package's main entry.
 *
 * If you later add explicit exports to packages/cli/package.json
 * (e.g. "exports": { "./scanner": "./src/scanner/index.js" }),
 * update the imports here to use the package name instead.
 */
// The CLI package uses CommonJS (module.exports). Since this app package is ESM,
// we bridge with createRequire — the standard Node.js pattern for this.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { scanDiff: cliScanDiff } = require('@envguard/cli/src/scanner/index.js');
const { parseSchemaYaml } = require('@envguard/cli/src/schema.js');

/**
 * Runs the diff scanner and returns only the violations that appear
 * in the diff AND are not documented in .env.schema.
 *
 * @param {object} params
 * @param {string} params.diff          - Raw unified diff string from GitHub
 * @param {string|null} params.schemaContent - Raw .env.schema file content, or null if absent
 *
 * @returns {Array<{ varName: string, file: string, line: number }>}
 */
export function runDiffScan({ diff, schemaContent }) {
  // Parse the schema. If the repo has no .env.schema yet, treat it as empty
  // (every env var in the diff is undocumented).
const schema = schemaContent ? parseSchemaYaml(schemaContent) : {};

  // scanDiff() inspects only lines added in the diff (lines starting with '+')
  // and returns an array of env var references found in those lines.
  //
  // Expected return shape from the CLI:
  //   [{ varName: string, file: string, line: number }, ...]
  //
  // __DYNAMIC__ entries (process.env[someVar]) are excluded here — they appear
  // as warnings from the CLI but can't be validated against a schema key, so
  // the GitHub App ignores them rather than producing noisy false failures.
  const found = cliScanDiff(diff);

  const documentedKeys = new Set(Object.keys(schema));

  return found.filter(
    (ref) => !ref.dynamic && !documentedKeys.has(ref.name)
  );
}
