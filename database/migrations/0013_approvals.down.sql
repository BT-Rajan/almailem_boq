-- Development only: after this, held, rejected and cancelled expenses count toward Actual again.
-- The approval.decide grants removed by the up migration are not restored; run the seed for that.
DROP TABLE approval_actions;
DROP TABLE approvals;

DROP INDEX ix_expenses_project_actual ON expenses;
CREATE INDEX ix_expenses_project_actual
  ON expenses (project_id, reversal_of, reversed_at, cost_head_id, amount_fils);

ALTER TABLE expenses DROP INDEX uq_expenses_invoice;
ALTER TABLE expenses DROP COLUMN invoice_key;
ALTER TABLE expenses DROP CONSTRAINT ck_expenses_status;
ALTER TABLE expenses DROP COLUMN status;
ALTER TABLE expenses
  ADD COLUMN invoice_key VARCHAR(60) AS (IF(reversal_of IS NULL AND reversed_at IS NULL, invoice_no, NULL)) PERSISTENT,
  ADD UNIQUE KEY uq_expenses_invoice (project_id, vendor, invoice_key);
