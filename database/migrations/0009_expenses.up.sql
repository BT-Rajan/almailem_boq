CREATE TABLE expenses (
  id UUID NOT NULL DEFAULT UUID(),
  project_id UUID NOT NULL,
  cost_head_id UUID NOT NULL,
  vendor VARCHAR(200) NOT NULL,
  invoice_no VARCHAR(60) NOT NULL,
  expense_date DATE NOT NULL,
  amount_fils BIGINT NOT NULL,
  description TEXT NULL,
  attachment_key CHAR(32) NULL,
  attachment_type VARCHAR(40) NULL,
  attachment_size INT UNSIGNED NULL,
  attachment_name VARCHAR(200) NULL,
  created_by UUID NOT NULL,
  reversal_of UUID NULL,
  reversed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- The invoice number of a live original expense; NULL for reversals and reversed originals,
  -- so a reversed invoice can be entered again correctly. Drives the duplicate-invoice rule.
  invoice_key VARCHAR(60) AS (IF(reversal_of IS NULL AND reversed_at IS NULL, invoice_no, NULL)) PERSISTENT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expenses_invoice (project_id, vendor, invoice_key),
  UNIQUE KEY uq_expenses_reversal_of (reversal_of),
  KEY ix_expenses_project_head (project_id, cost_head_id, expense_date),
  KEY ix_expenses_cost_head (cost_head_id),
  KEY ix_expenses_created_by (created_by),
  -- An original is positive; its reversal is negative.
  CONSTRAINT ck_expenses_amount_sign CHECK (
    (reversal_of IS NULL AND amount_fils > 0) OR (reversal_of IS NOT NULL AND amount_fils < 0)
  ),
  CONSTRAINT fk_expenses_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_cost_head FOREIGN KEY (cost_head_id) REFERENCES cost_heads (id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_reversal_of FOREIGN KEY (reversal_of) REFERENCES expenses (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
