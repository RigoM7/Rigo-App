import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, Eye, EyeOff, ChevronLeft, Loader2, CircleDot, Clock, Ban, XCircle, Send, FlaskConical, PauseCircle, Hand, Sparkles, PlayCircle, Siren, ChevronsUp, Hourglass } from 'lucide-react';
import type { ApiError } from '../lib/api';
import { useDocumentTitle } from '../lib/title';

// ------------------------------------------------------------ buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'dark' | 'ghost' | 'danger' | 'default'; size?: 'sm' | 'lg'; block?: boolean; busy?: boolean; icon?: ReactNode };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'default', size, block, busy, icon, className = '', children, disabled, type = 'button', ...rest }, ref) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Loader2 className="spin-icon" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ to, variant = 'default', size, icon, children, block }: { to: string; variant?: 'primary' | 'dark' | 'ghost' | 'danger' | 'default'; size?: 'sm' | 'lg'; icon?: ReactNode; children: ReactNode; block?: boolean }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block'].filter(Boolean).join(' ');
  return <Link to={to} className={cls}>{icon}{children}</Link>;
}

export function IconButton({ label, children, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number }) {
  return (
    <button type="button" className="icon-btn" aria-label={badge ? undefined : label} title={label} {...rest}>
      {children}
      {badge ? <><span className="sr-only">{label}</span><span className="badge-count">{badge > 99 ? '99+' : badge}</span><span className="sr-only"> unread</span></> : null}
    </button>
  );
}

// ------------------------------------------------------------ fields
export function Field({ label, hint, error, children, id, required, optionalText }: { label: ReactNode; hint?: ReactNode; error?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }) => ReactNode; id?: string; required?: boolean; optionalText?: boolean }) {
  const auto = useId();
  const fid = id ?? `f${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}{optionalText && !required ? <span className="muted" style={{ fontWeight: 400 }}> (optional)</span> : null}</label>
      {hint ? <div className="hint" id={hintId}>{hint}</div> : null}
      {children({ id: fid, 'aria-invalid': error ? true : undefined, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, required })}
      {error ? <div className="field-error" id={errId}><AlertCircle aria-hidden />{error}</div> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(p, ref) {
  return <input ref={ref} className="input" {...p} />;
});
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) { return <select className="select" {...p} />; }
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="textarea" {...p} />; }

export function PasswordInput(p: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input className="input" type={show ? 'text' : 'password'} {...p} />
      <IconButton label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</IconButton>
    </div>
  );
}

export function Checkbox({ label, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" {...p} />
      <span><span>{label}</span>{hint ? <span className="hint" style={{ display: 'block' }}>{hint}</span> : null}</span>
    </label>
  );
}

/** Linked error summary shown after a failed multi-field submit. Receives focus. */
export function ErrorSummary({ error, labels = {} }: { error: ApiError | null; labels?: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) ref.current?.focus(); }, [error]);
  if (!error) return null;
  const fields = Object.entries(error.fields ?? {});
  const missing = error.missing ?? [];
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-labelledby="err-title" className="banner banner-danger">
      <AlertCircle aria-hidden />
      <div className="stack-sm">
        <strong id="err-title">{error.message}</strong>
        {fields.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {fields.map(([k, v]) => <li key={k}><a href={`#${labels[k] ?? `f-${k.replace(/\./g, '-')}`}`}>{v}</a></li>)}
          </ul>
        )}
        {missing.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ feedback
export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'danger' ? AlertCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon aria-hidden />
      <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span role="status" className="row muted"><span className="spinner" aria-hidden /> {label}…</span>;
}

export function Skeleton({ h = 18, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

/** Skeleton shaped like a page: a header line, then a card of rows. */
export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-page" role="status" aria-label="Loading" aria-busy="true">
      <Skeleton h={30} w="min(280px, 60%)" />
      <div className="skeleton-card">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={i === 0 ? 20 : 16} w={i === 0 ? '35%' : `${92 - (i % 4) * 9}%`} />)}</div>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error as ApiError;
  if (e?.status === 403) return <Banner tone="warning" title="You don't have access to this">{e.message}</Banner>;
  if (e?.status === 404) return <Banner tone="warning" title="Not found">{e.message}</Banner>;
  return <Banner tone="danger" title="Could not load" action={retry ? <Button size="sm" onClick={retry}>Try again</Button> : undefined}>{e?.message ?? 'Something went wrong.'}</Banner>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty">{icon ? <span className="empty-icon" aria-hidden>{icon}</span> : null}<h3>{title}</h3>{children ? <div style={{ maxWidth: 460 }}>{children}</div> : null}{action}</div>;
}

/** Rigo wordmark. On the black chrome it inherits the chrome text color. */
export function Wordmark({ to, label = 'Rigo', hideText }: { to: string; label?: string; hideText?: boolean }) {
  return <Link to={to} className="brand"><span className="brand-mark" aria-hidden>R</span>{hideText ? <span className="sr-only">{label}</span> : <span>{label}</span>}</Link>;
}

/** A slow pulse for things happening right now. Static under reduced motion. */
export function LiveDot({ label }: { label?: string }) {
  return <span className="live-dot" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Numbers that tick to their new value when they change (instant under reduced motion). */
export function TickNumber({ value, format = (n: number) => String(n) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(start) || !Number.isFinite(value)) { from.current = value; setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className="num">{format(shown)}</span>;
}

/** Inline "Ask Rigo" suggestion that opens the Assistant with context. */
export function AskRigo({ to, prompt, children = 'Ask Rigo' }: { to: string; prompt: string; children?: ReactNode }) {
  return <Link className="ask-rigo no-print" to={`${to}?ask=${encodeURIComponent(prompt)}`}><Sparkles aria-hidden />{children}</Link>;
}

export function Card({ title, actions, children, flush, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; id?: string }) {
  return (
    <section className={`card${flush ? ' card-flush' : ''}`} aria-labelledby={title && id ? `${id}-t` : undefined}>
      {(title || actions) && <div className="card-title" style={flush ? { padding: '16px 16px 0' } : undefined}>{typeof title === 'string' ? <h2 id={id ? `${id}-t` : undefined}>{title}</h2> : title}{actions ? <div className="row">{actions}</div> : null}</div>}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, actions, back, docTitle }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; docTitle?: string }) {
  // The tab title follows the page heading; pages with a non-text heading pass docTitle.
  useDocumentTitle(docTitle ?? (typeof title === 'string' ? title : null));
  return (
    <div className="stack-sm">
      {back && <Link className="back-link" to={back.to}><ChevronLeft aria-hidden />{back.label}</Link>}
      <div className="page-header">
        <div style={{ minWidth: 0 }}><h1>{title}</h1>{sub ? <div className="sub">{sub}</div> : null}</div>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ status pills (always icon + text, never color alone)
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand' | 'demo';
const toneIcon: Record<Tone, ReactNode> = {
  neutral: <CircleDot aria-hidden />, info: <Clock aria-hidden />, success: <CheckCircle2 aria-hidden />, warning: <AlertTriangle aria-hidden />,
  danger: <XCircle aria-hidden />, brand: <CircleDot aria-hidden />, demo: <FlaskConical aria-hidden />,
};
export function Pill({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{icon ?? toneIcon[tone]}{children}</span>;
}

const JOB_TONES: Record<string, [Tone, string]> = {
  // in_progress uses the live red: it is the one status that is happening right now.
  draft: ['neutral', 'Draft'], open: ['info', 'Open'], in_progress: ['brand', 'In progress'], completed: ['success', 'Completed'],
  partial: ['warning', 'Partial'], unsuccessful: ['danger', 'Unsuccessful'], cancelled: ['neutral', 'Cancelled'],
};
export function JobStatus({ status }: { status: string }) {
  const [tone, label] = JOB_TONES[status] ?? ['neutral', status];
  if (status === 'in_progress') return <span className="pill pill-brand"><LiveDot />{label}</span>;
  return <Pill tone={tone} icon={status === 'cancelled' ? <Ban aria-hidden /> : undefined}>{label}</Pill>;
}

/** Urgent / Emergency pill (icon and text). Normal priority shows nothing. */
export function PriorityPill({ priority }: { priority?: string | null }) {
  if (priority === 'emergency') return <Pill tone="danger" icon={<Siren aria-hidden />}>Emergency</Pill>;
  if (priority === 'urgent') return <Pill tone="warning" icon={<ChevronsUp aria-hidden />}>Urgent</Pill>;
  return null;
}

/** "Late": an open job whose time window ended without being started (rule in shared/jobs). */
export function LatePill() {
  return <Pill tone="warning" icon={<Hourglass aria-hidden />}>Late</Pill>;
}

/**
 * Marks a control the demo walkthrough can point at. The walkthrough draws a dashed outline with a
 * text label around this wrapper, outside the control and its focus ring.
 */
export function GuideTarget({ id, children, block }: { id: string; children: ReactNode; block?: boolean }) {
  return <span className={`guide-target${block ? ' block' : ''}`} data-guide-target={id}>{children}</span>;
}

const INVOICE_TONES: Record<string, [Tone, string]> = {
  held: ['warning', 'On hold'], draft: ['neutral', 'Draft'], pending_approval: ['info', 'Awaiting approval'], approved: ['info', 'Approved'], issued: ['success', 'Issued'], void: ['neutral', 'Void'],
};
export function InvoiceStatus({ status }: { status: string }) {
  const [tone, label] = INVOICE_TONES[status] ?? ['neutral', status];
  return <Pill tone={tone}>{label}</Pill>;
}

const ACTION_TONES: Record<string, [Tone, string, ReactNode?]> = {
  suggested: ['neutral', 'Next step (manual)', <Hand aria-hidden key="h" />], proposed: ['info', 'Proposed'], waiting_approval: ['warning', 'Waiting for approval'], queued: ['info', 'Queued'],
  running: ['brand', 'Running', <PlayCircle aria-hidden key="r" />], completed: ['success', 'Completed'], simulated: ['demo', 'Simulated'], failed: ['danger', 'Failed'], blocked: ['warning', 'Blocked'],
  rejected: ['danger', 'Rejected'], cancelled: ['neutral', 'Cancelled'],
};
export function ActionStatus({ status, held }: { status: string; held?: boolean }) {
  if (held) return <Pill tone="warning" icon={<PauseCircle aria-hidden />}>Held (paused)</Pill>;
  const [tone, label, icon] = ACTION_TONES[status] ?? ['neutral', status];
  return <Pill tone={tone} icon={icon}>{label}</Pill>;
}

const MSG_TONES: Record<string, [Tone, string, ReactNode?]> = {
  prepared: ['neutral', 'Prepared, not sent'], simulated: ['demo', 'Simulated'], queued: ['info', 'Queued'], sent: ['success', 'Sent', <Send aria-hidden key="s" />],
  delivered: ['success', 'Delivered'], failed: ['danger', 'Failed'], replied: ['info', 'Replied'],
};
export function MessageStatus({ status }: { status: string }) {
  const [tone, label, icon] = MSG_TONES[status] ?? ['neutral', status];
  return <Pill tone={tone} icon={icon}>{label}</Pill>;
}

// ------------------------------------------------------------ dialog
export function Dialog({ open, onClose, title, children, footer, labelledBy }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const tid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={labelledBy ?? tid} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && <>
        <div className="dialog-head"><h2 id={tid}>{title}</h2><IconButton label="Close" onClick={onClose}><X aria-hidden /></IconButton></div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </>}
    </dialog>
  );
}

/** Side panel that slides in from the right. Uses a modal <dialog> so focus is contained and Escape closes it. */
export function Drawer({ open, onClose, title, sub, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const tid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="drawer" aria-labelledby={tid} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && <>
        <div className="drawer-head"><div style={{ minWidth: 0 }}><h2 id={tid}>{title}</h2>{sub ? <div className="small muted" style={{ marginTop: 4 }}>{sub}</div> : null}</div><IconButton label="Close panel" onClick={onClose}><X aria-hidden /></IconButton></div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </>}
    </dialog>
  );
}

/** Confirmation for consequential or destructive actions: states the consequence plainly. */
export function useConfirm() {
  const [state, setState] = useState<null | { title: string; body: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void }>(null);
  const ask = useCallback((o: { title: string; body: ReactNode; confirm: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const node = (
    <Dialog open={!!state} onClose={() => close(false)} title={state?.title ?? ''}
      footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={state?.danger ? 'danger' : 'primary'} icon={state?.danger ? <AlertTriangle aria-hidden /> : undefined} onClick={() => close(true)}>{state?.confirm}</Button></>}>
      {state?.body}
    </Dialog>
  );
  return { ask, node };
}

// ------------------------------------------------------------ toasts
export interface ToastAction { label: string; onClick: () => void }
type Toast = { id: number; text: string; tone: 'success' | 'info' | 'error'; action?: ToastAction };
const ToastCtx = createContext<(text: string, tone?: Toast['tone'], action?: ToastAction) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success', action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone, action }]);
    // Toasts with an action (Undo) stay longer so there is time to use it.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 12000 : 6000);
  }, []);
  const dismiss = (id: number) => setToasts((x) => x.filter((y) => y.id !== id));
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.tone === 'error' ? <AlertCircle className="t-error" aria-hidden /> : t.tone === 'info' ? <Info className="t-info" aria-hidden /> : <CheckCircle2 className="t-success" aria-hidden />}
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.action ? <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action!.onClick(); }}>{t.action.label}</button> : null}
            <button className="icon-btn" style={{ width: 28, height: 28, color: 'inherit' }} aria-label="Dismiss" onClick={() => dismiss(t.id)}><X aria-hidden style={{ width: 16, height: 16 }} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => <button key={t.key} role="tab" className="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>{t.label}</button>)}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string; icon?: ReactNode }[]; value: T; onChange: (k: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.icon}{o.label}</button>)}
    </div>
  );
}
