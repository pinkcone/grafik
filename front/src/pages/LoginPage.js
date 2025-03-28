import React, { useState } from 'react';
import "../styles/LoginPage.css";
function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    console.log("Submitting login with:", { email, password });

    try {
      const response = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      console.log("Response status:", response.status);
      const data = await response.json();
      console.log("Response data:", data);

      if (!response.ok) {
        setError(data.message || 'Błąd podczas logowania');
      } else {
        // Zapisujemy token w localStorage
        localStorage.setItem('token', data.token);
        console.log("Token saved, reloading page to load homepage");
        // Przekierowujemy do strony głównej i przeładowujemy stronę
        window.location.href = "/";
      }
    } catch (err) {
      console.error("Network error:", err);
      setError('Błąd sieciowy.');
    }
  };

  return (
    <div className="main">
      <h2>Logowanie</h2>
      <form onSubmit={handleLogin}>
        <div>
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder='email'
          />
        </div>
        <div>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required 
            placeholder='hasło'
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit">Zaloguj się</button>
      </form>
      <p>Nie masz konta? <a href="/register">Zarejestruj się</a></p>
    </div>
  );
}

export default LoginPage;
