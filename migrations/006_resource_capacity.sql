-- Critique Phase 1 (WP1, R7-M2): a number for what a truck holds, so a delivery larger than
-- the truck can carry is caught. Filled from the existing free-text capacity ("3,000 gal").
alter table rigo.resources
  add column capacity_quantity numeric,
  add column capacity_unit text not null default '';
update rigo.resources
   set capacity_quantity = replace(substring(capacity from '^\s*([0-9][0-9,]*(?:\.[0-9]+)?)'), ',', '')::numeric,
       capacity_unit = coalesce(nullif(trim(substring(capacity from '^\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*([A-Za-z]+)')), ''), '')
 where capacity ~ '^\s*[0-9]';
