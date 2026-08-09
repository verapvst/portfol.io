-- Portfolio.io — brokers gets a real "Last updated" too.
--
-- Reuses set_updated_at() from 0007_security_details_last_updated.sql
-- rather than redefining it - exactly the "other tables can adopt the
-- same trigger later without a schema change of their own" case that
-- migration's own comment anticipated. Run after 0007 (needs that
-- function to already exist).

drop trigger if exists brokers_set_updated_at on brokers;
create trigger brokers_set_updated_at
  before update on brokers
  for each row
  execute function set_updated_at();
