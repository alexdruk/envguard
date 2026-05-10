const GITHUB_API = 'https://api.github.com';

/**
 * Creates a new check run in the "in_progress" state.
 * Called as soon as we receive the webhook so GitHub shows a spinner immediately.
 *
 * Returns the check_run id needed to update it later.
 */
export async function createCheckRun({ owner, repo, headSha, githubHeaders }) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/check-runs`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...githubHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'EnvGuard',
      head_sha: headSha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      output: {
        title: 'EnvGuard: scanning for undocumented env vars…',
        summary: 'Checking for `process.env` references not documented in `.env.schema`.',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createCheckRun failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Updates an existing check run with the final result.
 *
 * GitHub Checks API limits annotations to 50 per PATCH call.
 * We batch them automatically if there are more.
 */
export async function updateCheckRun({
  owner,
  repo,
  checkRunId,
  conclusion,  // 'success' | 'failure' | 'neutral'
  output,      // { title, summary, annotations[] }
  githubHeaders,
}) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/check-runs/${checkRunId}`;
  const { annotations = [], ...outputMeta } = output;

  // Send the first batch (up to 50) with the completion PATCH.
  const firstBatch = annotations.slice(0, 50);
  const remaining = annotations.slice(50);

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...githubHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'completed',
      completed_at: new Date().toISOString(),
      conclusion,
      output: {
        ...outputMeta,
        annotations: firstBatch,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`updateCheckRun failed (${res.status}): ${body}`);
  }

  // If we have more than 50 annotations, send the rest in follow-up PATCHes.
  // Each must omit conclusion/status (already completed).
  for (let i = 0; i < remaining.length; i += 50) {
    const batch = remaining.slice(i, i + 50);
    await fetch(url, {
      method: 'PATCH',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        output: { ...outputMeta, annotations: batch },
      }),
    });
  }
}
