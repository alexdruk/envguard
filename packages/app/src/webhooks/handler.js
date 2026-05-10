import { getInstallationToken } from '../github/auth.js';
import { createCheckRun, updateCheckRun } from '../github/checks.js';
import { fetchPullDiff, fetchFileContent } from '../github/diff.js';
import { runDiffScan } from '../scanner/adapter.js';
import { recordCheckRun } from '../db/client.js';

/**
 * Main handler for pull_request webhook events.
 *
 * Flow:
 *   1. Respond 200 immediately (GitHub requires < 10 s response)
 *   2. Get an installation access token
 *   3. Create a check run (queued → in_progress)
 *   4. Fetch the PR unified diff
 *   5. Fetch .env.schema from the PR head commit
 *   6. Run scanDiff() against the schema
 *   7. Update the check run (success / failure) with annotations
 *   8. Persist the result to Supabase
 */
export async function handleWebhook(req, res) {
  // Respond immediately — processing is async.
  res.status(202).json({ accepted: true });

  const payload = req.body;

  const {
    installation: { id: installationId },
    repository: { full_name: fullName, name: repoName, owner: { login: owner } },
    pull_request: {
      number: pullNumber,
      head: { sha: headSha },
    },
  } = payload;

  const context = { owner, repo: repoName, fullName, pullNumber, headSha, installationId };

  try {
    await runCheckLifecycle(context);
  } catch (err) {
    // Log but don't crash — the 202 is already sent.
    console.error(`[${fullName}#${pullNumber}] Unhandled error:`, err);
  }
}

async function runCheckLifecycle(ctx) {
  const { owner, repo, pullNumber, headSha, installationId } = ctx;

  // ── Step 1: Auth ───────────────────────────────────────────────────────────
  const token = await getInstallationToken(installationId);
  const githubHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // ── Step 2: Create check run (in_progress) ─────────────────────────────────
  const checkRunId = await createCheckRun({ owner, repo, headSha, githubHeaders });

  let conclusion;
  let output;
  let violations = [];

  try {
    // ── Step 3: Fetch the PR diff ─────────────────────────────────────────────
    const diff = await fetchPullDiff({ owner, repo, pullNumber, githubHeaders });

    // ── Step 4: Fetch .env.schema at the head commit ──────────────────────────
    // Returns null if the file doesn't exist in this repo.
    const schemaContent = await fetchFileContent({
      owner, repo, path: '.env.schema', ref: headSha, githubHeaders,
    });

    // ── Step 5: Scan ──────────────────────────────────────────────────────────
    violations = runDiffScan({ diff, schemaContent });

    // ── Step 6: Build check output ────────────────────────────────────────────
    if (violations.length === 0) {
      conclusion = 'success';
      output = buildSuccessOutput(schemaContent);
    } else {
      conclusion = 'failure';
      output = buildFailureOutput(violations);
    }
  } catch (err) {
    // Surface scanner/network errors as a neutral check so the PR isn't silently stuck.
    console.error(`[${ctx.fullName}#${ctx.pullNumber}] Scan error:`, err);
    conclusion = 'neutral';
    output = {
      title: 'EnvGuard: check could not complete',
      summary: `An error occurred while running the EnvGuard scan:\n\`\`\`\n${err.message}\n\`\`\`\nThis is not a problem with your code. Please retry or contact support.`,
      annotations: [],
    };
  }

  // ── Step 7: Update check run ───────────────────────────────────────────────
  await updateCheckRun({ owner, repo, checkRunId, conclusion, output, githubHeaders });

  // ── Step 8: Persist to Supabase ───────────────────────────────────────────
  await recordCheckRun({
    repoFullName: ctx.fullName,
    pullNumber: ctx.pullNumber,
    headSha,
    conclusion,
    violationCount: violations.length,
    violations,
  });

  console.log(`[${ctx.fullName}#${ctx.pullNumber}] ${conclusion} — ${violations.length} violation(s)`);
}

// ── Output builders ────────────────────────────────────────────────────────────

function buildFailureOutput(violations) {
  const count = violations.length;
  const noun = count === 1 ? 'variable' : 'variables';

  // Plain-text list for the summary (matches README example format).
  const list = violations
    .map((v) => `  ✗ ${v.name}\n    ${v.file}:${v.line}`)
    .join('\n');

  const summary = [
    `### ✗ EnvGuard: ${count} undocumented environment ${noun}`,
    '',
    `Undocumented environment ${noun} (${count}):`,
    list,
    '',
    '**To fix:** add these variables to `.env.schema` in this PR.',
    '',
    '```yaml',
    violations.map((v) => buildSchemaStub(v.name)).join('\n\n'),
    '```',
    '',
    '> EnvGuard ensures every environment variable your app uses is documented.',
    '> [What is .env.schema?](https://github.com/alexdruk/envguard#the-envschema-format)',
  ].join('\n');

  // GitHub Check Annotations — appear inline on the diff.
  const annotations = violations.map((v) => ({
    path: v.file,
    start_line: v.line,
    end_line: v.line,
    annotation_level: 'failure',
    title: `Undocumented env var: ${v.name}`,
    message: `${v.name} is used here but not documented in .env.schema. Add an entry for it to make this PR pass.`,
    raw_details: buildSchemaStub(v.name),
  }));

  return {
    title: `EnvGuard: ${count} undocumented environment ${noun}`,
    summary,
    annotations,
  };
}

function buildSuccessOutput(schemaContent) {
  const documented = schemaContent
    ? Object.keys(parseSchemaKeys(schemaContent)).length
    : 0;

  return {
    title: 'EnvGuard: all environment variables documented ✓',
    summary: [
      '### ✓ EnvGuard passed',
      '',
      'No undocumented `process.env` references were introduced in this PR.',
      documented > 0 ? `\n_${documented} variable(s) currently documented in \`.env.schema\`._` : '',
    ].join('\n'),
    annotations: [],
  };
}

/** Produces a ready-to-paste .env.schema stub for a variable name. */
function buildSchemaStub(varName) {
  return `${varName}:\n  description: # TODO — describe what this variable does\n  required: true\n  example: # TODO — add a non-sensitive example value`;
}

/** Quick key-count helper — avoids importing the full schema parser just for this. */
function parseSchemaKeys(content) {
  const keys = {};
  for (const line of content.split('\n')) {
    if (line && !line.startsWith(' ') && !line.startsWith('#') && line.includes(':')) {
      keys[line.split(':')[0].trim()] = true;
    }
  }
  return keys;
}
