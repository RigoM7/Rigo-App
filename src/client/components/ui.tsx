import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, Info, Lock, RefreshCw, SearchX, WifiOff, X, CircleDot, CircleCheck, CircleSlash, CircleX, Circle } from 'lucide-react';
import { ApiError } from '../lib/api';
import type { Meaning } from '../../shared/workspace';
import { formatMoney } from '../../shared/money';

// Rigo's components (DESIGN.md, Components). Tokens live in styles.css; nothing here uses raw colours.

// ---------------------------------------------------------------- brand

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M10 23V9h7.2c3.3 0 5.3 1.8 5.3 4.6 0 2.1-1.1 3.6-3 4.2l3.4 5.2h-3.6l-3-4.8H13.2V23H10Zm3.2-7.5h3.8c1.6 0 2.4-.7 2.4-1.9s-.8-1.9-2.4-1.9h-3.8v3.8Z" fill="var(--on-primary)" />
      <circle cx="24" cy="24" r="3" fill="var(--attention)" />
    </svg>
  );
}
export function Wordmark({ to = '/' }: { to?: string }) {
  return <Link to={to} className="brand" aria-label="Rigo home"><BrandMark /> <span>Rigo</span></Link>;
}

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'default' | 'ghost' | 'danger';
const cls = (variant: Variant = 'default', size?: 'sm' | 'lg', block?: boolean, extra = '') =>
  ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', extra].filter(Boolean).join(' ');

export function Button({ variant, size, block, busy, icon, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; block?: boolean; busy?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" {...rest} className={cls(variant, size, block, className)} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ variant, size, block, icon, children, className, ...rest }: LinkProps & { variant?: Variant; size?: 'sm' | 'lg'; block?: boolean; icon?: ReactNode }) {
  return <Link {...rest} className={cls(variant, size, block, className)}>{icon}{children}</Link>;
}

export function IconButton({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" {...rest} className={`btn btn-ghost icon-btn ${rest.className ?? ''}`} aria-label={label} title={label}>{children}</button>;
}

// ---------------------------------------------------------------- fields

interface FieldShell { label: ReactNode; hint?: ReactNode; error?: string | null; optional?: boolean; className?: string }

function Shell({ id, label, hint, error, optional, className, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}{optional && <span className="opt"> (optional)</span>}</label>
      {hint && <div className="hint" id={`${id}-hint`}>{hint}</div>}
      {children}
      {error && <div className="field-error" id={`${id}-err`}><AlertCircle aria-hidden="true" />{error}</div>}
    </div>
  );
}
const described = (id: string, hint?: ReactNode, error?: string | null) => [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;

export function TextField({ label, hint, error, optional, className, id: given, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId(); const id = given ?? auto;
  return <Shell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
    <input id={id} className={`input ${rest.inputMode === 'decimal' ? 'num mono' : ''}`} aria-invalid={error ? true : undefined} aria-describedby={described(id, hint, error)} {...rest} />
  </Shell>;
}

export function TextArea({ label, hint, error, optional, className, id: given, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId(); const id = given ?? auto;
  return <Shell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
    <textarea id={id} className="textarea" aria-invalid={error ? true : undefined} aria-describedby={described(id, hint, error)} {...rest} />
  </Shell>;
}

export function SelectField({ label, hint, error, optional, className, id: given, children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId(); const id = given ?? auto;
  return <Shell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
    <select id={id} className="select" aria-invalid={error ? true : undefined} aria-describedby={described(id, hint, error)} {...rest}>{children}</select>
  </Shell>;
}

export function Check({ label, hint, ...rest }: { label: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} />
      <span className="check-text"><span>{label}</span>{hint && <span className="hint">{hint}</span>}</span>
    </label>
  );
}

/** Field errors from an API error ("fields.qty" keys come back as "qty" too). */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fields)) { out[k] = v; if (k.startsWith('fields.')) out[k.slice(7)] = v; }
  return out;
}

/** A failed form says so at the top, with the first problem, and moves focus there. */
export function FormError({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) ref.current?.focus(); }, [error]);
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
  const fields = error instanceof ApiError ? Object.values(error.fields) : [];
  return (
    <div className="banner banner-error" role="alert" tabIndex={-1} ref={ref}>
      <AlertCircle aria-hidden="true" />
      <div className="grow">
        <strong>{msg}</strong>
        {fields.length > 0 && msg !== fields[0] && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{fields.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}</ul>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- choices

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- badges and states

const MEANING_ICON: Record<Meaning, ReactNode> = {
  open: <Circle aria-hidden="true" />, active: <CircleDot aria-hidden="true" />, finished: <CircleCheck aria-hidden="true" />,
  cancelled: <CircleSlash aria-hidden="true" />, failed: <CircleX aria-hidden="true" />,
};
/** A stage, always icon plus the workspace's own name. */
export function StageBadge({ name, meaning }: { name: string; meaning: Meaning }) {
  return <span className={`badge badge-${meaning}`}>{MEANING_ICON[meaning]}{name}</span>;
}

export function Badge({ tone = 'open', icon, children }: { tone?: 'open' | 'good' | 'bad' | 'attn' | 'demo' | 'cancelled'; icon?: ReactNode; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{icon}{children}</span>;
}

export function Money({ minor, currency = 'USD', className }: { minor: number | null | undefined; currency?: string; className?: string }) {
  return <span className={`money ${className ?? ''}`}>{minor === null || minor === undefined ? '—' : formatMoney(minor, currency)}</span>;
}

export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'attn' | 'error' | 'plain'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const icon = tone === 'error' ? <AlertCircle aria-hidden="true" /> : tone === 'attn' ? <AlertTriangle aria-hidden="true" /> : <Info aria-hidden="true" />;
  return (
    <div className={`banner ${tone === 'plain' ? '' : `banner-${tone}`}`} role={tone === 'error' ? 'alert' : undefined}>
      {icon}
      <div className="grow">{title && <strong>{title}</strong>}{children && <div className="small">{children}</div>}</div>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="stack" role="status" aria-label={label}>
      <div className="skeleton" style={{ height: 36, width: '40%' }} />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error as ApiError;
  if (e?.status === 403) return <Empty icon={<Lock />} title="Not for your role">{e.message} Ask an owner if you need it.</Empty>;
  if (e?.status === 404) return <Empty icon={<SearchX />} title="Not found">It may have been removed, or it belongs to another workspace.</Empty>;
  if (e?.code === 'offline' || e?.status === 0) return <Empty icon={<WifiOff />} title="No connection" action={retry && <Button onClick={retry} icon={<RefreshCw />}>Try again</Button>}>Check your signal. What you saved on this device is still here.</Empty>;
  return <Empty icon={<AlertCircle />} title="This didn't load" action={retry && <Button onClick={retry} icon={<RefreshCw />}>Try again</Button>}>{e?.message ?? 'Something went wrong.'}</Empty>;
}

// ---------------------------------------------------------------- page structure

export function PageHeader({ title, eyebrow, back, children, sub }: { title: ReactNode; eyebrow?: ReactNode; back?: { to: string; label: string }; children?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stack-sm">
      {back && <Link to={back.to} className="back-link"><ChevronLeft size={18} aria-hidden="true" />{back.label}</Link>}
      <div className="page-head">
        <div className="head-text">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        {children && <div className="row">{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dialogs

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, children, wide, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const [a, b] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; before?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="row-between">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose}><X size={20} /></IconButton>
        </div>
        {children}
        {actions && <div className="form-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Asks before something that can't be undone, and says the consequence in plain words. */
export function Confirm({ title, body, confirm, danger, onConfirm, onClose, busy }: { title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Dialog title={title} onClose={onClose} actions={<>
      <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>{confirm}</Button>
      <Button variant="ghost" onClick={onClose}>Keep it</Button>
    </>}>
      <div className="muted">{body}</div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- popover menu

export function Menu({ button, children, align = 'left' }: { button: (p: { open: boolean; toggle: () => void; id: string }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {button({ open, toggle: () => setOpen((o) => !o), id })}
      {open && <div className="menu" id={id} style={{ [align]: 0, top: 'calc(100% + 6px)' } as any}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- toasts

type ToastFn = (msg: string, tone?: 'success' | 'error' | 'info', action?: { label: string; onClick: () => void }) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tone: string; action?: { label: string; onClick: () => void } }[]>([]);
  const push = useCallback<ToastFn>((msg, tone = 'success', action) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, msg, tone, action }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), action ? 10000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className="toast">
            {t.tone === 'error' ? <AlertCircle aria-hidden="true" /> : t.tone === 'info' ? <Info aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            <span>{t.msg}</span>
            {t.action && <button className="link-btn" onClick={() => { t.action!.onClick(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
