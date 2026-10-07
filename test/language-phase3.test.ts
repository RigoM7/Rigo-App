import { describe, it, expect } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { rid, processAll, getDb, signup } from './helpers.js';
import { en } from '../src/shared/i18n/en.js';
import { es } from '../src/shared/i18n/es.js';
import { translate, pickLang, plural, phrase } from '../src/shared/i18n/index.js';
import { jobUpdateText } from '../src/shared/messages.js';
import { changeItems, changeText } from '../src/shared/changes.js';

// WP16: Spanish for the driver side, sign-in, invitations, driver notifications and customer
// messages (D8); plain words instead of machine words (R18-m2).

describe('the dictionaries (R4-M5)', () => {
  it('Spanish covers every English key, with the same placeholders', () => {
    const missing = Object.keys(en).filter((k) => k !== 'notice.raw' && !(k in es));
    expect(missing).toEqual([]);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const differ = Object.entries(es).filter(([k, v]) => vars(v!) !== vars((en as any)[k])).map(([k]) => k);
    expect(differ).toEqual([]);
  });

  it('picks a language, falls back to English, and handles plurals and known sentences', () => {
    expect(pickLang(null, ['es-MX', 'en-US'])).toBe('es');
    expect(pickLang('en', ['es-MX'])).toBe('en');
    expect(pickLang(undefined, ['fr-FR'])).toBe('en');
    expect(translate('es', 'job.start')).toBe('Empezar trabajo');
    expect(translate('es', 'today.job', { number: 54 })).toBe('Trabajo n.º 54');
    expect(plural('es', 'today.waiting', 3)).toBe('3 registros esperando para enviarse');
    expect(plural('en', 'today.waiting', 1)).toBe('1 record waiting to send');
    expect(phrase('es', 'Delivered quantity is required')).toBe('Delivered quantity es obligatorio');
    expect(phrase('es', 'Something the server said')).toBe('Something the server said');
    expect(phrase('es', 'Too many sign-in attempts. Try again in 30 seconds, or reset your password.')).toBe('Demasiados intentos de inicio de sesión. Vuelve a intentarlo en 30 segundos, o restablece tu contraseña.');
  });

  it('writes what changed in the driver\'s language, with times in the company zone', () => {
    const before = { scheduled_start: '2026-10-07T14:00:00Z', access_instructions: '', priority: 'normal' };
    const after = { scheduled_start: '2026-10-07T16:00:00Z', access_instructions: 'Use the north gate', priority: 'emergency' };
    const items = changeItems(before, after, 'America/Chicago');
    expect(items.map((i) => changeText('en', 'America/Chicago', i))).toEqual(['Moved from 9:00 AM to 11:00 AM', 'New access instructions: Use the north gate', 'Now an emergency']);
    expect(items.map((i) => changeText('es', 'America/Chicago', i))).toEqual(['Se cambió de 9:00 a.m. a 11:00 a.m.', 'Nuevas instrucciones de acceso: Use the north gate', 'Ahora es una emergencia']);
  });

  it('customer messages follow the customer\'s language', () => {
    const j = { number: 7, status: 'open', customer_name: 'Grace', company_name: 'Acme', service_name: 'Pump-out', address: '1 Main St', driver_name: 'Luis Ortiz', en_route_at: '2026-10-07T14:00:00Z', en_route_eta_minutes: 20 };
    expect(jobUpdateText(j, undefined, 'es').short).toBe('Acme: Luis va en camino para su pump-out en 1 Main St, llega en aproximadamente 20 minutos.');
    expect(jobUpdateText(j).short).toBe('Acme: Luis is on the way for your pump-out at 1 Main St, arriving in about 20 minutes.');
  });
});

describe('Spanish on the server (D8)', () => {
  it('a Spanish-speaking driver gets the change notice in Spanish; the office record stays English', async () => {
    const t = await triCounty();
    expect((await t.luis.patch('/auth/me', { language: 'es' })).status).toBe(200);
    expect((await t.luis.get('/auth/me')).body.user.language).toBe('es');
    const c = t.customers.grace;
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, scheduledStart: start, clientRequestId: rid() });
    let job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, version: job.version });
    await t.luis.post(`/c/${t.cid}/jobs/${job.id}/seen-changes`);
    job = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    expect((await t.dana.patch(`/c/${t.cid}/jobs/${job.id}`, { version: a.body.version ?? job.version, accessInstructions: 'Portón norte, código 2211' })).status).toBe(200);
    const bell = (await t.luis.get(`/c/${t.cid}/notifications?state=all`)).body.notifications.map((n: any) => n.title);
    expect(bell).toContain(`El trabajo n.º ${job.number} cambió: Nuevas instrucciones de acceso: Portón norte, código 2211`);
    const mine = (await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((x: any) => x.id === job.id);
    expect(mine.driver_changes.lines).toEqual(['New access instructions: Portón norte, código 2211']);
    expect(mine.driver_changes.items).toEqual([{ k: 'notice.newAccess', v: { text: 'Portón norte, código 2211' } }]);
  });

  it('a customer marked Spanish gets the invoice email and job update in Spanish', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const cu = (await t.dana.get(`/c/${t.cid}/customers/${c.id}`)).body.customer;
    expect((await t.dana.patch(`/c/${t.cid}/customers/${c.id}`, { version: cu.version, language: 'es' })).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/customers/${c.id}`)).body.customer.language).toBe('es');
    const j = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid() })).body;
    let job = (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, version: job.version });
    await t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '10' } });
    await processAll();
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`)).body.invoiceId;
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
    await t.dana.post(`/c/${t.cid}/invoices/${inv}/approve`, { version: d.version });
    d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
    await t.dana.post(`/c/${t.cid}/invoices/${inv}/issue`, { version: d.version });
    const m = (await t.dana.post(`/c/${t.cid}/invoices/${inv}/email`)).body.messageId;
    const msg = (await (await getDb()).query<any>(`select subject, body from rigo.messages where id = $1`, [m])).rows[0];
    expect(msg.subject).toMatch(/^Tri-County Field Services: factura /);
    expect(msg.body).toMatch(/^Hola, Grace Okafor:\n\nGracias por su preferencia\. Aquí está la factura .* del trabajo n\.º \d+\./);
    expect(msg.body).toMatch(/Total: \$/);
    expect(msg.body).not.toMatch(/Thank you|Due:|Balance due/);
    job = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    const rep = (await t.dana.post(`/c/${t.cid}/jobs/${job.id}/report-message`)).body.messageId;
    const report = (await (await getDb()).query<any>(`select subject, body from rigo.messages where id = $1`, [rep])).rows[0];
    expect(report.body).toMatch(/Resultado: Completado con éxito/);
  });
});

describe('plain words (R18-m2)', () => {
  it('validation never shows the validator\'s own wording', async () => {
    const owner = await signup('Plain Words');
    const r = await owner.post('/companies', { name: '', timezone: 42, currency: 'USD', categories: 'fuel' });
    expect(r.status).toBe(400);
    const all = JSON.stringify(r.body.error);
    expect(all).not.toMatch(/Invalid input|expected|received|Too small|Too big/);
    expect(r.body.error.details.fields).toMatchObject({ name: 'Enter the company name', timezone: 'Enter text.', categories: 'Choose from the list.' });
  });
});
