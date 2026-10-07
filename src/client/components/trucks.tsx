import { useState } from 'react';
import { Checkbox, Button } from './ui';

/**
 * Trucks and equipment for a job (R11-m5): the ones meant for this kind of work first (a resource with
 * no kinds set fits any), rental units only for portable toilets, with "Show all" for the rest.
 * Out-of-service ones can't be added but stay ticked if already on the job.
 */
export function TruckPicker({ resources, selected, onChange, category, legend = 'Trucks and equipment' }: { resources: any[]; selected: string[]; onChange: (ids: string[]) => void; category: string | null; legend?: string }) {
  const [all, setAll] = useState(false);
  const usable = resources.filter((r) => r.status !== 'retired' || selected.includes(r.id));
  const fits = (r: any) => {
    if (r.kind === 'unit') return category === 'portable_toilet';
    const cats: string[] = r.categories ?? [];
    return !category || cats.length === 0 || cats.includes(category);
  };
  const shown = all ? usable : usable.filter((r) => fits(r) || selected.includes(r.id));
  const hidden = usable.length - shown.length;
  if (!usable.length) return null;
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="truck-list">
        {shown.map((r) => (
          <Checkbox key={r.id} label={`${r.name}${r.capacity ? ` (${r.capacity})` : ''}${r.status === 'out_of_service' ? ' — out of service' : r.status === 'retired' ? ' — retired' : ''}`}
            disabled={(r.status === 'out_of_service' || r.status === 'retired') && !selected.includes(r.id)} checked={selected.includes(r.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
        ))}
      </div>
      {hidden > 0 || all ? <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show only the ones for this work' : `Show all (${hidden} more)`}</Button> : null}
    </fieldset>
  );
}
