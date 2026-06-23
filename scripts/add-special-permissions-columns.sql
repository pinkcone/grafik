-- Uruchom na serwerze jeśli kolumny specjalnych uprawnień nie istnieją:
-- mysql -u root -p graf < scripts/add-special-permissions-columns.sql

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS special_permissions TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Czy pracownik posiada specjalne uprawnienia';

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS requires_special_permissions TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Czy trasa wymaga specjalnych uprawnień pracownika';
