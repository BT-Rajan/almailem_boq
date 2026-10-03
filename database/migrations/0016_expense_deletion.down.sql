-- Development only: after this, deleted expenses count again.
DROP INDEX ix_expenses_project_actual ON expenses;
CREATE INDEX ix_expenses_project_actual
  ON expenses (project_id, status, reversal_of, reversed_at, cost_head_id, amount_fils);
ALTER TABLE expenses DROP INDEX uq_expenses_invoice;
ALTER TABLE expenses DROP COLUMN invoice_key;
ALTER TABLE expenses
  ADD COLUMN invoice_key VARCHAR(60) AS (
    IF(reversal_of IS NULL AND reversed_at IS NULL AND status IN ('POSTED', 'PENDING_APPROVAL'),
       invoice_no, NULL)
  ) PERSISTENT,
  ADD UNIQUE KEY uq_expenses_invoice (project_id, vendor, invoice_key);
ALTER TABLE expenses DROP CONSTRAINT ck_expenses_deleted;
ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_deleted_by;
ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_updated_by;
ALTER TABLE expenses DROP INDEX ix_expenses_deleted_by;
ALTER TABLE expenses DROP INDEX ix_expenses_updated_by;
ALTER TABLE expenses DROP COLUMN deleted_by, DROP COLUMN deleted_at, DROP COLUMN updated_by;
