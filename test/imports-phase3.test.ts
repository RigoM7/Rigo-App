import { describe, it, expect } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { signup, newCompany, getDb } from './helpers.js';
import { addressKey, cleanCell, combineAddress, decodeBytes, flipName, formatPhone, isLastFirst, phoneDigits, resourceKind, sameCustomer } from '../src/shared/imports.js';

// WP14: reading customer and equipment files honestly, and templates that never duplicate or leak.

describe('reading the file (R16-M1, R16-m2)', () => {
  it('reads UTF-8, Windows (Excel) text and a byte-order mark', () => {
    const utf8 = new TextEncoder().encode('Name\nNúñez, José\n');
    expect(decodeBytes(utf8)).toEqual({ text: 'Name\nNúñez, José\n', encoding: 'utf-8', replaced: false });
    // The same text saved by Excel on Windows: one byte per accented letter.
    const cp1252 = Uint8Array.from([...'Name\nN'].map((c) => c.charCodeAt(0)).concat([0xfa, 0x0f1 - 0x00, 0x65, 0x7a, 0x2c, 0x20, 0x4a, 0x6f, 0x73, 0xe9, 0x0a]).map((b) => b & 0xff));
    expect(decodeBytes(cp1252)).toMatchObject({ text: 'Name\nNúñez, José\n', encoding: 'windows-1252', replaced: false });
    expect(decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Name')])).text).toBe('Name');
    // Forcing UTF-8 on Windows bytes shows the damage, so the page can warn.
    expect(decodeBytes(cp1252, 'utf-8').replaced).toBe(true);
    expect(cleanCell('Ridge\u0000line\u0007')).toEqual({ value: 'Ridgeline', changed: true });
    expect(cleanCell('Two\nlines\tok')).toEqual({ value: 'Two\nlines\tok', changed: false });
  });

  it('tidies addresses, names, phones and equipment types', () => {
    expect(combineAddress({ street: '12 Quarry Rd', line2: 'Unit 4', city: 'Millbrook', state: 'TX', zip: '75001' })).toBe('12 Quarry Rd, Unit 4, Millbrook, TX 75001');
    expect(combineAddress({ street: ' 9 Sycamore Ct ', city: 'Fairview' })).toBe('9 Sycamore Ct, Fairview');
    expect(addressKey('12 Quarry Road, Millbrook')).toBe(addressKey('12 quarry rd. Millbrook'));
    expect(isLastFirst('Núñez, José')).toBe(true);
    expect(isLastFirst('Smith, Jones & Co')).toBe(false);
    expect(isLastFirst('Ridgeline Construction, LLC')).toBe(false);
    expect(flipName('Núñez, José')).toBe('José Núñez');
    expect(formatPhone('555.201.0003')).toBe('(555) 201-0003');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(phoneDigits('1-555-201-0003')).toBe('5552010003');
    expect(resourceKind('Vac truck')).toEqual({ kind: 'truck', exact: false });
    expect(resourceKind('Tank wagon').kind).toBe('equipment');
    expect(resourceKind('trailer').kind).toBe('equipment');
    expect(resourceKind('Hand-wash station').kind).toBe('unit');
    expect(resourceKind('Portable toilet').kind).toBe('unit');
    expect(resourceKind('unit')).toEqual({ kind: 'unit', exact: true });
    expect(resourceKind('boat').kind).toBeNull();
    expect(sameCustomer({ name: 'John Smith', email: 'a@x.test' }, { name: 'john smith', phone: '555 111 2222', email: 'b@x.test' })).toBe(false);
    expect(sameCustomer({ name: 'John Smith', phone: '(555) 111-2222' }, { name: 'John Smith', phone: '1 555 111 2222' })).toBe(true);
  });
});

async function upload(t: { cid: string; dana: any }, csv: string, kind: 'customers' | 'resources' = 'customers') {
  const r = await t.dana.post(`/c/${t.cid}/imports`, { kind, fileName: 'list.csv', text: csv });
  expect(r.status).toBe(200);
  return r.body;
}

describe('importing customers (R16-M2, R16-M3, R16-m3)', () => {
  it('combines split address columns, keeps unmapped columns in notes if asked, and never merges two people by name alone', async () => {
    const t = await triCounty();
    const csv = [
      'Customer Name,Contact Name,Email,Phone,Street,City,State,ZIP,Billing Address,Billing City,Account Rep,Fax',
      'Acme Septic,Ann Lee,ann@acme.test,555-300-0001,1 Main St,Millbrook,TX,75001,PO Box 9,Millbrook,Kim,555-9',
      'Acme Septic,,ann@acme.test,,22 Farm Rd,Fairview,TX,75002,,,Kim,',
      'Acme Septic,,ann@acme.test,,1 Main Street,Millbrook,TX,75001,,,Kim,',
      'John Smith,,john1@example.test,,5 Oak Ln,Millbrook,TX,,,,,',
      'John Smith,,john2@example.test,,7 Elm Ln,Millbrook,TX,,,,,',
      'Grace Okafor,,,(555) 201-0003,40 New Site Rd,Fairview,TX,,,,,',
      'Grace Okafor,,,555.201.0003,812 Willow Ln,Fairview,,,,,,',
      'Ridge\u0000line Two,,,,,,,,,,,',
    ].join('\n');
    const up = await upload(t, csv);
    expect(up.mapping).toMatchObject({ name: 'Customer Name', contact_name: 'Contact Name', address: 'Street', city: 'City', state: 'State', zip: 'ZIP', billing_address: 'Billing Address', billing_city: 'Billing City' });
    expect(up.mapping.opening_balance).toBeUndefined();
    expect(up.warnings).toEqual(['Removed invisible control characters from row 9.']);
    const rv = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping: up.mapping, notesColumns: ['Account Rep'] })).body;
    expect(rv.unmapped).toEqual(['Account Rep', 'Fax']);
    const row = (n: number) => rv.rows.find((r: any) => r.index === n - 2);
    expect(row(2).values).toMatchObject({ address: '1 Main St, Millbrook, TX 75001', billing_address: 'PO Box 9, Millbrook', phone: '(555) 300-0001', notes: 'Account Rep: Kim', contact_name: 'Ann Lee' });
    expect(row(3).action).toBe('row:0'); // same name and email: another site of row 2
    expect(row(4).action).toBe('skip'); // the same address written differently
    expect(row(6)).toMatchObject({ action: 'create' }); // a different John Smith
    expect(row(6).warnings.join(' ')).toMatch(/Same name as row 5, but the email and phone don't match/);
    expect(row(6).options.map((o: any) => o.value)).toEqual(['create', 'row:3', 'skip']);
    expect(row(7).action).toBe(`existing:${t.customers.grace.id}`); // matched by phone, new site
    expect(row(8)).toMatchObject({ action: 'skip' }); // already on file with this address
    expect(row(9).values.name).toBe('Ridgeline Two');
    // Not offered → refused.
    expect((await t.dana.post(`/c/${t.cid}/imports/${up.id}/commit`, { confirm: true, overrides: { 4: `existing:${t.customers.grace.id}` } })).status).toBe(400);
    const done = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/commit`, { confirm: true, overrides: {} })).body.result;
    expect(done).toMatchObject({ customers: 4, locations: 5, skipped: 2 });
    const db = await getDb();
    const acme = (await db.query<any>(`select c.id, c.notes, (select count(*)::int from rigo.locations l where l.customer_id = c.id) as n from rigo.customers c where c.company_id = $1 and c.name = 'Acme Septic'`, [t.cid])).rows;
    expect(acme).toHaveLength(1);
    expect(acme[0]).toMatchObject({ n: 2, notes: 'Account Rep: Kim' });
    expect((await db.query(`select 1 from rigo.customers where company_id = $1 and name = 'John Smith'`, [t.cid])).rows).toHaveLength(2);
    expect((await db.query<any>(`select address from rigo.locations where customer_id = $1 order by created_at`, [t.customers.grace.id])).rows.map((r) => r.address)).toEqual(['812 Willow Ln, Fairview', '40 New Site Rd, Fairview, TX']);
  });

  it('turns "Last, First" names around on request, and picks up an unfinished import', async () => {
    const t = await triCounty();
    const up = await upload(t, 'Name,Phone\n"Lopez, Maria",555-111-2222\n"Hill Farms, LLC",\n');
    let rv = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping: up.mapping })).body;
    expect(rv.summary.lastFirst).toBe(1);
    rv = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping: up.mapping, flipNames: true })).body;
    expect(rv.rows.map((r: any) => r.values.name)).toEqual(['Maria Lopez', 'Hill Farms, LLC']);
    const left = (await t.dana.get(`/c/${t.cid}/imports`)).body.imports.find((i: any) => i.id === up.id);
    expect(left.status).toBe('reviewed');
    const again = (await t.dana.get(`/c/${t.cid}/imports/${up.id}`)).body;
    expect(again.review.flipNames).toBe(true);
    expect(again.import.headers).toEqual(['Name', 'Phone']);
    await t.dana.post(`/c/${t.cid}/imports/${up.id}/discard`);
    expect((await t.dana.get(`/c/${t.cid}/imports`)).body.imports.some((i: any) => i.id === up.id)).toBe(false);
  });

  it('opening balances become invoice drafts, only for people who prepare invoices', async () => {
    const t = await triCounty();
    const up = await upload(t, 'Name,Balance\nNew Farm,"$1,234.50"\nOther Farm,(20.00)\n');
    const mapping = { ...up.mapping, opening_balance: 'Balance' };
    const roles = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles;
    const disp = roles.find((r: any) => r.key === 'dispatcher');
    await t.dana.patch(`/c/${t.cid}/roles/dispatcher`, { permissions: [...disp.permissions, 'imports.run'] });
    expect((await t.marcus.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping })).status).toBe(403);
    const rv = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping })).body;
    expect(rv.rows[0].values.opening_balance).toBe('1234.50');
    expect(rv.rows[1].errors[0]).toMatch(/negative balance/);
    expect((await t.dana.post(`/c/${t.cid}/imports/${up.id}/commit`, { confirm: true })).body.result).toMatchObject({ customers: 1, openingBalances: 1 });
    const inv = (await (await getDb()).query<any>(`select i.status, i.total_minor, l.description from rigo.invoices i join rigo.customers c on c.id = i.customer_id join rigo.invoice_lines l on l.invoice_id = i.id where c.name = 'New Farm'`)).rows;
    expect(inv).toEqual([{ status: 'draft', total_minor: 123450, description: 'Opening balance' }]);
  });
});

describe('importing equipment (R16-m1)', () => {
  it('understands everyday words for the type and says how it read them', async () => {
    const t = await triCounty();
    const up = await upload(t, 'Name,Type\nVac 7,Vac truck\nWagon 2,Tank wagon\nHW-1,Hand-wash station\nBoat,boat\n', 'resources');
    const rv = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping: up.mapping })).body;
    expect(rv.rows.map((r: any) => r.values.kind)).toEqual(['truck', 'equipment', 'unit', 'boat']);
    expect(rv.rows[0].info).toEqual(['Type "Vac truck" read as Truck']);
    expect(rv.rows[3].errors).toEqual(['Type "boat" isn\'t a truck, equipment or unit']);
  });
});

async function author() {
  const a = await signup('Template Author');
  const cid = await newCompany(a, ['fuel'], 'Author Fuel Co');
  return { a, cid };
}

describe('templates (R16-M4, R16-m4, D11)', () => {
  it('shows a plan, and applying the same template twice adds nothing', async () => {
    const { a, cid } = await author();
    const t = (await a.post(`/c/${cid}/templates`, { name: 'Mine' })).body;
    const b = await signup('Receiver Two');
    const cb = await newCompany(b, [], 'Receiver Two Co');
    await a.patch(`/c/${cid}/templates/${t.id}`, { visibility: 'public' });
    const plan = (await b.get(`/c/${cb}/templates/${t.id}/plan`)).body.plan;
    expect(plan.services).toEqual([{ name: 'Fuel delivery', action: 'add' }]);
    const first = (await b.post(`/c/${cb}/templates/${t.id}/apply`, { confirm: true })).body.summary;
    expect(first.services).toBe(1);
    // The receiver started with the standard workflows, so the template's are already there.
    expect(first.workflows).toBe(0);
    expect(first.skipped).toContain('Workflow "Completed job to invoice": you already have one with this name');
    const again = (await b.get(`/c/${cb}/templates/${t.id}/plan`)).body.plan;
    expect([...again.services, ...again.workflows].every((x: any) => x.action === 'skip')).toBe(true);
    const second = (await b.post(`/c/${cb}/templates/${t.id}/apply`, { confirm: true })).body.summary;
    expect(second).toMatchObject({ services: 0, workflows: 0, customFields: 0 });
    // Asked for, a copy is added under a new name.
    const copy = (await b.post(`/c/${cb}/templates/${t.id}/apply`, { confirm: true, duplicates: 'copy' })).body.summary;
    expect(copy.copied).toContain('Service "Fuel delivery" added as "Fuel delivery (2)"');
  });

  it('keeps people and untested work out, and a published copy is anonymous and blank', async () => {
    const t: TriCounty = await triCounty();
    // A workflow naming Priya as the approver, switched on.
    const def = { trigger: { event: 'job.unsuccessful' }, conditions: [], steps: [{ id: 'f', action: 'job.create_followup', params: {}, mode: null, approval: { required: 'always', conditions: [], approverRoles: [], approverUserIds: [t.ids.priya], backupUserIds: [t.ids.marcus], escalateAfterHours: null }, onException: { notifyRoles: ['owner'], stop: true } }] };
    const wf = (await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Priya approves follow-ups', definition: def })).body;
    await t.dana.post(`/c/${t.cid}/workflows/${wf.id}/versions/${wf.versionId}/test`, {});
    await t.dana.post(`/c/${t.cid}/workflows/${wf.id}/versions/${wf.versionId}/activate`);
    // One tested but not switched on, one never tested.
    const tested = (await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Tested draft', definition: { ...def, steps: [{ ...def.steps[0], approval: { ...def.steps[0].approval, approverUserIds: [], backupUserIds: [], approverRoles: ['owner'] } }] } })).body;
    await t.dana.post(`/c/${t.cid}/workflows/${tested.id}/versions/${tested.versionId}/test`, {});
    await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Untested idea', definition: def });
    const tpl = (await t.dana.post(`/c/${t.cid}/templates`, { name: 'Tri-County setup', includeTestedDrafts: true })).body;
    const stored = (await (await getDb()).query<any>(`select content from rigo.templates where id = $1`, [tpl.id])).rows[0].content;
    const names = stored.workflows.map((w: any) => w.name);
    expect(names).toContain('Priya approves follow-ups');
    expect(names).toContain('Tested draft');
    expect(names).not.toContain('Untested idea');
    expect(JSON.stringify(stored)).not.toContain(t.ids.priya);
    expect(JSON.stringify(stored)).not.toContain(t.ids.marcus);
    expect(JSON.stringify(stored)).not.toContain('Tri-County Field Services');
    // Published: others see a blank copy without the draft, labeled, without the owner's name.
    await t.dana.patch(`/c/${t.cid}/templates/${tpl.id}`, { visibility: 'public' });
    const other = await signup('Someone Else');
    const co = await newCompany(other, [], 'Elsewhere');
    const listed = (await other.get(`/c/${co}/templates`)).body.templates.find((x: any) => x.id === tpl.id);
    expect(listed).toMatchObject({ madeBy: 'Made by another Rigo user', owner_name: null });
    expect(listed.summary.workflows).not.toContain('Tested draft');
    const seen = (await other.get(`/c/${co}/templates/${tpl.id}`)).body.template.content;
    expect(seen.workflows.map((w: any) => w.name)).not.toContain('Tested draft');
    expect(JSON.stringify(seen)).not.toMatch(/"rateE4":\d/);
    // Unpublished: gone for others.
    await t.dana.patch(`/c/${t.cid}/templates/${tpl.id}`, { visibility: 'private' });
    expect((await other.get(`/c/${co}/templates/${tpl.id}`)).status).toBe(404);
  });
});
