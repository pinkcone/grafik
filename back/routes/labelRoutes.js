const express = require('express');
const router = express.Router();
const labelController = require('../controllers/labelController');
const auth = require('../middlewares/auth');

router.use(auth);

router.post('/', labelController.createLabel);
router.get('/', labelController.getLabels);
router.put('/:code', labelController.updateLabel);
router.delete('/:code', labelController.deleteLabel);

module.exports = router;
