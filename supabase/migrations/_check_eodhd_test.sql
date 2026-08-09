-- Diagnostic only. Shows exactly what the fetch-daily-prices Edge
-- Function did on its first real invocation - success, partial, or
-- total failure, and why.

select l.run_at::text, s.name, l.symbol_used, l.status, l.error_message, l.http_status
from price_fetch_log l left join securities s on s.id = l.security_id
order by l.run_at desc
limit 20;

select s.name, d.date::text, d.close::text, d.source
from daily_prices d join securities s on s.id = d.security_id
order by d.date desc;
