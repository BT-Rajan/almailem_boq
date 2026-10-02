-- Actual per project and per head reads only this index (project first, then the "counts toward
-- actual" columns, then head and amount). See PERFORMANCE.md.
CREATE INDEX ix_expenses_project_actual
  ON expenses (project_id, reversal_of, reversed_at, cost_head_id, amount_fils);
