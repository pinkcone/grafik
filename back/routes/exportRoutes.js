const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const exportController = require('../controllers/exportController');

router.use(auth);

router.get('/data', exportController.exportUserData);

module.exports = router;
