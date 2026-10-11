-- Portfol.io - research universe for the Simulator: 8 robotics / AI ETFs and
-- 3 US Treasury ETFs (short / mid / long maturity), UCITS only.
--
-- Every figure (ISIN, TER, fund size, inception, holdings count, 1-year
-- return, top holdings and country weights) was read from the fund's own
-- justETF.com profile on 2026-10-12 - nothing from memory. Fund size and the 1-year
-- return carry NO as-of date on justETF, so 2026-10-12 (the fetch date) is
-- recorded as last_verified and as the as-of of anything undated; weights
-- that DO carry a date (e.g. top holdings 2026-08-31) keep their own date.
-- Returns are 1-year only: the 3/5-year figures aren't labelled annualised.
-- Whether Trading 212 lists each fund is NOT verified here - check in the app.
--
-- Adds securities.theme / sub_theme so the Securities page and the Simulator
-- can group the universe. Research only (no valuations/transactions), so
-- nothing here touches the portfolio. Idempotent. Run once in the SQL Editor.

alter table securities add column if not exists theme text;
alter table securities add column if not exists sub_theme text;

insert into institutions (name)
select v.name from (values ('Amundi'), ('BlackRock (iShares)'), ('DWS Xtrackers'), ('Global X (Mirae Asset)'), ('KraneShares'), ('Legal & General'), ('WisdomTree')) as v(name)
where not exists (select 1 from institutions i where i.name = v.name);

insert into securities (name, type, isin, domicile, currency, benchmark, provider_id, asset_class, theme, sub_theme)
select v.name, 'ETF', v.isin, v.domicile, v.currency, v.benchmark,
       (select id from institutions where name = v.provider), v.asset_class, v.theme, v.sub_theme
from (values
  ('L&G ROBO Global Robotics and Automation UCITS ETF (Acc)', 'IE00BMW3QX54', 'Ireland', 'USD', 'ROBO-STOX Global Robotics and Automation', 'Legal & General', 'Equity', 'Robotics & Automation', 'Pure-play robotics & automation'),
  ('iShares Automation & Robotics UCITS ETF (Acc)', 'IE00BYZK4552', 'Ireland', 'USD', 'iSTOXX FactSet Automation & Robotics', 'BlackRock (iShares)', 'Equity', 'Robotics & Automation', 'Broad automation (software-heavy)'),
  ('Global X Robotics & Artificial Intelligence UCITS ETF (Acc)', 'IE00BLCHJB90', 'Ireland', 'USD', 'Indxx Global Robotics & Artificial Intelligence Thematic', 'Global X (Mirae Asset)', 'Equity', 'Robotics & Automation', 'Robotics + AI (small fund)'),
  ('KraneShares Global Humanoid and Embodied Intelligence UCITS ETF (Acc)', 'IE000O6Z73N7', 'Ireland', 'USD', 'MerQube Global Humanoid and Embodied Intelligence', 'KraneShares', 'Equity', 'Robotics & Automation', 'Humanoid & embodied AI'),
  ('WisdomTree Physical AI, Humanoids and Drones UCITS ETF (Acc)', 'IE000LCKJ888', 'Ireland', 'USD', 'WisdomTree Physical AI UCITS', 'WisdomTree', 'Equity', 'Robotics & Automation', 'Physical AI, humanoids & drones'),
  ('Amundi MSCI Robotics & AI UCITS ETF (Acc)', 'LU1861132840', 'Luxembourg', 'EUR', 'MSCI ACWI IMI Robotics & AI Filtered', 'Amundi', 'Equity', 'AI & Robotics-adjacent', 'Robotics & AI (software/cyber-heavy)'),
  ('Xtrackers Artificial Intelligence & Big Data UCITS ETF (Acc)', 'IE00BGV5VN51', 'Ireland', 'USD', 'Nasdaq Global Artificial Intelligence and Big Data', 'DWS Xtrackers', 'Equity', 'AI & Robotics-adjacent', 'AI & big data (mega-cap tech)'),
  ('WisdomTree Artificial Intelligence UCITS ETF (Acc)', 'IE00BDVPNG13', 'Ireland', 'USD', 'Nasdaq CTA Artificial Intelligence', 'WisdomTree', 'Equity', 'AI & Robotics-adjacent', 'AI (semiconductors & software)'),
  ('iShares USD Treasury Bond 1-3yr UCITS ETF (Acc)', 'IE00B3VWN179', 'Ireland', 'USD', 'ICE US Treasury 1-3 Year', 'BlackRock (iShares)', 'Bond', 'US Treasuries', 'Short (1-3 years)'),
  ('iShares USD Treasury Bond 7-10yr UCITS ETF (Dist)', 'IE00B1FZS798', 'Ireland', 'USD', 'ICE US Treasury 7-10 Year', 'BlackRock (iShares)', 'Bond', 'US Treasuries', 'Mid (7-10 years)'),
  ('iShares USD Treasury Bond 20+yr UCITS ETF (Dist)', 'IE00BSKRJZ44', 'Ireland', 'USD', 'ICE US Treasury 20+ Year', 'BlackRock (iShares)', 'Bond', 'US Treasuries', 'Long (20+ years)')
) as v(name, isin, domicile, currency, benchmark, provider, asset_class, theme, sub_theme)
where not exists (select 1 from securities s where s.isin = v.isin);

update securities set theme = 'Robotics & Automation', sub_theme = 'Pure-play robotics & automation' where isin = 'IE00BMW3QX54' and theme is null;
update securities set theme = 'Robotics & Automation', sub_theme = 'Broad automation (software-heavy)' where isin = 'IE00BYZK4552' and theme is null;
update securities set theme = 'Robotics & Automation', sub_theme = 'Robotics + AI (small fund)' where isin = 'IE00BLCHJB90' and theme is null;
update securities set theme = 'Robotics & Automation', sub_theme = 'Humanoid & embodied AI' where isin = 'IE000O6Z73N7' and theme is null;
update securities set theme = 'Robotics & Automation', sub_theme = 'Physical AI, humanoids & drones' where isin = 'IE000LCKJ888' and theme is null;
update securities set theme = 'AI & Robotics-adjacent', sub_theme = 'Robotics & AI (software/cyber-heavy)' where isin = 'LU1861132840' and theme is null;
update securities set theme = 'AI & Robotics-adjacent', sub_theme = 'AI & big data (mega-cap tech)' where isin = 'IE00BGV5VN51' and theme is null;
update securities set theme = 'AI & Robotics-adjacent', sub_theme = 'AI (semiconductors & software)' where isin = 'IE00BDVPNG13' and theme is null;
update securities set theme = 'US Treasuries', sub_theme = 'Short (1-3 years)' where isin = 'IE00B3VWN179' and theme is null;
update securities set theme = 'US Treasuries', sub_theme = 'Mid (7-10 years)' where isin = 'IE00B1FZS798' and theme is null;
update securities set theme = 'US Treasuries', sub_theme = 'Long (20+ years)' where isin = 'IE00BSKRJZ44' and theme is null;

insert into security_details (
  security_id, launched_date, ter_pct, riy_pct, aum_eur_millions, holdings_count, return_1y_pct,
  alloc_stocks_pct, alloc_bonds_pct, alloc_other_pct,
  data_quality, philosophy, top_holdings, composition_as_of, source, last_verified
)
select s.id, v.launched::date, v.ter, v.ter, v.aum, v.holdings, v.ret1y,
       v.stocks, v.bonds, 0, 'Partial', v.philosophy, v.top::jsonb, v.top_asof::date,
       'justETF.com fund profile, fetched 2026-10-12', '2026-10-12'::date
from (values
  ('IE00BMW3QX54', '2014-10-27', 0.8, 1596, 79, 22.95, 100, 0, 'Physical replication (full) of the ROBO-STOX Global Robotics and Automation index; accumulating.', '[{"asset": "Illumina", "weight_pct": 2.08}, {"asset": "AutoStore Holdings", "weight_pct": 1.93}, {"asset": "Zebra Technologies", "weight_pct": 1.87}, {"asset": "GEA Group", "weight_pct": 1.86}, {"asset": "Advantech", "weight_pct": 1.77}]', '2026-10-12'),
  ('IE00BYZK4552', '2016-09-08', 0.4, 5057, 158, 40.55, 100, 0, 'Physical replication (optimized sampling) of the iSTOXX FactSet Automation & Robotics index; accumulating. Top holdings are largely software and electronics, not robot makers.', '[{"asset": "ServiceNow", "weight_pct": 3.78}, {"asset": "Snowflake", "weight_pct": 3.78}, {"asset": "Advantest", "weight_pct": 3.51}, {"asset": "SAP", "weight_pct": 3.39}, {"asset": "KEYENCE", "weight_pct": 3.07}]', '2026-08-31'),
  ('IE00BLCHJB90', '2021-11-16', 0.5, 136, null, 1.47, 100, 0, 'Physical replication (full) of the Indxx Global Robotics & Artificial Intelligence Thematic index; accumulating. Fund size is small (about EUR 136m), so closure and liquidity risk deserve a look.', '[]', null),
  ('IE000O6Z73N7', '2025-10-09', 0.69, 110, 51, 13.56, 100, 0, 'Physical replication (full) of the MerQube Global Humanoid and Embodied Intelligence index; accumulating. Launched Oct 2025, so very little track record.', '[{"asset": "Hexagon", "weight_pct": 2.73}, {"asset": "MP Materials", "weight_pct": 2.35}, {"asset": "Rainbow Robotics", "weight_pct": 2.34}, {"asset": "Horizon Robotics", "weight_pct": 2.29}, {"asset": "Magna International", "weight_pct": 2.26}]', '2026-08-31'),
  ('IE000LCKJ888', '2026-02-10', 0.45, 200, null, null, 100, 0, 'Physical replication (full) of the WisdomTree Physical AI UCITS index; accumulating. Launched Feb 2026, so essentially no track record.', '[]', null),
  ('LU1861132840', '2018-09-04', 0.4, 1314, 182, 35.56, 100, 0, 'Physical replication (full) of the MSCI ACWI IMI Robotics & AI Filtered index; accumulating. Top holdings are cybersecurity, software and semiconductor names.', '[{"asset": "Palo Alto Networks", "weight_pct": 4.56}, {"asset": "Arista Networks", "weight_pct": 4.21}, {"asset": "SAP", "weight_pct": 3.83}, {"asset": "CrowdStrike", "weight_pct": 3.78}, {"asset": "AMD", "weight_pct": 3.73}]', '2026-08-25'),
  ('IE00BGV5VN51', '2019-01-29', 0.35, 8652, 100, 47.04, 100, 0, 'Physical replication (full) of the Nasdaq Global Artificial Intelligence and Big Data index; accumulating. Mostly mega-cap US tech, not robotics.', '[{"asset": "Microsoft", "weight_pct": 5.97}, {"asset": "Amazon", "weight_pct": 4.85}, {"asset": "Apple", "weight_pct": 4.79}, {"asset": "NVIDIA", "weight_pct": 4.72}, {"asset": "Meta Platforms", "weight_pct": 4.45}]', '2026-10-12'),
  ('IE00BDVPNG13', '2018-11-30', 0.4, 1389, 52, 44.02, 100, 0, 'Physical replication (full) of the Nasdaq CTA Artificial Intelligence index; accumulating. Semiconductor and AI-software heavy.', '[{"asset": "AMD", "weight_pct": 4.78}, {"asset": "Marvell Technology", "weight_pct": 4.7}, {"asset": "Micron Technology", "weight_pct": 3.62}, {"asset": "Nebius Group", "weight_pct": 2.92}, {"asset": "Astera Labs", "weight_pct": 2.85}]', '2026-08-25'),
  ('IE00B3VWN179', '2009-06-03', 0.07, 608, 92, 5.54, 0, 100, 'Physical replication (sampling) of the ICE US Treasury 1-3 Year index; accumulating. Short maturity, so low interest-rate risk.', '[]', null),
  ('IE00B1FZS798', '2006-12-08', 0.07, 3304, 14, 0.2, 0, 100, 'Physical replication (sampling) of the ICE US Treasury 7-10 Year index; distributing semi-annually. Medium interest-rate risk.', '[]', null),
  ('IE00BSKRJZ44', '2015-01-20', 0.07, 874, 41, -5.18, 0, 100, 'Physical replication (sampling) of the ICE US Treasury 20+ Year index; distributing semi-annually. High interest-rate (duration) risk.', '[]', null)
) as v(isin, launched, ter, aum, holdings, ret1y, stocks, bonds, philosophy, top, top_asof)
join securities s on s.isin = v.isin
where not exists (select 1 from security_details d where d.security_id = s.id);

-- Country weights for the geography engine (0035/0036), where the profile lists them.
-- Whatever the profile doesn't itemise is the 'Other (not itemised)' row, never invented.
insert into security_country_exposure (security_id, as_of, country, region, weight_pct, source)
select s.id, v.as_of::date, v.country, v.region, v.weight_pct, 'justETF.com fund profile, fetched 2026-10-12, top countries'
from (values
  ('IE00BMW3QX54', '2026-10-12', 'United States', 'North America', 43.01),
  ('IE00BMW3QX54', '2026-10-12', 'Japan', 'Asia', 18.43),
  ('IE00BMW3QX54', '2026-10-12', 'Germany', 'Europe', 10.24),
  ('IE00BMW3QX54', '2026-10-12', 'Other (not itemised)', 'World', 28.32),
  ('IE00BYZK4552', '2026-10-12', 'United States', 'North America', 55.37),
  ('IE00BYZK4552', '2026-10-12', 'Japan', 'Asia', 13.56),
  ('IE00BYZK4552', '2026-10-12', 'Germany', 'Europe', 7.83),
  ('IE00BYZK4552', '2026-10-12', 'Other (not itemised)', 'World', 23.24),
  ('IE000O6Z73N7', '2026-10-12', 'United States', 'North America', 36.1),
  ('IE000O6Z73N7', '2026-10-12', 'China', 'Emerging Markets', 22.81),
  ('IE000O6Z73N7', '2026-10-12', 'Japan', 'Asia', 11.29),
  ('IE000O6Z73N7', '2026-10-12', 'Other (not itemised)', 'World', 29.8),
  ('LU1861132840', '2026-10-12', 'United States', 'North America', 79.43),
  ('LU1861132840', '2026-10-12', 'Germany', 'Europe', 5.72),
  ('LU1861132840', '2026-10-12', 'Switzerland', 'Europe', 4.93),
  ('LU1861132840', '2026-10-12', 'Other (not itemised)', 'World', 9.92),
  ('IE00BGV5VN51', '2026-10-12', 'United States', 'North America', 82.72),
  ('IE00BGV5VN51', '2026-10-12', 'South Korea', 'Emerging Markets', 7.1),
  ('IE00BGV5VN51', '2026-10-12', 'China', 'Emerging Markets', 4.44),
  ('IE00BGV5VN51', '2026-10-12', 'Other (not itemised)', 'World', 5.74),
  ('IE00BDVPNG13', '2026-10-12', 'United States', 'North America', 73.42),
  ('IE00BDVPNG13', '2026-10-12', 'Netherlands', 'Europe', 5.94),
  ('IE00BDVPNG13', '2026-10-12', 'Other (not itemised)', 'World', 20.64),
  ('IE00B3VWN179', '2026-10-12', 'United States', 'North America', 100.0),
  ('IE00B1FZS798', '2026-10-12', 'United States', 'North America', 100.0),
  ('IE00BSKRJZ44', '2026-10-12', 'United States', 'North America', 100.0)
) as v(isin, as_of, country, region, weight_pct)
join securities s on s.isin = v.isin
where not exists (
  select 1 from security_country_exposure x
  where x.security_id = s.id and x.as_of = v.as_of::date and x.country = v.country
);
