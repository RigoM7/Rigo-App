import { useId } from 'react';
import { AlertCircle } from 'lucide-react';
import type { FieldDef } from '../../shared/workspace';
import { TextField, TextArea, SelectField } from './ui';
import { formatMoney, parseMoney, minorToInput } from '../../shared/money';

// Inputs for the custom fields a workspace defines (DESIGN.md, Components). Values are kept as the
// server stores them: text, "12.5" for numbers, minor units for money, booleans for yes/no.

export function FieldInput({ def, value, onChange, error }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: string | null }) {
  const id = useId();
  const label = <>{def.label}{def.unit ? <span className="opt"> ({def.unit})</span> : null}</>;
  const common = { label, hint: def.hint, error, optional: !def.required };
  switch (def.type) {
    case 'long_text':
      return <TextArea {...common} value={String(value ?? '')} maxLength={4000} rows={3} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <TextField {...common} inputMode="decimal" value={String(value ?? '')} onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))} />;
    case 'money':
      return <TextField {...common} inputMode="decimal" value={typeof value === 'number' ? minorToInput(value) : String(value ?? '')} onChange={(e) => { const m = parseMoney(e.target.value); onChange(m ?? e.target.value); }} />;
    case 'date':
      return <TextField {...common} type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <TextField {...common} type="email" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <TextField {...common} type="tel" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'choice':
      return <SelectField {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {(def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </SelectField>;
    case 'yes_no':
      return (
        <fieldset className="field">
          <legend className="field-label">{def.label}{!def.required && <span className="opt"> (optional)</span>}</legend>
          <div className="segmented" role="radiogroup" aria-label={def.label}>
            {[['true', 'Yes'], ['false', 'No']].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={String(value) === v} onClick={() => onChange(v === 'true')}>{l}</button>
            ))}
          </div>
          {error && <div className="field-error" id={`${id}-err`}><AlertCircle aria-hidden="true" />{error}</div>}
        </fieldset>
      );
    default:
      return <TextField {...common} value={String(value ?? '')} maxLength={300} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** A stored value shown in words. */
export function fieldText(def: FieldDef, v: unknown, currency = 'USD') {
  if (v === undefined || v === null || v === '') return '—';
  if (def.type === 'yes_no') return v === true || v === 'true' ? 'Yes' : 'No';
  if (def.type === 'money' && typeof v === 'number') return formatMoney(v, currency);
  return `${String(v)}${def.unit && def.type === 'number' ? ` ${def.unit}` : ''}`;
}

/** Shows the fields that have values, label above value. */
export function FieldValues({ defs, values, currency }: { defs: FieldDef[]; values: Record<string, unknown>; currency?: string }) {
  const shown = defs.filter((d) => values[d.key] !== undefined && values[d.key] !== '');
  if (!shown.length) return null;
  return (
    <dl className="details">
      {shown.map((d) => <div key={d.key}><dt>{d.label}</dt><dd className={d.type === 'number' || d.type === 'money' ? 'mono' : ''}>{fieldText(d, values[d.key], currency)}</dd></div>)}
    </dl>
  );
}
