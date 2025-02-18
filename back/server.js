// server.js
const express = require('express');
const { sequelize } = require('./models'); // lub destructuring modeli, jeśli potrzebujesz
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Backend działa i tabele są zsynchonizowane!');
});

app.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
