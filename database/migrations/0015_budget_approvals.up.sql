-- Budget approval (cost structure). A project's proposed cost heads and estimates go to an
-- administrator through the existing approvals table, as a second kind of request. Only an
-- approval writes project_estimates, which stays the one authoritative budget. Existing
-- projects and their estimates are not touched.

ALTER TABLE approvals
  ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'EXPENSE' AFTER id,
  MODIFY expense_id UUID NULL,
  MODIFY requested_bp BIGINT NULL;

-- Every existing row is an expense request; a budget request has no expense.
ALTER TABLE approvals
  ADD CONSTRAINT ck_approvals_kind CHECK (
    (kind = 'EXPENSE' AND expense_id IS NOT NULL AND requested_bp IS NOT NULL)
    OR (kind = 'BUDGET' AND expense_id IS NULL)
  ),
  -- At most one budget request waits per project at a time.
  ADD COLUMN pending_budget_project UUID
    AS (IF(kind = 'BUDGET' AND status = 'PENDING', project_id, NULL)) PERSISTENT,
  ADD UNIQUE KEY uq_approvals_pending_budget (pending_budget_project);

-- A budget request, head by head, exactly as submitted. Append-only. approved_fils is the head's
-- approved estimate when the request was made (NULL: not in the approved budget, i.e. added);
-- amount_fils is the proposed estimate (NULL: removed from the budget).
CREATE TABLE approval_budget_lines (
  approval_id UUID NOT NULL,
  cost_head_id UUID NOT NULL,
  approved_fils BIGINT NULL,
  amount_fils BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (approval_id, cost_head_id),
  KEY ix_approval_budget_lines_cost_head (cost_head_id),
  CONSTRAINT ck_approval_budget_lines_amount CHECK (
    (amount_fils IS NULL OR amount_fils >= 0)
    AND (approved_fils IS NULL OR approved_fils >= 0)
    AND (amount_fils IS NOT NULL OR approved_fils IS NOT NULL)
  ),
  CONSTRAINT fk_approval_budget_lines_approval FOREIGN KEY (approval_id) REFERENCES approvals (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_budget_lines_cost_head FOREIGN KEY (cost_head_id) REFERENCES cost_heads (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER approval_budget_lines_no_update BEFORE UPDATE ON approval_budget_lines FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_budget_lines is append-only';

CREATE TRIGGER approval_budget_lines_no_delete BEFORE DELETE ON approval_budget_lines FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_budget_lines is append-only';
