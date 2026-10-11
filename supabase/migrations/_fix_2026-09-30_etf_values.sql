-- ONE-OFF correction (run in the Supabase SQL Editor, in this order).
-- The 2026-09-30 values for the four ETFs were typed from the SHARE value
-- instead of the POSITION value. Correct position values (EUR):
--   UBS Core MSCI World            83.13
--   Avantis Global Small Cap Value 39.92
--   Xtrackers MSCI World Quality   25.00
--   SPDR MSCI Emerging Markets     16.89

-- STEP 1 - look first (read-only). Expect one row per ETF; if a security
-- has two rows on that date, both are listed. value_eur / units should be a
-- sensible per-share price once corrected.
select s.name, v.id, v.date, v.value_eur, v.units, v.source, v.created_at
from valuations v
join securities s on s.id = v.security_id
where v.date = '2026-09-30'
  and s.isin in ('IE00BD4TXV59', 'IE0003R87OG3', 'IE00BL25JL35', 'IE00B469F816')
order by s.name, v.created_at;

-- STEP 2 - correct them in place (an entry error, not a new observation).
begin;

update valuations v
set value_eur = c.position_eur
from securities s,
     (values
       ('IE00BD4TXV59', 83.13),
       ('IE0003R87OG3', 39.92),
       ('IE00BL25JL35', 25.00),
       ('IE00B469F816', 16.89)
     ) as c(isin, position_eur)
where v.security_id = s.id
  and s.isin = c.isin
  and v.date = '2026-09-30';

-- Check before committing: should list exactly the four new values.
select s.name, v.value_eur, v.units
from valuations v join securities s on s.id = v.security_id
where v.date = '2026-09-30'
  and s.isin in ('IE00BD4TXV59', 'IE0003R87OG3', 'IE00BL25JL35', 'IE00B469F816')
order by s.name;

commit;

-- STEP 3 - re-check the totals (compare 2026-09-30 with 2026-08-30 = 750.03):
select d.date, round(sum(lv.value_eur)::numeric, 2) as total_eur
from (select distinct date from valuations where date >= '2026-08-01') d
cross join lateral (
  select distinct on (v.security_id) v.value_eur
  from valuations v where v.date <= d.date
  order by v.security_id, v.date desc, v.created_at desc
) lv
group by d.date order by d.date;
