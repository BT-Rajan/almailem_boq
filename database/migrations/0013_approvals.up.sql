-- Approval workflow (Chunk 10). An expense that would take its head to the approval level is held
-- (PENDING_APPROVAL) and does not count toward Actual until an administrator approves it.

-- Only POSTED expenses count toward Actual. Reversal entries are always POSTED.
ALTER TABLE expenses
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'POSTED' AFTER amount_fils,
  ADD CONSTRAINT ck_expenses_status CHECK (
    status IN ('POSTED', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED')
    AND (reversal_of IS NULL OR status = 'POSTED')
  );

-- The duplicate-invoice rule also covers held expenses (they may still be approved), but a
-- rejected or cancelled one frees its invoice number so it can be entered again correctly.
ALTER TABLE expenses DROP INDEX uq_expenses_invoice;
ALTER TABLE expenses DROP COLUMN invoice_key;
ALTER TABLE expenses
  ADD COLUMN invoice_key VARCHAR(60) AS (
    IF(reversal_of IS NULL AND reversed_at IS NULL AND status IN ('POSTED', 'PENDING_APPROVAL'),
       invoice_no, NULL)
  ) PERSISTENT,
  ADD UNIQUE KEY uq_expenses_invoice (project_id, vendor, invoice_key);

-- Actual reads only this index (see PERFORMANCE.md); it now carries the status as well.
DROP INDEX ix_expenses_project_actual ON expenses;
CREATE INDEX ix_expenses_project_actual
  ON expenses (project_id, status, reversal_of, reversed_at, cost_head_id, amount_fils);

-- One request per held expense. Its status follows domain/approval-status.ts.
CREATE TABLE approvals (
  id UUID NOT NULL DEFAULT UUID(),
  expense_id UUID NOT NULL,
  project_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  reason TEXT NOT NULL,
  -- Utilisation (basis points) the head would reach with this expense, when asked and when decided.
  requested_bp BIGINT NOT NULL,
  requested_by UUID NOT NULL,
  decided_bp BIGINT NULL,
  decided_by UUID NULL,
  decided_at DATETIME(3) NULL,
  decision_comment TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_approvals_expense (expense_id),
  KEY ix_approvals_status (status, created_at),
  KEY ix_approvals_project (project_id, status),
  KEY ix_approvals_requested_by (requested_by),
  KEY ix_approvals_decided_by (decided_by),
  CONSTRAINT ck_approvals_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  -- The requester can never be the one who decides.
  CONSTRAINT ck_approvals_not_self CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT fk_approvals_expense FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approvals_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approvals_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approvals_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every step of every request, in order. Append-only, like the audit log.
CREATE TABLE approval_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approval_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  actor_user_id UUID NOT NULL,
  comment TEXT NULL,
  projected_bp BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_approval_actions_approval (approval_id, id),
  KEY ix_approval_actions_actor (actor_user_id),
  CONSTRAINT ck_approval_actions_action CHECK (action IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT fk_approval_actions_approval FOREIGN KEY (approval_id) REFERENCES approvals (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_actions_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER approval_actions_no_update BEFORE UPDATE ON approval_actions FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_actions is append-only';

CREATE TRIGGER approval_actions_no_delete BEFORE DELETE ON approval_actions FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_actions is append-only';

-- Deciding is for administrators only (D29). Earlier seeds granted approval.decide to every working
-- role; take it back from any role that cannot also manage users. A no-op on a new database.
DELETE FROM role_permissions
 WHERE permission_id = (SELECT id FROM permissions WHERE code = 'approval.decide')
   AND role_id NOT IN (
     SELECT role_id FROM (
       SELECT rp.role_id
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'admin.users.manage'
     ) admins
   );
