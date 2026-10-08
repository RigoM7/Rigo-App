import { describe, it, expect } from 'vitest';
import { signup, newCompany, invite } from './helpers.js';
import { team } from './fixtures/team.js';
import { TEMPLATES, matchTemplates, suggestTemplate, structureOf, templateByKey } from '../src/shared/templates.js';
import {
  stageProblems, moveProblem, nextStages, structureProblems, structureSchema, wordsOf, count, lower, cleanValues, fieldKey,
  fieldSensitivity, effectivePermissions, DEFAULT_WORDS, type StageDef,
} from '../src/shared/workspace.js';

// Step 1 of the rebuild: the workspace model (words, record types and fields, stages tagged with a
// meaning, roles) on top of the kept accounts and isolation.

describe('templates and word matching (no AI)', () => {
  it('every built-in template is a valid structure with no prices, people or records', () => {
    for (const t of TEMPLATES) {
      expect(structureSchema.safeParse(t.structure).success, t.key).toBe(true);
      expect(structureProblems(t.structure), t.key).toEqual([]);
      expect(t.structure.catalog.every((c) => Object.keys(c).sort().join() === 'name,taxable,unit'), t.key).toBe(true);
      expect(Object.keys(t.structure).sort()).toEqual(['catalog', 'equipment', 'fields', 'roles', 'stages', 'words']);
    }
    expect(TEMPLATES.map((t) => t.key)).toEqual(['field_service', 'cleaning', 'appointments', 'orders', 'general']);
  });

  it('suggests the closest template from one sentence', () => {
    expect(suggestTemplate('We deliver fuel and pump septic tanks').key).toBe('field_service');
    expect(suggestTemplate('Portable toilet rentals for events').key).toBe('field_service');
    expect(suggestTemplate('I run a house cleaning business').key).toBe('cleaning');
    expect(suggestTemplate('Mobile dog grooming').key).toBe('appointments');
    expect(suggestTemplate('Hair salon with three chairs').key).toBe('appointments');
    expect(suggestTemplate('Math tutoring for high school students').key).toBe('appointments');
    expect(suggestTemplate('Custom cakes and catering').key).toBe('orders');
    expect(suggestTemplate('A small bakery').key).toBe('orders');
    // Nothing recognisable: the general template, never a guess.
    expect(suggestTemplate('We do things').key).toBe('general');
    expect(suggestTemplate('').key).toBe('general');
    const m = matchTemplates('Café that bakes bread');
    expect(m[0]).toMatchObject({ key: 'orders' });
    expect(m[0].matched).toEqual(expect.arrayContaining(['bake', 'bread']));
  });

  it('a template copy never shares objects with the template', () => {
    const s = structureOf(templateByKey('cleaning')!);
    s.words.work.one = 'Clean';
    expect(templateByKey('cleaning')!.structure.words.work.one).toBe('Visit');
  });
});

describe('stages, fields and words (shared rules)', () => {
  const stages: StageDef[] = [
    { key: 'new', name: 'New', meaning: 'open', next: ['doing', 'cancelled'] },
    { key: 'doing', name: 'Doing', meaning: 'active', requires: ['qty'] },
    { key: 'done', name: 'Done', meaning: 'finished' },
    { key: 'cancelled', name: 'Cancelled', meaning: 'cancelled' },
  ];
  const fields = [{ key: 'qty', label: 'Quantity' }];

  it('needs an Open and a Finished stage, unique names and real links', () => {
    expect(stageProblems(stages, fields)).toEqual([]);
    expect(stageProblems(stages.filter((s) => s.meaning !== 'finished'), fields)).toContain('Add a stage marked Finished, so finished work can be billed.');
    expect(stageProblems(stages.filter((s) => s.meaning !== 'open'), fields)[0]).toMatch(/marked Open/);
    expect(stageProblems([...stages, { key: 'new2', name: 'new', meaning: 'open' }], fields)).toContain('Two stages are called new.');
    expect(stageProblems([{ ...stages[0], next: ['nowhere'] }, ...stages.slice(1)], fields)).toContain("New leads to a stage that doesn't exist.");
    expect(stageProblems(stages, [])).toContain("Doing requires a field that doesn't exist.");
  });

  it('moves only along the paths the owner allows, with the information a stage needs', () => {
    expect(moveProblem(stages[0], stages[2], {}, fields)).toBe("Work in New can't move to Done.");
    expect(moveProblem(stages[0], stages[1], {}, fields)).toBe('Fill in Quantity before moving to Doing.');
    expect(moveProblem(stages[0], stages[1], { qty: '3' }, fields)).toBeNull();
    expect(moveProblem(stages[1], stages[2], {}, fields)).toBeNull(); // no paths set: anywhere
    expect(nextStages(stages[0], stages).map((s) => s.key)).toEqual(['doing', 'cancelled']);
    expect(nextStages(stages[2], stages).map((s) => s.key)).toEqual(['new', 'doing', 'cancelled']);
  });

  it('words fall back to defaults and read naturally in sentences', () => {
    expect(wordsOf({ work: { one: 'Appointment', many: 'Appointments' }, customer: { one: '' } })).toEqual({ ...DEFAULT_WORDS, work: { one: 'Appointment', many: 'Appointments' } });
    expect(count(1, { one: 'Visit', many: 'Visits' })).toBe('1 visit');
    expect(count(3, { one: 'Visit', many: 'Visits' })).toBe('3 visits');
    expect(lower('CPR class')).toBe('CPR class');
  });

  it('checks field values and marks contact and money fields', () => {
    const defs = [
      { key: 'qty', label: 'Quantity', type: 'number' as const, required: true },
      { key: 'size', label: 'Size', type: 'choice' as const, options: ['S', 'L'] },
      { key: 'phone', label: 'Site phone', type: 'phone' as const },
    ];
    expect(cleanValues(defs, { qty: 'many', size: 'XL', other: 'dropped' }).problems).toEqual({ qty: 'Quantity needs digits, like 2 or 1.5.', size: 'Choose one of the options for Size.' });
    expect(cleanValues(defs, { qty: '2.5', size: 'S', other: 'dropped' })).toEqual({ values: { qty: '2.5', size: 'S' }, problems: {} });
    expect(cleanValues(defs, {}).problems).toEqual({ qty: 'Fill in Quantity.' });
    expect(fieldSensitivity({ type: 'phone' })).toBe('contact');
    expect(fieldSensitivity({ type: 'money' })).toBe('money');
    expect(fieldSensitivity({ type: 'text' })).toBeNull();
    expect(fieldKey('Gate code', ['gate_code'])).toBe('gate_code_2');
    expect(fieldKey('2nd phone')).toBe('f_2nd_phone');
  });

  it('worker-app roles keep only worker permissions', () => {
    expect(effectivePermissions('worker', ['work.do', 'members.manage', 'invoices.approve'])).toEqual(['work.do']);
    expect(effectivePermissions('office', ['members.manage'])).toEqual(['members.manage']);
  });
});

describe('creating a workspace from a template', () => {
  it('applies the reviewed structure: words, roles, stages, fields and unpriced price list', async () => {
    const owner = await signup('Rosa Salon');
    const structure = structureOf(templateByKey('appointments')!);
    structure.words.customer = { one: 'Guest', many: 'Guests' };
    structure.stages = structure.stages.filter((s) => s.key !== 'checked_in');
    structure.roles.push({ key: 'assistant', name: 'Assistant', description: '', app: 'worker', permissions: ['work.view_assigned', 'work.do'] });
    const r = await owner.post('/companies', { name: 'Rosa Hair', description: 'Hair salon with three chairs', templateKey: 'appointments', structure, timezone: 'America/Denver', currency: 'USD' });
    expect(r.status).toBe(200);
    const boot = (await owner.get(`/c/${r.body.id}`)).body;
    expect(boot.workspace).toMatchObject({ name: 'Rosa Hair', templateKey: 'appointments', description: 'Hair salon with three chairs', timezone: 'America/Denver' });
    expect(boot.words.customer).toEqual({ one: 'Guest', many: 'Guests' });
    expect(boot.words.work).toEqual({ one: 'Appointment', many: 'Appointments' });
    expect(boot.stages.map((s: any) => s.name)).toEqual(['Requested', 'Booked', 'Completed', 'Cancelled', 'No-show']);
    expect(boot.stages.map((s: any) => s.meaning)).toEqual(['open', 'open', 'finished', 'cancelled', 'failed']);
    expect(boot.roles.map((x: any) => x.name)).toEqual(['Owner', 'Front desk', 'Specialist', 'Assistant']);
    expect(boot.role).toMatchObject({ key: 'owner', isOwner: true, app: 'office' });
    expect(boot.fields.customer.map((f: any) => f.key)).toEqual(['preferences', 'birthday']);
    expect(boot.equipment).toBe(true);
    // The setup checklist says prices aren't set: the template carried names only.
    expect(boot.setup.items.find((i: any) => i.key === 'prices')).toMatchObject({ done: false });
    expect(boot.setup.items.find((i: any) => i.key === 'prices').note).toMatch(/5 items have no price yet/);
  });

  it('refuses a structure that breaks the stage rules, in plain words', async () => {
    const owner = await signup();
    const structure = structureOf(templateByKey('general')!);
    structure.stages = structure.stages.filter((s) => s.meaning !== 'finished');
    const r = await owner.post('/companies', { name: 'Broken', templateKey: 'general', structure });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('Add a stage marked Finished, so finished work can be billed.');
    const owner2 = { ...structureOf(templateByKey('general')!) };
    owner2.roles = [{ key: 'owner', name: 'Boss', description: '', app: 'office', permissions: [] }];
    expect((await owner.post('/companies', { name: 'Two owners', structure: owner2 })).status).toBe(400);
  });

  it('starts from the general template when none is chosen, and asks before a duplicate name', async () => {
    const owner = await signup();
    const r = await owner.post('/companies', { name: 'Just Me' });
    expect(r.status).toBe(200);
    expect((await owner.get(`/c/${r.body.id}`)).body.workspace.templateKey).toBe('general');
    const again = await owner.post('/companies', { name: 'just me' });
    expect(again.status).toBe(409);
    expect(again.body.error.details.needsConfirm).toBe('duplicateName');
    expect((await owner.post('/companies', { name: 'just me', allowDuplicateName: true })).status).toBe(200);
  });

  it('lists the templates and matches a sentence without signing in', async () => {
    const anon = new (await import('./helpers.js')).Client('anon');
    const list = await anon.get('/templates');
    expect(list.body.templates.map((t: any) => t.key)).toContain('cleaning');
    const m = await anon.post('/templates/match', { description: 'We pump septic tanks' });
    expect(m.body.matches[0].key).toBe('field_service');
  });
});

describe('changing the model, with permissions and isolation', () => {
  it('owners change words, stages and fields; others with no setup permission cannot', async () => {
    const t = await team();
    const boot = (await t.dana.get(`/c/${t.cid}`)).body;
    const words = { ...boot.words, work: { one: 'Delivery', many: 'Deliveries' } };
    expect((await t.marcus.put(`/c/${t.cid}/words`, { words })).status).toBe(403);
    expect((await t.dana.put(`/c/${t.cid}/words`, { words })).status).toBe(200);
    expect((await t.luis.get(`/c/${t.cid}`)).body.words.work.one).toBe('Delivery');

    const stages = boot.stages.map((s: any) => ({ key: s.key, name: s.name, meaning: s.meaning }));
    const renamed = [{ ...stages[0], name: 'New request' }, ...stages.slice(1), { key: 'on_hold', name: 'On hold', meaning: 'open' }];
    expect((await t.marcus.put(`/c/${t.cid}/stages`, { stages: renamed })).status).toBe(403);
    const put = await t.dana.put(`/c/${t.cid}/stages`, { stages: renamed });
    expect(put.status).toBe(200);
    expect(put.body.stages.map((s: any) => s.name)).toEqual(['New request', 'Scheduled', 'In progress', 'Done', 'Cancelled', "Couldn't complete", 'On hold']);
    const bad = await t.dana.put(`/c/${t.cid}/stages`, { stages: stages.filter((s: any) => s.meaning !== 'open') });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/marked Open/);

    const fields = [...boot.fields.work, { key: 'tank_size', label: 'Tank size', type: 'number', unit: 'gal' }];
    expect((await t.marcus.put(`/c/${t.cid}/fields/work`, { fields })).status).toBe(403);
    expect((await t.dana.put(`/c/${t.cid}/fields/work`, { fields })).status).toBe(200);
    // A stage can require it now; removing the field then is refused until the stage changes.
    const needing = put.body.stages.map((s: any) => ({ key: s.key, name: s.name, meaning: s.meaning, ...(s.key === 'in_progress' ? { requires: ['tank_size'] } : {}) }));
    expect((await t.dana.put(`/c/${t.cid}/stages`, { stages: needing })).status).toBe(200);
    expect((await t.dana.put(`/c/${t.cid}/fields/work`, { fields: boot.fields.work })).status).toBe(409);
    expect((await t.dana.put(`/c/${t.cid}/fields/nonsense`, { fields: [] })).status).toBe(400);
  });

  it('workers see only the work fields marked for them, and no money settings', async () => {
    const t = await team();
    const boot = (await t.luis.get(`/c/${t.cid}`)).body;
    expect(boot.role.app).toBe('worker');
    expect(boot.fields.work.every((f: any) => f.forWorkers)).toBe(true);
    expect(boot.workspace.taxRateBp).toBeUndefined();
    expect(boot.setup).toBeNull();
    const office = (await t.priya.get(`/c/${t.cid}`)).body;
    expect(office.workspace.taxRateBp).toBeNull();
  });

  it('another workspace owner gets 404 for every part of the model', async () => {
    const t = await team();
    const other = await signup('Other Owner');
    await newCompany(other, 'cleaning', 'Other Clean');
    for (const p of [`/c/${t.cid}`, `/c/${t.cid}/stages`, `/c/${t.cid}/roles`, `/c/${t.cid}/members`]) {
      expect((await other.get(p)).status, p).toBe(404);
    }
    expect((await other.put(`/c/${t.cid}/words`, { words: DEFAULT_WORDS })).status).toBe(404);
    expect((await other.put(`/c/${t.cid}/stages`, { stages: [] })).status).toBe(404);
    expect((await other.put(`/c/${t.cid}/fields/work`, { fields: [] })).status).toBe(404);
    expect((await other.patch(`/c/${t.cid}/settings`, { name: 'Taken' })).status).toBe(404);
  });

  it('a person can be an owner in one workspace and a worker in another', async () => {
    const a = await signup('Alice');
    const b = await signup('Bob');
    const ca = await newCompany(a, 'cleaning', 'Alice Cleans');
    const cb = await newCompany(b, 'field_service', 'Bob Fuel');
    await invite(b, cb, a, 'driver');
    const me = (await a.get('/auth/me')).body.companies;
    expect(me.map((c: any) => [c.name, c.role_key, c.role_app]).sort()).toEqual([['Alice Cleans', 'owner', 'office'], ['Bob Fuel', 'driver', 'worker']]);
    expect((await a.get(`/c/${ca}`)).body.words.work.one).toBe('Visit');
    expect((await a.get(`/c/${cb}`)).body.words.work.one).toBe('Job');
    expect((await a.put(`/c/${cb}/stages`, { stages: [] })).status).toBe(403);
  });

  it('setup checklist steps can be skipped and the tax rate needs price permission', async () => {
    const t = await team();
    const s = await t.dana.post(`/c/${t.cid}/setup`, { mark: 'automationChosen' });
    expect(s.body.items.find((i: any) => i.key === 'automation').done).toBe(true);
    expect((await t.marcus.post(`/c/${t.cid}/setup`, { mark: 'dismissed' })).status).toBe(403);
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { taxRateBp: 825 })).status).toBe(200);
    expect((await t.priya.get(`/c/${t.cid}`)).body.workspace.taxRateBp).toBe(825);
  });
});
