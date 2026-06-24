-- Dni kursowania tras (1=pon … 7=nd). Brak wpisów = domyślnie pn–pt w aplikacji.
CREATE TABLE IF NOT EXISTS route_days (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  day_of_week TINYINT NOT NULL,
  CONSTRAINT fk_route_days_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  UNIQUE KEY uq_route_day (route_id, day_of_week),
  CHECK (day_of_week BETWEEN 1 AND 7)
);

-- Istniejące trasy bez dni → pn–pt (1–5)
INSERT IGNORE INTO route_days (route_id, day_of_week)
SELECT r.id, d.day_of_week
FROM routes r
CROSS JOIN (
  SELECT 1 AS day_of_week UNION ALL
  SELECT 2 UNION ALL
  SELECT 3 UNION ALL
  SELECT 4 UNION ALL
  SELECT 5
) d
WHERE NOT EXISTS (
  SELECT 1 FROM route_days rd WHERE rd.route_id = r.id
);
