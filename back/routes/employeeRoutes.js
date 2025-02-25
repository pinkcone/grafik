const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const auth = require('../middlewares/auth');

router.use(auth);

// Tworzenie pracownika
router.post('/', employeeController.createEmployee);
// Pobieranie pracowników dla danego miasta (przekazywany parametr cityId)
router.get('/city/:cityId', employeeController.getEmployeesByCity);
// Edycja i usuwanie pracownika (identyfikacja po id)
router.put('/:id', employeeController.updateEmployee);
router.delete('/:id', employeeController.deleteEmployee);

module.exports = router;
