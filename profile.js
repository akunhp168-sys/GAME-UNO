// profile.js — halaman profil berdiri sendiri (lihat + edit)
(function () {
  const token = localStorage.getItem('uno_token');
  const myUsername = localStorage.getItem('uno_username');
  if (!token) {
    window.location.href = '/index.html';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const targetUsername = params.get('user') || myUsername;
  const isOwn = targetUsername.toLowerCase() === myUsername.toLowerCase();

  const socket = io({ auth: { token } });

  function toast(message, type) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 220);
    }, 2400);
  }

  function avatarHtml(name, avatarUrl) {
    if (avatarUrl) return `<img class="avatar-img" src="${avatarUrl}" alt="${name}" />`;
    return (name || '?')[0].toUpperCase();
  }

  let currentProfile = null;

  function renderProfile(p) {
    currentProfile = p;
    document.getElementById('pageTitle').textContent = isOwn ? 'Profil Saya' : p.username;
    document.getElementById('pfAvatar').innerHTML = avatarHtml(p.username, p.avatar);
    document.getElementById('pfName').textContent = p.username;
    document.getElementById('pfBio').textContent = p.bio || 'Belum ada bio.';
    document.getElementById('pfGamesPlayed').textContent = p.gamesPlayed;
    document.getElementById('pfGamesWon').textContent = p.gamesWon;
    document.getElementById('pfWinRate').textContent = p.winRate + '%';
    const d = new Date(p.createdAt);
    document.getElementById('pfJoined').textContent = d.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    document.getElementById('editBtn').style.display = isOwn ? 'inline-block' : 'none';
  }

  function loadProfile() {
    socket.emit('user:profile', targetUsername, (res) => {
      if (!res.ok) {
        toast(res.error || 'Profil tidak ditemukan', 'error');
        return;
      }
      renderProfile(res.profile);
    });
  }
  loadProfile();

  document.getElementById('backHomeBtn').addEventListener('click', () => {
    window.location.href = '/app.html';
  });

  // ---------------- Edit mode (hanya milik sendiri) ----------------
  let pendingAvatarDataUrl = undefined;

  document.getElementById('editBtn').addEventListener('click', () => {
    pendingAvatarDataUrl = undefined;
    document.getElementById('editAvatarPreview').innerHTML = avatarHtml(currentProfile.username, currentProfile.avatar);
    document.getElementById('bioInput').value = currentProfile.bio || '';
    document.getElementById('editError').textContent = '';
    document.getElementById('viewMode').style.display = 'none';
    document.getElementById('editMode').style.display = 'block';
  });

  document.getElementById('cancelBtn').addEventListener('click', () => {
    document.getElementById('editMode').style.display = 'none';
    document.getElementById('viewMode').style.display = 'block';
  });

  document.getElementById('avatarFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => {
        const size = 320;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        pendingAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        document.getElementById('editAvatarPreview').innerHTML = `<img class="avatar-img" src="${pendingAvatarDataUrl}" />`;
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const payload = { bio: document.getElementById('bioInput').value.trim() };
    if (pendingAvatarDataUrl !== undefined) payload.avatar = pendingAvatarDataUrl;
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
    socket.emit('user:profile:update', payload, (res) => {
      btn.disabled = false;
      btn.textContent = '💾 Simpan Perubahan';
      if (!res.ok) {
        document.getElementById('editError').textContent = res.error || 'Gagal menyimpan';
        return;
      }
      toast('Profil diperbarui', 'success');
      renderProfile(res.profile);
      document.getElementById('editMode').style.display = 'none';
      document.getElementById('viewMode').style.display = 'block';
    });
  });
})();
