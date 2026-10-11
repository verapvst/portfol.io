-- READ-ONLY diagnostic (run in the Supabase SQL Editor, changes nothing).
-- Why did 2026 YTD jump from +5.92% to +17.88% (+11.3% in one month)?
-- A TWR jump with no matching cash flow means a VALUE changed without a
-- transaction explaining it (e.g. Cash EUR first valued, a security
-- entered with the wrong units/amount, or a top-up not recorded).

-- A. Every security's last 4 values and the month-over-month change.
select s.name, s.type, v.date, v.value_eur, v.units,
       round(((v.value_eur / nullif(lag(v.value_eur) over w, 0)) - 1) * 100, 1) as change_pct,
       v.source
from valuations v join securities s on s.id = v.security_id
window w as (partition by v.security_id order by v.date)
order by s.name, v.date desc
limit 80;

-- B. Cash flows / trades since July (should explain any big value change).
select t.date, t.type, a.name as account, s.name as security, t.amount, t.units, t.voided
from transactions t
left join accounts a on a.id = t.account_id
left join securities s on s.id = t.security_id
where t.date >= '2026-07-01'
order by t.date;

-- C. Total portfolio value per date, carried forward (what the app uses).
select d.date, round(sum(lv.value_eur)::numeric, 2) as total_eur
from (select distinct date from valuations where date >= '2026-07-01') d
cross join lateral (
  select distinct on (v.security_id) v.value_eur
  from valuations v where v.date <= d.date
  order by v.security_id, v.date desc, v.created_at desc
) lv
group by d.date order by d.date;
