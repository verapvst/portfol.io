-- Diagnostic only. Everything needed to validate the new chain-linked
-- TWR against your real live data (Phase 3).

-- 1. Exact external cash-flow dates (TWR sub-period boundaries)
select 'cash-flow dates' as check, t.date::text, t.type, s.name as security, t.amount::text
from transactions t join securities s on s.id = t.security_id
where t.type in ('buy','sell','deposit','withdrawal') and t.voided = false
order by t.date, s.name;

-- 2. BPI Dinâmico: just the boundary-relevant points (first, last, and
--    nearest-prior to each cash-flow date) - not all 113 rows, that's
--    not needed to validate the methodology, just the endpoints.
select 'BPI Dinâmico first' as check, date::text, value_eur::text
from valuations v join securities s on s.id = v.security_id
where s.name = 'BPI Dinâmico'
order by date asc limit 1;

select 'BPI Dinâmico last' as check, date::text, value_eur::text
from valuations v join securities s on s.id = v.security_id
where s.name = 'BPI Dinâmico'
order by date desc limit 1;

-- BPI's recent 2026 points too, so I have its value right around
-- whatever date the ETF purchases turn out to be at, not just the very
-- first/last of its 113.
select 'BPI Dinâmico 2026' as check, date::text, value_eur::text
from valuations v join securities s on s.id = v.security_id
where s.name = 'BPI Dinâmico' and date >= '2026-01-01'
order by date;

-- 3. Every ETF's full history (only 2 points each, fine to see in full)
select s.name, v.date::text, v.value_eur::text
from valuations v join securities s on s.id = v.security_id
where s.name in ('UBS Core MSCI World (Acc)', 'Avantis Global Small Cap Value (Acc)', 'Xtrackers MSCI World Quality (Acc)', 'SPDR MSCI Emerging Markets (Acc)')
order by s.name, v.date;
