// auth.js — login/register page logic
(function () {
  const tabs = document.querySelectorAll('.auth-tab');
  const forms = document.querySelectorAll('.auth-form');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      forms.forEach((f) => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + 'Form').classList.add('active');
    });
  });

  // Redirect if already logged in
  if (localStorage.getItem('uno_token')) {
    window.location.href = '/app.html';
  }

  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        errorEl.textContent = data.error || 'Gagal masuk';
        return;
      }
      localStorage.setItem('uno_token', data.token);
      localStorage.setItem('uno_username', data.username);
      window.location.href = '/app.html';
    } catch (err) {
      errorEl.textContent = 'Tidak bisa terhubung ke server';
    }
  });

  const registerForm = document.getElementById('registerForm');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorEl = document.getElementById('registerError');
    const successEl = document.getElementById('registerSuccess');
    errorEl.textContent = '';
    successEl.textContent = '';
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        errorEl.textContent = data.error || 'Gagal daftar';
        return;
      }
      successEl.textContent = 'Akun dibuat! Masuk otomatis...';
      registerForm.reset();
      localStorage.setItem('uno_token', data.token);
      localStorage.setItem('uno_username', data.username);
      setTimeout(() => {
        window.location.href = '/app.html';
      }, 500);
    } catch (err) {
      errorEl.textContent = 'Tidak bisa terhubung ke server';
    }
  });
})();
