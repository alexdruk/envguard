# EnvGuard

**ESLint for environment variables.** Catches undocumented `process.env` references before they reach production.

```
✗ EnvGuard: 2 undocumented environment variables

Undocumented environment variables (2):
  ✗ PAYMENT_WEBHOOK_SECRET
    src/webhooks/stripe.ts:47
  ✗ ADMIN_EMAIL_ADDRESS
    src/admin/notifications.ts:12

To fix: add these to .env.schema in this PR.
```

---

## How it works

1. You commit a `.env.schema` file to your repo — one entry per environment variable your app uses, with a description and example value.
2. When a PR introduces a new `process.env.VAR` reference not in `.env.schema`, the PR check fails with a clear explanation of exactly what to add.
3. The `npx envguard init` command generates the initial `.env.schema` from your existing codebase in one command — turning a one-time documentation task into an ongoing enforcement rule.

---

## Quickstart

```bash
# In your project root — scans the codebase, generates .env.schema
npx @envguard/cli init

# Check for undocumented env vars (exit code 1 if violations found)
npx @envguard/cli check
```

---

## The `.env.schema` format

```yaml
# .env.schema — commit this file to your repository
DATABASE_URL:
  description: PostgreSQL connection string for the primary database
  required: true
  example: postgres://user:pass@host:5432/dbname

STRIPE_SECRET_KEY:
  description: Stripe secret key for payment processing
  required: true
  example: sk_test_...

REDIS_URL:
  description: Redis connection string for job queue and caching
  required: false
  example: redis://localhost:6379
```

This file is reviewed in PRs like any other config. It becomes the living documentation for every environment variable your application uses.

---

## Supported languages

| Language | Patterns |
|---|---|
| JavaScript / TypeScript | `process.env.VAR`, `process.env['VAR']`, `import.meta.env.VAR` |
| Python | `os.environ['VAR']`, `os.environ.get('VAR')`, `os.getenv('VAR')` |
| Ruby | `ENV['VAR']`, `ENV.fetch('VAR')`, `ENV.dig('VAR')` |

---

## Use in CI

### GitHub Actions

```yaml
# .github/workflows/envguard.yml
name: EnvGuard check
on: [pull_request]

jobs:
  envguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @envguard/cli check
```

### Any CI (GitLab, CircleCI, Bitbucket, etc.)

```bash
npx @envguard/cli check
# Exit code 0 = pass, exit code 1 = violations found
```

---

## CLI reference

### `npx @envguard/cli init`

Scans your codebase and generates (or updates) `.env.schema` with an entry for every environment variable reference found. Existing entries are preserved — only new variables are added.

```
Options:
  -d, --dir <path>   Directory to scan (default: current directory)
  -h, --help         Display help
```

After running `init`, open `.env.schema` and fill in the `description` and `example` fields. Then commit it.

### `npx @envguard/cli check`

Reads `.env.schema`, scans the codebase, and reports any references not documented in the schema. Exits with code 1 if violations are found — making it safe to use as a CI gate.

```
Options:
  -d, --dir <path>   Directory to check (default: current directory)
  --strict           Also flag schema entries missing descriptions or examples
  -h, --help         Display help
```

---

## Known limitations

- **Destructuring is not detected.** `const { DATABASE_URL } = process.env` will not be flagged. Use direct access (`process.env.DATABASE_URL`) for EnvGuard compatibility — this is the more common pattern in most codebases.
- **Dynamic key access is flagged as a warning, not validated.** `process.env[someVar]` will appear as a `__DYNAMIC__` notice. These must be reviewed manually.
- **The GitHub App (PR enforcement) is Phase 2** — not yet released. The CLI works standalone today.

---

## Repository structure

```
envguard/
├── packages/
│   ├── cli/                    # @envguard/cli — npm package (Phase 1, complete)
│   │   ├── src/
│   │   │   ├── scanner/        # Language scanners + diff scanner
│   │   │   ├── commands/       # init, check
│   │   │   ├── schema.js       # .env.schema parser + writer
│   │   │   └── index.js        # CLI entry point
│   │   └── tests/
│   │
│   └── app/                    # GitHub App server (Phase 2, coming)
│       └── ...
│
├── .github/workflows/ci.yml    # Tests on Node 18, 20, 22
└── .env.schema                 # EnvGuard documents itself
```

---

## Roadmap

- [x] **Phase 1** — CLI (`npx envguard init`, `npx envguard check`)
- [ ] **Phase 2** — GitHub App with PR check integration
- [ ] **Phase 3** — Paid tier: schema drift dashboard, Slack alerts, check run history
- [ ] **Phase 4** — GitHub Marketplace launch

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
