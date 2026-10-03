-- Expense lifecycle: who last modified an expense, and administrator-only (soft) deletion. A
-- deleted expense stays on record, with its audit history, but no longer counts anywhere.

ALTER TABLE expenses
  ADD COLUMN updated_by UUID NULL AFTER created_by,
  ADD COLUMN deleted_at DATETIME(3) NULL,
  ADD COLUMN deleted_by UUID NULL,
  ADD KEY ix_expenses_updated_by (updated_by),
  ADD KEY ix_expenses_deleted_by (deleted_by),
  ADD CONSTRAINT fk_expenses_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_expenses_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_expenses_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- A deleted expense frees its invoice number, like a rejected or reversed one.
ALTER TABLE expenses DROP INDEX uq_expenses_invoice;
ALTER TABLE expenses DROP COLUMN invoice_key;
ALTER TABLE expenses
  ADD COLUMN invoice_key VARCHAR(60) AS (
    IF(reversal_of IS NULL AND reversed_at IS NULL AND deleted_at IS NULL
       AND status IN ('POSTED', 'PENDING_APPROVAL'), invoice_no, NULL)
  ) PERSISTENT,
  ADD UNIQUE KEY uq_expenses_invoice (project_id, vendor, invoice_key);

-- Actual reads only this index (PERFORMANCE.md); it now carries deleted_at as well.
DROP INDEX ix_expenses_project_actual ON expenses;
CREATE INDEX ix_expenses_project_actual
  ON expenses (project_id, status, reversal_of, reversed_at, deleted_at, cost_head_id, amount_fils);
