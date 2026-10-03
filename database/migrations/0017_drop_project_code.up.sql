-- Projects are identified by their system number (P00001) alone: the free-text project code goes.
ALTER TABLE projects
  DROP INDEX uq_projects_code,
  DROP COLUMN code;
