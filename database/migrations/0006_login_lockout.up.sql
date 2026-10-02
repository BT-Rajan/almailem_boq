ALTER TABLE users
  ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER disabled,
  ADD COLUMN locked_until DATETIME(3) NULL AFTER failed_login_count;
