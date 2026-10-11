-- Portfol.io - which currency a security's PRICE is quoted in.
--
-- daily_prices.close is a number in the listing's own currency. The Simulator
-- needs to know it (units = EUR amount / price only makes sense for a EUR
-- line; a USD or GBX line needs conversion and a different FX-fee cost).
-- resolve-provider-symbols now stores it, from the same provider response
-- whose ISIN it verified, instead of guessing from the exchange suffix.
--
-- Backfill: the four held ETFs use XETRA symbols (EUR), verified in 0004.
-- Idempotent. Run once in the Supabase SQL Editor.

alter table securities add column if not exists price_currency text;
update securities set price_currency = 'EUR'
where price_currency is null and data_provider_symbol like '%.XETRA';
