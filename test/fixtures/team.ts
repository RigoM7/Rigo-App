import { signup, invite, type Client } from '../helpers.js';

// A field-service workspace with a full team: Dana (owner), Marcus (dispatcher), Priya (office) and
// four drivers. Each is a real account; roles come from the field-service template.

export interface Team {
  cid: string;
  dana: Client; marcus: Client; priya: Client; luis: Client; sam: Client; jo: Client; tyler: Client;
  ids: Record<'dana' | 'marcus' | 'priya' | 'luis' | 'sam' | 'jo' | 'tyler', string>;
}

export async function team(name = 'Tri-County Field Services'): Promise<Team> {
  const dana = await signup('Dana');
  const people = { marcus: await signup('Marcus'), priya: await signup('Priya'), luis: await signup('Luis'), sam: await signup('Sam'), jo: await signup('Jo'), tyler: await signup('Tyler') };
  const r = await dana.post('/companies', { name, templateKey: 'field_service', timezone: 'America/Chicago', currency: 'USD' });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const cid = r.body.id as string;
  await invite(dana, cid, people.marcus, 'dispatcher');
  await invite(dana, cid, people.priya, 'office');
  for (const d of ['luis', 'sam', 'jo', 'tyler'] as const) await invite(dana, cid, people[d], 'driver');
  const ids = Object.fromEntries(await Promise.all([['dana', dana] as const, ...Object.entries(people)].map(async ([k, c]) => [k, (await c.get('/auth/me')).body.user.id]))) as Team['ids'];
  return { cid, dana, ...people, ids };
}
