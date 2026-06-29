-- Znacznik wpisów z „Uzupełnij trasy”
ALTER TABLE schedule
  ADD COLUMN IF NOT EXISTS auto_filled TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '1 = dodane przez auto-uzupełnianie tras';
