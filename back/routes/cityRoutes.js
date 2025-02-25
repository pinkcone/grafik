const express = require('express');
const router = express.Router();
const cityController = require('../controllers/cityController');
const auth = require('../middlewares/auth');

router.use(auth);

router.post('/', cityController.createCity);
router.get('/', cityController.getCities);
router.get('/:id', cityController.getCityById);
router.put('/:id', cityController.updateCity);
router.delete('/:id', cityController.deleteCity);

module.exports = router;
