-- System numbers: every project gets P00001, P00002, ... and every cost head C001, C002, ...,
-- assigned by the application (never typed or edited) and stored as data. The UUID ids stay the
-- internal keys, so no foreign key changes. The user-entered codes are unchanged.

-- The last number handed out per kind. The application increments a row inside the transaction
-- that creates the record: the row lock serialises concurrent creation, and a rolled-back create
-- gives its number back, so numbers have no gaps.
CREATE TABLE system_counters (
  name VARCHAR(30) NOT NULL,
  last_value INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing rows (deleted ones included) are numbered in the order they were created.
ALTER TABLE projects ADD COLUMN system_no CHAR(6) NULL AFTER id;
UPDATE projects p
  JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM projects) o ON o.id = p.id
   SET p.system_no = CONCAT('P', LPAD(o.n, 5, '0'));
ALTER TABLE projects
  MODIFY system_no CHAR(6) NOT NULL,
  ADD UNIQUE KEY uq_projects_system_no (system_no),
  ADD CONSTRAINT ck_projects_system_no CHECK (system_no REGEXP '^P[0-9]{5}$');

ALTER TABLE cost_heads ADD COLUMN system_no CHAR(4) NULL AFTER id;
UPDATE cost_heads h
  JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM cost_heads) o ON o.id = h.id
   SET h.system_no = CONCAT('C', LPAD(o.n, 3, '0'));
ALTER TABLE cost_heads
  MODIFY system_no CHAR(4) NOT NULL,
  ADD UNIQUE KEY uq_cost_heads_system_no (system_no),
  ADD CONSTRAINT ck_cost_heads_system_no CHECK (system_no REGEXP '^C[0-9]{3}$');

INSERT INTO system_counters (name, last_value)
  SELECT 'project', COUNT(*) FROM projects
  UNION ALL
  SELECT 'cost_head', COUNT(*) FROM cost_heads;
