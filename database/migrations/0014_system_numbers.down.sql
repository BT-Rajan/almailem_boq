ALTER TABLE cost_heads DROP CONSTRAINT ck_cost_heads_system_no;
ALTER TABLE cost_heads DROP INDEX uq_cost_heads_system_no;
ALTER TABLE cost_heads DROP COLUMN system_no;
ALTER TABLE projects DROP CONSTRAINT ck_projects_system_no;
ALTER TABLE projects DROP INDEX uq_projects_system_no;
ALTER TABLE projects DROP COLUMN system_no;
DROP TABLE system_counters;
