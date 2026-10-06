import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompany } from '../lib/session';
import { get } from '../lib/api';

/**
 * Pick a customer by typing part of their name, phone or address (R5-M4). Accents and phone
 * formatting don't matter. Each option shows the town and first address, so two "Smith" customers
 * can be told apart. Keyboard: arrows move, Enter picks, Escape closes.
 */
export function CustomerPicker({ id, value, onChange, name, invalid, describedBy, placeholder = 'Type a name, phone or address', disabled }: {
  id?: string; value: string; onChange: (id: string, customer: any | null) => void; name?: string | null; invalid?: boolean; describedBy?: string; placeholder?: string; disabled?: boolean;
}) {
  const c = useCompany();
  const listId = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>(name ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 150); return () => clearTimeout(t); }, [text]);
  useEffect(() => { if (name !== undefined) setPicked(name ?? null); }, [name]);
  // The selected customer's name when only its id is known.
  const current = useQuery({ queryKey: [c.cid, 'customer', value], queryFn: () => get(`/c/${c.cid}/customers/${value}`), enabled: !!value && !picked });
  useEffect(() => { if (current.data?.customer?.name && value) setPicked(current.data.customer.name); }, [current.data, value]);
  const results = useQuery({ queryKey: [c.cid, 'customer-pick', debounced], queryFn: () => get(`/c/${c.cid}/customers?limit=20&q=${encodeURIComponent(debounced)}`), enabled: open });
  // While the typing hasn't been searched yet, the old list is not offered (Enter would pick the wrong one).
  const stale = text.trim() !== debounced || results.isLoading;
  const options: any[] = stale ? [] : results.data?.customers ?? [];
  useEffect(() => { setActive(0); }, [debounced]);
  const choose = (cu: any) => { onChange(cu.id, cu); setPicked(cu.name); setText(''); setOpen(false); };
  const optId = (i: number) => `${listId}-o${i}`;
  return (
    <div className="combo">
      <input ref={inputRef} id={id} className="input" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" disabled={disabled}
        aria-activedescendant={open && options[active] ? optId(active) : undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        placeholder={picked ? '' : placeholder}
        value={open ? text : picked ?? ''}
        onFocus={() => { setOpen(true); setText(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(options.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }} />
      {value && !disabled && <button type="button" className="combo-clear" aria-label="Clear the customer" onClick={() => { onChange('', null); setPicked(null); setText(''); inputRef.current?.focus(); }}><X aria-hidden /></button>}
      {open && (
        <ul id={listId} role="listbox" className="combo-list">
          {stale ? <li className="combo-note" role="presentation">Searching…</li>
            : options.length === 0 ? <li className="combo-note" role="presentation">{debounced ? 'No customer matches. Add a new one.' : 'No customers yet.'}</li>
            : options.map((cu, i) => (
              <li key={cu.id} id={optId(i)} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined}
                onMouseDown={(e) => { e.preventDefault(); choose(cu); }} onMouseEnter={() => setActive(i)}>
                <strong>{cu.name}</strong>
                <span className="small muted">{[cu.town, cu.firstAddress].filter(Boolean).join(' · ') || (cu.locationCount ? `${cu.locationCount} location(s)` : 'No location yet')}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Customers that look like the one being added or edited (R5-M1), with why: the person opens the
 * existing one or carries on anyway.
 */
export function DuplicateNotice({ candidates, onContinue, continueLabel, busy }: { candidates: any[]; onContinue: () => void; continueLabel: string; busy?: boolean }) {
  const c = useCompany();
  return (
    <section className="card dup-card stack-sm" role="alert" aria-labelledby="dup-h">
      <h3 id="dup-h" style={{ margin: 0 }}>{candidates.length === 1 ? 'This looks like a customer you already have' : `This looks like ${candidates.length} customers you already have`}</h3>
      <ul className="list">{candidates.map((d) => (
        <li key={d.id} className="row-between" style={{ padding: '8px 0', gap: 12 }}>
          <span style={{ minWidth: 0 }}><strong>{d.name}</strong>
            <div className="small muted">{[d.firstAddress, d.phone, d.email].filter(Boolean).join(' · ') || 'No address yet'}</div>
            <div className="small">{d.reasons.join(' · ')}</div></span>
          <Link className="btn btn-sm" to={c.to(`customers/${d.id}`)}>Open existing</Link>
        </li>
      ))}</ul>
      <div className="row"><button type="button" className="btn" disabled={busy} onClick={onContinue}>{continueLabel}</button></div>
    </section>
  );
}
