-- Diagnostic only. Two things: (1) did today's Data Hub import actually
-- write cost rows for BPI Dinâmico, (2) did it accidentally create a
-- second/duplicate security with a slightly different name instead of
-- matching the existing one (possible if the PDF's extracted fund name
-- isn't byte-identical to "BPI Dinâmico").

select 'costs for BPI Dinâmico' as check, c.date::text, c.cost_name, c.value::text, c.source, c.created_at::text
from costs c join securities s on s.id = c.security_id
where s.name = 'BPI Dinâmico'
order by c.created_at desc;

select 'securities named like BPI%' as check, id::text, name, isin, type, created_at::text
from securities
where name ilike 'BPI%'
order by created_at desc;
