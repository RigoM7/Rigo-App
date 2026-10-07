import { config } from '../config.js';

// Email and text message providers (D1, D10). Each stays off until its keys are set in the
// environment (Vercel → Settings → Environment Variables). Nothing here is ever called for a demo
// company: capabilities() decides that first. Errors carry the provider's reason, never the key.

export interface OutgoingEmail { to: string; subject: string; body: string }
export interface OutgoingText { to: string; body: string }

export const EMAIL_PROVIDERS = ['resend', 'postmark'] as const;
export const SMS_PROVIDERS = ['twilio'] as const;
const NAMES: Record<string, string> = { resend: 'Resend', postmark: 'Postmark', twilio: 'Twilio' };
export const providerName = (key: string) => NAMES[key] ?? key;

/** What is missing before email can be sent; empty when it is ready. */
export function emailSetupGaps() {
  const e = config.email;
  if (!e.provider) return ['RIGO_EMAIL_PROVIDER'];
  const gaps: string[] = [];
  if (!(EMAIL_PROVIDERS as readonly string[]).includes(e.provider)) gaps.push(`RIGO_EMAIL_PROVIDER (use ${EMAIL_PROVIDERS.join(' or ')})`);
  if (!e.apiKey) gaps.push('RIGO_EMAIL_API_KEY');
  if (!e.from) gaps.push('RIGO_EMAIL_FROM');
  return gaps;
}
export const emailReady = () => emailSetupGaps().length === 0;

export function smsSetupGaps() {
  const s = config.sms;
  if (!s.provider) return ['RIGO_SMS_PROVIDER'];
  const gaps: string[] = [];
  if (!(SMS_PROVIDERS as readonly string[]).includes(s.provider)) gaps.push(`RIGO_SMS_PROVIDER (use ${SMS_PROVIDERS.join(' or ')})`);
  if (!s.accountSid) gaps.push('TWILIO_ACCOUNT_SID');
  if (!s.authToken) gaps.push('TWILIO_AUTH_TOKEN');
  if (!s.from) gaps.push('TWILIO_FROM_NUMBER');
  return gaps;
}
export const smsReady = () => smsSetupGaps().length === 0;

async function failure(r: Response) {
  const text = await r.text().catch(() => '');
  let why = text;
  try { const j = JSON.parse(text); why = j.message ?? j.Message ?? j.error?.message ?? text; } catch { /* plain text */ }
  return new Error(`${r.status}: ${String(why).slice(0, 200)}`);
}

/** Send one email through the configured provider. Throws with the provider's reason on failure. */
export async function sendEmail(mail: OutgoingEmail) {
  const e = config.email;
  if (!emailReady()) throw new Error(`Email is not set up: ${emailSetupGaps().join(', ')}`);
  if (e.provider === 'resend') {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${e.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: e.from, to: [mail.to], subject: mail.subject, text: mail.body }),
    });
    if (!r.ok) throw await failure(r);
    return;
  }
  const r = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST', headers: { 'x-postmark-server-token': e.apiKey, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ From: e.from, To: mail.to, Subject: mail.subject, TextBody: mail.body, MessageStream: 'outbound' }),
  });
  if (!r.ok) throw await failure(r);
}

/** Send one text message through Twilio. Throws with Twilio's reason on failure. */
export async function sendText(msg: OutgoingText) {
  const s = config.sms;
  if (!smsReady()) throw new Error(`Text messaging is not set up: ${smsSetupGaps().join(', ')}`);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: msg.to, From: s.from, Body: msg.body }).toString(),
  });
  if (!r.ok) throw await failure(r);
}
