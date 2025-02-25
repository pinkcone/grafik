const express = require('express');
const { sequelize } = require('./models'); 
const cors = require('cors');// lub destructuring modeli, jeśli potrzebujesz
const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

app.use(express.json());

const cityRoutes = require('./routes/cityRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const routeRoutes = require('./routes/routeRoutes');
const labelRoutes = require('./routes/labelRoutes');
const userRoutes = require('./routes/userRoutes'); // Endpointy rejestracji i logowania
const scheduleRoutes = require('./routes/scheduleRoutes');
// Podpięcie tras
app.use('/api/cities', cityRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/schedule', scheduleRoutes);

app.get('/', (req, res) => {
  res.send('Backend działa i tabele są zsynchonizowane!');
});

app.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
