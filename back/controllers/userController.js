const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User } = require('../models'); // import modelu User

// Klucz tajny JWT – ustawiony w .env lub wartość domyślna
const SECRET_KEY = process.env.JWT_SECRET || 'your_secret_key';

// Rejestracja nowego użytkownika
exports.register = async (req, res) => {
  try {
    const { first_name, last_name, email, password } = req.body;

    // Sprawdzenie, czy użytkownik z danym emailem już istnieje
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'Użytkownik z takim emailem już istnieje.' });
    }

    // Haszowanie hasła
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tworzenie nowego użytkownika (pamiętaj, aby w rekordach przypisywać także np. user_id do powiązania z danymi, jeśli dotyczy)
    const newUser = await User.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: 'Użytkownik został utworzony.', user: newUser });
  } catch (error) {
    res.status(500).json({ message: 'Błąd podczas rejestracji użytkownika.', error });
  }
};

// Logowanie użytkownika i generowanie tokenu JWT
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Wyszukanie użytkownika po emailu
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: 'Nieprawidłowy email lub hasło.' });
    }

    // Porównanie hasła z hashem zapisanym w bazie
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Nieprawidłowy email lub hasło.' });
    }

    // Generowanie tokenu JWT (przydatny, aby w przyszłości filtrować dane użytkownika)
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });

    res.json({ message: 'Zalogowano pomyślnie.', token });
  } catch (error) {
    res.status(500).json({ message: 'Błąd podczas logowania.', error });
  }
};
