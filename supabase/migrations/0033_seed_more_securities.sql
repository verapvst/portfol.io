-- Portfol.io - 10 more widely held UCITS ETFs/ETC for the Securities
-- library (28 products total), toward a database broad enough to mix and
-- match for the future simulator.
--
-- Every figure (ISIN, domicile, index, fund currency, TER, fund size,
-- inception date) was read from the fund's own justETF.com profile page
-- on 2026-10-06 - nothing is from memory. TER is both ter_pct and riy_pct
-- (the ETF's own ongoing charge; no separate RIY was published there).
-- data_quality is 'Partial' on purpose: performance, risk, allocation and
-- tax fields are not filled for these rows yet. AUM is the fund size in
-- EUR millions at fetch time.
--
-- Research-only (no valuations/transactions), so nothing here touches
-- the portfolio, its performance or the public allocation RPCs.
-- Idempotent: skips any ISIN that already exists.

insert into institutions (name)
select v.name from (values ('Vanguard')) as v(name)
where not exists (select 1 from institutions i where i.name = v.name);

insert into securities (name, type, isin, domicile, currency, benchmark, provider_id, asset_class)
select v.* from (values
  ('Vanguard FTSE All-World UCITS ETF (USD) Acc', 'ETF', 'IE00BK5BQT80', 'Ireland', 'USD', 'FTSE All-World',
    (select id from institutions where name = 'Vanguard'), 'Equity'),
  ('Vanguard S&P 500 UCITS ETF (USD) Acc', 'ETF', 'IE00BFMXXD54', 'Ireland', 'USD', 'S&P 500',
    (select id from institutions where name = 'Vanguard'), 'Equity'),
  ('iShares MSCI ACWI UCITS ETF (Acc)', 'ETF', 'IE00B6R52259', 'Ireland', 'USD', 'MSCI All Country World (ACWI)',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Equity'),
  ('iShares Core MSCI EM IMI UCITS ETF (Acc)', 'ETF', 'IE00BKM4GZ66', 'Ireland', 'USD', 'MSCI Emerging Markets IMI',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Equity'),
  ('iShares Nasdaq 100 UCITS ETF (Acc)', 'ETF', 'IE00B53SZB19', 'Ireland', 'USD', 'Nasdaq 100',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Equity'),
  ('iShares Core EURO STOXX 50 UCITS ETF (Acc)', 'ETF', 'IE00B53L3W79', 'Ireland', 'EUR', 'EURO STOXX 50',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Equity'),
  ('Xtrackers MSCI World UCITS ETF 1C', 'ETF', 'IE00BJ0KDQ92', 'Ireland', 'USD', 'MSCI World',
    (select id from institutions where name = 'DWS Xtrackers'), 'Equity'),
  ('iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc)', 'ETF', 'IE00BDBRDM35', 'Ireland', 'EUR', 'Bloomberg Global Aggregate Bond (EUR Hedged)',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Bond'),
  ('Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Acc', 'ETF', 'IE00BG47KH54', 'Ireland', 'EUR', 'Bloomberg Global Aggregate Float Adjusted and Scaled (EUR Hedged)',
    (select id from institutions where name = 'Vanguard'), 'Bond'),
  ('iShares Physical Gold ETC', 'ETF', 'IE00B4ND3602', 'Ireland', 'USD', 'Gold',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Commodity')
) as v(name, type, isin, domicile, currency, benchmark, provider_id, asset_class)
where not exists (select 1 from securities s where s.isin = v.isin);

insert into security_details (
  security_id, launched_date, ter_pct, riy_pct, aum_eur_millions, data_quality, philosophy, source, last_verified
)
select v.security_id, v.launched_date::date, v.ter_pct, v.riy_pct, v.aum_eur_millions, v.data_quality, v.philosophy, v.source, v.last_verified::date
from (values
  ((select id from securities where isin = 'IE00BK5BQT80'), '2019-07-23', 0.14, 0.14, 54126, 'Partial', 'Physical replication (optimized sampling) of the FTSE All-World index; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00BFMXXD54'), '2019-05-14', 0.07, 0.07, 32731, 'Partial', 'Physical replication (full) of the S&P 500; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00B6R52259'), '2011-10-21', 0.2, 0.2, 31931, 'Partial', 'Physical replication (optimized sampling) of the MSCI ACWI; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00BKM4GZ66'), '2014-05-30', 0.18, 0.18, 40289, 'Partial', 'Physical replication (full) of the MSCI Emerging Markets IMI; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00B53SZB19'), '2010-01-26', 0.3, 0.3, 26449, 'Partial', 'Physical replication (full) of the Nasdaq 100; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00B53L3W79'), '2010-01-26', 0.1, 0.1, 7642, 'Partial', 'Physical replication (full) of the EURO STOXX 50; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00BJ0KDQ92'), '2014-07-22', 0.12, 0.12, 21798, 'Partial', 'Physical replication (optimized sampling) of the MSCI World; accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00BDBRDM35'), '2017-11-21', 0.1, 0.1, 2543, 'Partial', 'Physical replication (sampling) of the Bloomberg Global Aggregate (EUR hedged); accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00BG47KH54'), '2019-06-18', 0.08, 0.08, 2316, 'Partial', 'Physical replication (sampling) of the Bloomberg Global Aggregate float-adjusted (EUR hedged); accumulating.', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06'),
  ((select id from securities where isin = 'IE00B4ND3602'), '2011-04-08', 0.12, 0.12, 34374, 'Partial', 'Physically backed by allocated gold bullion; accumulating (no distributions).', 'justETF.com fund profile, fetched 2026-10-06', '2026-10-06')
) as v(security_id, launched_date, ter_pct, riy_pct, aum_eur_millions, data_quality, philosophy, source, last_verified)
where v.security_id is not null
  and not exists (select 1 from security_details d where d.security_id = v.security_id);
