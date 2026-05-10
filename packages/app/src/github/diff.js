const GITHUB_API = 'https://api.github.com';

/**
 * Fetches the unified diff for a pull request.
 *
 * Returns a raw unified diff string — the same format that
 * `git diff` produces, which the CLI's scanDiff() expects.
 */
export async function fetchPullDiff({ owner, repo, pullNumber, githubHeaders }) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}`;

  const res = await fetch(url, {
    headers: {
      ...githubHeaders,
      // This media type tells GitHub to return the diff, not JSON.
      Accept: 'application/vnd.github.v3.diff',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchPullDiff failed (${res.status}): ${body}`);
  }

  return res.text();
}

/**
 * Fetches the raw text content of a file from a specific commit.
 *
 * Returns null if the file doesn't exist at that ref (404), so callers
 * can treat a missing .env.schema as an empty schema rather than crashing.
 */
export async function fetchFileContent({ owner, repo, path, ref, githubHeaders }) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`;

  const res = await fetch(url, {
    headers: {
      ...githubHeaders,
      // raw media type returns the file content directly as text.
      Accept: 'application/vnd.github.raw+json',
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchFileContent(${path}) failed (${res.status}): ${body}`);
  }

  return res.text();
}
