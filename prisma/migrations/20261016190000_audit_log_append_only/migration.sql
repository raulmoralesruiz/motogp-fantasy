-- T-09: auditoría append-only.
-- La garantía vive en la base de datos (no en la app): ningún camino de
-- código puede UPDATE ni DELETE una entrada de `audit_log`; solo INSERT.
-- (security.md §1.9; CA de T-09.)
CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es append-only: UPDATE/DELETE no permitidos (T-09)';
END;
$$;

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION reject_audit_log_mutation();
