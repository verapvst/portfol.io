-- Two things: (1) confirm BPI Dinâmico's security_details landed and
-- the duplicate is gone, (2) the one question that's been blocking
-- Risk/TWR all session - does any holding besides BPI Dinâmico now have
-- 2+ dated valuations? If yes, real multi-holding chain-linked TWR
-- should be prioritised before Risk gets built. If no, the current
-- single-driver simplification is still correct and Risk can proceed
-- on top of it as-is.

select 'BPI Dinâmico security_details' as check, sd.ter_pct::text, sd.data_quality, sd.costs_as_of::text
from security_details sd join securities s on s.id = sd.security_id
where s.name = 'BPI Dinâmico';

select 'duplicate check' as check, count(*) as securities_named_bpi_dinamico_no_accent
from securities where name = 'BPI DINAMICO';

select s.name, count(*) as valuation_points
from valuations v join securities s on s.id = v.security_id
group by s.name
order by valuation_points desc;
