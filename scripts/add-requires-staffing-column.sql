-- Trasa musi być obsadzona (domyślnie tak). Odznaczenie = może zostać pusta przy braku kierowców.
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS requires_staffing TINYINT(1) NOT NULL DEFAULT 1
  COMMENT 'Czy trasa musi być obsadzona';
