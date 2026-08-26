-- Portfolio.io — enables automated weekly S&P 500 / Nasdaq-100 tracking
-- via SPY/QQQ (Alpha Vantage TIME_SERIES_WEEKLY, live-tested working on
-- the current plan 2026-08-26), while keeping the existing real
-- historical index-level data (SPX/NDX, 0018/0019) frozen exactly as
-- imported. Decision (confirmed with the app's owner): the two must
-- never be compared or divided against each other directly - SPY trades
-- at roughly 1/10th the S&P 500's index level by pure ETF-share-price
-- mechanics, nothing to do with performance, so mixing them the way
-- 0016's original SPY/QQQ collector once did would corrupt every return
-- calculated across the seam (exactly the bug 0018 fixed once already).
--
-- Two additive schema changes:
--
-- 1. benchmarks.proxy_symbol - the live-tracking instrument this
--    benchmark is displayed under the SAME name with. The UI always
--    shows "S&P 500"/"Nasdaq-100" (benchmarks.name, unchanged) as the
--    primary label; proxy_symbol only powers a small methodology
--    footnote ("tracked using SPY") - it never replaces the display
--    name. Deliberately separate from the existing `symbol` column
--    (SPX/NDX - the real index ticker the frozen historical segment is
--    against), per the app owner's explicit instruction to keep
--    benchmark identity and proxy explicitly separated.
alter table benchmarks add column proxy_symbol text;
update benchmarks set proxy_symbol = 'SPY' where id = 'sp500';
update benchmarks set proxy_symbol = 'QQQ' where id = 'nasdaq100';

-- 2. benchmark_history.symbol / instrument_type - carried PER ROW, not
--    read from the parent benchmarks row. A single benchmark_id's row
--    history can now span two real segments (frozen SPX/NDX index
--    levels, then live SPY/QQQ proxy prices) - every row must self-
--    describe which one it is, the same discipline `frequency` already
--    has (0018), so js/calculations.js:indexValueSeries() can detect
--    exactly where the switch happens from the data itself, never a
--    hardcoded date, and chain-link across it instead of dividing two
--    incompatible scales together.
alter table benchmark_history add column symbol text;
alter table benchmark_history add column instrument_type text check (instrument_type in ('index', 'etf'));

-- Backfill: every row that exists today is part of the frozen
-- historical import (0019), so it takes on whatever its parent
-- benchmarks row's symbol/instrument_type already are today (SPX/NDX,
-- 'index', per 0018) - not hardcoded here, read from the live
-- benchmarks table, so this is correct even if that ever changes.
update benchmark_history bh
set symbol = b.symbol, instrument_type = b.instrument_type
from benchmarks b
where bh.benchmark_id = b.id and bh.symbol is null;

-- Verification.
select id, name, symbol, proxy_symbol, instrument_type from benchmarks order by id;
select benchmark_id, symbol, instrument_type, count(*) from benchmark_history
  group by benchmark_id, symbol, instrument_type order by benchmark_id;
