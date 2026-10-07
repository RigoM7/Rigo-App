-- Critique Phase 1 (WP1, owner decision D3): rates in ten-thousandths of the currency ($3.8995/gal).
-- Additive: older code that reads whole-cent rates keeps working until this release replaces it.

-- Service price lines (jsonb): add `rateE4` (= rateMinor × 100) next to the existing `rateMinor`.
update rigo.services s set pricing = coalesce((
  select jsonb_agg(
           case when e ? 'rateE4' then e
                when jsonb_typeof(e->'rateMinor') = 'number' then e || jsonb_build_object('rateE4', (e->>'rateMinor')::bigint * 100)
                else e || jsonb_build_object('rateE4', null) end
           order by ord)
    from jsonb_array_elements(s.pricing) with ordinality as t(e, ord)), '[]'::jsonb)
 where jsonb_typeof(s.pricing) = 'array';

-- Invoice lines: the precise rate, the date that rate took effect, the rate when the job was
-- booked (when it changed since), and a short note printed under the line.
alter table rigo.invoice_lines
  add column rate_e4 bigint,
  add column price_date date,
  add column booked_rate_e4 bigint,
  add column note text not null default '';
update rigo.invoice_lines set rate_e4 = rate_minor * 100 where rate_minor is not null;

-- Jobs remember the service rates at booking, so a price change before delivery is shown.
alter table rigo.jobs add column booked_rates jsonb;
