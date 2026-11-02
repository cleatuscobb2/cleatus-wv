/**
 * Runs the *hosted* admin (sign-in + GitHub) under `astro dev`, to test it
 * without deploying:
 *
 *   npm run dev:hosted -- <branch> [email]
 *
 * Saves are committed to <branch> on GitHub — use a throwaway branch, never
 * main. Sign-in links are printed to this terminal instead of emailed, and
 * rate limits / spent links are kept in memory. The GitHub token comes from the
 * `gh` CLI at start-up, so no secret is ever written to a file.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const [branch, email = 'test@example.com'] = process.argv.slice(2);
if (!branch || branch === 'main') {
  console.error('usage: npm run dev:hosted -- <throwaway-branch> [email]   (not main)');
  process.exit(1);
}

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const child = spawn(process.execPath, ['node_modules/astro/astro.js', 'dev', '--port', '4322'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ADMIN_HOSTED: '1',
    ADMIN_EMAILS: email,
    SESSION_SECRET: randomBytes(48).toString('base64url'),
    GITHUB_TOKEN: token,
    GITHUB_BRANCH: branch,
    // Make sure nothing real is reached from a test run.
    RESEND_API_KEY: '',
    KV_REST_API_URL: '',
    KV_REST_API_TOKEN: '',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
