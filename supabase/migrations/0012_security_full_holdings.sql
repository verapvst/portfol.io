-- Portfolio.io — the FULL current holdings list (all ~118 for BPI
-- Dinâmico), distinct from security_details.top_holdings (0011 - a
-- short summary list from the monthly Ficha Mensal).
--
-- Same architecture decision as 0011 and for the same reason: current
-- state only, replaced wholesale on each import, never accumulated
-- historically. Reuses the exact jsonb-on-security_details pattern
-- (matching annual_returns' own precedent) rather than a new
-- relational table - still no concrete cross-security query need to
-- justify one.
--
-- Source is a genuinely different document from top_holdings: BPI's
-- "Carteira Detalhada" (Detailed Portfolio) report, not the monthly
-- Ficha Mensal - js/importer/holdingsReportParser.js already parses it
-- in full (name, weight_pct, market_value, confidence per holding) but
-- nothing has ever persisted that output, same gap 0011 closed for
-- top_holdings. all_holdings_as_of gets its own column since the two
-- documents can have different report dates even for the same fund.

alter table security_details add column if not exists all_holdings jsonb;
comment on column security_details.all_holdings is
  'The FULL current holdings list (e.g. ~118 for BPI Dinâmico) - [{name, weight_pct, market_value, ...}, ...], from a BPI "Carteira Detalhada" (Detailed Portfolio) import. Distinct from top_holdings (0011, a shorter summary from the monthly Ficha Mensal) - genuinely different source documents. Replaced wholesale on each import, never accumulated historically. Null means genuinely not yet imported, not zero holdings.';

alter table security_details add column if not exists all_holdings_as_of date;
comment on column security_details.all_holdings_as_of is
  'Data as of: the Carteira Detalhada report''s own as-of date - same Last Updated / Data as of convention as costs_as_of/performance_as_of/allocation_as_of/composition_as_of. Can differ from composition_as_of (0011) since the two source documents are imported separately and may have different report dates.';
