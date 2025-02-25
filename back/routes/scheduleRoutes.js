// routes/scheduleRoutes.js
const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');
const auth = require('../middlewares/auth');

router.use(auth);

// PUT /api/schedule/update-cell
router.put('/update-cell', scheduleController.updateScheduleCell);

// GET /api/schedule/city/:cityId
router.get('/city/:cityId', scheduleController.getCitySchedule);

module.exports = router;
