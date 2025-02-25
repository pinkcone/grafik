const jwt = require('jsonwebtoken');

// Klucz tajny – ustaw w zmiennych środowiskowych lub użyj domyślnej wartości
const SECRET_KEY = process.env.JWT_SECRET || 'your_secret_key';

const authMiddleware = (req, res, next) => {
  // Sprawdzenie, czy nagłówek Authorization został przesłany
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Brak tokena, autoryzacja wymagana.' });
  }

  // Oczekujemy formatu "Bearer token"
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token jest nieprawidłowy.' });
  }

  try {
    // Weryfikacja tokenu
    const decoded = jwt.verify(token, SECRET_KEY);
    // Ustawiamy dane użytkownika w obiekcie request
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token jest nieprawidłowy lub wygasł.' });
  }
};

module.exports = authMiddleware;
