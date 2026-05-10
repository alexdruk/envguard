# EnvGuard GitHub App — `packages/app/`

The server that powers EnvGuard's GitHub integration. When a developer opens a pull request, this server receives a webhook from GitHub, scans the PR diff for undocumented `process.env` references, and posts a Check Run result directly into the PR — passing or failing it with inline annotations on the exact lines that introduced the problem.

---

## Table of contents

1. [How it works](#how-it-works)
2. [Prerequisites](#prerequisites)
3. [Step 0 — Get a smee.io webhook URL](#step-0--get-a-smeeio-webhook-url)
4. [Step 1 — Create the GitHub App](#step-1--create-the-github-app)
5. [Step 2 — Set up Supabase](#step-2--set-up-supabase)
6. [Step 3 — Local development](#step-3--local-development)
7. [Step 4 — Deploy to Fly.io](#step-4--deploy-to-flyio)
8. [Step 5 — Install the App on a repository](#step-5--install-the-app-on-a-repository)
9. [Step 6 — Verify end-to-end](#step-6--verify-end-to-end)
10. [Environment variable reference](#environment-variable-reference)
11. [Troubleshooting](#troubleshooting)
12. [Route reference](#route-reference)

---

## How it works

```
Developer opens or pushes to a PR
          │
          ▼
GitHub sends POST /webhook
          │
          ▼
Verify HMAC-SHA256 signature         ← rejects tampered payloads
          │
          ▼
Filter: only pull_request events     ← ignores push, issues, etc.
Filter: only opened/synchronize/reopened actions
          │
          ▼
Respond 202 immediately              ← GitHub requires a response within 10 s;
          │                            all real work happens after this
          ▼
Generate GitHub App JWT (RS256)
Exchange JWT for installation token  ← scoped to this repo only
          │
          ▼
POST /repos/:owner/:repo/check-runs  ← PR shows a spinner immediately
  status: in_progress
          │
          ▼
GET /repos/:owner/:repo/pulls/:number   (Accept: diff)
          │
          ▼
GET /repos/:owner/:repo/contents/.env.schema?ref=:headSha
          │                            ← fetched at exact commit, not branch tip
          ▼
scanDiff(diff)                       ← CLI scanner, added lines only
filter against schema keys           ← __DYNAMIC__ refs are excluded
          │
          ├── 0 violations ──► conclusion: success
          └── N violations ──► conclusion: failure
                                       + per-line annotations on the diff
          │
          ▼
PATCH /repos/:owner/:repo/check-runs/:id
  status: completed, conclusion, output
          │
          ▼
INSERT into Supabase check_runs      ← for Phase 3 dashboard
```

The check result looks like this in a PR:

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

## Prerequisites

Before starting, make sure you have:

- **Node.js 18 or later** (`node --version`)
- **npm 9 or later** (`npm --version`)
- **Fly.io CLI** installed and authenticated (`fly auth whoami`)
  - Install: `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`
- A **GitHub account** — personal or organisation, doesn't matter
- A **Supabase account** — free tier is sufficient for Phase 2
- The EnvGuard monorepo cloned locally with Phase 1 already working

---

## Step 0 — Get a smee.io webhook URL

GitHub requires a valid, reachable webhook URL at App creation time — you can't leave it blank. During local development your server runs on `localhost`, which GitHub can't reach. smee.io solves this by giving you a public URL that relays webhooks to your machine.

**Do this before creating the GitHub App.**

1. Go to **https://smee.io** and click **Start a new channel**
2. You'll get a URL like `https://smee.io/AbCdEfGhIjKlMnOp` — copy it
3. You'll use this URL as the **Webhook URL** in Step 1.2 below
4. Later, after deploying to Fly.io, you'll replace it with your production URL

Keep the smee.io tab open so you can find the URL again.

---

## Step 1 — Create the GitHub App

A GitHub App is different from an OAuth App. It acts as its own identity, can be installed on specific repositories, and uses short-lived installation tokens instead of user tokens. This is what allows EnvGuard to post Check Runs.

### 1.1 Open the new App form

Go to: **https://github.com/settings/apps/new**

If you want the App owned by an organisation instead of your personal account, go to:
`https://github.com/organizations/YOUR_ORG/settings/apps/new`

### 1.2 Fill in the basic details

| Field | Value |
|---|---|
| **GitHub App name** | `EnvGuard` (must be globally unique — add a suffix if taken, e.g. `EnvGuard-alexdruk`) |
| **Homepage URL** | `https://github.com/alexdruk/envguard` |
| **Webhook URL** | Your smee.io URL from Step 0 (`https://smee.io/AbCdEfGhIjKlMnOp`) — GitHub requires this field, and you'll update it to your Fly.io URL after deployment |
| **Webhook secret** | Click **Generate** or type a long random string. Copy it — this becomes `GITHUB_WEBHOOK_SECRET` |

### 1.3 Set repository permissions

Scroll to **Repository permissions** and set exactly these — nothing more:

| Permission | Level |
|---|---|
| **Checks** | Read & write |
| **Contents** | Read-only |
| **Pull requests** | Read-only |

Everything else stays **No access**. Minimal permissions reduce your attack surface and make the App easier for users to trust.

### 1.4 Subscribe to events

Under **Subscribe to events**, check:

- ✅ **Pull request**

That's the only event the server handles.

### 1.5 Set installation scope

Under **Where can this GitHub App be installed?**, select:

- **Only on this account** — correct for now while you're testing. Switch to **Any account** before listing on the GitHub Marketplace.

### 1.6 Create the App

Click **Create GitHub App**.

You'll land on the App's settings page. Note:

- **App ID** — a number like `12345678`. This is your `GITHUB_APP_ID`.

### 1.7 Generate a private key

On the same settings page, scroll to **Private keys** and click **Generate a private key**.

A `.pem` file downloads automatically. Keep it safe — it can't be recovered from GitHub. The App settings page only shows the key's fingerprint, not the key content itself.

You now have everything you need for `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_PRIVATE_KEY`.

---

## Step 2 — Set up Supabase

Supabase stores a record of every check run for Phase 3's dashboard and billing features. It's optional for local development — the app works without it, persistence just becomes a no-op.

### 2.1 Create a project

1. Go to **https://supabase.com** and sign in
2. Click **New project**
3. Choose a name (e.g. `envguard`), set a database password, pick a region close to your Fly.io region (`us-east-1` maps to Fly's `iad`)
4. Click **Create new project** — provisioning takes about 60 seconds

### 2.2 Get your API credentials

In your project, go to **Settings → API**:

- **Project URL** — this is your `SUPABASE_URL` (looks like `https://xxxxxxxxxxxx.supabase.co`)
- **Service role** key — this is your `SUPABASE_SERVICE_ROLE_KEY`
  - Use the **service role** key, not the **anon** key. The service role key bypasses Row Level Security, which is correct for a server-side process that you control.
  - Never expose this key in a frontend or public repository.

### 2.3 Create the table

Go to **SQL Editor** in your Supabase project and run:

```sql
create table check_runs (
  id              bigint generated always as identity primary key,
  created_at      timestamptz default now(),
  repo_full_name  text not null,
  pull_number     int  not null,
  head_sha        text not null,
  conclusion      text not null,
  violation_count int  not null default 0,
  violations      jsonb not null default '[]'
);

-- Used by the Phase 3 dashboard to query history per repo efficiently
create index on check_runs (repo_full_name, created_at desc);
```

Click **Run**. You should see `Success. No rows returned.`

---

## Step 3 — Local development

### 3.1 Configure your environment

From the monorepo root:

```bash
cp packages/app/.env.example packages/app/.env
```

Open `packages/app/.env` and fill in:

```bash
GITHUB_APP_ID=12345678

GITHUB_WEBHOOK_SECRET=the-secret-you-set-in-step-1

# Paste the entire contents of your .pem file, replacing real newlines with \n
# The result should be a single line starting with -----BEGIN RSA PRIVATE KEY-----
GITHUB_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEo...\n-----END RSA PRIVATE KEY-----

SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

**Converting the .pem file to a single line:**

```bash
# Run this in the directory where your .pem file was downloaded
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-app.2024-01-01.private-key.pem
```

Copy the output (it's one long line) and paste it as the value of `GITHUB_PRIVATE_KEY` in `.env`.

### 3.2 Install dependencies

From the monorepo root:

```bash
npm install
```

### 3.3 Start the server

```bash
node packages/app/src/server.js
```

You should see:

```
EnvGuard app server listening on :3000
```

### 3.4 Start the smee relay

In a second terminal:

```bash
npx smee-client \
  --url https://smee.io/AbCdEfGhIjKlMnOp \
  --path /webhook \
  --port 3000
```

You should see:

```
Forwarding https://smee.io/AbCdEfGhIjKlMnOp to http://localhost:3000/webhook
Connected to smee
```

Any webhook GitHub sends to your smee URL will now appear in your server's terminal.

### 3.5 Verify the server is running

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.1.0"}
```

---

## Step 4 — Deploy to Fly.io

### 4.1 Install the Fly CLI (if you haven't)

```bash
# macOS
brew install flyctl

# Linux / WSL
curl -L https://fly.io/install.sh | sh
```

Log in:

```bash
fly auth login
```

### 4.2 Move fly.toml to the repo root

Fly resolves the `dockerfile` path relative to the `fly.toml` file location. Because the Dockerfile needs to copy from both `packages/cli/` and `packages/app/`, the build context must be the monorepo root — so `fly.toml` must live there too.

```bash
# From the monorepo root
mv packages/app/fly.toml fly.toml
```

All subsequent `fly` commands are run from the monorepo root without a `--config` flag.

### 4.3 Launch the app (first time only)

```bash
fly launch --name envguard-app --region iad --no-deploy
```

When prompted:
- **Would you like to set up a Postgresql database?** → No
- **Would you like to set up an Upstash Redis database?** → No

This creates the app on Fly.io without deploying yet.

### 4.4 Set secrets

Fly.io secrets are environment variables injected at runtime. They're encrypted at rest and never appear in logs or the Fly dashboard.

```bash
fly secrets set \
  GITHUB_APP_ID=12345678 \
  GITHUB_WEBHOOK_SECRET=your-webhook-secret \
  SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

The private key gets special treatment because it contains real newlines:

```bash
fly secrets set \
  GITHUB_PRIVATE_KEY="$(cat /path/to/your-app.2026-05-10.private-key.pem)"
```

Use the actual path to the `.pem` file you downloaded in Step 1.7. The `$()` substitution passes the key with real newlines preserved — Fly.io handles this correctly, and the server reads it as-is without the `\n` conversion needed in `.env`.

Verify the secrets were set (values are hidden):

```bash
fly secrets list
```

### 4.5 Deploy

```bash
fly deploy
```

The first deploy takes 2–4 minutes while the Docker image builds. Subsequent deploys are faster. When it finishes you'll see:

```
✓ Machine 1234567890 [app] update finished: success
```

### 4.6 Confirm the deployment is healthy

```bash
curl https://envguard-app.fly.dev/health
# {"status":"ok","version":"0.1.0"}
```

If you chose a different app name in step 4.3, replace `envguard-app` with your app name.

### 4.7 Update the GitHub App webhook URL

Now that you have a real public URL, go back to your GitHub App's settings and update:

- **Webhook URL**: `https://envguard-app.fly.dev/webhook`

Click **Save changes**.

### 4.8 Future deploys

```bash
fly deploy
```

---

## Step 5 — Install the App on a repository

A GitHub App must be explicitly installed on each repository before it receives webhooks from it.

1. Go to your GitHub App's public page:
   `https://github.com/apps/your-app-name`
   (or navigate: **GitHub → Settings → Applications → Configure**)

2. Click **Install App** in the left sidebar

3. Choose your account or organisation

4. Select **Only select repositories** and choose the repo you want to enforce EnvGuard on

5. Click **Install**

GitHub will immediately send an `installation` event to your webhook URL. You'll see it arrive in your server logs as a skipped event — the server only processes `pull_request` events — but it confirms the webhook connection is working.

---

## Step 6 — Verify end-to-end

### 6.1 Create a test PR

In the repository where you installed the App, create a branch that adds an undocumented `process.env` reference:

```bash
git checkout -b test/envguard-check
echo 'const x = process.env.MY_UNDOCUMENTED_VAR;' >> src/test.js
git add src/test.js
git commit -m "test: add undocumented env var"
git push origin test/envguard-check
```

Open a pull request from that branch.

### 6.2 Watch the check run appear

Within a few seconds of opening the PR, you should see:

1. A **spinning EnvGuard check** appear in the PR's checks section (this is the `in_progress` state posted immediately)
2. The check resolves to **❌ failure** with the message:

```
EnvGuard: 1 undocumented environment variable

  ✗ MY_UNDOCUMENTED_VAR
    src/test.js:1

To fix: add this to .env.schema in this PR.
```

3. The file `src/test.js` shows an inline annotation on line 1 in the **Files changed** tab.

### 6.3 Fix it and watch it pass

Add the variable to `.env.schema` in the same PR:

```yaml
MY_UNDOCUMENTED_VAR:
  description: Test variable for EnvGuard check
  required: false
  example: some-value
```

Commit and push. The check re-runs automatically on the new commit and resolves to **✓ success**.

### 6.4 Confirm the record in Supabase

In your Supabase project, go to **Table Editor → check_runs**. You should see two rows: one `failure` and one `success`, both for the same PR number.

---

## Environment variable reference

| Variable | Required | Description |
|---|---|---|
| `GITHUB_APP_ID` | Yes | The numeric App ID from your GitHub App's settings page |
| `GITHUB_WEBHOOK_SECRET` | Yes | The secret used to sign webhook payloads — must match exactly what you entered when creating the App |
| `GITHUB_PRIVATE_KEY` | Yes | The RSA private key (full PEM contents). In `.env`, replace newlines with `\n`. On Fly.io, pass the raw file via `$(cat file.pem)` |
| `SUPABASE_URL` | No* | Your Supabase project URL. Without it, persistence is silently skipped |
| `SUPABASE_SERVICE_ROLE_KEY` | No* | Supabase service role key. Without it, persistence is silently skipped |
| `STRIPE_SECRET_KEY` | No | Stripe secret key for Phase 3 billing. Not used yet |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret for Phase 3. Not used yet |
| `PORT` | No | HTTP port the server listens on. Defaults to `3000` |

*Omitting Supabase variables produces a warning at startup but doesn't break the check run flow.

---

## Troubleshooting

### The check never appears in the PR

**1. Check that the webhook is being received.**

In your GitHub App settings, go to **Advanced → Recent Deliveries**. You should see a `pull_request` delivery. Click it to see the request and response.

- No deliveries at all → the App isn't installed on this repo (go back to Step 5)
- Response code 401 → the webhook secret doesn't match — double-check `GITHUB_WEBHOOK_SECRET`
- Response code 500 → check your server logs with `fly logs --config packages/app/fly.toml`

**2. Check the server logs.**

```bash
fly logs --config packages/app/fly.toml
```

A successful lifecycle prints: `[owner/repo#42] success — 0 violation(s)`

**3. Check the health endpoint.**

```bash
curl https://envguard-app.fly.dev/health
```

If this fails, the server isn't running. Check `fly status --config packages/app/fly.toml`.

---

### `Invalid webhook signature` errors in the logs

The HMAC verification is failing — the signature GitHub sends doesn't match what your server computes. This happens when:

- The secret in `GITHUB_WEBHOOK_SECRET` doesn't match the secret in your GitHub App settings
- A proxy is modifying the request body before it reaches the server (Fly.io doesn't do this)

Fix: regenerate the webhook secret in the GitHub App settings page, update the secret on Fly.io:

```bash
fly secrets set --config packages/app/fly.toml GITHUB_WEBHOOK_SECRET=new-secret
```

Then redeploy:

```bash
fly deploy --config packages/app/fly.toml
```

---

### `Failed to get installation token` errors

The App JWT is being rejected by GitHub. Common causes:

- **Wrong `GITHUB_APP_ID`** — verify it matches the number on the App settings page exactly
- **Malformed private key** — the PEM must have real newlines when it reaches the running process. On Fly.io this is handled correctly via `$(cat file.pem)`. Locally in `.env`, the value needs `\n` escape sequences which `auth.js` converts with `.replace(/\\n/g, '\n')`.
- **Clock skew** — the JWT is backdated by 30 seconds to tolerate minor drift, but if your server clock is more than 60 seconds off, GitHub will reject it. Fly.io machines use NTP so this is rarely a problem there; it can occur in local Docker containers.

To verify the key is being read correctly, temporarily add a log line in `auth.js` after the `PRIVATE_KEY` assignment:

```js
console.log('Key prefix:', PRIVATE_KEY.slice(0, 40));
// Should print: -----BEGIN RSA PRIVATE KEY-----
```

---

### Check run is always `neutral` (never success or failure)

The scanner threw an error during fetching or scanning. The server sets `neutral` as a safe fallback so the PR isn't silently stuck. Look in the logs for:

```
[owner/repo#42] Scan error: <message>
```

Common scan errors:

- **`fetchPullDiff failed (404)`** — the PR doesn't exist. Shouldn't happen with a real webhook payload.
- **`cliScanDiff is not a function`** — the import path in `adapter.js` doesn't match your CLI's actual file structure. Verify that `packages/cli/src/scanner/index.js` exists and exports `scanDiff`.
- **`parseSchema is not a function`** — same issue for `packages/cli/src/schema.js`.

A missing `.env.schema` file is not an error — the server correctly treats it as an empty schema, meaning every env var in the diff is a violation.

---

### Supabase inserts failing

The server logs `Supabase insert failed: <message>` but continues normally — a DB write failure never affects the check run result.

Common causes:

- The `check_runs` table doesn't exist — run the SQL from Step 2.3
- Wrong key — make sure you're using the **service role** key, not the **anon** key
- Column mismatch — if you modified the table schema, update `db/client.js` to match

---

## Route reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{"status":"ok","version":"0.1.0"}`. Used by Fly.io for deployment health checks. |
| `POST` | `/webhook` | HMAC-SHA256 | GitHub webhook receiver. Verifies signature, filters to `pull_request` events, processes the check run lifecycle asynchronously. Returns 202 immediately. |
| `POST` | `/stripe/webhook` | *(stub)* | Placeholder for Phase 3 billing events. Returns 200 with no processing. |
