// Fixture: JavaScript with various env access patterns

// Standard process.env
const dbUrl = process.env.DATABASE_URL;
const port = process.env.PORT;

// Bracket notation
const stripeKey = process.env['STRIPE_SECRET_KEY'];
const anotherKey = process.env["ANOTHER_KEY"];

// Vite / ESM style
const apiUrl = import.meta.env.VITE_API_URL;
const viteKey = import.meta.env['VITE_PUBLIC_KEY'];

// Inside a function
function getConfig() {
  return {
    redisUrl: process.env.REDIS_URL,
    adminEmail: process.env.ADMIN_EMAIL,
  };
}

// Inline with default
const timeout = process.env.REQUEST_TIMEOUT || '30000';

// In a conditional
if (process.env.NODE_ENV === 'production') {
  console.log('prod');
}

// This should be skipped — it's in a comment
// const secret = process.env.COMMENTED_OUT_VAR;

// Dynamic access — should be flagged as __DYNAMIC__
const dynamic = process.env[someVariable];
