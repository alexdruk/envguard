import jwt from 'jsonwebtoken';

const APP_ID = process.env.GITHUB_APP_ID;
const PRIVATE_KEY = (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// Installation tokens last 1 hour. We cache them per installation and refresh
// 5 minutes before expiry to avoid races on busy repos.
const tokenCache = new Map(); // installationId → { token, expiresAt }

/**
 * Returns a valid GitHub installation access token.
 * Automatically generates a new JWT if the cached token is near expiry.
 */
export async function getInstallationToken(installationId) {
  const cached = tokenCache.get(installationId);
  const now = Date.now();

  if (cached && cached.expiresAt - now > 5 * 60 * 1000) {
    return cached.token;
  }

  const appJwt = generateAppJwt();
  const token = await exchangeForInstallationToken(installationId, appJwt);
  return token;
}

/**
 * Generates a short-lived GitHub App JWT (10 minutes).
 * The JWT is signed with the App's RSA private key using RS256.
 *
 * GitHub rejects JWTs with iat more than 60 seconds in the future,
 * so we back-date by 30 s to account for clock skew.
 */
function generateAppJwt() {
  if (!APP_ID || !PRIVATE_KEY) {
    throw new Error(
      'GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set. ' +
      'Download the private key from your GitHub App settings.'
    );
  }

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 30, // back-date to avoid clock skew rejection
      exp: now + 60 * 10, // 10-minute max per GitHub docs
      iss: APP_ID,
    },
    PRIVATE_KEY,
    { algorithm: 'RS256' }
  );
}

/**
 * Exchanges the App JWT for an installation-scoped access token.
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
 */
async function exchangeForInstallationToken(installationId, appJwt) {
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get installation token (${res.status}): ${body}`);
  }

  const data = await res.json();
  const token = data.token;
  // GitHub returns ISO 8601; parse to ms timestamp for cache comparison.
  const expiresAt = new Date(data.expires_at).getTime();

  tokenCache.set(installationId, { token, expiresAt });
  return token;
}
