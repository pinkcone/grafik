const express = require('express');
const router = express.Router();
const routeController = require('../controllers/routeController');
const auth = require('../middlewares/auth');

router.use(auth);

router.post('/', routeController.createRoute);
router.get('/city/:cityId', routeController.getRoutesByCity);
router.put('/:id', routeController.updateRoute);
router.delete('/:id', routeController.deleteRoute);

module.exports = router;
