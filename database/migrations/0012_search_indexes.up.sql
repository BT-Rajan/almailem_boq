-- Search and sort paths of the shared list builder and the global search (Chunk 13).
-- Expense paths lead with project_id, so a search reads only the visible projects' entries.
CREATE INDEX ix_expenses_project_invoice ON expenses (project_id, invoice_no);
CREATE INDEX ix_expenses_project_date ON expenses (project_id, expense_date, created_at);
CREATE INDEX ix_projects_name ON projects (name);
