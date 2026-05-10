import { createHmac, timingSafeEqual } from 'crypto';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

/**
 * Verifies the GitHub webhook signature (X-Hub-Signature-256).
 *
 * GitHub signs every delivery with HMAC-SHA256 over the raw request body using
 * your webhook secret. We compare using timingSafeEqual to prevent timing attacks.
 *
 * Rejects non-pull_request events early so the handler never needs to branch on it.
 */
export function webhookMiddleware(req, res, next) {
  // ── 1. Signature verification ──────────────────────────────────────────────
  if (!WEBHOOK_SECRET) {
    console.error('GITHUB_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const signatureHeader = req.headers['x-hub-signature-256'];
  if (!signatureHeader) {
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256' });
  }

  const expected = Buffer.from(
    `sha256=${createHmac('sha256', WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex')}`
  );
  const received = Buffer.from(signatureHeader);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // ── 2. Event filtering ─────────────────────────────────────────────────────
  // We only care about pull_request events.
  const event = req.headers['x-github-event'];
  if (event !== 'pull_request') {
    return res.status(200).json({ skipped: true, event });
  }

  // Only process the actions that mean "new commits to check".
  const { action } = req.body;
  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    return res.status(200).json({ skipped: true, action });
  }

  next();
}
