# Changelog

All notable changes to EnvGuard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Planned
- GitHub App with PR check integration (Phase 2)
- Paid tier: schema drift dashboard, Slack alerts (Phase 3)
- GitHub Marketplace submission (Phase 4)

---

## [0.1.0] — 2025

### Added
- `npx @envguard/cli init` — scans codebase and generates `.env.schema`
- `npx @envguard/cli check` — validates codebase against `.env.schema`, exits 1 on violations
- `--strict` flag on `check` — additionally flags empty descriptions and missing examples
- `--dir` flag on both commands — scan a directory other than cwd
- JavaScript/TypeScript scanner: `process.env.VAR`, `process.env['VAR']`, `import.meta.env.VAR`
- Python scanner: `os.environ['VAR']`, `os.environ.get('VAR')`, `os.getenv('VAR')`, imported `environ`
- Ruby scanner: `ENV['VAR']`, `ENV.fetch('VAR')`, `ENV.dig('VAR')`
- Dynamic access detection (`process.env[someVar]`) with warning output
- Comment-skipping for all three languages
- `scanDiff()` in scanner orchestrator — diff-scoped scanning for GitHub App Phase 2
- 63 unit tests covering all scanners, schema parser/writer, and diff scanner
