-- Diagnostic only. Real costs already imported for BPI Dinâmico via the
-- Data Hub pipeline, if any - want the actual imported figures (and
-- their real source date) rather than a documentation cross-reference.
select c.date, c.cost_category, c.cost_name, c.frequency, c.unit, c.value, c.source
from costs c
join securities s on s.id = c.security_id
where s.name = 'BPI Dinâmico'
order by c.date desc, c.cost_name;
