-- ONE-OFF (run after 0042). These five price symbols were verified on
-- 2026-10-12 by resolve-provider-symbols (dry run): in every case the data
-- provider's own ISIN equalled securities.isin, and the line quoted a recent
-- close. Written by hand here so no further API calls are spent today (the
-- EODHD free plan allows 20 a day, and the nightly price fetch needs its own).
--   L&G ROBO               IROB.XETRA  EUR  last close 29.275 (2026-10-09)
--   iShares Automation     2B76.XETRA  EUR  last close 20.005 (2026-10-09)
--   Global X Robotics & AI XB0T.XETRA  EUR  last close 21.485 (2026-10-09)
--   WisdomTree Physical AI PAIW.XETRA  EUR  last close 19.056 (2026-10-09)
--   KraneShares Humanoid   KOID.LSE    USD  last close 27.85  (2026-10-09)
--     (the provider lists KOID only on the London exchange, quoted in USD)

update securities set data_provider_symbol = 'IROB.XETRA', price_currency = 'EUR' where isin = 'IE00BMW3QX54';
update securities set data_provider_symbol = '2B76.XETRA', price_currency = 'EUR' where isin = 'IE00BYZK4552';
update securities set data_provider_symbol = 'XB0T.XETRA', price_currency = 'EUR' where isin = 'IE00BLCHJB90';
update securities set data_provider_symbol = 'PAIW.XETRA', price_currency = 'EUR' where isin = 'IE000LCKJ888';
update securities set data_provider_symbol = 'KOID.LSE',   price_currency = 'USD' where isin = 'IE000O6Z73N7';

select name, data_provider_symbol, price_currency from securities where theme is not null order by theme, name;
