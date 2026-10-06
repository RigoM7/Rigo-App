import { Link } from 'react-router-dom';
import { CalendarClock, Smartphone, ReceiptText, ShieldCheck, PauseCircle, WifiOff, FlaskConical, Building2, UserPlus } from 'lucide-react';
import { LinkButton, Wordmark } from '../components/ui';
import { useDocumentTitle } from '../lib/title';
import { useResolvedTheme } from '../lib/theme';

// Real screenshots of the demo company (fictional sample data), in both themes.
// Regenerate with scripts/landing-shots.mjs after visible changes to these screens.
const SHOTS = {
  timeline: { w: 1440, h: 900, alt: "Rigo's Home screen for an office: today's jobs on a timeline, one lane per driver, with an unassigned job at the top." },
  driver: { w: 780, h: 1688, alt: "A driver's fuel delivery on a phone: the address, time and gate code first, the record saved on the phone, and a Submit to office button." },
  invoice: { w: 1440, h: 1100, alt: 'An invoice Rigo prepared from a completed septic job. It is on hold because no price is set for the service yet, so it cannot be approved or sent.' },
} as const;

function Shot({ name, eager, className }: { name: keyof typeof SHOTS; eager?: boolean; className?: string }) {
  const theme = useResolvedTheme();
  const s = SHOTS[name];
  return (
    <figure className={`lp-shot ${className ?? ''}`}>
      <img src={`/landing/${name}-${theme}.webp`} width={s.w} height={s.h} alt={s.alt}
        loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} />
      <figcaption>Shown with the demo's sample company. All names and numbers are fictional.</figcaption>
    </figure>
  );
}

/** The signed-out front page: what Rigo is, who it's for, and how to start. Every claim here is built today. */
export function Landing() {
  useDocumentTitle('Rigo: run your fuel, portable toilet or septic business');
  return (
    <div className="lp">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="plain-top lp-top">
        <Wordmark to="/" />
        <span className="spacer" />
        <Link to="/signin" className="btn btn-sm">Sign in</Link>
        <Link to="/signup" className="btn btn-sm lp-top-cta">Create a free account</Link>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-hero-copy">
            <h1 id="lp-h1">Run your fuel delivery, portable toilet or septic business in one place.</h1>
            <p className="lp-lead">Free to start. Plan the day, give drivers a simple phone screen, and send invoices built from what was delivered.</p>
            <div className="lp-ctas">
              <LinkButton variant="primary" size="lg" to="/signup">Create a free account</LinkButton>
              <LinkButton size="lg" to="/signup?next=/start-demo" icon={<FlaskConical aria-hidden />}>Try the demo</LinkButton>
            </div>
          </div>
          <Shot name="timeline" eager className="lp-hero-shot" />
        </section>

        <section className="lp-office" aria-labelledby="lp-office">
          <h2 id="lp-office">The office sees the whole day</h2>
          <p>Every job on one timeline, a lane for each driver. Unassigned work sits at the top, and you pick a driver and truck from a list.</p>
          <ul className="lp-points lp-points-2">
            <li><CalendarClock aria-hidden /><span>One set of customers, service locations, trucks and equipment for all your services.</span></li>
            <li><ShieldCheck aria-hidden /><span>Each person sees only what their role allows. Drivers never see your prices.</span></li>
          </ul>
        </section>

        <section className="lp-split" aria-labelledby="lp-driver">
          <Shot name="driver" className="lp-phone" />
          <div className="lp-split-copy">
            <h2 id="lp-driver">Drivers get a phone screen that keeps up</h2>
            <p>Big buttons, the address and gate code first, and the gallons or units they actually delivered. Notes, photos and a signature when you need them.</p>
            <ul className="lp-points">
              <li><WifiOff aria-hidden /><span>Weak signal? The job is saved on the phone and sent to the office when the connection comes back.</span></li>
              <li><Smartphone aria-hidden /><span>A job only counts as done once the office has the driver's record.</span></li>
            </ul>
          </div>
        </section>

        <section className="lp-split lp-split-wide" aria-labelledby="lp-owner">
          <div className="lp-split-copy">
            <h2 id="lp-owner">You stay in charge of the money</h2>
            <p>Rigo prepares each invoice from what the driver recorded, using your prices. If a price is missing, the invoice waits for you instead of going out wrong.</p>
            <ul className="lp-points">
              <li><ReceiptText aria-hidden /><span>Approve, edit or reject an invoice before it goes anywhere.</span></li>
              <li><PauseCircle aria-hidden /><span>Pause Rigo's routine work at any time, and take over any step yourself.</span></li>
            </ul>
          </div>
          <Shot name="invoice" />
        </section>

        <section className="lp-honest" aria-labelledby="lp-honest-h">
          <h2 id="lp-honest-h">What Rigo doesn't do yet</h2>
          <p>We'd rather tell you now. These are not connected today:</p>
          <ul>
            <li><strong>Sending email or text messages to your customers.</strong> Rigo writes the message; you copy it and send it yourself.</li>
            <li><strong>Taking card payments.</strong> You record payments you receive.</li>
            <li><strong>Maps and routes.</strong> Addresses are kept as text, with a button to copy them.</li>
            <li><strong>AI answers.</strong> The assistant uses prepared answers that are clearly labeled.</li>
          </ul>
        </section>

        <section className="lp-start" aria-labelledby="lp-start-h">
          <h2 id="lp-start-h">How to start</h2>
          <ol>
            <li><FlaskConical aria-hidden /><div><strong>Try the demo.</strong> A sample company with fuel, toilet and septic jobs. Nothing is sent, charged or connected.</div></li>
            <li><Building2 aria-hidden /><div><strong>Create your company.</strong> It's free and starts empty. Add your services, prices and trucks.</div></li>
            <li><UserPlus aria-hidden /><div><strong>Invite your team.</strong> Drivers and office staff join with a link and see only their part.</div></li>
          </ol>
          <div className="lp-ctas">
            <LinkButton variant="primary" size="lg" to="/signup">Create a free account</LinkButton>
            <LinkButton size="lg" to="/signup?next=/start-demo" icon={<FlaskConical aria-hidden />}>Try the demo</LinkButton>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <Wordmark to="/" />
        <span className="small muted">Business software for fuel delivery, portable toilet and septic companies.</span>
        <Link to="/signin" className="small">Sign in</Link>
      </footer>
    </div>
  );
}
