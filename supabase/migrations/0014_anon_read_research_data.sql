/* ============================================================
   0014_anon_read_research_data.sql - Securities and Broker Comparison
   are the public research catalogue ("what has Vera researched?"), not
   personal financial data ("what does Vera own?") - see products.js/
   brokers.js/product-detail.js for the corresponding UI fix removing
   their sign-in gates.

   None of the five tables below has an ownership/personal column -
   confirmed against 0001/0004/0005's own schemas. Existing of a row
   here means "on file for research", never "Vera holds this". What
   Vera actually holds lives in transactions/valuations/accounts/
   portfolios, whose RLS is untouched by this migration.

   Additive only: Postgres OR's multiple SELECT policies together, so
   the existing "authenticated read" policy on each table is kept
   as-is and this just adds a second, anon-scoped one alongside it.
   Writes stay "authenticated write" everywhere - unchanged.
   ============================================================ */

create policy "anon read" on institutions     for select to anon using (true);
create policy "anon read" on securities       for select to anon using (true);
create policy "anon read" on security_details for select to anon using (true);
create policy "anon read" on brokers          for select to anon using (true);
create policy "anon read" on daily_prices     for select to anon using (true);
