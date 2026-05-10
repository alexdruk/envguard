import express from 'express';
import { webhookMiddleware } from './webhooks/middleware.js';
import { handleWebhook } from './webhooks/handler.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body needed for HMAC signature verification — must come before json().
// We attach rawBody to req so the middleware can verify it.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Health check — Fly.io uses this for deployment verification.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// GitHub sends all webhook events here.
app.post('/webhook', webhookMiddleware, handleWebhook);

// Stripe webhook (Phase 3 billing — stub kept here so the route exists).
app.post('/stripe/webhook', (_req, res) => {
  res.status(200).send('ok');
});

app.listen(PORT, () => {
  console.log(`EnvGuard app server listening on :${PORT}`);
});

export default app;
