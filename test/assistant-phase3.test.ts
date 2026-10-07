import { describe, it, expect } from 'vitest';
import { classify, isAutomationRequest, parseTime } from '../src/shared/assistant.js';

describe('what the assistant is asked (R15-M1)', () => {
  it('only a trigger plus an action becomes a proposal; questions never do', () => {
    for (const t of ['When a job is completed, prepare an invoice and ask me to approve it', 'Whenever a septic job is done, invoice it, Priya approves over $1,500, then email the customer', 'After a visit fails, notify dispatch', 'Create a workflow that emails the customer']) expect(isAutomationRequest(t), t).toBe(true);
    for (const t of ['When is Grace Okafor\'s next visit?', 'When is the next delivery for Hollis', 'Which workflows are active?', 'What needs my attention?', 'when will job 54 be done', 'Is automation on?']) expect(isAutomationRequest(t), t).toBe(false);
  });

  it('reads the everyday questions', () => {
    expect(classify("When is Grace Okafor's next visit?")).toEqual({ kind: 'customer', name: 'grace okafor', wants: 'next' });
    expect(classify('What does Hollis Family Farm owe?')).toEqual({ kind: 'customer', name: 'hollis family farm', wants: 'owes' });
    expect(classify('Who is free at 2pm tomorrow?')).toEqual({ kind: 'driversFree', day: 'tomorrow', hour: 14, minute: 0 });
    expect(classify('Which drivers are available at 9:30?')).toEqual({ kind: 'driversFree', day: 'today', hour: 9, minute: 30 });
    expect(classify('How much do we charge for dyed diesel?')).toEqual({ kind: 'price', item: 'dyed diesel' });
    expect(classify('What is the price of a pump-out?')).toEqual({ kind: 'price', item: 'pump-out' });
    expect(classify("Why can't I approve this invoice?")).toEqual({ kind: 'whyCantApprove' });
    expect(classify('Text the customer that we are late')).toEqual({ kind: 'cantYet', what: 'text' });
    expect(classify('Send Ridgeline their statement')).toEqual({ kind: 'cantYet', what: 'statement' });
    expect(classify('What needs my attention?').kind).toBe('attention');
    expect(classify('hello').kind).toBe('help');
  });

  it('reads times the way a dispatcher says them', () => {
    expect(parseTime('2pm')).toEqual({ hour: 14, minute: 0 });
    expect(parseTime('2:30 p.m.')).toEqual({ hour: 14, minute: 30 });
    expect(parseTime('at 9')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('at 3')).toEqual({ hour: 15, minute: 0 });
    expect(parseTime('noon')).toEqual({ hour: 12, minute: 0 });
    expect(parseTime('12am')).toEqual({ hour: 0, minute: 0 });
  });
});

describe('workflow proposals (R15-m1)', () => {
  it('reads a named approver and an amount, names it plainly, and lists what it left out', async () => {
    const { proposeFromText } = await import('../src/shared/proposal.js');
    const p = proposeFromText('When a septic job is completed, invoice it, Priya approves over $1,500, then email the customer, and water the plants', { people: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Priya Shah' }, { id: '00000000-0000-4000-8000-000000000002', name: 'Marcus Lee' }] });
    expect(p.name).toBe('Septic jobs: invoice, Priya approves over $1,500, email');
    const issue = p.definition!.steps.find((s) => s.action === 'invoice.issue')!;
    expect(issue.approval).toMatchObject({ required: 'conditional', approverUserIds: ['00000000-0000-4000-8000-000000000001'], conditions: [{ field: 'invoice.total_minor', op: 'gt', value: 150000 }] });
    expect(p.understood).toContain('Issue it after approval by Priya Shah when the total is over $1,500');
    expect(p.notUnderstood).toEqual(['"and water the plants"']);
  });
});
