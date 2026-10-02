CREATE TABLE project_estimates (
  project_id UUID NOT NULL,
  cost_head_id UUID NOT NULL,
  amount_fils BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id, cost_head_id),
  KEY ix_project_estimates_cost_head (cost_head_id),
  CONSTRAINT ck_project_estimates_amount CHECK (amount_fils >= 0),
  CONSTRAINT fk_project_estimates_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_estimates_cost_head FOREIGN KEY (cost_head_id) REFERENCES cost_heads (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
