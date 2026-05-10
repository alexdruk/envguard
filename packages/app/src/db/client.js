import { createClient } from '@supabase/supabase-js';

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Supabase is optional for local dev — log a warning and return null.
    // The app works without it; persistence just becomes a no-op.
    console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — persistence disabled');
    return null;
  }

  _client = createClient(url, key);
  return _client;
}

/**
 * Persists a completed check run to the `check_runs` table.
 *
 * Table schema (run once in Supabase SQL editor):
 *
 *   create table check_runs (
 *     id              bigint generated always as identity primary key,
 *     created_at      timestamptz default now(),
 *     repo_full_name  text not null,
 *     pull_number     int  not null,
 *     head_sha        text not null,
 *     conclusion      text not null,         -- 'success' | 'failure' | 'neutral'
 *     violation_count int  not null default 0,
 *     violations      jsonb not null default '[]'
 *   );
 *
 *   -- Index for the dashboard query (Phase 3)
 *   create index on check_runs (repo_full_name, created_at desc);
 */
export async function recordCheckRun({
  repoFullName,
  pullNumber,
  headSha,
  conclusion,
  violationCount,
  violations,
}) {
  const client = getClient();
  if (!client) return; // no-op when Supabase isn't configured

  const { error } = await client.from('check_runs').insert({
    repo_full_name: repoFullName,
    pull_number: pullNumber,
    head_sha: headSha,
    conclusion,
    violation_count: violationCount,
    violations: JSON.stringify(violations),
  });

  if (error) {
    // Don't throw — a DB write failure shouldn't affect the check result.
    console.error('Supabase insert failed:', error.message);
  }
}
