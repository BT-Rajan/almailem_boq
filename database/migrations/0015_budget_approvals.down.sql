-- Development only: refuses (foreign keys, NOT NULL) while budget requests exist.
DROP TABLE approval_budget_lines;
ALTER TABLE approvals DROP INDEX uq_approvals_pending_budget;
ALTER TABLE approvals DROP COLUMN pending_budget_project;
ALTER TABLE approvals DROP CONSTRAINT ck_approvals_kind;
ALTER TABLE approvals
  MODIFY expense_id UUID NOT NULL,
  MODIFY requested_bp BIGINT NOT NULL,
  DROP COLUMN kind;
