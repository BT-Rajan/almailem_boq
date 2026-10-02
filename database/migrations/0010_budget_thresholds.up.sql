-- The one place the budget thresholds live (D22). Exactly one row; edited in Admin > Approval Rules.
-- Values are basis points of the budget: 8000 = 80.00%, 10000 = 100.00%.
CREATE TABLE budget_thresholds (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  warning_bp INT UNSIGNED NOT NULL,
  approval_bp INT UNSIGNED NOT NULL,
  updated_by UUID NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_budget_thresholds_updated_by (updated_by),
  CONSTRAINT ck_budget_thresholds_single_row CHECK (id = 1),
  CONSTRAINT ck_budget_thresholds_order CHECK (
    warning_bp >= 1 AND warning_bp < approval_bp AND approval_bp <= 10000
  ),
  CONSTRAINT fk_budget_thresholds_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO budget_thresholds (id, warning_bp, approval_bp) VALUES (1, 8000, 10000);
