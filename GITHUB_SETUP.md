# GITHUB_SETUP.md — Submitting EnvGuard to GitHub

Step-by-step instructions for creating the repository, pushing the code, and
configuring everything correctly. Takes about 15 minutes.

---

## Part 1 — Create the GitHub repository

### 1. Go to GitHub and create a new repo

1. Open https://github.com/new
2. Fill in:
   - **Repository name:** `envguard`
   - **Description:** `ESLint for environment variables — enforces .env.schema documentation at the PR level`
   - **Visibility:** Public ← important for GitHub Marketplace later
   - **Do NOT** tick "Add a README file" — you already have one
   - **Do NOT** tick "Add .gitignore" — you already have one
   - **Do NOT** tick "Choose a license" — you already have one
3. Click **Create repository**
4. GitHub will show you an empty repo page. Keep this tab open.

---

## Part 2 — Initialise Git and push

Run these commands from the root of the `envguard/` directory (the folder containing `README.md`, `packages/`, `.gitignore`, etc.):

### 2. Initialise the repository

```bash
cd /path/to/envguard

git init
git branch -M main
```

### 3. Verify the .gitignore is working

Before staging files, confirm `node_modules` and `.env` files won't be committed:

```bash
git status
```

You should NOT see `node_modules/` or any `.env` files in the output.
You SHOULD see `.env.schema` (this one IS committed — it's the core of the product).

If `node_modules/` appears, something is wrong with the `.gitignore`. Check that the
`.gitignore` file is in the root directory (same level as `README.md`).

### 4. Stage all files

```bash
git add .
```

Then do a final check of what's staged:

```bash
git status
```

Expected staged files (roughly):
```
new file:   .env.schema
new file:   .gitignore
new file:   .github/workflows/ci.yml
new file:   .github/pull_request_template.md
new file:   CHANGELOG.md
new file:   CONTRIBUTING.md
new file:   LICENSE
new file:   LOCAL_SETUP.md
new file:   GITHUB_SETUP.md
new file:   README.md
new file:   package.json
new file:   packages/cli/README.md
new file:   packages/cli/package.json
new file:   packages/cli/package-lock.json
new file:   packages/cli/src/index.js
new file:   packages/cli/src/schema.js
new file:   packages/cli/src/commands/check.js
new file:   packages/cli/src/commands/init.js
new file:   packages/cli/src/scanner/index.js
new file:   packages/cli/src/scanner/js.js
new file:   packages/cli/src/scanner/python.js
new file:   packages/cli/src/scanner/ruby.js
new file:   packages/cli/tests/envguard.test.js
new file:   packages/cli/tests/fixtures/sample.diff
new file:   packages/cli/tests/fixtures/sample.js
new file:   packages/cli/tests/fixtures/sample.py
new file:   packages/cli/tests/fixtures/sample.rb
new file:   packages/cli/tests/fixtures/sample.ts
```

If `node_modules/` appears — stop. The `.gitignore` isn't being picked up. Fix before continuing.

### 5. Create the first commit

```bash
git commit -m "Phase 1: CLI scanner — init and check commands

- npx @envguard/cli init: scans codebase, generates .env.schema
- npx @envguard/cli check: validates against .env.schema, exits 1 on violations
- Scanners for JavaScript/TypeScript, Python, Ruby
- diff-scoped scanning ready for Phase 2 GitHub App
- 63 unit tests, all passing"
```

### 6. Add the remote and push

Replace `YOUR_USERNAME` with your GitHub username:

```bash
git remote add origin https://github.com/YOUR_USERNAME/envguard.git
git push -u origin main
```

GitHub will prompt for your credentials if you haven't set up SSH keys.
If you use HTTPS and have 2FA enabled, you'll need a Personal Access Token
instead of your password. Create one at: https://github.com/settings/tokens
(select `repo` scope).

---

## Part 3 — Verify the repository

### 7. Check the GitHub Actions CI runs

1. Go to your repo: `https://github.com/YOUR_USERNAME/envguard`
2. Click the **Actions** tab
3. You should see a workflow run called **CI** triggered by your push
4. Click into it — it runs tests on Node 18, 20, and 22 in parallel
5. All three should show green checks within ~60 seconds

If you see a red failure, click into the failing job to see the error output.

### 8. Check the README renders correctly

Back on the repo homepage, scroll through the README. Verify:
- Code blocks display correctly
- The table renders
- The installation commands look right

---

## Part 4 — Configure repository settings

### 9. Add a description and topics

On the repo homepage, click the gear icon (⚙) next to "About":

- **Description:** `ESLint for environment variables — enforces .env.schema documentation at the PR level`
- **Website:** leave blank for now (add when you have a landing page)
- **Topics:** add these tags:
  `devtools`, `environment-variables`, `dotenv`, `linter`, `cli`, `github-app`, `nodejs`, `developer-tools`, `ci-cd`

Topics help people find the repo via GitHub search.

### 10. Configure branch protection (optional but recommended)

Even as a solo founder, this prevents accidental direct pushes to main:

1. Go to **Settings → Branches**
2. Click **Add branch protection rule**
3. Branch name pattern: `main`
4. Tick: **Require status checks to pass before merging**
5. Search for and select: `Test CLI (Node 20.x)` (the CI job name)
6. Tick: **Require branches to be up to date before merging**
7. Leave everything else unchecked
8. Click **Create**

Now any PR to main must pass the tests before it can be merged.

---

## Part 5 — Publish the CLI to npm

You need an npm account. Create one at https://www.npmjs.com/signup if you don't have one.

### 11. Log in to npm

```bash
npm login
# Enter your username, password, and email
# If you have 2FA enabled, enter the OTP
```

### 12. Publish the package

```bash
cd packages/cli
npm publish --access public
```

The `--access public` flag is required for scoped packages (`@envguard/cli`).
Without it, npm defaults to private and will ask you to pay.

After publishing, verify it's live:

```bash
npm info @envguard/cli
```

And test the published version from scratch:

```bash
cd /tmp
mkdir test-install && cd test-install
npx @envguard/cli --version   # should print 0.1.0
```

### 13. Add the npm badge to your README

After publishing, add this badge at the top of `README.md`:

```markdown
[![npm version](https://img.shields.io/npm/v/@envguard/cli.svg)](https://www.npmjs.com/package/@envguard/cli)
[![CI](https://github.com/YOUR_USERNAME/envguard/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/envguard/actions/workflows/ci.yml)
```

Then commit and push:

```bash
git add README.md
git commit -m "Add npm and CI badges"
git push
```

---

## Part 6 — GitHub Marketplace (Phase 4 prep)

You don't need to do this now — the GitHub App isn't built yet. But when you're
ready to submit the GitHub App to the Marketplace, the requirements are:

1. The repo must be **public**  ✓ (already set)
2. The GitHub App must be published (configured with a logo, description, and webhook URL)
3. A **Marketplace listing** is created from the App settings page
4. Anthropic's marketplace review (usually 1–2 weeks for simple apps)

When you build Phase 2, the GitHub App lives at `packages/app/` in this same
monorepo. The Marketplace listing will link to your `README.md` — so keep it
accurate as features are added.

---

## Quick reference — common commands after setup

```bash
# Run tests locally
cd packages/cli && npm test

# Make a change and push
git add .
git commit -m "describe what changed"
git push

# Release a new version of the CLI
cd packages/cli
# Update "version" in package.json (e.g. "0.1.0" → "0.2.0")
git add package.json
git commit -m "Release 0.2.0"
git tag v0.2.0
git push && git push --tags
npm publish

# Check npm publish status
npm info @envguard/cli version
```
