import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import "../styles/LoginPage.css";
function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Błąd podczas logowania');
      } else {
        // Zapisujemy token w localStorage
        localStorage.setItem('token', data.token);
        window.dispatchEvent(new Event('grafik-auth'));
        navigate('/');
      }
    } catch (err) {
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
      <p>Nie masz konta? <Link to="/register">Zarejestruj się</Link></p>
    </div>
  );
}

export default LoginPage;
