-- Audit history is an official record: reject any UPDATE or DELETE on AuditLog rows.
CREATE OR REPLACE FUNCTION windguard_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION windguard_audit_log_immutable();
