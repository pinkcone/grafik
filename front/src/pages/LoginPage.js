import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

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
        localStorage.setItem('token', data.token);
        console.log("Token saved, navigating to /cities");
        navigate('/cities');
      }
    } catch (err) {
      console.error("Network error:", err);
      setError('Błąd sieciowy.');
    }
  };
  

  return (
    <div>
      <h2>Logowanie</h2>
      <form onSubmit={handleLogin}>
        <div>
          <label>Email: </label>
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required 
          />
        </div>
        <div>
          <label>Hasło: </label>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required 
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
