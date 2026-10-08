import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, Inbox as InboxIcon, PauseCircle, Hand, Check, CircleDot, Circle, CircleCheck, X } from 'lucide-react';
import { useMe } from '../lib/session';
import { useTitle } from '../lib/title';
import { Wordmark, LinkButton, BrandMark } from '../components/ui';
import { TEMPLATES } from '../../shared/templates';

// The front page: mostly the vision, plus sign-up. Hero, the same screen in four businesses' words,
// one request all the way to a payment, you stay in charge, templates, what isn't connected yet,
// sign-up again.

const BUSINESSES = [
  { key: 'salon', label: 'Salon', name: 'Rosa Hair', work: ['Appointment', 'Appointments'], customer: 'Client', person: 'Stylist', rows: [['9:00', 'Haircut', 'Maya Chen', 'Checked in', 'active'], ['10:30', 'Color', 'Jordan Ellis', 'Booked', 'open'], ['1:00', 'Haircut', 'Sam Ortiz', 'Booked', 'open']] },
  { key: 'cleaning', label: 'Cleaner', name: 'Bright Homes', work: ['Visit', 'Visits'], customer: 'Client', person: 'Cleaner', rows: [['8:00', 'Deep clean', '7 Birch Ln', 'In progress', 'active'], ['12:30', 'Standard clean', '48 Maple St', 'Booked', 'open'], ['3:00', 'Move-out clean', '12 Harbor Rd', 'Booked', 'open']] },
  { key: 'bakery', label: 'Bakery', name: 'Maple Street Bakery', work: ['Order', 'Orders'], customer: 'Customer', person: 'Baker', rows: [['7:00', 'Custom cake', 'Priya Nair', 'Preparing', 'active'], ['11:00', 'Catering tray ×5', 'Riverside Clinic', 'Confirmed', 'open'], ['4:00', 'Dozen cupcakes', 'Harbor View', 'Delivered', 'finished']] },
  { key: 'fuel', label: 'Fuel delivery', name: 'Tri-County Fuel', work: ['Job', 'Jobs'], customer: 'Customer', person: 'Driver', rows: [['6:30', 'Diesel, 250 gal', 'Hollis Farm', 'Done', 'finished'], ['9:00', 'Septic pump-out', '300 River Rd', 'In progress', 'active'], ['1:30', 'Portable toilets ×4', 'Lakeview Park', 'Scheduled', 'open']] },
] as const;

const ICON = { open: <Circle aria-hidden="true" />, active: <CircleDot aria-hidden="true" />, finished: <CircleCheck aria-hidden="true" /> } as const;

function TodayMock({ b }: { b: (typeof BUSINESSES)[number] }) {
  return (
    <div className="mock" aria-label={`${b.name}: today’s ${b.work[1].toLowerCase()}`}>
      <div className="row-between"><div className="mock-bar" aria-hidden="true"><i /><i /><i /></div><span className="tiny muted">{b.name}</span></div>
      <div className="row-between"><strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem' }}>Today</strong><span className="btn btn-primary btn-sm" aria-hidden="true">+ New {b.work[0].toLowerCase()}</span></div>
      <ul className="divider-list">
        {b.rows.map(([t, what, who, stage, m]) => (
          <li key={t} className="list-row" style={{ paddingInline: 0, minHeight: 56 }}>
            <span className="time" style={{ width: 48, fontWeight: 600 }}>{t}</span>
            <span className="row-main"><span className="row-title">{what}</span><span className="row-sub">{who}</span></span>
            <span className={`badge badge-${m}`}>{ICON[m as keyof typeof ICON]}{stage}</span>
          </li>
        ))}
      </ul>
      <div className="row tiny muted" style={{ justifyContent: 'space-between' }}><span>{b.work[1]} · {b.customer}s · {b.person}s</span><span className="row"><InboxIcon size={14} aria-hidden="true" />2 waiting</span></div>
    </div>
  );
}

const NOT_YET = [
  ['Email and text sending', 'Messages are prepared for you. They send only once the business connects an email or text service; until then you copy and send them yourself.'],
  ['Card payments', 'Rigo records the payments you receive. It doesn’t take card payments yet.'],
  ['Maps and routes', 'Addresses open in your maps app. There is no route planning yet.'],
  ['The AI assistant', 'Coming after launch. Today, suggestions come from simple word matching, and Rigo never uses AI for prices or totals.'],
  ['App Store and Google Play', 'Rigo installs from the browser on any phone for now.'],
];

export function Landing() {
  useTitle('One place to run your business');
  const me = useMe();
  const signedIn = !!me.data?.user;
  const [biz, setBiz] = useState<(typeof BUSINESSES)[number]['key']>('salon');
  const b = BUSINESSES.find((x) => x.key === biz)!;
  const start = signedIn ? '/start' : '/signup';
  const demo = signedIn ? '/demo' : '/signup?next=%2Fdemo';
  return (
    <div className="public" style={{ display: 'block' }}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="public-top">
        <Wordmark />
        <nav className="row" aria-label="Site">
          <Link to="/templates" className="btn btn-ghost">Templates</Link>
          {signedIn ? <LinkButton to="/home" variant="primary">Open Rigo</LinkButton> : <><Link to="/signin" className="btn btn-ghost">Sign in</Link><LinkButton to="/signup" variant="primary">Create a free workspace</LinkButton></>}
        </nav>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="hero-h">
          <div className="stack-lg">
            <span className="kicker">For any business</span>
            <h1 id="hero-h">One place to run your business, whatever it is.</h1>
            <p className="lead">Bookings, the schedule, your team on their phones, invoices and payments. In your own words. Rigo prepares the routine and you approve it.</p>
            <div className="row">
              <LinkButton to={start} variant="primary" size="lg" icon={<ArrowRight size={18} aria-hidden="true" />}>Create a free workspace</LinkButton>
              <LinkButton to={demo} size="lg" icon={<Eye size={18} aria-hidden="true" />}>Try a demo</LinkButton>
            </div>
            <p className="small muted">Free to create. No card needed.</p>
          </div>
          <TodayMock b={BUSINESSES[3]} />
        </section>

        <section className="section section-alt" aria-labelledby="words-h">
          <div className="section-inner">
            <div className="stack"><span className="kicker">Your words</span><h2 id="words-h">The same screen, in every business’s own words</h2>
              <p className="lead">A salon books appointments for clients. A bakery takes orders. A fuel company runs jobs. Rename everything, build your own stages, and Rigo follows.</p></div>
            <div className="segmented" role="group" aria-label="Business" style={{ justifySelf: 'start' }}>
              {BUSINESSES.map((x) => <button key={x.key} type="button" aria-pressed={biz === x.key} onClick={() => setBiz(x.key)}>{x.label}</button>)}
            </div>
            <div className="grid-2" style={{ alignItems: 'center' }}>
              <TodayMock b={b} />
              <dl className="details" style={{ gridTemplateColumns: '1fr' }}>
                <div><dt>The main record</dt><dd style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700 }}>{b.work[1]}</dd></div>
                <div><dt>Who it’s for</dt><dd style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700 }}>{b.customer}s</dd></div>
                <div><dt>Who does it</dt><dd style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700 }}>{b.person}s, on their phones</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="flow-h">
          <div className="section-inner">
            <div className="stack"><span className="kicker">A day of work</span><h2 id="flow-h">From a request to a payment, without retyping anything</h2></div>
            <ol className="flow-steps">
              <li><strong>A request comes in</strong><span className="small muted">From your booking page, or you add it. It lands in your inbox.</span></li>
              <li><strong>It becomes a booking</strong><span className="small muted">Pick a time and a person. Rigo prepares the confirmation for you to send.</span></li>
              <li><strong>The work gets done</strong><span className="small muted">Your team moves it along on their phones, even with no signal.</span></li>
              <li><strong>The invoice is ready</strong><span className="small muted">Built from the finished work with exact totals. A missing price holds it.</span></li>
              <li><strong>The payment is recorded</strong><span className="small muted">See who owes what, and how late, at a glance.</span></li>
            </ol>
          </div>
        </section>

        <section className="section section-alt" aria-labelledby="charge-h">
          <div className="section-inner">
            <div className="stack"><span className="kicker">You stay in charge</span><h2 id="charge-h">Rigo prepares. You decide.</h2>
              <p className="lead">Choose how much Rigo does, for the whole business or one task at a time. Nothing ever approves itself.</p></div>
            <div className="levels">
              <div className="card stack-sm"><h3>Manual</h3><p className="small muted">You do each step. Rigo shows what’s next.</p></div>
              <div className="card stack-sm tint"><h3>Assisted <span className="small muted" style={{ fontWeight: 400 }}>· the default</span></h3><p className="small">Rigo prepares invoices and messages. A person approves before anything happens.</p></div>
              <div className="card stack-sm"><h3>Automatic</h3><p className="small muted">Rigo does it and records why. Anything that moves money asks you first.</p></div>
            </div>
            <ul className="grid-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <li className="row" style={{ alignItems: 'flex-start' }}><InboxIcon aria-hidden="true" /><span><strong>One inbox</strong><br /><span className="small muted">Everything waiting for a person, in one place.</span></span></li>
              <li className="row" style={{ alignItems: 'flex-start' }}><PauseCircle aria-hidden="true" /><span><strong>A pause button</strong><br /><span className="small muted">Stop everything at once; resume when you’re ready.</span></span></li>
              <li className="row" style={{ alignItems: 'flex-start' }}><Hand aria-hidden="true" /><span><strong>Take over</strong><br /><span className="small muted">Grab any item and do it yourself.</span></span></li>
            </ul>
          </div>
        </section>

        <section className="section" aria-labelledby="tpl-h">
          <div className="section-inner">
            <div className="stack"><span className="kicker">Templates</span><h2 id="tpl-h">Start from a business like yours</h2>
              <p className="lead">Describe your business in one sentence and Rigo suggests a template. It brings words, stages and roles, never prices or data.</p></div>
            <ul className="grid-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {TEMPLATES.filter((t) => t.key !== 'general').map((t) => (
                <li key={t.key} className="card stack-sm"><h3>{t.name}</h3><p className="small muted">{t.examples.slice(0, 4).join(' · ')}</p>
                  <p className="small">{t.structure.stages.map((s) => s.name).join(' → ')}</p>
                  <Link to={signedIn ? `/demo?template=${t.key}` : `/signup?next=${encodeURIComponent(`/demo?template=${t.key}`)}`} className="small">Try it as a demo</Link></li>
              ))}
            </ul>
            <Link to="/templates">See every template, including ones other businesses shared</Link>
          </div>
        </section>

        <section className="section section-alt" aria-labelledby="honest-h">
          <div className="section-inner">
            <div className="stack"><span className="kicker">Honest</span><h2 id="honest-h">What isn’t connected yet</h2>
              <p className="lead">Rigo never claims a send, a payment or an approval that didn’t happen. Here is what it doesn’t do yet.</p></div>
            <ul className="grid-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {NOT_YET.map(([t, d]) => <li key={t} className="card row" style={{ alignItems: 'flex-start' }}><X aria-hidden="true" style={{ color: 'var(--text-2)', flex: 'none' }} /><span><strong>{t}</strong><br /><span className="small muted">{d}</span></span></li>)}
            </ul>
          </div>
        </section>

        <section className="section" aria-labelledby="end-h">
          <div className="section-inner" style={{ justifyItems: 'center', textAlign: 'center' }}>
            <BrandMark size={48} />
            <h2 id="end-h" style={{ maxWidth: '20ch' }}>Set up your workspace in five minutes</h2>
            <p className="lead">Name it, describe it in a sentence, adjust what Rigo suggests, and invite your team.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <LinkButton to={start} variant="primary" size="lg" icon={<ArrowRight size={18} aria-hidden="true" />}>Create a free workspace</LinkButton>
              <LinkButton to={demo} size="lg">Try a demo</LinkButton>
            </div>
            <ul className="row small muted" style={{ listStyle: 'none', padding: 0, justifyContent: 'center' }}>
              {['Free to create', 'Works on computer and phone', 'Your data stays yours'].map((x) => <li key={x} className="row" style={{ gap: 6 }}><Check size={16} aria-hidden="true" />{x}</li>)}
            </ul>
          </div>
        </section>
      </main>
      <footer className="footer">© Rigo · <Link to="/templates">Templates</Link> · <Link to="/signin">Sign in</Link></footer>
    </div>
  );
}
