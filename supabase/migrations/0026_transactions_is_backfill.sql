-- Portfolio.io — XIRR/TWR fix: distinguish a real cash flow happening
-- today from a backfill/recognition entry recording capital that
-- already existed before this app tracked it.
--
-- Real incident this closes: a Trading212 CSV import brought in 4 ETFs
-- with no purchase transaction behind them, and a stale Cash bug meant
-- €250 that had funded a real purchase was never recorded as a
-- deposit. Both got fixed by inserting deposit transactions dated to
-- when the capital was recognized - correct for Time-Weighted Return
-- (a deposit is a deposit; TWR only cares that it's excluded from
-- return, not why). But XIRR is money-weighted and treats every
-- deposit/buy as real money leaving your pocket ON THAT DATE - a
-- backfill deposit reads as a large NEW contribution today, distorting
-- the annualised rate needed to reconcile it against current value
-- (observed: XIRR swung to -97% after two backfill deposits totalling
-- €410 against a ~€753 portfolio).
--
-- is_backfill marks exactly this case. TWR is unaffected either way (a
-- deposit stays external at portfolio scope regardless of the flag);
-- XIRR excludes flagged transactions from its cash-flow list (js/
-- analytics.js), since money-weighted return should only ever weight
-- REAL cash-flow timing, never a bookkeeping catch-up entry.

alter table transactions add column is_backfill boolean not null default false;

comment on column transactions.is_backfill is
  'True when this transaction records capital that already existed before being tracked here (e.g. a bulk CSV import backfill, or recognising a cash balance that was never previously entered) rather than a real cash flow happening on this date. Time-Weighted Return treats it identically either way - a deposit is external capital regardless of why it is being recorded. XIRR (js/analytics.js) excludes backfill-flagged transactions from its cash-flow list, since XIRR is money-weighted and a backfill entry would otherwise read as new money leaving your pocket today, distorting the annualised rate needed to reconcile it against current value.';
