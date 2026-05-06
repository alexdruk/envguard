# @envguard/cli

> ESLint for environment variables — enforces `.env.schema` documentation in your codebase.

## Quick start

```bash
# Generate .env.schema from your existing codebase
npx envguard init

# Check for undocumented env vars (exit 1 on violations — use in CI)
npx envguard check
```

## The .env.schema format

```yaml
# .env.schema
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

Commit this file to your repository. Review it in PRs like any other config.

## Supported languages

| Language           | Patterns detected |
|--------------------|-------------------|
| JavaScript         | `process.env.VAR`, `process.env['VAR']`, `import.meta.env.VAR` |
| TypeScript         | Same as JavaScript |
| Python             | `os.environ['VAR']`, `os.environ.get('VAR')`, `os.getenv('VAR')` |
| Ruby               | `ENV['VAR']`, `ENV.fetch('VAR')` |

## Use in CI

```yaml
# .github/workflows/envguard.yml
- name: Check env documentation
  run: npx envguard check
```

Exit code 1 on violations. Works in any CI that checks exit codes.

## Known limitations

- Destructuring (`const { DATABASE_URL } = process.env`) is not detected — use direct access
- Dynamic key access (`process.env[someVar]`) is flagged as a warning, not validated
