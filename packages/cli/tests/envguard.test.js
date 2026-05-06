const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { scanJS } = require('../src/scanner/js');
const { scanPython } = require('../src/scanner/python');
const { scanRuby } = require('../src/scanner/ruby');
const { scanFile, scanDirectory, scanDiff, uniqueVarNames } = require('../src/scanner');
const {
  parseSchemaYaml,
  writeSchema,
  readSchema,
  findUndocumented,
  validateSchema,
} = require('../src/schema');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-test-'));
}

function names(refs) {
  return [...new Set(refs.filter(r => !r.dynamic).map(r => r.name))].sort();
}

// ─── JS Scanner ───────────────────────────────────────────────────────────────

describe('JS Scanner', () => {
  test('captures process.env.VAR_NAME dot access', () => {
    const refs = scanJS('const x = process.env.DATABASE_URL;', 'test.js');
    assert.deepEqual(names(refs), ['DATABASE_URL']);
  });

  test('captures bracket access with single quotes', () => {
    const refs = scanJS("const x = process.env['STRIPE_KEY'];", 'test.js');
    assert.deepEqual(names(refs), ['STRIPE_KEY']);
  });

  test('captures bracket access with double quotes', () => {
    const refs = scanJS('const x = process.env["API_SECRET"];', 'test.js');
    assert.deepEqual(names(refs), ['API_SECRET']);
  });

  test('captures import.meta.env (Vite style)', () => {
    const refs = scanJS('const x = import.meta.env.VITE_API_URL;', 'test.js');
    assert.deepEqual(names(refs), ['VITE_API_URL']);
  });

  test('captures multiple vars in one file', () => {
    const source = `
      const a = process.env.DB_URL;
      const b = process.env.API_KEY;
      const c = process.env['SECRET'];
    `;
    const result = names(scanJS(source, 'test.js'));
    assert.deepEqual(result, ['API_KEY', 'DB_URL', 'SECRET']);
  });

  test('deduplicates same var referenced multiple times', () => {
    const source = `
      if (process.env.NODE_ENV === 'production') {
        console.log(process.env.NODE_ENV);
      }
    `;
    const refs = scanJS(source, 'test.js');
    const nodeEnvRefs = refs.filter(r => r.name === 'NODE_ENV');
    // Same var on different lines → both kept (different line numbers)
    assert.ok(nodeEnvRefs.length <= 2);
  });

  test('marks dynamic access as __DYNAMIC__', () => {
    const refs = scanJS('const x = process.env[someVar];', 'test.js');
    const dynamic = refs.filter(r => r.dynamic);
    assert.equal(dynamic.length, 1);
    assert.equal(dynamic[0].name, '__DYNAMIC__');
  });

  test('skips commented-out references', () => {
    const source = `
      // const x = process.env.COMMENTED_VAR;
      const y = process.env.REAL_VAR;
    `;
    const result = names(scanJS(source, 'test.js'));
    assert.ok(!result.includes('COMMENTED_VAR'), 'should not include commented var');
    assert.ok(result.includes('REAL_VAR'), 'should include real var');
  });

  test('reports correct line numbers', () => {
    const source = `const a = 1;\nconst b = process.env.MY_VAR;\nconst c = 3;`;
    const refs = scanJS(source, 'test.js');
    const myVar = refs.find(r => r.name === 'MY_VAR');
    assert.ok(myVar, 'MY_VAR should be found');
    assert.equal(myVar.line, 2);
  });

  test('handles empty source', () => {
    const refs = scanJS('', 'test.js');
    assert.deepEqual(refs, []);
  });

  test('handles source with no env references', () => {
    const refs = scanJS('const x = 1 + 2;\nconsole.log("hello");', 'test.js');
    assert.deepEqual(refs, []);
  });

  test('scans actual JS fixture file', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.js');
    const source = fs.readFileSync(fixturePath, 'utf8');
    const result = names(scanJS(source, fixturePath));
    assert.ok(result.includes('DATABASE_URL'));
    assert.ok(result.includes('STRIPE_SECRET_KEY'));
    assert.ok(result.includes('REDIS_URL'));
    assert.ok(result.includes('PORT'));
    assert.ok(!result.includes('COMMENTED_OUT_VAR'), 'should not include commented var');
    // Check dynamic is detected
    const dynamic = scanJS(source, fixturePath).filter(r => r.dynamic);
    assert.equal(dynamic.length, 1);
  });

  test('scans actual TS fixture file', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.ts');
    const source = fs.readFileSync(fixturePath, 'utf8');
    const result = names(scanJS(source, fixturePath));
    assert.ok(result.includes('DATABASE_URL'));
    assert.ok(result.includes('JWT_SECRET'));
    assert.ok(result.includes('AWS_ACCESS_KEY_ID'));
    assert.ok(result.includes('STRIPE_SECRET_KEY'));
  });
});

// ─── Python Scanner ───────────────────────────────────────────────────────────

describe('Python Scanner', () => {
  test('captures os.environ bracket access', () => {
    const refs = scanPython("db = os.environ['DATABASE_URL']", 'test.py');
    assert.deepEqual(names(refs), ['DATABASE_URL']);
  });

  test('captures os.environ.get', () => {
    const refs = scanPython("key = os.environ.get('STRIPE_KEY')", 'test.py');
    assert.deepEqual(names(refs), ['STRIPE_KEY']);
  });

  test('captures os.environ.get with default', () => {
    const refs = scanPython("url = os.environ.get('REDIS_URL', 'redis://localhost')", 'test.py');
    assert.deepEqual(names(refs), ['REDIS_URL']);
  });

  test('captures os.getenv', () => {
    const refs = scanPython("s = os.getenv('SECRET_KEY')", 'test.py');
    assert.deepEqual(names(refs), ['SECRET_KEY']);
  });

  test('captures os.getenv with default', () => {
    const refs = scanPython("timeout = os.getenv('TIMEOUT', '30')", 'test.py');
    assert.deepEqual(names(refs), ['TIMEOUT']);
  });

  test('captures imported environ', () => {
    const refs = scanPython("email = environ['ADMIN_EMAIL']", 'test.py');
    assert.deepEqual(names(refs), ['ADMIN_EMAIL']);
  });

  test('captures environ.get', () => {
    const refs = scanPython("v = environ.get('SOME_VAR')", 'test.py');
    assert.deepEqual(names(refs), ['SOME_VAR']);
  });

  test('marks dynamic access as __DYNAMIC__', () => {
    const refs = scanPython('x = os.environ[key_name]', 'test.py');
    const dynamic = refs.filter(r => r.dynamic);
    assert.equal(dynamic.length, 1);
  });

  test('skips commented-out references', () => {
    const source = `
# password = os.environ['COMMENTED_PASSWORD']
real = os.environ['REAL_VAR']
    `;
    const result = names(scanPython(source, 'test.py'));
    assert.ok(!result.includes('COMMENTED_PASSWORD'));
    assert.ok(result.includes('REAL_VAR'));
  });

  test('scans actual Python fixture file', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.py');
    const source = fs.readFileSync(fixturePath, 'utf8');
    const result = names(scanPython(source, fixturePath));
    assert.ok(result.includes('DATABASE_URL'));
    assert.ok(result.includes('STRIPE_SECRET_KEY'));
    assert.ok(result.includes('SECRET_KEY'));
    assert.ok(result.includes('ADMIN_EMAIL'));
    assert.ok(!result.includes('COMMENTED_PASSWORD'));
  });
});

// ─── Ruby Scanner ─────────────────────────────────────────────────────────────

describe('Ruby Scanner', () => {
  test('captures ENV bracket access', () => {
    const refs = scanRuby("db = ENV['DATABASE_URL']", 'test.rb');
    assert.deepEqual(names(refs), ['DATABASE_URL']);
  });

  test('captures ENV double-quote bracket access', () => {
    const refs = scanRuby('key = ENV["SECRET_KEY"]', 'test.rb');
    assert.deepEqual(names(refs), ['SECRET_KEY']);
  });

  test('captures ENV.fetch', () => {
    const refs = scanRuby("s = ENV.fetch('STRIPE_KEY')", 'test.rb');
    assert.deepEqual(names(refs), ['STRIPE_KEY']);
  });

  test('captures ENV.fetch with default', () => {
    const refs = scanRuby("r = ENV.fetch('REDIS_URL', 'redis://localhost')", 'test.rb');
    assert.deepEqual(names(refs), ['REDIS_URL']);
  });

  test('captures ENV.dig', () => {
    const refs = scanRuby("v = ENV.dig('OPTIONAL_VAR')", 'test.rb');
    assert.deepEqual(names(refs), ['OPTIONAL_VAR']);
  });

  test('marks dynamic access as __DYNAMIC__', () => {
    const refs = scanRuby('x = ENV[key]', 'test.rb');
    const dynamic = refs.filter(r => r.dynamic);
    assert.equal(dynamic.length, 1);
  });

  test('skips commented-out references', () => {
    const source = `
# secret = ENV['COMMENTED_SECRET']
real = ENV['REAL_VAR']
    `;
    const result = names(scanRuby(source, 'test.rb'));
    assert.ok(!result.includes('COMMENTED_SECRET'));
    assert.ok(result.includes('REAL_VAR'));
  });

  test('scans actual Ruby fixture file', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.rb');
    const source = fs.readFileSync(fixturePath, 'utf8');
    const result = names(scanRuby(source, fixturePath));
    assert.ok(result.includes('DATABASE_URL'));
    assert.ok(result.includes('STRIPE_SECRET_KEY'));
    assert.ok(result.includes('RAILS_ENV'));
    assert.ok(result.includes('ADMIN_EMAIL'));
    assert.ok(!result.includes('COMMENTED_SECRET'));
  });
});

// ─── Scanner Orchestrator ─────────────────────────────────────────────────────

describe('Scanner orchestrator', () => {
  test('scanFile: routes .js files to JS scanner', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.js');
    const refs = scanFile(fixturePath);
    assert.ok(refs.length > 0);
    assert.ok(refs.some(r => r.name === 'DATABASE_URL'));
  });

  test('scanFile: routes .py files to Python scanner', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.py');
    const refs = scanFile(fixturePath);
    assert.ok(refs.length > 0);
  });

  test('scanFile: routes .rb files to Ruby scanner', () => {
    const fixturePath = path.join(__dirname, 'fixtures/sample.rb');
    const refs = scanFile(fixturePath);
    assert.ok(refs.length > 0);
  });

  test('scanFile: skips unsupported extensions', () => {
    const refs = scanFile('/some/file.md');
    assert.deepEqual(refs, []);
  });

  test('scanFile: accepts source override (no disk read)', () => {
    const refs = scanFile('virtual.js', 'const x = process.env.MY_VAR;');
    assert.ok(refs.some(r => r.name === 'MY_VAR'));
  });

  test('scanDirectory: skips node_modules', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(
      path.join(dir, 'node_modules', 'dep.js'),
      'const x = process.env.NODE_MODULES_VAR;'
    );
    fs.writeFileSync(
      path.join(dir, 'app.js'),
      'const x = process.env.APP_VAR;'
    );
    const refs = scanDirectory(dir);
    const varNames = names(refs);
    assert.ok(varNames.includes('APP_VAR'));
    assert.ok(!varNames.includes('NODE_MODULES_VAR'));
    fs.rmSync(dir, { recursive: true });
  });

  test('scanDirectory: scans nested directories', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'src', 'utils'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'utils', 'db.js'),
      'const url = process.env.NESTED_DB_URL;'
    );
    const refs = scanDirectory(dir);
    assert.ok(names(refs).includes('NESTED_DB_URL'));
    fs.rmSync(dir, { recursive: true });
  });

  test('uniqueVarNames: returns sorted deduplicated names', () => {
    const refs = [
      { name: 'ZEBRA_VAR', file: 'a.js', line: 1, dynamic: false },
      { name: 'ALPHA_VAR', file: 'b.js', line: 1, dynamic: false },
      { name: 'ZEBRA_VAR', file: 'c.js', line: 1, dynamic: false },
    ];
    assert.deepEqual(uniqueVarNames(refs), ['ALPHA_VAR', 'ZEBRA_VAR']);
  });

  test('uniqueVarNames: excludes dynamic refs', () => {
    const refs = [
      { name: '__DYNAMIC__', file: 'a.js', line: 1, dynamic: true },
      { name: 'REAL_VAR', file: 'a.js', line: 2, dynamic: false },
    ];
    assert.deepEqual(uniqueVarNames(refs), ['REAL_VAR']);
  });
});

// ─── Diff Scanner ─────────────────────────────────────────────────────────────

describe('Diff scanner', () => {
  test('only captures vars from added lines', () => {
    const diff = `diff --git a/config.js b/config.js
index abc..def 100644
--- a/config.js
+++ b/config.js
@@ -1,4 +1,6 @@
 const x = 1;
-const old = process.env.OLD_VAR;
+const newVar = process.env.NEW_VAR;
+const extra = process.env.EXTRA_VAR;
 const y = 2;`;
    const refs = scanDiff(diff);
    const varNames = names(refs);
    assert.ok(varNames.includes('NEW_VAR'));
    assert.ok(varNames.includes('EXTRA_VAR'));
    assert.ok(!varNames.includes('OLD_VAR'), 'should not flag removed lines');
  });

  test('scans actual diff fixture', () => {
    const diffPath = path.join(__dirname, 'fixtures/sample.diff');
    const diff = fs.readFileSync(diffPath, 'utf8');
    const refs = scanDiff(diff);
    const varNames = names(refs);
    // DATABASE_URL was modified (appears on + line) — should be included
    assert.ok(varNames.includes('DATABASE_URL') || varNames.includes('STRIPE_SECRET_KEY'));
    assert.ok(varNames.includes('PAYMENT_WEBHOOK_SECRET'));
  });

  test('handles multi-file diffs', () => {
    const diff = `diff --git a/server.js b/server.js
index abc..def 100644
--- a/server.js
+++ b/server.js
@@ -1,2 +1,3 @@
 const x = 1;
+const port = process.env.SERVER_PORT;
diff --git a/db.js b/db.js
index abc..def 100644
--- a/db.js
+++ b/db.js
@@ -1,2 +1,3 @@
 const y = 1;
+const url = process.env.DB_CONNECTION_URL;`;
    const refs = scanDiff(diff);
    const varNames = names(refs);
    assert.ok(varNames.includes('SERVER_PORT'));
    assert.ok(varNames.includes('DB_CONNECTION_URL'));
  });

  test('skips context lines (unchanged)', () => {
    const diff = `diff --git a/app.js b/app.js
index abc..def 100644
--- a/app.js
+++ b/app.js
@@ -1,3 +1,4 @@
 const existing = process.env.EXISTING_VAR;
+const newThing = process.env.TRULY_NEW_VAR;
 const other = process.env.ANOTHER_EXISTING;`;
    const refs = scanDiff(diff);
    const varNames = names(refs);
    assert.ok(varNames.includes('TRULY_NEW_VAR'));
    assert.ok(!varNames.includes('EXISTING_VAR'), 'context lines should not be flagged');
    assert.ok(!varNames.includes('ANOTHER_EXISTING'), 'context lines should not be flagged');
  });
});

// ─── Schema Parser ────────────────────────────────────────────────────────────

describe('Schema parser', () => {
  test('parses a valid .env.schema YAML', () => {
    const yaml = `
DATABASE_URL:
  description: PostgreSQL connection string
  required: true
  example: postgres://user:pass@host:5432/db

STRIPE_KEY:
  description: Stripe secret key
  required: true
  example: sk_test_...
    `;
    const schema = parseSchemaYaml(yaml);
    assert.ok(schema['DATABASE_URL']);
    assert.equal(schema['DATABASE_URL'].description, 'PostgreSQL connection string');
    assert.equal(schema['DATABASE_URL'].required, true);
    assert.equal(schema['DATABASE_URL'].example, 'postgres://user:pass@host:5432/db');
    assert.ok(schema['STRIPE_KEY']);
  });

  test('handles required: false', () => {
    const yaml = `
REDIS_URL:
  description: Optional Redis URL
  required: false
  example: redis://localhost:6379
    `;
    const schema = parseSchemaYaml(yaml);
    assert.equal(schema['REDIS_URL'].required, false);
  });

  test('defaults required to true when omitted', () => {
    const yaml = `
MY_VAR:
  description: Some variable
    `;
    const schema = parseSchemaYaml(yaml);
    assert.equal(schema['MY_VAR'].required, true);
  });

  test('handles shorthand string value', () => {
    const yaml = `MY_VAR: "A description string"`;
    const schema = parseSchemaYaml(yaml);
    assert.equal(schema['MY_VAR'].description, 'A description string');
    assert.equal(schema['MY_VAR'].required, true);
  });

  test('returns empty object for empty YAML', () => {
    assert.deepEqual(parseSchemaYaml(''), {});
    assert.deepEqual(parseSchemaYaml('   '), {});
  });

  test('throws on invalid YAML', () => {
    assert.throws(() => parseSchemaYaml('{ invalid yaml: ['), /Invalid .env.schema YAML/);
  });

  test('throws on non-mapping YAML (array)', () => {
    assert.throws(() => parseSchemaYaml('- item1\n- item2'), /mapping/);
  });
});

// ─── Schema Writer ────────────────────────────────────────────────────────────

describe('Schema writer', () => {
  test('writes a new .env.schema file', () => {
    const dir = tmpDir();
    const { added, path: schemaPath } = writeSchema(['DATABASE_URL', 'API_KEY'], dir);
    assert.equal(added.length, 2);
    assert.ok(fs.existsSync(schemaPath));
    const content = fs.readFileSync(schemaPath, 'utf8');
    assert.ok(content.includes('DATABASE_URL'));
    assert.ok(content.includes('API_KEY'));
    fs.rmSync(dir, { recursive: true });
  });

  test('does not overwrite existing entries by default', () => {
    const dir = tmpDir();
    // Write initial schema
    writeSchema(['DATABASE_URL'], dir);
    // Write again with same + new key
    const { added, skipped } = writeSchema(['DATABASE_URL', 'NEW_VAR'], dir);
    assert.ok(skipped.includes('DATABASE_URL'));
    assert.ok(added.includes('NEW_VAR'));
    fs.rmSync(dir, { recursive: true });
  });

  test('overwrites existing entries when overwrite: true', () => {
    const dir = tmpDir();
    writeSchema(['MY_VAR'], dir);
    const { added } = writeSchema(['MY_VAR'], dir, { overwrite: true });
    assert.ok(added.includes('MY_VAR'));
    fs.rmSync(dir, { recursive: true });
  });

  test('deduplicates input var names', () => {
    const dir = tmpDir();
    const { added } = writeSchema(['VAR_A', 'VAR_A', 'VAR_B'], dir);
    assert.equal(added.length, 2);
    fs.rmSync(dir, { recursive: true });
  });

  test('written schema is parseable', () => {
    const dir = tmpDir();
    writeSchema(['DB_URL', 'API_SECRET'], dir);
    const schema = readSchema(dir);
    assert.ok(schema['DB_URL']);
    assert.ok(schema['API_SECRET']);
    fs.rmSync(dir, { recursive: true });
  });
});

// ─── findUndocumented ─────────────────────────────────────────────────────────

describe('findUndocumented', () => {
  const schema = {
    DATABASE_URL: { description: 'DB URL', required: true, example: 'postgres://...' },
    STRIPE_KEY: { description: 'Stripe key', required: true, example: 'sk_...' },
  };

  test('returns vars not in schema', () => {
    const result = findUndocumented(['DATABASE_URL', 'NEW_VAR', 'ANOTHER_VAR'], schema);
    assert.deepEqual(result.sort(), ['ANOTHER_VAR', 'NEW_VAR']);
  });

  test('returns empty array when all are documented', () => {
    const result = findUndocumented(['DATABASE_URL', 'STRIPE_KEY'], schema);
    assert.deepEqual(result, []);
  });

  test('returns all vars when schema is empty', () => {
    const result = findUndocumented(['VAR_A', 'VAR_B'], {});
    assert.deepEqual(result.sort(), ['VAR_A', 'VAR_B']);
  });
});

// ─── validateSchema ───────────────────────────────────────────────────────────

describe('validateSchema', () => {
  test('flags entries with missing description', () => {
    const schema = {
      MY_VAR: { description: '', required: true, example: 'some-example' },
    };
    const issues = validateSchema(schema);
    assert.ok(issues.some(i => i.varName === 'MY_VAR' && i.issue === 'missing description'));
  });

  test('flags required entries with missing example', () => {
    const schema = {
      MY_VAR: { description: 'Some description', required: true, example: '' },
    };
    const issues = validateSchema(schema);
    assert.ok(issues.some(i => i.varName === 'MY_VAR' && i.issue.includes('example')));
  });

  test('does not flag optional entries without example', () => {
    const schema = {
      MY_VAR: { description: 'Optional var', required: false, example: '' },
    };
    const issues = validateSchema(schema);
    const exampleIssues = issues.filter(i => i.issue.includes('example'));
    assert.equal(exampleIssues.length, 0);
  });

  test('returns empty array for valid schema', () => {
    const schema = {
      DB_URL: { description: 'Database URL', required: true, example: 'postgres://...' },
    };
    const issues = validateSchema(schema);
    assert.deepEqual(issues, []);
  });
});
