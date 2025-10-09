const express = require('express');
const { sequelize } = require('./models'); 
const cors = require('cors');
const app = express();

const PORT = 5000;
const allowedOrigins = ['http://jagrafiko.pl', 'http://localhost:5000/', 'http://localhost:3000'];

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.error(`Rejected request from origin: ${origin}`);
      callback(new Error(`Not allowed by CORS: ${origin}`), false);
    }
  },
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

const cityRoutes = require('./routes/cityRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const routeRoutes = require('./routes/routeRoutes');
const labelRoutes = require('./routes/labelRoutes');
const userRoutes = require('./routes/userRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');

// Podpięcie tras
app.use('/api/cities', cityRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/schedule', scheduleRoutes);



// Middleware obsługujący błędy – loguje wszystkie napotkane błędy
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(500).json({ message: err.message });
});

app.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
