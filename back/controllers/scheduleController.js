// controllers/scheduleController.js
const { Schedule } = require('../models');
const { Op } = require('sequelize');

/**
 * PUT /api/schedule/update-cell
 * Aktualizacja pojedynczej komórki grafiku.
 * Oczekiwane body: { date, employee_id, route_id, label }
 */
exports.updateScheduleCell = async (req, res) => {
    const { date, employee_id, route_id, label } = req.body;
    console.log("=== updateScheduleCell ===");
    console.log("Received data:", { date, employee_id, route_id, label });
  
    try {
      let assignment_type = null;
      if (route_id) assignment_type = 'route';
      else if (label) assignment_type = 'label';
      else assignment_type = 'none';
  
      const user_id = req.user.id; // z middleware auth
  
      // Sprawdzanie konfliktu
      if (route_id) {
        console.log("Sprawdzanie konfliktu...");
        const conflict = await Schedule.findOne({
          where: {
            date,
            route_id,
            employee_id: { [Op.ne]: employee_id }
          }
        });
        if (conflict) {
          console.log("Konflikt – ta trasa jest już przypisana innemu pracownikowi.");
          return res.status(400).json({
            message: 'Wybrana trasa jest już przypisana do innego pracownika w tym dniu.'
          });
        }
      }
  
      // Szukamy istniejącego wpisu
      let schedule = await Schedule.findOne({ where: { date, employee_id } });
      if (schedule) {
        console.log(`Znaleziono rekord (ID=${schedule.id}). Aktualizujemy...`);
        await schedule.update({ route_id, label, assignment_type, user_id });
        console.log("Rekord zaktualizowany.");
      } else {
        console.log("Brak rekordu. Tworzymy nowy...");
        schedule = await Schedule.create({ date, employee_id, route_id, label, assignment_type, user_id });
        console.log(`Nowy rekord utworzony (ID=${schedule.id}).`);
      }
  
      return res.json({ message: 'Grafik zaktualizowany', schedule });
    } catch (error) {
      console.error("Błąd w updateScheduleCell:", error);
      return res.status(500).json({
        message: 'Błąd aktualizacji grafiku',
        error: error.message
      });
    }
  };
  
/**
 * GET /api/schedule/city/:cityId?month=MM&year=YYYY
 * Pobranie harmonogramu (Schedule) dla danego miasta i wybranego miesiąca/roku.
 * Zwraca tablicę rekordów z tabeli Schedule (date, employee_id, route_id, label, worked_hours, itp.)
 */
exports.getCitySchedule = async (req, res) => {
  const { cityId } = req.params;
  const { month, year } = req.query;

  console.log("=== getCitySchedule ===");
  console.log("Params:", { cityId });
  console.log("Query:", { month, year });

  try {
    // Ustalanie ostatniego dnia miesiąca dynamicznie
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    console.log("Zakres dat:", startDate, endDate);

    const schedules = await Schedule.findAll({
      where: {
        date: { [Op.between]: [startDate, endDate] }
      }
    });

    console.log(`Znaleziono ${schedules.length} rekordów w Schedule dla okresu ${startDate} - ${endDate}`);
    console.log("=== getCitySchedule – Zwracamy dane ===");
    return res.json(schedules);
  } catch (error) {
    console.error("Błąd w getCitySchedule:", error);
    return res.status(500).json({
      message: 'Błąd pobierania grafiku',
      error: error.message
    });
  }
};