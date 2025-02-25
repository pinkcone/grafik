const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User } = require('../models'); // import modelu User

// Klucz tajny JWT – ustawiony w .env lub wartość domyślna
const SECRET_KEY = process.env.JWT_SECRET || 'your_secret_key';

// Rejestracja nowego użytkownika
exports.register = async (req, res) => {
  console.log("=== REGISTER REQUEST RECEIVED ===");
  console.log("Request body:", req.body);
  try {
    const { first_name, last_name, email, password } = req.body;
    console.log("Destructured values:", { first_name, last_name, email, passwordLength: password.length });

    // Sprawdzenie, czy użytkownik z danym emailem już istnieje
    const existingUser = await User.findOne({ where: { email } });
    console.log("Existing user:", existingUser);
    if (existingUser) {
      console.log("User with email already exists");
      return res.status(400).json({ message: 'Użytkownik z takim emailem już istnieje.' });
    }

    // Haszowanie hasła
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("Password hashed successfully");

    // Tworzenie nowego użytkownika
    const newUser = await User.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
    });
    console.log("New user created:", newUser);

    res.status(201).json({ message: 'Użytkownik został utworzony.', user: newUser });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: 'Błąd podczas rejestracji użytkownika.', error: error.message });
  }
};

// Logowanie użytkownika i generowanie tokenu JWT
exports.login = async (req, res) => {
  console.log("=== LOGIN REQUEST RECEIVED ===");
  console.log("Request body:", req.body);
  try {
    const { email, password } = req.body;
    console.log("Email received:", email);

    // Wyszukanie użytkownika po emailu
    const user = await User.findOne({ where: { email } });
    console.log("User found:", user);
    if (!user) {
      console.log("User not found for email:", email);
      return res.status(400).json({ message: 'Nieprawidłowy email lub hasło.' });
    }

    // Porównanie hasła z hashem zapisanym w bazie
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log("Password validation result:", isPasswordValid);
    if (!isPasswordValid) {
      console.log("Invalid password for user:", email);
      return res.status(400).json({ message: 'Nieprawidłowy email lub hasło.' });
    }

    // Generowanie tokenu JWT
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });
    console.log("JWT token generated:", token);

    res.json({ message: 'Zalogowano pomyślnie.', token });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: 'Błąd podczas logowania.', error: error.message });
  }
};
