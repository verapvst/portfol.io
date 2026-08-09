-- Portfolio.io — Real product/broker data seed.
-- Source: ~/Desktop/Portfol.io/database/database.json (the old Portfol.io
-- app's Excel-derived master database, generated 2026-08-09), read in
-- full and transcribed here. Every number below is copied verbatim from
-- that file; nothing is invented. Portuguese prose (philosophy, SFDR
-- labels, broker descriptions/pros/cons) is translated to English per
-- the "UI language should be professional English throughout" directive
-- - the underlying facts are unchanged.
--
-- 4 of the 18 legacy products are securities Vera already holds (matched
-- by ISIN against her real Supabase `securities` rows: UETW, AVWS, XDEQ,
-- SPYM). Those get a security_details row attached to their EXISTING
-- security, not a new one. The other 14 are research-only products with
-- no existing security row, so this seed creates one for each.
-- BPI Dinâmico (her actual 5th held security) has no 1:1 match in this
-- dataset - none of the 18 products is literally that fund - so it gets
-- no security_details row here. That's an honest gap, not an omission.
--
-- How to run this: paste into the Supabase SQL Editor and run once,
-- after 0005_product_database.sql. Plain inserts, no conflict handling
-- - same "run once, fail loudly on a second run" discipline as every
-- migration before it.

-- =========================================================================
-- 1. Institutions (issuers) - reuse the existing shared table, insert
--    only the ones that don't already exist.
-- =========================================================================

insert into institutions (name)
select v.name from (values
  ('BPI Gestão de Ativos'),
  ('BPI Vida e Pensões'),
  ('BlackRock (iShares)'),
  ('UBS Asset Management'),
  ('American Century (Avantis)'),
  ('DWS Xtrackers'),
  ('State Street')
) as v(name)
where not exists (select 1 from institutions i where i.name = v.name);

-- =========================================================================
-- 2. New securities - the 14 legacy products with no existing holding.
--    Portuguese retail products (Fund/PPR/Insurance) are EUR-denominated
--    by regulation, hence currency='EUR' below; the 2 iShares ETFs have
--    no currency stated in the source data, so it's left null rather
--    than guessed.
-- =========================================================================

insert into securities (name, type, isin, domicile, currency, benchmark, provider_id, asset_class)
values
  ('BPI Ações Mundiais', 'Fund', 'PTYPIFLM0019', 'Portugal', 'EUR', 'MSCI World Net TR EUR',
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Equity'),
  -- isin intentionally null, not 'PTYPJJHM0002' as the legacy dataset states: that ISIN
  -- already belongs to Vera's real held "BPI Dinâmico" security in this database - either
  -- a data-entry error on one side or a genuine coincidence, not something to guess-fix here.
  -- Inserting it here would collide with that existing row (which is exactly what broke this
  -- script's first run - see the security_details insert below, which now matches by name).
  ('BPI Impacto Clima Ações', 'Fund', null, 'Portugal', 'EUR', 'MSCI World Net TR EUR',
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Equity'),
  ('BPI Renda Trimestral Ações', 'Fund', 'PTBG2KHM0008', 'Portugal', 'EUR', 'MSCI World Net TR EUR',
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Equity'),
  ('BPI Agressivo (Fundo)', 'Fund', 'PTYPJIHM0011', 'Portugal', 'EUR', '70% MSCI World / 30% Euro Bond',
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Multi-Asset'),
  ('BPI Universal (Fundo)', 'Fund', 'PTYPILLM0003', 'Portugal', 'EUR', '60% MSCI World / 40% Euro Bond',
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Multi-Asset'),
  ('BPI SMART Ações PPR', 'PPR', 'PTYPIEHM0024', 'Portugal', 'EUR', 'Bloomberg World Large & Mid Cap',
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Equity'),
  ('BPI Universal (Seguro Cap.)', 'Insurance', null, 'Portugal', 'EUR', '60% MSCI World / 40% Euro Bond',
    (select id from institutions where name = 'BPI Vida e Pensões'), 'Multi-Asset'),
  ('BPI Capitalização Agressivo (Seguro Cap.)', 'Insurance', null, 'Portugal', 'EUR', 'MSCI World Net TR EUR',
    (select id from institutions where name = 'BPI Vida e Pensões'), 'Multi-Asset'),
  ('iShares Core S&P 500', 'ETF', 'IE00B5BMR087', 'Ireland', null, 'S&P 500 NR',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Equity'),
  ('iShares Core MSCI World', 'ETF', 'IE00B4L5Y983', 'Ireland', null, 'MSCI World NR USD',
    (select id from institutions where name = 'BlackRock (iShares)'), 'Equity'),
  ('BPI Smart Obrigações PPR', 'PPR', null, 'Portugal', 'EUR', null,
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Bond'),
  ('BPI Smart Moderado PPR', 'PPR', null, 'Portugal', 'EUR', null,
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Multi-Asset'),
  ('BPI Smart Dinâmico PPR', 'PPR', null, 'Portugal', 'EUR', null,
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Multi-Asset'),
  ('BPI Smart Ações PPR', 'PPR', null, 'Portugal', 'EUR', null,
    (select id from institutions where name = 'BPI Gestão de Ativos'), 'Equity');

-- Backfill asset_class on the 4 already-held securities, only where it's
-- currently unset - additive, never overwrites anything Vera has set.
update securities set asset_class = 'Equity' where isin in ('IE00BD4TXV59', 'IE0003R87OG3', 'IE00BL25JL35', 'IE00B469F816') and asset_class is null;
update securities set provider_id = (select id from institutions where name = 'UBS Asset Management')        where isin = 'IE00BD4TXV59' and provider_id is null;
update securities set provider_id = (select id from institutions where name = 'American Century (Avantis)')  where isin = 'IE0003R87OG3' and provider_id is null;
update securities set provider_id = (select id from institutions where name = 'DWS Xtrackers')                where isin = 'IE00BL25JL35' and provider_id is null;
update securities set provider_id = (select id from institutions where name = 'State Street')                 where isin = 'IE00B469F816' and provider_id is null;

-- =========================================================================
-- 3. security_details - all 18 products. The 4 already-held securities
--    are matched by ISIN (their id already exists); the 14 new ones are
--    matched by the exact name just inserted above.
-- =========================================================================

insert into security_details (
  security_id, launched_date, ter_pct, riy_pct, management_fee_pct, depositary_fee_pct, redemption_fee_pct,
  aum_eur_millions, return_1y_pct, return_3y_pct, return_5y_pct, volatility_pct, sharpe_ratio, sortino_ratio,
  beta, tracking_error_pct, max_drawdown_pct, alpha_pct, assumed_gross_return_pct, star_rating,
  alloc_stocks_pct, alloc_bonds_pct, alloc_other_pct, exposure_us_pct, exposure_eu_pct, exposure_em_pct,
  holdings_count, concentration_top10, tax_rate_lt2y_pct, tax_rate_2to5y_pct, tax_rate_5to8y_pct,
  tax_rate_gt8y_pct, tax_deduction_pct, tax_efficiency_score, data_quality, transparency_score,
  philosophy, sfdr_article, annual_returns, legacy_product_id, source, last_verified
) values

-- PROD001 — BPI Ações Mundiais
((select id from securities where isin = 'PTYPIFLM0019'), '2000-12-04', 2.22, 2.22, 1.7, 0.08, 0.0,
 141.29, 10.24, 7.69, 6.9, 14.5, 0.329655172413793, 0.470935960591133,
 0.99, 2.0, -34.88, -2.22, 9.0, 2,
 99.2, 0, 0.8, 76.84, 16.58, 1.31,
 70, 0.3358, 28.0, 25.2, 22.4,
 19.6, 0, 10, 'Real', 6,
 'Actively managed; integrates sustainability risk considerations (SFDR Article 8).', 'Article 8',
 '{"2025":-5.1,"2024":14.53,"2023":22.28,"2022":-18.05,"2021":33.95,"2020":10.1,"2019":34.6,"2018":-8.8,"2017":9.3,"2016":19.5}'::jsonb,
 'PROD001', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD002 — BPI Impacto Clima Ações (matched by name, not isin - see the securities insert above)
((select id from securities where name = 'BPI Impacto Clima Ações'), '2022-05-24', 2.21, 2.21, 1.7, 0.08, 0.0,
 14.98, 14.74, 8.94, null, 14.5, 0.330344827586207, 0.47192118226601,
 0.99, 2.5, -40.0, -2.21, 9.0, 2,
 99.0, 0, 1.0, 65.0, 24.0, 1.0,
 65, 0.2263, 28.0, 25.2, 22.4,
 19.6, 0, 8, 'Partial', 6,
 'Actively managed; focused on climate impact and action (SFDR Article 9).', 'Article 9',
 '{"2025":-0.52,"2024":15.93,"2023":16.1}'::jsonb,
 'PROD002', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD003 — BPI Renda Trimestral Ações
((select id from securities where isin = 'PTBG2KHM0008'), '2025-04-24', 2.74, 2.74, 1.7, 0.08, 0.0,
 104.27, 16.27, null, null, 14.5, 0.293793103448276, 0.419704433497537,
 0.98, 2.5, -36.35, -2.74, 9.0, 2,
 98.4, 0, 1.6, 69.0, 23.0, 0.7,
 60, 0.2322, 28.0, 25.2, 22.4,
 19.6, 0, 8, 'Partial', 6,
 'Actively managed; targets attractively-valued equities in the EU, UK, Switzerland and Norway.', null,
 '{}'::jsonb,
 'PROD003', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD004 — BPI Agressivo (Fundo)
((select id from securities where isin = 'PTYPJIHM0011'), '2015-07-13', 1.88, 1.88, 1.125, 0.1, 0.0,
 31.95, 19.45, 11.15, 5.71, 10.4076, 0.491949639968885, 0.70278519995555,
 1.0, 3.0, -33.7, -1.88, 9.0, 3,
 69.4, 13.1, 17.5, 55.0, 25.0, 4.0,
 50, 0.3186, 28.0, 25.2, 22.4,
 19.6, 0, 7, 'Real', 6,
 'Actively managed and diversified; integrates ESG risk considerations (SFDR Article 8).', 'Article 8',
 '{"2025":9.71,"2024":12.15,"2023":10.25,"2022":-13.18,"2021":11.35}'::jsonb,
 'PROD004', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD005 — BPI Universal (Fundo)
((select id from securities where isin = 'PTYPILLM0003'), '1995-06-27', 1.81, 1.81, 0.975, 0.025, 2.0,
 14.02, 32.16, 13.92, 7.1, 9.1198, 0.569094000357794, 0.812991429082563,
 1.0, 3.0, -25.95, -1.81, 9.0, 2,
 58.6, 22.2, 19.2, 45.0, 20.0, 9.0,
 25, 0.6741, 28.0, 25.2, 22.4,
 19.6, 0, 7, 'Real', 6,
 'Actively managed; captures market trends via third-party funds (fund-of-funds).', null,
 '{"2025":14.5,"2024":10.81,"2023":4.92,"2022":-7.51,"2021":5.97}'::jsonb,
 'PROD005', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD006 — BPI SMART Ações PPR
((select id from securities where isin = 'PTYPIEHM0024'), '2019-11-07', 2.44, 2.44, 1.7, 0.09, 0.0,
 46.55, 9.61, 7.02, 4.18, 14.5, 0.31448275862069, 0.449261083743842,
 0.99, 2.0, -34.0, -2.44, 9.0, 4,
 99.2, 0, 0.8, 76.0, 14.3, 1.4,
 70, 0.3294, 21.5, 21.5, 17.2,
 8.6, 20.0, 7, 'Real', 9,
 'Actively managed; global mandate with ESG criteria (SFDR Article 8).', 'Article 8',
 '{"2025":-5.4,"2024":14.01,"2023":14.95,"2022":-18.11,"2021":28.86,"2020":5.6}'::jsonb,
 'PROD006', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD007 — BPI Universal (Seguro Cap.) — isin field in source was a policy code ("902"), not a real ISIN, so left null on the security row; kept here for traceability.
((select id from securities where name = 'BPI Universal (Seguro Cap.)'), '2001-06-11', 1.83, 1.83, 1.25, null, 0.0,
 18.63, 32.0, 13.7, 6.7, 9.1198, 0.566900959893987, 0.809858514134268,
 1.0, 3.0, -21.39, -1.83, 9.0, 3,
 62.0, 19.5, 18.5, 40.0, 18.0, 14.0,
 22, 0.6676, 28.0, 28.0, 22.4,
 11.2, 0, 7, 'Real', 6,
 'Invests in funds managed by independent asset managers.', null,
 '{}'::jsonb,
 'PROD007 (policy code 902)', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD008 — BPI Capitalização Agressivo (Seguro Cap.) — same policy-code caveat as PROD007 (code "835")
((select id from securities where name = 'BPI Capitalização Agressivo (Seguro Cap.)'), '2002-12-26', 2.0, 2.0, 1.25, null, 0.0,
 77.59, 19.7, 11.3, 5.8, 14.5, 0.344827586206897, 0.492610837438424,
 1.0, 3.0, -34.16, -2.0, 9.0, 3,
 69.8, 12.8, 17.4, 55.0, 25.0, 13.0,
 65, 0.306, 28.0, 28.0, 22.4,
 11.2, 0, 5, 'Real', 6,
 'Actively managed with currency exposure; predominantly equity-focused.', null,
 '{}'::jsonb,
 'PROD008 (policy code 835)', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD009 — iShares Core S&P 500
((select id from securities where isin = 'IE00B5BMR087'), '2010-05-19', 0.07, 0.07, null, null, 0.0,
 126023.0, 26.0, 20.0, 14.12, 15.5, 0.608387096774194, 0.869124423963134,
 0.95, 6.0, -34.0, 2.43, 11.5, 4,
 100.0, 0, 0, 99.9, 0, 0,
 504, 0.32, 28.0, 28.0, 28.0,
 28.0, 0, 4, 'Estimated', 6,
 'Passively managed; full physical replication.', null,
 '{"2025":26.0,"2024":13.7,"2023":21.4,"2022":-13.0,"2021":37.8}'::jsonb,
 'PROD009', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD010 — iShares Core MSCI World
((select id from securities where isin = 'IE00B4L5Y983'), '2009-09-25', 0.2, 0.2, null, null, 0.0,
 105553.0, 21.2, null, 11.36, 14.5, 0.468965517241379, 0.669950738916256,
 1.0, 0.05, -34.0, -0.2, 9.0, 5,
 100.0, 0, 0, 71.52, 14.06, 0,
 1500, 0.2684, 28.0, 28.0, 28.0,
 28.0, 0, 4, 'Partial', 6,
 'Passively managed; optimised (sampling) replication.', null,
 '{"2025":21.2}'::jsonb,
 'PROD010', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD011 — UBS Core MSCI World UCITS ETF USD Acc (already held: UETW)
((select id from securities where isin = 'IE00BD4TXV59'), '2014-02-27', 0.06, 0.06, 0.06, 0.0, 0.0,
 8929.0, 20.28, 16.81, 12.09, 14.71, 0.69, 0.97,
 1.0, 0.06, -20.45, -0.06, 9.0, 4,
 100.0, 0, 0, 72.5, 11.8, 0,
 1308, 0.244, 28.0, 28.0, 28.0,
 28.0, 0, 4, 'Real', 9,
 'Accumulating passive ETF that physically replicates the MSCI World Index using full replication. TER of 0.06%, among the most competitive in its category. Exposure to over 1,300 large- and mid-cap companies across 23 developed markets.', 'Article 6',
 '{"2025":7.24,"2024":26.43,"2023":19.47,"2022":-13.2}'::jsonb,
 'PROD011', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD012 — Avantis Global Small Cap Value UCITS ETF USD Acc (already held: AVWS)
((select id from securities where isin = 'IE0003R87OG3'), '2024-09-25', 0.39, 0.39, 0.39, 0.0, 0.0,
 873.0, 38.59, null, null, 13.41, 2.73, 3.82,
 1.1, 3.0, -23.02, -0.39, 9.0, 3,
 100.0, 0, 0, 70.7, 12.0, 0,
 1354, 0.067, 28.0, 28.0, 28.0,
 28.0, 0, 4, 'Partial', 9,
 'Actively managed ETF focused on small-cap equities across global developed markets. Overweights companies with low valuations and high profitability (Value + Profitability tilt). Highly diversified, with 1,354 holdings and no single position above 1%.', 'Article 6',
 '{"2025":6.04}'::jsonb,
 'PROD012', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD013 — Xtrackers MSCI World Quality UCITS ETF 1C (already held: XDEQ)
((select id from securities where isin = 'IE00BL25JL35'), '2014-09-11', 0.25, 0.25, 0.25, 0.0, 0.0,
 2469.0, 17.57, 15.2, 11.03, 14.86, 0.61, 0.85,
 0.83, 0.05, -19.86, -0.25, 9.0, 4,
 100.0, 0, 0, 67.3, 14.0, 0,
 293, 0.323, 28.0, 28.0, 28.0,
 28.0, 0, 4, 'Real', 9,
 'Passive ETF tracking the MSCI World Quality Index, selecting around 300 companies with high ROE, low leverage and stable earnings growth. A beta of 0.83 gives it a defensive profile, with a lower historical drawdown than the broad market.', 'Article 6',
 '{"2025":2.04,"2024":24.14,"2023":21.43,"2022":-14.18,"2021":23.32,"2020":14.94,"2019":31.47,"2018":-7.89}'::jsonb,
 'PROD013', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD014 — SPDR MSCI Emerging Markets UCITS ETF (already held: SPYM)
((select id from securities where isin = 'IE00B469F816'), '2011-05-13', 0.18, 0.18, 0.18, 0.0, 0.0,
 1763.0, 46.45, 20.06, 8.26, 15.68, 0.4, 0.56,
 1.05, 0.47, -24.03, -0.18, 9.0, 3,
 100.0, 0, 0, 0, 2.0, 98.0,
 1193, 0.405, 28.0, 28.0, 28.0,
 28.0, 0, 4, 'Partial', 9,
 'Passive ETF using physical sampling to track the MSCI Emerging Markets Index (24 countries). Dominant concentration in Taiwan (27%), South Korea (23%) and China (21%), with 43% in the technology sector. Exposure to fast-growing economies, with elevated currency and geopolitical risk.', 'Article 6',
 '{"2025":18.3,"2024":14.47,"2023":5.98,"2022":-15.45}'::jsonb,
 'PROD014', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD015 — BPI Smart Obrigações PPR (newly launched, no track record)
((select id from securities where name = 'BPI Smart Obrigações PPR'), '2026-07-03', 0.955, 0.955, 0.955, 0.07, 0.0,
 0, null, null, null, 5.0, 1.209, 1.72714285714286,
 0.1, 2.0, -8.0, -0.955, 9.0, 3,
 0, 100.0, 0, 0, 0, 0,
 0, 0, 21.5, 21.5, 17.2,
 8.6, 20.0, 10, 'Estimated', 6,
 'Actively managed PPR from BPI Gestão de Ativos, launched 2026-07-03. Risk profile: up to 0% in equities. No market track record yet (newly launched) - risk metrics are estimated from a category proxy.', null,
 '{}'::jsonb,
 'PROD015', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD016 — BPI Smart Moderado PPR (newly launched, no track record)
((select id from securities where name = 'BPI Smart Moderado PPR'), '2026-07-03', 1.3, 1.3, 1.3, 0.09, 0.0,
 0, null, null, null, 5.8496, 0.974430160402858, 1.3920430862898,
 0.37, 2.0, -15.8, -1.3, 9.0, 3,
 30.0, 70.0, 0, 0, 0, 0,
 0, 0, 21.5, 21.5, 17.2,
 8.6, 20.0, 10, 'Estimated', 6,
 'Actively managed PPR from BPI Gestão de Ativos, launched 2026-07-03. Risk profile: up to 30% in equities. No market track record yet (newly launched) - risk metrics are estimated from a category proxy.', null,
 '{}'::jsonb,
 'PROD016', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD017 — BPI Smart Dinâmico PPR (newly launched, no track record)
((select id from securities where name = 'BPI Smart Dinâmico PPR'), '2026-07-03', 1.5, 1.5, 1.5, 0.09, 0.0,
 0, null, null, null, 9.1198, 0.603086127546795, 0.861551610781136,
 0.63, 2.0, -23.6, -1.5, 9.0, 4,
 60.0, 40.0, 0, 0, 0, 0,
 0, 0, 21.5, 21.5, 17.2,
 8.6, 20.0, 10, 'Estimated', 6,
 'Actively managed PPR from BPI Gestão de Ativos, launched 2026-07-03. Risk profile: up to 60% in equities. No market track record yet (newly launched) - risk metrics are estimated from a category proxy.', null,
 '{}'::jsonb,
 'PROD017', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09'),

-- PROD018 — BPI Smart Ações PPR (newly launched, no track record — distinct from PROD006's older "BPI SMART Ações PPR")
((select id from securities where name = 'BPI Smart Ações PPR'), '2026-07-03', 1.7, 1.7, 1.7, 0.09, 0.0,
 0, null, null, null, 14.5, 0.36551724137931, 0.522167487684729,
 0.99, 2.0, -34.0, -1.7, 9.0, 4,
 100.0, 0, 0, 0, 0, 0,
 0, 0, 21.5, 21.5, 17.2,
 8.6, 20.0, 10, 'Estimated', 6,
 'Actively managed PPR from BPI Gestão de Ativos, launched 2026-07-03. Risk profile: up to 100% in equities. No market track record yet (newly launched) - risk metrics are estimated from a category proxy.', null,
 '{}'::jsonb,
 'PROD018', 'Portfol.io legacy database (Excel-derived), generated 2026-08-09', '2026-08-09');

-- =========================================================================
-- 4. Brokers (10) - standalone reference data for the future
--    broker-comparison feature. Descriptions/pros/cons translated from
--    the source Portuguese.
-- =========================================================================

insert into brokers (
  id, name, country, regulator, publicly_listed, founded_year, protection_amount, protection_currency,
  custodian, etf_commission, stock_commission, fx_fee_pct, custody_fee_pct, inactivity_fee, withdrawal_fee,
  fractional_etfs, fractional_stocks, auto_investing, tax_report_provided, interest_on_cash_pct,
  tax_simplicity_score, beginner_score, advanced_score, cost_score, safety_score, ux_score,
  website, description, pros, cons
) values

('xtb', 'XTB', 'Poland', 'KNF / FCA / CySEC', true, 2002, 100000.0, 'EUR',
 'Dom Maklerski XTB S.A.', 0.0, 0.0, 0.5, 0.0, 10.0, 0.0,
 true, true, false, true, 3.8,
 7, 8, 7, 9, 9, 8,
 'xtb.com', 'Publicly listed Polish broker, zero commission on ETFs up to €100k/month. Award-winning app and advanced analysis platform.',
 array['Zero commission on ETFs (up to €100k/month)', 'Publicly listed (transparency)', 'Top-tier xStation app and platform'],
 array['No automated investment plan', '0.5% FX fee on non-EUR assets', 'Inactivity fee after 12 months without trades']),

('trading212', 'Trading 212', 'Bulgaria / United Kingdom', 'FCA / FSC', false, 2004, 85000.0, 'GBP',
 'Trading 212 Ltd', 0.0, 0.0, 0.15, 0.0, 0.0, 0.0,
 true, true, true, true, 4.2,
 7, 9, 6, 10, 7, 9,
 'trading212.com', 'Leading app for beginners. Zero commissions, a very low FX fee, "Pies" for automated investing, and interest on cash balances.',
 array['Zero commissions + 0.15% FX fee (lowest in the market)', 'Pies: automated investing by portfolio composition', 'Intuitive interface, ideal for beginners'],
 array['Not publicly listed', '€20k ICF protection for EU clients (£85k FCA for UK)', 'Tax report requires manual export']),

('traderepublic', 'Trade Republic', 'Germany', 'BaFin', false, 2019, 100000.0, 'EUR',
 'HSBC Deutschland', 1.0, 1.0, 0.0, 0.0, 0.0, 0.0,
 true, true, true, true, 3.25,
 8, 9, 7, 9, 9, 9,
 'traderepublic.com', 'German neobroker with €1 per trade, automated savings plans, interest on cash, and an integrated debit card.',
 array['Just €1 per trade (no FX fee)', 'Automated savings plans from €1', 'BaFin-regulated, custody via HSBC'],
 array['App-only (no full web version)', 'Tax reporting for Portugal needs manual adjustment', 'No access to options or complex products']),

('ibkr', 'Interactive Brokers', 'USA', 'SEC / FINRA / FCA / BaFin', true, 1978, 500000.0, 'USD',
 'Interactive Brokers LLC', 0.0, 1.0, 0.2, 0.0, 0.0, 0.0,
 true, true, true, true, 4.5,
 7, 5, 10, 8, 10, 6,
 'interactivebrokers.com', 'The most complete and secure broker in the global market. SIPC protection up to $500k, professional-grade execution, access to 150+ markets.',
 array['SIPC protection $500k + Lloyd''s excess insurance', 'Free ETF trading (IBKR Lite)', 'World-class tax reporting', 'Nasdaq-listed since 2007'],
 array['Complex interface, steep learning curve', 'Less suited to beginners', 'Requires USD-to-EUR conversion']),

('degiro', 'DEGIRO', 'Netherlands', 'AFM / DNB / BaFin', true, 2013, 100000.0, 'EUR',
 'flatexDEGIRO Bank AG', 0.0, 3.9, 0.25, 0.0, 0.0, 0.0,
 false, false, false, true, 0.0,
 6, 7, 7, 8, 8, 7,
 'degiro.pt', 'European pioneer of low-cost trading. A commission-free ETF list, integrated with flatexDEGIRO Bank AG.',
 array['Commission-free ETFs (selected list)', 'Banking integration via flatexDEGIRO Bank', 'Robust web interface'],
 array['No fractional shares/ETFs', 'No automated investment plan', 'Dated interface compared to neobrokers']),

('lightyear', 'Lightyear', 'United Kingdom / Estonia', 'FCA / Finantsinspektsioon', false, 2021, 20000.0, 'EUR',
 'Lightyear Europe AS', 0.0, 1.0, 0.35, 0.0, 0.0, 0.0,
 true, true, false, false, 4.0,
 5, 7, 5, 8, 6, 7,
 'lightyear.com', 'British-Estonian fintech startup. Free ETF trading, a simple interface, and competitive interest on cash balances.',
 array['Free ETF trading', 'Modern, simple interface', '~4% interest on cash'],
 array['Only €20k protection', 'No detailed tax reporting', 'No automated plan', 'Still a young platform']),

('scalable', 'Scalable Capital', 'Germany', 'BaFin', false, 2014, 100000.0, 'EUR',
 'Baader Bank AG', 0.99, 0.99, 0.0, 0.0, 0.0, 0.0,
 true, true, true, true, 2.5,
 7, 7, 7, 8, 8, 8,
 'scalable.capital', 'German platform with automated savings plans, €0.99/trade with no FX fee, and a PRIME plan with unlimited trades.',
 array['No FX fee', 'Automated savings plans', 'PRIME plan: unlimited trades for €2.99/month'],
 array['€0.99 per trade on the basic plan', 'Lower interest on cash', 'No access to exotic markets']),

('saxo', 'Saxo Bank', 'Denmark', 'FSA (DK) / FCA', false, 1992, 100000.0, 'EUR',
 'Saxo Bank A/S', 3.0, 5.0, 0.25, 0.0, 0.0, 0.0,
 false, false, false, true, 3.0,
 7, 5, 9, 5, 9, 7,
 'home.saxo', 'Premium Danish bank for experienced investors. Access to 70+ exchanges, options, futures and individual bonds.',
 array['Access to 70+ global exchanges', 'Options, futures and individual bonds', 'A regulated bank, not a broker'],
 array['High commissions (€3-5 minimum)', 'No fractional shares', 'Complex interface', 'Not ideal for small amounts']),

('freedom24', 'Freedom24', 'Cyprus', 'CySEC / SEC', true, 2013, 20000.0, 'EUR',
 'Freedom Finance Europe Ltd', 2.0, 2.0, 1.5, 0.0, 0.0, 15.0,
 false, false, false, true, 5.5,
 5, 5, 7, 4, 7, 6,
 'freedom24.com', 'Kazakh-founded broker, Nasdaq-listed. Differentiated by access to US IPOs and high-interest cash deposits.',
 array['Exclusive access to US IPOs', 'Interest on cash up to 5.5%', 'Nasdaq-listed (FRHC)'],
 array['1.5% FX fee (among the highest)', '$15 withdrawal fee', 'No fractional shares', 'Only €20k protection']),

('revolut', 'Revolut', 'United Kingdom / Lithuania', 'FCA / Lietuvos bankas', false, 2015, 20000.0, 'EUR',
 'Revolut Securities Europe UAB', 1.0, 1.0, 0.0, 0.12, 0.0, 0.0,
 true, true, true, true, 3.5,
 6, 8, 5, 6, 7, 9,
 'revolut.com', 'Financial super-app with integrated trading. Convenient for existing everyday Revolut users.',
 array['Excellent interface and UX', 'Integration with a Revolut current account', 'Automated plans available'],
 array['0.12%/yr custody fee on positions', 'Only €20k protection', 'Not ideal as a primary broker for large amounts']);
