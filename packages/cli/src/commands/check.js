const path = require('path');
const chalk = require('../colours');
const { scanDirectory, uniqueVarNames } = require('../scanner');
const { readSchema, findUndocumented, validateSchema, SCHEMA_FILENAME } = require('../schema');

/**
 * `envguard check`
 *
 * Reads .env.schema, scans the codebase, and reports any undocumented
 * environment variable references.
 *
 * Exit code 0 — all clear
 * Exit code 1 — violations found (enables direct use in CI scripts)
 */
async function checkCommand(options = {}) {
  const cwd = options.cwd || process.cwd();
  const dir = path.resolve(cwd);
  const strict = options.strict || false;  // strict mode: also flag empty descriptions

  // Load schema
  const schema = readSchema(dir);
  const schemaExists = Object.keys(schema).length > 0 || schemaFileExists(dir);

  if (!schemaExists) {
    console.log(chalk.yellow(`\n⚠  No ${SCHEMA_FILENAME} found in ${dir}`));
    console.log(`  Run ${chalk.cyan('npx envguard init')} to generate one.\n`);
    process.exitCode = 1;
    return { violations: [], missingSchema: true };
  }

  // Scan codebase
  const refs = scanDirectory(dir);
  const allVarNames = uniqueVarNames(refs);
  const dynamicRefs = refs.filter(r => r.dynamic);

  // Find violations — vars in code that aren't in schema
  const undocumented = findUndocumented(allVarNames, schema);

  // Group references by variable name for reporting
  const refsByVar = groupByVar(refs);

  // Check for schema quality issues in strict mode
  const schemaIssues = strict ? validateSchema(schema) : [];

  // ─── Report ────────────────────────────────────────────────────────────────

  if (undocumented.length === 0 && schemaIssues.length === 0) {
    console.log(chalk.green(`\n✓ EnvGuard: all ${allVarNames.length} environment variable(s) are documented\n`));
    if (dynamicRefs.length > 0) {
      console.log(chalk.yellow(`  ⚠  ${dynamicRefs.length} dynamic env access pattern(s) cannot be checked automatically`));
      console.log(chalk.dim(`     Review manually: ${uniqueFiles(dynamicRefs, dir).join(', ')}\n`));
    }
    return { violations: [], missingSchema: false };
  }

  // Violations exist
  const totalViolations = undocumented.length + schemaIssues.length;
  console.log(chalk.red(`\n✗ EnvGuard: ${totalViolations} issue(s) found\n`));

  if (undocumented.length > 0) {
    console.log(chalk.bold(`Undocumented environment variables (${undocumented.length}):`));
    console.log(chalk.dim('  These are referenced in your code but missing from .env.schema\n'));

    for (const varName of undocumented) {
      const usages = refsByVar[varName] || [];
      console.log(`  ${chalk.red('✗')} ${chalk.bold(varName)}`);
      for (const usage of usages.slice(0, 3)) {
        console.log(`    ${chalk.dim(`${relativePath(usage.file, dir)}:${usage.line}`)}`);
      }
      if (usages.length > 3) {
        console.log(chalk.dim(`    ...and ${usages.length - 3} more reference(s)`));
      }
    }

    console.log('\n' + chalk.bold('To fix:') + ' add these to ' + chalk.cyan(SCHEMA_FILENAME) + ':\n');
    for (const varName of undocumented) {
      console.log(chalk.dim(`  ${varName}:`));
      console.log(chalk.dim(`    description: [describe what this variable is used for]`));
      console.log(chalk.dim(`    required: true`));
      console.log(chalk.dim(`    example: [example value]\n`));
    }
    console.log(`  Or run ${chalk.cyan('npx envguard init')} to auto-add them (then fill in the descriptions).`);
  }

  if (schemaIssues.length > 0) {
    console.log(chalk.bold(`\nSchema quality issues (${schemaIssues.length}) — strict mode:`));
    for (const issue of schemaIssues) {
      console.log(`  ${chalk.yellow('⚠')}  ${chalk.bold(issue.varName)}: ${issue.issue}`);
    }
  }

  if (dynamicRefs.length > 0) {
    console.log(chalk.yellow(`\n  ⚠  ${dynamicRefs.length} dynamic env access pattern(s) found — cannot validate automatically`));
  }

  console.log('');
  process.exitCode = 1;

  return {
    violations: undocumented.map(name => ({
      varName: name,
      references: refsByVar[name] || [],
    })),
    missingSchema: false,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByVar(refs) {
  const map = {};
  for (const ref of refs) {
    if (ref.dynamic) continue;
    if (!map[ref.name]) map[ref.name] = [];
    map[ref.name].push(ref);
  }
  return map;
}

function uniqueFiles(refs, baseDir) {
  const files = [...new Set(refs.map(r => relativePath(r.file, baseDir)))];
  return files.slice(0, 5);
}

function relativePath(filePath, baseDir) {
  return path.relative(baseDir, filePath) || filePath;
}

function schemaFileExists(dir) {
  const fs = require('fs');
  return fs.existsSync(path.join(dir, SCHEMA_FILENAME));
}

module.exports = { checkCommand };
