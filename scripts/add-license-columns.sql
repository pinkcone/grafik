-- Uruchom na serwerze jeśli kategoria prawa jazdy się nie zapisuje:
-- mysql -u root -p graf < scripts/add-license-columns.sql

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS license_category ENUM('B', 'C') NULL
  COMMENT 'Najwyższa kategoria prawa jazdy (C uprawnia też do B)';

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS required_license_category ENUM('B', 'C') NOT NULL DEFAULT 'B'
  COMMENT 'Wymagana kategoria prawa jazdy na trasie';
