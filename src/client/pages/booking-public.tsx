import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CalendarDays } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { dayKey, fmtTime, fmtDay } from '../lib/format';
import { BrandMark, Button, TextField, TextArea, SelectField, FormError, Loading, Empty, Badge } from '../components/ui';

// A workspace's public page: customers ask for work or pick a free time. Nothing is booked until a
// person at the business accepts it. Never shows prices, people or other customers.

export function BookingPage() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['public', slug], queryFn: () => get<any>(`/public/${slug}`), retry: false });
  const [v, setV] = useState({ name: '', email: '', phone: '', address: '', message: '', catalogId: '', preferredAt: '', website: '' });
  const [day, setDay] = useState('');
  const [sent, setSent] = useState<{ when: string | null } | null>(null);
  useTitle(q.data?.headline || q.data?.name || 'Book');
  const send = useSubmit(async () => {
    const r = await post<{ when: string | null }>(`/public/${slug}/requests`, { ...v, catalogId: v.catalogId || null, preferredAt: v.preferredAt || null });
    setSent(r);
  });
  const days = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of q.data?.slots ?? []) { const k = dayKey(s, q.data.timezone); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [q.data]);
  if (q.isLoading) return <div className="main"><div className="page page-narrow"><Loading /></div></div>;
  if (q.error || !q.data) return <div className="main"><div className="page page-narrow"><Empty icon={<CalendarDays />} title="This page isn’t available">The business may have turned it off. Check the link they gave you.</Empty></div></div>;
  const d = q.data;
  const tz = d.timezone;
  const err = (k: string) => send.fieldError(k);
  return (
    <div className="public">
      <header className="public-top"><span className="brand" style={{ fontSize: '1.125rem' }}>{d.name}</span>{d.demo && <Badge tone="demo">Demo</Badge>}</header>
      <main id="main" className="main" style={{ paddingBottom: 48 }}>
        <div className="page page-narrow">
          {sent ? (
            <div className="card card-lg stack" role="status">
              <CheckCircle2 size={40} aria-hidden="true" style={{ color: 'var(--primary-text)' }} />
              <h1>Thanks, {v.name.split(' ')[0]}</h1>
              <p>{d.name} has your {d.mode === 'book' ? 'booking request' : 'request'}{sent.when ? ` for ${fmtDay(sent.when, tz)} at ${fmtTime(sent.when, tz)}` : ''}. Nothing is confirmed until they get back to you.</p>
            </div>
          ) : (
            <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); void send.run(); }} noValidate>
              <div className="stack-sm"><h1>{d.headline || (d.mode === 'book' ? `Book with ${d.name}` : `Ask ${d.name} for help`)}</h1>{d.intro && <p className="muted prose">{d.intro}</p>}</div>
              <FormError error={send.error} />
              {d.items.length > 0 && (
                <SelectField label="What do you need?" value={v.catalogId} onChange={(e) => setV({ ...v, catalogId: e.target.value })} error={err('catalogId')}>
                  <option value="">Choose…</option>
                  {d.items.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </SelectField>
              )}
              {d.mode === 'book' && (
                <fieldset className="card stack">
                  <legend className="sr-only">Pick a time</legend>
                  <h2 style={{ fontSize: '1.125rem' }}>Pick a time</h2>
                  {!days.size ? <p className="muted">No free times in the next two weeks. Send a request instead and they’ll find one.</p> : (
                    <>
                      <div className="segmented" role="radiogroup" aria-label="Day" style={{ overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%' }}>
                        {[...days.keys()].map((k) => <button key={k} type="button" role="radio" aria-checked={day === k} onClick={() => { setDay(k); setV({ ...v, preferredAt: '' }); }}>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`))}</button>)}
                      </div>
                      {day && <div className="row" role="radiogroup" aria-label="Time">
                        {days.get(day)!.map((s) => <button key={s} type="button" className="btn btn-sm" role="radio" aria-checked={v.preferredAt === s} style={v.preferredAt === s ? { background: 'var(--primary)', color: 'var(--on-primary)', borderColor: 'var(--primary)' } : undefined} onClick={() => setV({ ...v, preferredAt: s })}>{fmtTime(s, tz)}</button>)}
                      </div>}
                      {err('preferredAt') && <p className="field-error">{err('preferredAt')}</p>}
                    </>
                  )}
                </fieldset>
              )}
              <div className="card stack">
                <TextField label="Your name" autoComplete="name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} error={err('name')} />
                <div className="grid-2">
                  <TextField label="Email" type="email" autoComplete="email" optional value={v.email} maxLength={254} onChange={(e) => setV({ ...v, email: e.target.value })} error={err('email')} hint="An email or a phone number." />
                  <TextField label="Phone" type="tel" autoComplete="tel" optional value={v.phone} maxLength={40} onChange={(e) => setV({ ...v, phone: e.target.value })} error={err('phone')} />
                </div>
                <TextField label="Address" optional autoComplete="street-address" value={v.address} maxLength={300} onChange={(e) => setV({ ...v, address: e.target.value })} />
                <TextArea label="Anything else?" optional rows={3} value={v.message} maxLength={2000} onChange={(e) => setV({ ...v, message: e.target.value })} />
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px' }}><label>Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></label></div>
              </div>
              <Button type="submit" variant="primary" size="lg" busy={send.busy}>{d.mode === 'book' ? 'Request this time' : 'Send request'}</Button>
              <p className="small muted">{d.name} will get back to you. Your details go only to them.</p>
            </form>
          )}
        </div>
      </main>
      <footer className="footer row" style={{ justifyContent: 'center' }}><BrandMark size={18} /> Runs on Rigo</footer>
    </div>
  );
}
