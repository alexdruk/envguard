# Contributing to EnvGuard

Thank you for your interest. EnvGuard is early-stage — the most useful contributions right now are:

1. **Bug reports** — especially scanner false positives/negatives (patterns we miss or wrongly flag)
2. **New language scanners** — Go (`os.Getenv`), Java (`System.getenv`), Rust (`std::env::var`)
3. **Edge case tests** — unusual patterns in real codebases

---

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/envguard.git
cd envguard/packages/cli
npm install
npm test
```

All 63 tests should pass. If any fail on your machine, open an issue.

---

## Adding a new language scanner

1. Create `packages/cli/src/scanner/<language>.js`
2. Export a single function: `scan<Language>(source, filePath)`
3. Return `{ name, file, line, dynamic }[]` — same shape as the JS scanner
4. Register the file extension(s) in `packages/cli/src/scanner/index.js` in the `SCANNERS` map
5. Add a fixture file in `packages/cli/tests/fixtures/sample.<ext>`
6. Add tests in `packages/cli/tests/envguard.test.js`

Look at `src/scanner/python.js` as the simplest reference implementation.

---

## Running tests

```bash
cd packages/cli
npm test
```

Uses Node.js's built-in test runner (Node 18+) — no extra dependencies needed.

---

## Pull requests

- One logical change per PR
- Tests required for new behaviour
- Scanner changes must include a fixture file update
- Keep PRs focused — large refactors should be discussed in an issue first

---

## Reporting scanner false positives/negatives

If EnvGuard misses an env var reference or flags something it shouldn't, please open an issue with:

1. The source code snippet (a few lines around the reference)
2. The language and framework
3. Whether it's a false positive (flagged when it shouldn't be) or false negative (missed)

The most useful thing to include is the exact string as it appears in your code.
