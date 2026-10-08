import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { Q } from '../db/index.js';
import { emailReady, emailSetupGaps, smsReady, smsSetupGaps, sendEmail, sendText, providerName } from './providers.js';

// External-service boundary. Every outbound capability is decided here, on the server, from the
// company kind and deployment configuration. Demo companies can never reach a real provider.

export type CapabilityState = 'available' | 'simulated' | 'disabled';
export interface Capability { state: CapabilityState; reason: string }
export interface Capabilities { email: Capability; sms: Capability; ai: Capability; payments: Capability; maps: Capability; fileStorage: Capability }

/** Real sending is turned on per company by whoever runs Rigo (RIGO_SENDING_COMPANIES), not just by having keys. */
export function sendingAllowed(company: { id?: string }) {
  return config.sendingCompanies.includes('*') || (!!company.id && config.sendingCompanies.includes(company.id));
}
const NOT_ALLOWED = (what: string) => `${what} is set up on this server, but sending isn't turned on for this workspace yet (RIGO_SENDING_COMPANIES). Messages are prepared for you to send yourself.`;

export function capabilities(company: { kind: string; id?: string }): Capabilities {
  const demo = company.kind === 'demo';
  const sim = (what: string): Capability => ({ state: 'simulated', reason: `Demo: ${what} is simulated and nothing leaves Rigo.` });
  const allowed = sendingAllowed(company);
  return {
    email: demo ? sim('email') : emailReady() && !allowed ? { state: 'disabled', reason: NOT_ALLOWED('Email') } : emailReady()
      ? { state: 'available', reason: `Email is sent through ${providerName(config.email.provider)} from ${config.email.from}.` }
      : config.email.provider
        ? { state: 'disabled', reason: `Email is not fully set up yet (missing ${emailSetupGaps().join(', ')}). Messages are prepared for you to copy and send yourself.` }
        : { state: 'disabled', reason: 'No email service is configured. Messages are prepared for you to copy and send yourself.' },
    sms: demo ? sim('text messaging') : smsReady() && !allowed ? { state: 'disabled', reason: NOT_ALLOWED('Text messaging') } : smsReady()
      ? { state: 'available', reason: `Texts are sent through ${providerName(config.sms.provider)} from ${config.sms.from}.` }
      : config.sms.provider
        ? { state: 'disabled', reason: `Text messaging is not fully set up yet (missing ${smsSetupGaps().join(', ')}). Texts are prepared for you to send yourself.` }
        : { state: 'disabled', reason: 'Text messaging is not set up. Texts are prepared for you to send from your phone.' },
    ai: { state: 'disabled', reason: 'The AI assistant comes after launch. Suggestions use simple word matching, not AI.' },
    payments: { state: 'disabled', reason: 'Payment processing is not part of this build. You can record payments received.' },
    maps: { state: 'disabled', reason: 'Maps, routing and geocoding are not configured. Addresses are stored as text.' },
    fileStorage: { state: 'available', reason: config.storageDriver === 'local' ? 'Files are stored on this server.' : 'Files are stored in the database.' },
  };
}

/** Provider errors can quote the address or number: people without contact access see the message status. */
export function redactRecipient(text: string, recipient: string) {
  let out = text;
  if (recipient) out = out.split(recipient).join('the recipient');
  const digits = recipient.replace(/\D/g, '');
  if (digits.length >= 7) out = out.replace(/\+?[\d][\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').endsWith(digits.slice(-7)) ? 'the recipient' : m));
  return out.replace(/[^\s@'"<>]+@[^\s@'"<>]+\.[^\s@'"<>]+/g, 'the recipient');
}

/**
 * Customer-facing message delivery. Returns the honest resulting status; never claims a send that
 * did not happen. With `guard`, a company's daily sends are capped (security review).
 */
export async function deliverMessage(company: { kind: string; id?: string }, msg: { channel: string; recipient: string; subject: string; body: string }, guard?: { q: Q }) {
  const sms = msg.channel === 'sms';
  const cap = capabilities(company)[sms ? 'sms' : 'email'];
  if (cap.state === 'simulated') return { status: 'simulated' as const, detail: cap.reason, provider: 'simulation' };
  if (cap.state === 'disabled') return { status: 'blocked' as const, detail: cap.reason, provider: 'none' };
  if (sms && !config.smsAnyCountry && !/^\+1\d{10}$/.test(msg.recipient)) return { status: 'blocked' as const, detail: 'Texts only go to US and Canada numbers (+1 and 10 digits).', provider: 'none' };
  const provider = sms ? config.sms.provider : config.email.provider;
  if (guard && company.id) {
    const archived = (await guard.q.query<{ archived_at: string | null }>(`select archived_at from rigo.companies where id = $1`, [company.id])).rows[0]?.archived_at;
    if (archived) return { status: 'blocked' as const, detail: 'Not sent: this workspace is archived. Restore it to send messages.', provider: 'none' };
    const n = (await guard.q.query<{ n: number }>(`select count(*)::int as n from rigo.outbox_messages where company_id = $1 and channel = $2 and provider = $3 and status in ('sent','failed') and updated_at > now() - interval '1 day'`, [company.id, sms ? 'sms' : 'email', provider])).rows[0].n;
    const limit = sms ? config.dailyTextLimit : config.dailyEmailLimit;
    if (n >= limit) return { status: 'blocked' as const, detail: `Not sent: this workspace has reached today's limit of ${limit} ${sms ? 'texts' : 'emails'}. It stays prepared; send it tomorrow or yourself.`, provider: 'none' };
  }
  try {
    if (sms) await sendText({ to: msg.recipient, body: msg.body });
    else await sendEmail({ to: msg.recipient, subject: msg.subject, body: msg.body });
    return { status: 'sent' as const, detail: `Sent through ${providerName(provider)}.`, provider };
  } catch (e) {
    return { status: 'failed' as const, detail: `${providerName(provider)} did not accept it: ${redactRecipient((e as Error).message, msg.recipient)}`, provider };
  }
}

// ---------------------------------------------------------------- system email
// Account email (password reset, invitations, email confirmation, email change) all goes through
// sendSystemEmail, so configuring a provider later turns every one of them on at once.

export type SystemEmailKind = 'password_reset' | 'invitation' | 'email_verify' | 'email_change' | 'email_changed_notice';
export interface SystemEmail { to: string; subject: string; body: string; link?: string; kind: SystemEmailKind }


/** How account email can reach people on this deployment. */
export function systemEmailChannel(): 'email' | 'mailbox' | 'none' {
  if (emailReady()) return 'email';
  if (config.devMailbox) return 'mailbox';
  return 'none';
}

export async function sendSystemEmail(q: Q, mail: SystemEmail) {
  const channel = systemEmailChannel();
  if (channel === 'email') {
    await sendEmail({ to: mail.to, subject: mail.subject, body: mail.link && !mail.body.includes(mail.link) ? `${mail.body}\n\n${mail.link}` : mail.body });
    return { delivered: true, simulated: false, detail: 'Sent.' };
  }
  if (channel === 'mailbox') {
    await q.query(`insert into rigo.dev_mailbox (to_email, subject, body, link, kind) values ($1,$2,$3,$4,$5)`,
      [mail.to, mail.subject, mail.body, mail.link ?? null, mail.kind]);
    return { delivered: false, simulated: true, detail: 'Recorded in the local simulated mailbox (/dev/mailbox).' };
  }
  return { delivered: false, simulated: false, detail: 'Email is not set up yet; share the link directly.' };
}

// ---------------------------------------------------------------- file storage
export interface StoredFile { storage: 'local' | 'database'; storage_key: string | null; data: Buffer | null }

export function storeFile(id: string, data: Buffer): StoredFile {
  if (config.storageDriver === 'local') {
    mkdirSync(config.uploadsDir, { recursive: true });
    writeFileSync(join(config.uploadsDir, id), data);
    return { storage: 'local', storage_key: id, data: null };
  }
  return { storage: 'database', storage_key: null, data };
}

export function readStoredFile(f: { storage: string; storage_key: string | null; data: Buffer | null }): Buffer | null {
  if (f.storage === 'database') return f.data;
  const p = join(config.uploadsDir, f.storage_key ?? '');
  return f.storage_key && /^[0-9a-f-]{36}$/.test(f.storage_key) && existsSync(p) ? readFileSync(p) : null;
}

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Check magic bytes so a renamed file cannot pretend to be an image. SVG is never accepted. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
