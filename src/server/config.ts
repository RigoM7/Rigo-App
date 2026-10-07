import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

function findRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'migrations'))) return dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const env = process.env;
const isProd = env.NODE_ENV === 'production' || !!env.VERCEL;
const rootDir = findRoot();

export const config = {
  rootDir,
  isProd,
  isServerless: !!env.VERCEL,
  port: Number(env.PORT || 8787),
  // Base for invitation and reset links. Preview deployments link to their own branch URL.
  appUrl: (env.APP_URL
    || (env.VERCEL_ENV === 'preview' && env.VERCEL_BRANCH_URL ? `https://${env.VERCEL_BRANCH_URL}` : '')
    || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173')).replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || undefined,
  dataDir: env.RIGO_DATA_DIR === 'memory' ? null : resolve(rootDir, env.RIGO_DATA_DIR || 'data/db'),
  uploadsDir: resolve(rootDir, 'data/uploads'),
  storageDriver: (env.STORAGE_DRIVER || (env.VERCEL ? 'database' : 'local')) as 'local' | 'database',
  devMailbox: env.RIGO_DEV_MAILBOX ? env.RIGO_DEV_MAILBOX === '1' : !isProd,
  sessionDays: 30,
  ai: {
    provider: env.RIGO_AI_PROVIDER || '',
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.RIGO_AI_MODEL || 'claude-sonnet-5-5',
    dailyLimit: Number(env.RIGO_AI_DAILY_LIMIT || 50),
  },
  emailProvider: env.RIGO_EMAIL_PROVIDER || '',
  // Email and texts to customers and account email (D1, D10): off until these are set.
  email: { provider: (env.RIGO_EMAIL_PROVIDER || '').toLowerCase(), apiKey: env.RIGO_EMAIL_API_KEY || '', from: env.RIGO_EMAIL_FROM || '' },
  sms: { provider: (env.RIGO_SMS_PROVIDER || '').toLowerCase(), accountSid: env.TWILIO_ACCOUNT_SID || '', authToken: env.TWILIO_AUTH_TOKEN || '', from: env.TWILIO_FROM_NUMBER || '' },
  // Which companies may really send to customers once a provider is set (security review): company
  // ids separated by commas, or "*" for every company. Empty: nobody sends; messages stay prepared.
  sendingCompanies: (env.RIGO_SENDING_COMPANIES || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Daily ceilings per company, so a mistake or a misused account can't run up a bill.
  dailyEmailLimit: Number(env.RIGO_DAILY_EMAIL_LIMIT || 300),
  dailyTextLimit: Number(env.RIGO_DAILY_TEXT_LIMIT || 100),
  // Texts go only to US and Canada numbers (+1) unless this is "1".
  smsAnyCountry: env.RIGO_SMS_ANY_COUNTRY === '1',
  cronSecret: env.CRON_SECRET || '',
  // Trust X-Forwarded-For only behind a proxy that sets it (Vercel overwrites it; tests opt in).
  trustProxy: !!env.VERCEL || env.RIGO_TRUST_PROXY === '1',
  // Shown on the password recovery page for owners with no other owner. Never invented.
  supportEmail: validEmail(env.RIGO_SUPPORT_EMAIL),
  termsUrl: validUrl(env.RIGO_TERMS_URL),
  privacyUrl: validUrl(env.RIGO_PRIVACY_URL),
};

function validEmail(v: string | undefined) {
  const s = (v ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function validUrl(v: string | undefined) {
  try { const u = new URL((v ?? '').trim()); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}
