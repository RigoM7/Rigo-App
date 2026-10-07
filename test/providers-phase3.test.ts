import { describe, it, expect, afterEach, vi } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { signup, newCompany, getDb } from './helpers.js';
import { config } from '../src/server/config.js';
import { capabilities, deliverMessage, systemEmailChannel } from '../src/server/adapters/index.js';

// Email and text providers (D1, D10) and confirming an email before inviting (D2). The network is
// mocked: nothing here leaves the machine.

const saved = { email: { ...config.email }, sms: { ...config.sms } };
afterEach(() => { Object.assign(config.email, saved.email); Object.assign(config.sms, saved.sms); vi.restoreAllMocks(); });
const useResend = () => Object.assign(config.email, { provider: 'resend', apiKey: 're_test_key', from: 'Rigo <billing@example.test>' });
const useTwilio = () => Object.assign(config.sms, { provider: 'twilio', accountSid: 'AC123', authToken: 'tok', from: '+15550001111' });
const ok = () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));

describe('providers stay off until configured (D1, D10)', () => {
  it('says what is missing, and a real company sends nothing', async () => {
    expect(capabilities({ kind: 'real' }).email).toMatchObject({ state: 'disabled', reason: 'No email service is configured. Messages are prepared for you to copy and send yourself.' });
    Object.assign(config.email, { provider: 'resend', apiKey: '', from: '' });
    expect(capabilities({ kind: 'real' }).email.reason).toBe('Email is not fully set up yet (missing RIGO_EMAIL_API_KEY, RIGO_EMAIL_FROM). Messages are prepared for you to copy and send yourself.');
    const f = ok();
    expect((await deliverMessage({ kind: 'real' }, { channel: 'email', recipient: 'a@example.test', subject: 's', body: 'b' })).status).toBe('blocked');
    expect(f).not.toHaveBeenCalled();
    expect(systemEmailChannel()).not.toBe('email');
  });

  it('sends email through Resend once set up; a demo company is still only simulated', async () => {
    useResend();
    const f = ok();
    expect(capabilities({ kind: 'real' }).email).toMatchObject({ state: 'available', reason: 'Email is sent through Resend from Rigo <billing@example.test>.' });
    const r = await deliverMessage({ kind: 'real' }, { channel: 'email', recipient: 'grace@example.test', subject: 'Invoice 1', body: 'Hello' });
    expect(r).toMatchObject({ status: 'sent', detail: 'Sent through Resend.', provider: 'resend' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as any).authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(String(init.body))).toEqual({ from: 'Rigo <billing@example.test>', to: ['grace@example.test'], subject: 'Invoice 1', text: 'Hello' });
    f.mockClear();
    expect((await deliverMessage({ kind: 'demo' }, { channel: 'email', recipient: 'grace@example.test', subject: 's', body: 'b' })).status).toBe('simulated');
    expect(f).not.toHaveBeenCalled();
  });

  it('a refused email is recorded as failed with the reason, never as sent', async () => {
    useResend();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"The from address is not verified"}', { status: 422 }));
    const r = await deliverMessage({ kind: 'real' }, { channel: 'email', recipient: 'grace@example.test', subject: 's', body: 'b' });
    expect(r).toMatchObject({ status: 'failed', detail: 'Resend did not accept it: 422: The from address is not verified' });
  });

  it('sends texts through Twilio once set up', async () => {
    useTwilio();
    const f = ok();
    expect(capabilities({ kind: 'real' }).sms.state).toBe('available');
    expect((await deliverMessage({ kind: 'real' }, { channel: 'sms', recipient: '+15552010003', subject: '', body: 'On my way' })).status).toBe('sent');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((init.headers as any).authorization).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    expect(String(init.body)).toBe('To=%2B15552010003&From=%2B15550001111&Body=On+my+way');
  });

  it('a prepared customer message is sent and marked sent from Messages', async () => {
    const t = await triCounty();
    await (await getDb()).query(`update rigo.users set email_verified_at = now() where id = $1`, [t.ids.priya]);
    useResend();
    ok();
    const db = await getDb();
    const m = (await db.query<{ id: string }>(`insert into rigo.messages (company_id, customer_id, channel, recipient, subject, body) values ($1,$2,'email','grace@example.test','Your delivery','Hello Grace') returning id`, [t.cid, t.customers.grace.id])).rows[0].id;
    const r = await t.priya.post(`/c/${t.cid}/messages/${m}/send`);
    expect(r.body).toEqual({ status: 'sent', detail: 'Sent through Resend.' });
    expect((await db.query<{ status: string }>(`select status from rigo.messages where id = $1`, [m])).rows[0].status).toBe('sent');
  });
});

describe('confirm your email before inviting or emailing customers (D2)', () => {
  it('blocks an unconfirmed owner once email works, and lets them through after confirming', async () => {
    const owner = await signup('Una Confirmed');
    const cid = await newCompany(owner);
    useResend();
    ok();
    const r = await owner.post(`/c/${cid}/invitations`, { email: 'newhire@example.test', role: 'driver' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'email_unconfirmed', message: 'Confirm your email address before inviting people. Use the link we sent you, or send a new one from Account.' });
    await (await getDb()).query(`update rigo.users set email_verified_at = now() where lower(email) = lower($1)`, [owner.email]);
    expect((await owner.post(`/c/${cid}/invitations`, { email: 'newhire@example.test', role: 'driver' })).status).toBe(200);
  });

  it('blocks nothing while email cannot be sent (no one could confirm)', async () => {
    const owner = await signup('Una Unconfigured');
    const cid = await newCompany(owner);
    expect((await owner.post(`/c/${cid}/invitations`, { email: 'other@example.test', role: 'driver' })).status).toBe(200);
  });
});
