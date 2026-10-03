-- The old codes are not kept: a project's code comes back as its system number.
ALTER TABLE projects ADD COLUMN code VARCHAR(30) NULL AFTER system_no;
UPDATE projects SET code = system_no;
ALTER TABLE projects
  MODIFY code VARCHAR(30) NOT NULL,
  ADD UNIQUE KEY uq_projects_code (code);
