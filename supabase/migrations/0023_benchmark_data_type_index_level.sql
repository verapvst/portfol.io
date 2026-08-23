-- Portfolio.io — fix stale data_type on the sp500/nasdaq100 benchmark
-- rows.
--
-- 0018 (benchmark_index_level_restructure) switched these two rows from
-- ETF-proxy prices (SPY/QQQ) to real S&P 500/Nasdaq-100 INDEX levels
-- (SPX/NDX) - it updated symbol, instrument_type and source/description
-- to say so, but missed data_type, which is still the original seed
-- value from 0016: 'price_return'. Neither UI reads this column for
-- anything beyond a label suffix (js/app.js and js/performance.js both
-- append " · Price Return" to the benchmark legend/toggle label when
-- dataType === 'price_return' - see BENCHMARK_SERIES_COLOR's own
-- neighbouring comment), so the only visible symptom is a wrong label -
-- "S&P 500 (SPX) · Price Return" - on data that's actually an index
-- level, not a price return series. No calculation ever branches on
-- this column, so nothing beyond the label was ever wrong.
--
-- 'index_level' wasn't a valid data_type when 0016 defined the check
-- constraint (only 'price_return'/'total_return' - proxy-data concepts,
-- since the original plan was ETF prices) - widening it here rather
-- than picking one of the two existing values, since an index level is
-- neither a price-return nor a total-return series computed from a
-- price; it's the index itself. Once this lands, both pages' existing
-- `dataType === 'price_return'` check automatically stops appending the
-- suffix for sp500/nasdaq100 - no JS change needed, this is purely a
-- data correction.

alter table benchmarks drop constraint benchmarks_data_type_check;
alter table benchmarks add constraint benchmarks_data_type_check
  check (data_type in ('price_return', 'total_return', 'index_level'));

update benchmarks set data_type = 'index_level' where id in ('sp500', 'nasdaq100');

-- Verification - confirm both rows now read as index-level, real-price
-- data, not a stale price-return label.
select id, symbol, instrument_type, data_type, source from benchmarks order by id;
