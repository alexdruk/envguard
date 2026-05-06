const path = require('path');
const chalk = require('../colours');
const { scanDirectory, uniqueVarNames } = require('../scanner');
const { readSchema, writeSchema, SCHEMA_FILENAME } = require('../schema');

/**
 * `envguard init`
 *
 * Scans the codebase, collects all env var references, and generates (or updates)
 * a .env.schema file with empty description/example fields for each new variable.
 *
 * The developer then fills in the descriptions and commits the file.
 */
async function initCommand(options = {}) {
  const cwd = options.cwd || process.cwd();
  const dir = path.resolve(cwd);

  console.log(chalk.bold('\n🔍 EnvGuard — scanning codebase for environment variables\n'));

  // Scan
  const refs = scanDirectory(dir);
  const allVarNames = uniqueVarNames(refs);
  const dynamicRefs = refs.filter(r => r.dynamic);

  if (allVarNames.length === 0 && dynamicRefs.length === 0) {
    console.log(chalk.yellow('No environment variable references found.'));
    console.log(chalk.dim('  Scanned: ' + dir));
    console.log(chalk.dim('  Languages: JavaScript/TypeScript, Python, Ruby'));
    return { added: [], skipped: [], varNames: [] };
  }

  // Check what's already documented
  const existing = readSchema(dir);
  const existingKeys = Object.keys(existing);

  const newVars = allVarNames.filter(name => !existing[name]);
  const alreadyDocumented = allVarNames.filter(name => existing[name]);

  // Report findings
  console.log(chalk.green(`✓ Scan complete`));
  console.log(`  Found ${chalk.bold(allVarNames.length)} unique variable reference(s) across your codebase`);

  if (dynamicRefs.length > 0) {
    console.log(chalk.yellow(`  ⚠  ${dynamicRefs.length} dynamic access pattern(s) found — cannot auto-document these`));
    for (const ref of dynamicRefs.slice(0, 3)) {
      console.log(chalk.dim(`     ${ref.file}:${ref.line} — process.env[variable]`));
    }
    if (dynamicRefs.length > 3) {
      console.log(chalk.dim(`     ...and ${dynamicRefs.length - 3} more`));
    }
  }

  if (alreadyDocumented.length > 0) {
    console.log(chalk.dim(`  ${alreadyDocumented.length} already documented in ${SCHEMA_FILENAME} — skipping`));
  }

  if (newVars.length === 0) {
    console.log(chalk.green(`\n✓ All variables already documented in ${SCHEMA_FILENAME}`));
    return { added: [], skipped: alreadyDocumented, varNames: allVarNames };
  }

  // Write
  const { added, skipped, path: schemaPath } = writeSchema(allVarNames, dir);

  console.log(`\n${chalk.green(`✓ ${SCHEMA_FILENAME} updated`)} — ${chalk.bold(added.length)} new variable(s) added:`);
  for (const name of added) {
    // Show which files reference this variable
    const usages = refs.filter(r => r.name === name);
    const locationSummary = formatUsages(usages, dir);
    console.log(`  ${chalk.cyan(name)}  ${chalk.dim(locationSummary)}`);
  }

  console.log(`\n${chalk.bold('Next steps:')}`);
  console.log(`  1. Open ${chalk.cyan(SCHEMA_FILENAME)}`);
  console.log(`  2. Fill in ${chalk.yellow('description')} and ${chalk.yellow('example')} for each variable`);
  console.log(`  3. Set ${chalk.yellow('required: false')} for any optional variables`);
  console.log(`  4. Commit ${chalk.cyan(SCHEMA_FILENAME)} to your repository`);
  console.log(`\n  Then run ${chalk.cyan('npx envguard check')} to validate everything is documented.\n`);

  return { added, skipped, varNames: allVarNames };
}

function formatUsages(usages, baseDir) {
  if (usages.length === 0) return '';
  if (usages.length === 1) {
    return `(${relativePath(usages[0].file, baseDir)}:${usages[0].line})`;
  }
  const files = [...new Set(usages.map(u => relativePath(u.file, baseDir)))];
  if (files.length === 1) {
    return `(${files[0]}, ${usages.length} references)`;
  }
  return `(${files.length} files)`;
}

function relativePath(filePath, baseDir) {
  return path.relative(baseDir, filePath) || filePath;
}

module.exports = { initCommand };
