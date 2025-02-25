import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function RegisterPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    console.log("Register form submitted with values:", { firstName, lastName, email, passwordLength: password.length });

    try {
      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          first_name: firstName, 
          last_name: lastName, 
          email, 
          password 
        })
      });
      console.log("Response status:", response.status);
      const data = await response.json();
      console.log("Response data:", data);

      if (!response.ok) {
        setError(data.message || 'Błąd podczas rejestracji');
      } else {
        alert('Rejestracja zakończona powodzeniem!');
        navigate('/login');
      }
    } catch (err) {
      console.error("Network error during registration:", err);
      setError('Błąd sieciowy.');
    }
  };

  return (
    <div>
      <h2>Rejestracja</h2>
      <form onSubmit={handleRegister}>
        <div>
          <label>Imię: </label>
          <input 
            type="text" 
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required 
          />
        </div>
        <div>
          <label>Nazwisko: </label>
          <input 
            type="text" 
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required 
          />
        </div>
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
        <button type="submit">Zarejestruj się</button>
      </form>
      <p>Masz już konto? <a href="/login">Zaloguj się</a></p>
    </div>
  );
}

export default RegisterPage;
