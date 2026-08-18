-- Portfolio.io — Performance & Benchmark Engine: switch benchmark_history
-- from ETF-proxy prices (SPY/QQQ via Alpha Vantage) to real S&P 500 /
-- Nasdaq-100 INDEX levels (SPX/NDX), sourced from a historical CSV
-- import (0019) going forward.
--
-- WHY: Alpha Vantage's free tier has no raw index symbol, so 0016
-- originally used SPY/QQQ as proxies. A historical CSV (Investing.com-
-- style export, Feb 2017 - Aug 2026, monthly) turned out to contain the
-- real SPX/NDX index levels instead - a fundamentally different scale
-- (S&P 500 index ~4,500-7,800 over this period vs. SPY ETF price
-- ~450-680; Nasdaq-100 index ~13,000-30,000 vs. QQQ ETF price
-- ~300-620). Mixing the two scales in one benchmark_id's row history
-- would make the chain-linked return engine see a fake ~85-90% "move"
-- at the seam between them - a real correctness bug, not cosmetic.
-- Decision (confirmed with the app's owner): index levels are the more
-- correct benchmark anyway (no ETF tracking error/expense drag), so
-- this migration deletes the old ETF-scale rows and repoints the whole
-- table at index levels. ETF-based auto-collection is retired, not
-- paused-with-intent-to-resume - see the two now-deprecated Edge
-- Functions' own updated header comments.
--
-- The existing "observation table, not a calculated one" discipline
-- (0016's own header comment) is unchanged - only the column name
-- (close -> index_level, since "close" implies a traded price, not an
-- index level) and what's allowed to write it change.

-- Old ETF-scale rows are not salvageable at the new column's meaning -
-- deleting rather than converting (there's no valid SPY-close ->
-- index-level conversion that wouldn't be inventing data).
delete from benchmark_history;

alter table benchmark_history rename column close to index_level;

-- Explicit, not inferred from row density - a table that mixes monthly
-- (this CSV) and, eventually, daily observations for the same
-- benchmark_id needs to say which is which so the UI/data-quality layer
-- never implies daily coverage that isn't real (see 0019's own comment
-- and the app owner's explicit "do not fabricate daily observations
-- from the monthly index levels" instruction).
alter table benchmark_history add column frequency text not null default 'daily' check (frequency in ('daily', 'monthly'));

alter table benchmarks rename column provider_symbol to symbol;
alter table benchmarks drop column provider;
alter table benchmarks add column instrument_type text not null default 'index' check (instrument_type in ('index', 'etf'));
alter table benchmarks add column source text;

update benchmarks set
  symbol = 'SPX', instrument_type = 'index', source = 'Historical CSV import (Investing.com-style export)',
  description = 'S&P 500 index level (SPX) - not the SPY ETF. Historical data imported from CSV (0019); no free automated daily index feed exists today, so this updates by periodic re-import until a provider is found.'
where id = 'sp500';

update benchmarks set
  symbol = 'NDX', instrument_type = 'index', source = 'Historical CSV import (Investing.com-style export)',
  description = 'Nasdaq-100 index level (NDX) - not the QQQ ETF. Historical data imported from CSV (0019); no free automated daily index feed exists today, so this updates by periodic re-import until a provider is found.'
where id = 'nasdaq100';

alter table benchmarks alter column source set not null;

-- Retire the SPY/QQQ nightly collector - it would now both write the
-- wrong scale AND reference a dropped column name. fetch-fx-rates-
-- nightly is untouched (FX isn't affected by this benchmark-scale
-- change at all).
select cron.unschedule('fetch-benchmark-history-nightly');

-- Confirm the retirement and the new benchmarks shape.
select jobname, active from cron.job where jobname = 'fetch-benchmark-history-nightly';
select id, symbol, name, instrument_type, currency, data_type, source from benchmarks order by id;
