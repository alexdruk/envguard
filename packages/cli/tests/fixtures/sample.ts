// Fixture: TypeScript with type assertions and modern patterns

interface Config {
  databaseUrl: string;
  jwtSecret: string;
}

// Standard access
const config: Config = {
  databaseUrl: process.env.DATABASE_URL as string,
  jwtSecret: process.env.JWT_SECRET!,
};

// Optional chaining style
const maybeRegion = process.env.AWS_REGION ?? 'us-east-1';

// Bracket notation with type
const awsKey: string = process.env['AWS_ACCESS_KEY_ID'] as string;
const awsSecret = process.env["AWS_SECRET_ACCESS_KEY"];

// In a class
class StripeClient {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.STRIPE_SECRET_KEY || '';
  }
}

// Destructuring won't be caught (documented limitation in README)
// const { DATABASE_URL } = process.env; — not matched, this is correct
// Teams should use direct access for EnvGuard compatibility
