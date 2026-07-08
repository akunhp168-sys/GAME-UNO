// app.js — Main app logic (home, chat, game)
(function () {
  const token = localStorage.getItem('uno_token');
  const username = localStorage.getItem('uno_username');
  if (!token) {
    window.location.href = '/index.html';
    return;
  }

  const socket = io({ auth: { token } });

  // ---------------- Toast (pengganti alert) ----------------
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

  // ---------------- Avatar helper ----------------
  function avatarHtml(name, avatarUrl) {
    if (avatarUrl) return `<img class="avatar-img" src="${avatarUrl}" alt="${name}" />`;
    return (name || '?')[0].toUpperCase();
  }
  let myProfile = { username, bio: '', avatar: null, gamesPlayed: 0, gamesWon: 0, winRate: 0, createdAt: Date.now() };
  function applyMyAvatarEverywhere() {
    document.getElementById('sideMenuAvatar').innerHTML = avatarHtml(username, myProfile.avatar);
    document.getElementById('myPanelAvatar').innerHTML = avatarHtml(username, myProfile.avatar);
    const heroAvatar = document.getElementById('homeHeroAvatar');
    if (heroAvatar) heroAvatar.innerHTML = avatarHtml(username, myProfile.avatar);
  }

  // Cache foto profil user lain biar gak nembak socket berkali-kali tiap render chat.
  const avatarCache = new Map(); // username(lower) -> avatarUrl|null
  function ensureAvatarCached(uname, onReady) {
    const key = uname.toLowerCase();
    if (key === username.toLowerCase()) return onReady(myProfile.avatar);
    if (avatarCache.has(key)) return onReady(avatarCache.get(key));
    socket.emit('user:profile', uname, (res) => {
      const url = res.ok ? res.profile.avatar : null;
      avatarCache.set(key, url);
      onReady(url);
    });
  }

  // ---------------- Navigation ----------------
  const views = document.querySelectorAll('.view');
  const navItems = document.querySelectorAll('.nav-item');
  function gotoView(name) {
    views.forEach((v) => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    navItems.forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  }
  navItems.forEach((btn) => btn.addEventListener('click', () => gotoView(btn.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => gotoView(el.dataset.goto))
  );

  // ---------------- Side menu ----------------
  const menuBtn = document.getElementById('menuBtn');
  const sideMenu = document.getElementById('sideMenu');
  const sideMenuOverlay = document.getElementById('sideMenuOverlay');
  document.getElementById('sideMenuUsername').textContent = username;
  document.getElementById('homeUsername').textContent = username;
  document.getElementById('myPanelName').textContent = 'Kamu';
  document.getElementById('myTimerRing').dataset.player = username;
  applyMyAvatarEverywhere();
  socket.emit('user:profile', username, (res) => {
    if (res.ok) {
      myProfile = res.profile;
      applyMyAvatarEverywhere();
    }
  });

  function openSideMenu() {
    sideMenu.classList.add('show');
    sideMenuOverlay.classList.add('show');
  }
  function closeSideMenu() {
    sideMenu.classList.remove('show');
    sideMenuOverlay.classList.remove('show');
  }
  menuBtn.addEventListener('click', openSideMenu);
  sideMenuOverlay.addEventListener('click', closeSideMenu);
  document.querySelectorAll('.side-menu-list li').forEach((li) => {
    li.addEventListener('click', () => {
      const action = li.dataset.action;
      closeSideMenu();
      if (action === 'dev') window.location.href = '/dev-info.html';
      if (action === 'logout') doLogout();
      if (action === 'profile') window.location.href = '/profile.html';
    });
  });

  document.querySelectorAll('[data-href]').forEach((el) => {
    el.addEventListener('click', () => {
      window.location.href = el.dataset.href;
    });
  });

  document.getElementById('devInfoBtn').addEventListener('click', () => {
    window.location.href = '/dev-info.html';
  });

  function doLogout() {
    localStorage.removeItem('uno_token');
    localStorage.removeItem('uno_username');
    window.location.href = '/index.html';
  }

  // ---------------- Modal helpers ----------------
  function openModal(id) {
    document.getElementById(id).classList.add('show');
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove('show');
  }
  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close))
  );

  // ================= CHAT =================
  const chatMessages = document.getElementById('chatMessages');
  const chatWindowPane = document.getElementById('chatWindowPane');
  const chatWindowTitle = document.getElementById('chatWindowTitle');
  const chatInputForm = document.getElementById('chatInputForm');
  const chatInput = document.getElementById('chatInput');
  const privateThreadList = document.getElementById('privateThreadList');

  let currentThread = 'public'; // 'public' or username
  const privateThreadsCache = new Map(); // username -> messages[]
  const knownPrivateContacts = new Set();

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }

  function renderMessage(msg, mine) {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble ' + (mine ? 'mine' : 'theirs');
    bubble.dataset.id = msg.id;
    bubble.dataset.text = msg.text;
    bubble.dataset.from = msg.from;
    if (!mine && currentThread === 'public') {
      const sender = document.createElement('div');
      sender.className = 'msg-sender';
      const senderAvatar = document.createElement('span');
      senderAvatar.className = 'msg-sender-avatar';
      senderAvatar.textContent = msg.from[0].toUpperCase();
      ensureAvatarCached(msg.from, (url) => {
        if (url) senderAvatar.innerHTML = `<img class="avatar-img" src="${url}" />`;
      });
      const senderName = document.createElement('span');
      senderName.textContent = msg.from;
      sender.appendChild(senderAvatar);
      sender.appendChild(senderName);
      sender.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = '/profile.html?user=' + encodeURIComponent(msg.from);
      });
      bubble.appendChild(sender);
    }
    const textNode = document.createElement('div');
    textNode.textContent = msg.text;
    bubble.appendChild(textNode);
    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = fmtTime(msg.ts);
    bubble.appendChild(time);

    let pressTimer;
    bubble.addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => showContextMenu(e.touches[0].clientX, e.touches[0].clientY, bubble, mine), 450);
    });
    bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
    bubble.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, bubble, mine);
    });

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function openThread(threadId, displayName) {
    currentThread = threadId;
    chatWindowTitle.textContent = displayName;
    chatMessages.innerHTML = '';
    chatWindowPane.classList.add('show');
    document.querySelectorAll('.chat-list-item').forEach((it) => it.classList.remove('active'));
    const activeItem = document.querySelector(`.chat-list-item[data-thread="${threadId}"]`);
    if (activeItem) activeItem.classList.add('active');

    setUnread(threadId, false);
    if (threadId === 'public') {
      renderedPublic.forEach((m) => renderMessage(m, m.from === username));
    } else {
      socket.emit('chat:private:history', threadId);
    }
  }

  document.getElementById('backToListBtn').addEventListener('click', () => {
    chatWindowPane.classList.remove('show');
  });

  let renderedPublic = [];
  chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value;
    if (!text.trim()) return;
    chatInput.value = '';
    if (currentThread === 'public') {
      socket.emit('chat:public:send', text);
    } else {
      const targetThread = currentThread;
      const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const optimisticMsg = { id: tempId, from: username, to: targetThread, text: text.trim(), ts: Date.now() };
      if (!privateThreadsCache.has(targetThread)) privateThreadsCache.set(targetThread, []);
      privateThreadsCache.get(targetThread).push(optimisticMsg);
      renderMessage(optimisticMsg, true);
      socket.emit('chat:private:send', { to: targetThread, text }, (res) => {
        const arr = privateThreadsCache.get(targetThread) || [];
        const bubbleEl = chatMessages.querySelector(`[data-id="${tempId}"]`);
        if (!res || !res.ok) {
          toast((res && res.error) || 'Pesan gagal terkirim, coba lagi', 'error');
          if (bubbleEl) bubbleEl.classList.add('failed');
          return;
        }
        // Tukar id sementara dengan id asli dari server biar konsisten
        // (dipakai buat hapus pesan dll), tanpa perlu render ulang / ilang.
        const idx = arr.findIndex((m) => m.id === tempId);
        if (idx !== -1) arr[idx] = res.message;
        if (bubbleEl) bubbleEl.dataset.id = res.message.id;
      });
    }
  });

  socket.on('bootstrap', (data) => {
    renderedPublic = data.publicMessages;
    if (currentThread === 'public') {
      chatMessages.innerHTML = '';
      renderedPublic.forEach((m) => renderMessage(m, m.from === username));
    }
    document.getElementById('roomList') && renderRoomList(data.rooms);
    document.getElementById('openRoomCount').textContent = data.rooms.length;
  });

  socket.on('chat:public:new', (msg) => {
    renderedPublic.push(msg);
    document.getElementById('publicPreview').textContent = `${msg.from}: ${msg.text}`;
    if (currentThread === 'public') {
      renderMessage(msg, msg.from === username);
    } else if (msg.from !== username) {
      setUnread('public', true);
    }
  });

  socket.on('chat:public:deleted', ({ messageId }) => {
    renderedPublic = renderedPublic.filter((m) => m.id !== messageId);
    const el = chatMessages.querySelector(`[data-id="${messageId}"]`);
    if (el) el.remove();
  });

  function addPrivateContactToList(otherUser) {
    if (knownPrivateContacts.has(otherUser)) return;
    knownPrivateContacts.add(otherUser);
    const btn = document.createElement('button');
    btn.className = 'chat-list-item';
    btn.dataset.thread = otherUser;
    btn.innerHTML = `
      <div class="chat-avatar" data-role="avatar">${otherUser[0].toUpperCase()}</div>
      <div class="chat-list-meta">
        <div class="chat-list-name">${otherUser}</div>
        <div class="chat-list-preview">Ketuk untuk membuka chat</div>
      </div>
      <span class="unread-dot" data-role="unread-dot" style="display:none;"></span>`;
    btn.querySelector('[data-role="avatar"]').addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = '/profile.html?user=' + encodeURIComponent(otherUser);
    });
    btn.addEventListener('click', () => openThread(otherUser, otherUser));
    privateThreadList.appendChild(btn);
    ensureAvatarCached(otherUser, (url) => {
      if (url) btn.querySelector('[data-role="avatar"]').innerHTML = `<img class="avatar-img" src="${url}" />`;
    });
  }

  function setUnread(threadId, unread) {
    const item = document.querySelector(`.chat-list-item[data-thread="${threadId}"]`);
    if (!item) return;
    const dot = item.querySelector('[data-role="unread-dot"]');
    if (dot) dot.style.display = unread ? 'block' : 'none';
  }

  socket.on('chat:private:new', (msg) => {
    const otherUser = msg.from === username ? msg.to : msg.from;
    addPrivateContactToList(otherUser);
    if (!privateThreadsCache.has(otherUser)) privateThreadsCache.set(otherUser, []);
    const arr = privateThreadsCache.get(otherUser);
    if (!arr.some((m) => m.id === msg.id)) arr.push(msg);
    if (currentThread === otherUser) {
      renderMessage(msg, msg.from === username);
    } else if (msg.from !== username) {
      setUnread(otherUser, true);
    }
  });

  socket.on('chat:private:history', ({ withUser, messages }) => {
    // PENTING: gabung (merge) sama cache lokal, JANGAN langsung timpa.
    // Kalau history dari server sempat "ketinggalan" (race waktu pesan baru
    // saja terkirim), pesan yang sudah tampil di layar gak boleh ikut hilang.
    const existing = privateThreadsCache.get(withUser) || [];
    const merged = new Map();
    existing.forEach((m) => merged.set(m.id, m));
    messages.forEach((m) => merged.set(m.id, m));
    const combined = Array.from(merged.values()).sort((a, b) => a.ts - b.ts);
    privateThreadsCache.set(withUser, combined);
    if (currentThread === withUser) {
      chatMessages.innerHTML = '';
      combined.forEach((m) => renderMessage(m, m.from === username));
    }
  });

  socket.on('chat:private:deleted', ({ withUser, messageId }) => {
    if (currentThread === withUser) {
      const el = chatMessages.querySelector(`[data-id="${messageId}"]`);
      if (el) el.remove();
    }
  });

  // Context menu: copy / forward / delete
  const contextMenu = document.getElementById('msgContextMenu');
  let contextTargetBubble = null;
  let contextTargetMine = false;

  function showContextMenu(x, y, bubble, mine) {
    contextTargetBubble = bubble;
    contextTargetMine = mine;
    contextMenu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 140) + 'px';
    contextMenu.classList.add('show');
    // hapus hanya boleh untuk pesan milik sendiri
    const deleteBtn = contextMenu.querySelector('[data-act="delete"]');
    deleteBtn.style.display = mine ? 'block' : 'none';
  }
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.classList.remove('show');
  });
  contextMenu.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act || !contextTargetBubble) return;
    const text = contextTargetBubble.dataset.text;
    const msgId = contextTargetBubble.dataset.id;
    if (act === 'copy') {
      navigator.clipboard && navigator.clipboard.writeText(text);
    } else if (act === 'delete') {
      if (currentThread === 'public') {
        socket.emit('chat:public:delete', msgId);
      } else {
        socket.emit('chat:private:delete', { withUser: currentThread, messageId: msgId });
      }
    } else if (act === 'forward') {
      openForwardModal(text);
    }
    contextMenu.classList.remove('show');
  });

  function openForwardModal(text) {
    const list = document.getElementById('forwardTargetList');
    list.innerHTML = '';
    const targets = new Set([...knownPrivateContacts]);
    if (targets.size === 0) {
      list.innerHTML = '<p class="muted">Belum ada kontak pribadi. Cari pemain dulu.</p>';
    }
    targets.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `<div class="chat-avatar">${t[0].toUpperCase()}</div><div>${t}</div>`;
      item.addEventListener('click', () => {
        socket.emit('chat:private:send', { to: t, text });
        closeModal('forwardModal');
      });
      list.appendChild(item);
    });
    openModal('forwardModal');
  }

  // Public thread click
  document.querySelector('.chat-list-item[data-thread="public"]').addEventListener('click', () => {
    openThread('public', 'Grup Publik');
  });

  // New private chat search
  document.getElementById('newPrivateChatBtn').addEventListener('click', () => {
    document.getElementById('userSearchInput').value = '';
    document.getElementById('userSearchResults').innerHTML = '';
    openModal('searchUserModal');
  });
  document.getElementById('userSearchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    socket.emit('user:search', q, (matches) => {
      const resultsEl = document.getElementById('userSearchResults');
      resultsEl.innerHTML = '';
      matches.forEach((m) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `<div class="chat-avatar">${m[0].toUpperCase()}</div><div>${m}</div>`;
        item.addEventListener('click', () => {
          addPrivateContactToList(m);
          openThread(m, m);
          closeModal('searchUserModal');
        });
        resultsEl.appendChild(item);
      });
    });
  });

  // ================= GAME =================
  const roomList = document.getElementById('roomList');
  const gameLobby = document.getElementById('gameLobby');
  const roomWaiting = document.getElementById('roomWaiting');
  const gameBoard = document.getElementById('gameBoard');
  let myCurrentRoomId = null;
  let pendingWildUid = null;

  function showLobby() {
    gameLobby.classList.add('active');
    roomWaiting.classList.remove('active');
    gameBoard.classList.remove('active');
  }
  function showWaiting() {
    gameLobby.classList.remove('active');
    roomWaiting.classList.add('active');
    gameBoard.classList.remove('active');
  }
  function showBoard() {
    gameLobby.classList.remove('active');
    roomWaiting.classList.remove('active');
    gameBoard.classList.add('active');
  }

  function renderRoomList(rooms) {
    document.getElementById('openRoomCount').textContent = rooms.length;
    roomList.innerHTML = '';
    if (rooms.length === 0) {
      roomList.innerHTML = '<div class="room-empty-hint">Belum ada room terbuka.<br>Tekan + untuk buat room baru!</div>';
      return;
    }
    rooms.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'room-card';
      const statusMap = {
        waiting: { label: 'Menunggu Pemain', cls: 'status-waiting' },
        playing: { label: 'Sedang Bermain', cls: 'status-playing' },
        finished: { label: 'Selesai', cls: 'status-waiting' },
      };
      const st = statusMap[r.status] || statusMap.waiting;
      card.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-name">${r.name}</div>
          <div class="room-card-meta">
            <span>ID: ${r.id}</span>
            <span>${r.memberCount}/${r.maxPlayers} pemain</span>
            ${r.hasPassword ? '<span class="lock-icon"><i class="fa-solid fa-lock"></i></span>' : ''}
          </div>
          <span class="room-status-badge ${st.cls}"><i class="fa-solid fa-circle"></i> ${st.label}</span>
        </div>
        <button class="btn-join-room" ${r.status === 'playing' ? 'disabled' : ''}>${r.status === 'playing' ? 'Sedang Main' : 'Gabung'}</button>
      `;
      card.querySelector('.btn-join-room').addEventListener('click', () => attemptJoinRoom(r.id, r.hasPassword, r.status));
      roomList.appendChild(card);
    });
  }

  socket.on('room:list', renderRoomList);

  document.getElementById('searchRoomInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toUpperCase();
    socket.emit('room:list', (rooms) => {
      renderRoomList(q ? rooms.filter((r) => r.id.includes(q)) : rooms);
    });
  });

  // Create room
  document.getElementById('createRoomBtn').addEventListener('click', () => {
    document.getElementById('roomNameInput').value = '';
    document.getElementById('roomPasswordInput').value = '';
    document.getElementById('createRoomError').textContent = '';
    openModal('createRoomModal');
  });
  document.getElementById('confirmCreateRoomBtn').addEventListener('click', () => {
    const name = document.getElementById('roomNameInput').value.trim();
    const maxPlayers = document.getElementById('roomMaxPlayers').value;
    const password = document.getElementById('roomPasswordInput').value.trim();
    socket.emit('room:create', { name, maxPlayers, password }, (res) => {
      if (!res.ok) {
        document.getElementById('createRoomError').textContent = res.error || 'Gagal membuat room';
        return;
      }
      closeModal('createRoomModal');
      myCurrentRoomId = res.room.id;
      enterWaitingRoom(res.room.id, res.room.name, [username], username);
    });
  });

  let pendingJoinRoomId = null;
  function attemptJoinRoom(roomId, hasPassword, status) {
    if (status === 'playing') {
      toast('Room ini sedang bermain, coba lagi nanti ya', 'error');
      return;
    }
    if (hasPassword) {
      pendingJoinRoomId = roomId;
      document.getElementById('joinPasswordInput').value = '';
      document.getElementById('joinPasswordError').textContent = '';
      openModal('joinPasswordModal');
    } else {
      doJoinRoom(roomId, null);
    }
  }
  document.getElementById('confirmJoinPasswordBtn').addEventListener('click', () => {
    const pw = document.getElementById('joinPasswordInput').value;
    doJoinRoom(pendingJoinRoomId, pw);
  });
  function doJoinRoom(roomId, password) {
    socket.emit('room:join', { roomId, password }, (res) => {
      if (!res.ok) {
        const el = document.getElementById('joinPasswordError');
        if (el) el.textContent = res.error;
        else toast(res.error, 'error');
        return;
      }
      closeModal('joinPasswordModal');
      myCurrentRoomId = roomId;
      const hostUser = res.room.hostUsername || res.room.members[0];
      enterWaitingRoom(roomId, res.room.name, res.room.members, hostUser);
    });
  }

  function enterWaitingRoom(roomId, name, members, hostUsername) {
    document.getElementById('roomWaitingTitle').textContent = name;
    document.getElementById('roomWaitingId').textContent = roomId;
    renderMembers(members, hostUsername);
    document.getElementById('startGameBtn').style.display = hostUsername === username ? 'block' : 'none';
    document.getElementById('waitingHint').style.display = hostUsername === username ? 'none' : 'block';
    loadRoomChat(roomId);
    showWaiting();
  }

  // ---------------- Chat di dalam room ----------------
  let roomChatCache = [];
  function renderRoomChatMsg(msg, targetEl) {
    const row = document.createElement('div');
    row.className = 'room-chat-msg' + (msg.from === username ? ' mine' : '');
    row.innerHTML = `<span class="room-chat-from">${msg.from}</span><span class="room-chat-text"></span>`;
    row.querySelector('.room-chat-text').textContent = msg.text;
    targetEl.appendChild(row);
    targetEl.scrollTop = targetEl.scrollHeight;
  }
  function renderAllRoomChat() {
    ['roomChatLog', 'gameChatLog'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '';
      roomChatCache.forEach((m) => renderRoomChatMsg(m, el));
    });
  }
  function loadRoomChat(roomId) {
    socket.emit('room:chat:history', roomId, (messages) => {
      roomChatCache = messages || [];
      renderAllRoomChat();
    });
  }
  function sendRoomChat(text) {
    if (!text || !text.trim() || !myCurrentRoomId) return;
    socket.emit('room:chat:send', { roomId: myCurrentRoomId, text }, (res) => {
      if (!res || !res.ok) toast('Gagal mengirim pesan', 'error');
    });
  }
  socket.on('room:chat:new', (msg) => {
    roomChatCache.push(msg);
    ['roomChatLog', 'gameChatLog'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) renderRoomChatMsg(msg, el);
    });
    if (gameBoard.classList.contains('active')) showChatBubble(msg.from, msg.text);
  });
  socket.on('room:chat:cleared', () => {
    roomChatCache = [];
    renderAllRoomChat();
  });

  document.getElementById('roomChatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('roomChatInput');
    sendRoomChat(input.value);
    input.value = '';
  });
  document.getElementById('gameChatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('gameChatInput');
    sendRoomChat(input.value);
    input.value = '';
  });
  document.querySelectorAll('[data-quick]').forEach((btn) =>
    btn.addEventListener('click', () => sendRoomChat(btn.dataset.quick))
  );
  document.querySelectorAll('[data-quick-game]').forEach((btn) =>
    btn.addEventListener('click', () => sendRoomChat(btn.dataset.quickGame))
  );
  document.getElementById('gameChatToggleBtn').addEventListener('click', () => {
    document.getElementById('gameChatDrawer').classList.toggle('show');
  });
  document.getElementById('closeGameChatBtn').addEventListener('click', () => {
    document.getElementById('gameChatDrawer').classList.remove('show');
  });

  // Bubble kecil yang muncul sesaat di atas avatar pengirim pas lagi main
  function showChatBubble(from, text) {
    const ring = document.querySelector(`.timer-ring[data-player="${from}"]`);
    const anchor = ring ? ring.closest('.opponent-chip, .my-panel') : null;
    if (!anchor) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-float-bubble';
    bubble.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
    anchor.style.position = 'relative';
    anchor.appendChild(bubble);
    setTimeout(() => bubble.remove(), 3000);
  }

  function renderMembers(members, hostUsername) {
    const list = document.getElementById('roomMemberList');
    list.innerHTML = '';
    members.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'room-member-item';
      item.innerHTML = `<div class="chat-avatar">${m[0].toUpperCase()}</div><div>${m}</div>${m === hostUsername ? '<span class="host-badge">HOST</span>' : ''}`;
      list.appendChild(item);
    });
  }

  socket.on('room:update', (room) => {
    if (room.id !== myCurrentRoomId) return;
    renderMembers(room.members, room.hostUsername);
    document.getElementById('startGameBtn').style.display = room.hostUsername === username ? 'block' : 'none';
  });

  document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('room:start', myCurrentRoomId, (res) => {
      if (!res.ok) toast(res.error, 'error');
    });
  });

  document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    if (myCurrentRoomId) socket.emit('room:leave', myCurrentRoomId);
    myCurrentRoomId = null;
    showLobby();
  });
  let gameInProgress = false;
  document.getElementById('exitGameBtn').addEventListener('click', () => {
    if (gameInProgress) {
      toast('Kamu tidak bisa keluar sebelum game selesai!', 'error');
      return;
    }
    if (myCurrentRoomId) socket.emit('room:leave', myCurrentRoomId);
    myCurrentRoomId = null;
    showLobby();
  });

  socket.on('room:closed', ({ roomId }) => {
    if (roomId !== myCurrentRoomId) return;
    myCurrentRoomId = null;
    gameInProgress = false;
    stopTurnTimerUI();
    toast('Room ditutup karena host sudah keluar.', 'error');
    showLobby();
  });

  // ---- Game board rendering ----
  const CARD_LABELS = { skip: '⦸', reverse: '⇄', draw2: '+2', wild: '', wild4: '+4' };
  function cardLabel(card) {
    if (card.type === 'number') return card.value;
    return CARD_LABELS[card.type] || '?';
  }
  function cardColorClass(card, activeColor) {
    if (card.color === 'wild') return 'card-wild';
    return 'card-' + card.color;
  }

  // Bikin tampilan kartu ala kartu UNO asli: badge sudut kiri-atas & kanan-bawah,
  // oval putih di tengah, dan simbol besar di dalamnya.
  function buildCardFace(cardDiv, card) {
    cardDiv.innerHTML = '';
    const isWild = card.color === 'wild';
    const label = cardLabel(card);
    const corner1 = document.createElement('div');
    corner1.className = 'card-corner card-corner-tl';
    corner1.textContent = label;
    const oval = document.createElement('div');
    oval.className = 'card-oval';
    const symbol = document.createElement('div');
    symbol.className = 'card-symbol';
    symbol.textContent = isWild ? (card.type === 'wild4' ? '+4' : '🎨') : label;
    oval.appendChild(symbol);
    const corner2 = document.createElement('div');
    corner2.className = 'card-corner card-corner-br';
    corner2.textContent = label;
    cardDiv.appendChild(corner1);
    cardDiv.appendChild(oval);
    cardDiv.appendChild(corner2);
  }

  // ---- Timer giliran (ditampilkan sebagai cincin di atas avatar pemain yang jalan) ----
  let turnTimerInterval = null;
  function allTimerRings() {
    return document.querySelectorAll('.timer-ring');
  }
  function stopTurnTimerUI() {
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerInterval = null;
    allTimerRings().forEach((el) => {
      el.classList.remove('active');
      el.style.background = '';
      const badge = el.querySelector('.timer-badge');
      if (badge) badge.textContent = '';
    });
  }
  function ringColorFor(pct) {
    if (pct > 0.5) return getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
    if (pct > 0.2) return getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim();
    return getComputedStyle(document.documentElement).getPropertyValue('--red').trim();
  }
  function startTurnTimerUI(turnEndsAt, currentPlayerId) {
    stopTurnTimerUI();
    const totalMs = 20000;
    const ring = document.querySelector(`.timer-ring[data-player="${currentPlayerId}"]`);
    if (!ring) return;
    ring.classList.add('active');
    const badge = ring.querySelector('.timer-badge');
    const tick = () => {
      const remaining = Math.max(0, turnEndsAt - Date.now());
      const pct = Math.max(0, Math.min(1, remaining / totalMs));
      const color = ringColorFor(pct);
      ring.style.background = `conic-gradient(${color} ${pct * 360}deg, var(--card) ${pct * 360}deg 360deg)`;
      if (badge) badge.textContent = Math.ceil(remaining / 1000);
      if (remaining <= 0) clearInterval(turnTimerInterval);
    };
    tick();
    turnTimerInterval = setInterval(tick, 150);
  }

  socket.on('game:state', (state) => {
    showBoard();
    gameInProgress = state.status === 'playing';
    renderBoard(state);
    if (state.status === 'playing' && state.turnEndsAt) {
      startTurnTimerUI(state.turnEndsAt, state.currentPlayerId);
    } else {
      stopTurnTimerUI();
    }
  });

  function renderBoard(state) {
    // opponents
    const row = document.getElementById('opponentsRow');
    row.innerHTML = '';
    state.players.forEach((p) => {
      if (p.id === username) return;
      const chip = document.createElement('div');
      chip.className = 'opponent-chip' + (p.id === state.currentPlayerId ? ' is-turn' : '');
      chip.innerHTML = `
        <div class="timer-ring" data-player="${p.id}">
          <div class="player-avatar">${avatarHtml(p.id, p.avatar)}</div>
          <div class="timer-badge">20</div>
        </div>
        <div class="opponent-name">${p.id}${p.calledUno ? ' 🗣️' : ''}</div>
        <div class="opponent-cardcount">${p.cardCount} kartu</div>`;
      row.appendChild(chip);
    });

    // discard pile
    const discardEl = document.getElementById('discardPileCard');
    discardEl.innerHTML = '';
    const topCardDiv = document.createElement('div');
    topCardDiv.className = 'card ' + cardColorClass(state.topCard);
    buildCardFace(topCardDiv, state.topCard);
    discardEl.appendChild(topCardDiv);

    document.getElementById('drawPileCount').textContent = state.drawPileCount;
    const colorMap = { red: 'var(--red)', yellow: 'var(--yellow)', green: 'var(--green)', blue: 'var(--blue)' };
    document.getElementById('activeColorDot').style.background = colorMap[state.activeColor] || '#fff';

    const isMyTurn = state.currentPlayerId === username;
    if (!isMyTurn) clearStaged();
    document.getElementById('myPanel').classList.toggle('is-turn', isMyTurn);
    document.getElementById('turnIndicator').textContent = isMyTurn
      ? 'Giliranmu!' + (state.pendingDraw > 0 ? ` (tumpuk atau ambil ${state.pendingDraw})` : '')
      : `Giliran ${state.currentPlayerId}...`;

  // Cerminan aturan server: dipakai buat highlight kartu yang bisa dipasang.
  function canPlayClient(card, state) {
    if (state.pendingDraw > 0) {
      return (card.type === 'draw2' && state.topCard.type === 'draw2') || card.type === 'wild4';
    }
    if (card.type === 'wild' || card.type === 'wild4') return true;
    const color = state.activeColor || state.topCard.color;
    if (card.color === color) return true;
    if (card.type === 'number' && state.topCard.type === 'number' && card.value === state.topCard.value) return true;
    if (card.type !== 'number' && card.type === state.topCard.type) return true;
    return false;
  }

  // my hand
  currentHandCache = state.yourHand;
  const hand = document.getElementById('myHand');
  hand.innerHTML = '';
  state.yourHand.forEach((card, i) => {
    const cardDiv = document.createElement('div');
    const playable = isMyTurn && canPlayClient(card, state);
    cardDiv.className = 'card card-settle ' + cardColorClass(card) + (playable ? ' playable' : '');
    cardDiv.style.animationDelay = (i * 25) + 'ms';
    buildCardFace(cardDiv, card);
    if (!isMyTurn) cardDiv.classList.add('disabled');

    cardDiv.addEventListener('click', () => {
      if (!isMyTurn || cardDiv.dataset.dragPlayed) return;
      handlePlayAttempt(card, cardDiv);
    });

    // ---- Drag ke atas untuk memainkan kartu ----
    let drag = null;
    cardDiv.addEventListener('pointerdown', (e) => {
      if (!isMyTurn) return;
      drag = { startX: e.clientX, startY: e.clientY };
      cardDiv.setPointerCapture(e.pointerId);
      cardDiv.style.transition = 'none';
    });
    cardDiv.addEventListener('pointermove', (e) => {
      if (!drag || !isMyTurn) return;
      const dx = e.clientX - drag.startX;
      const dy = Math.min(0, e.clientY - drag.startY);
      cardDiv.style.transform = `translate(${dx * 0.35}px, ${dy}px) rotate(${dx * 0.04}deg)`;
      cardDiv.style.zIndex = 20;
    });
    const endDrag = (e) => {
      if (!drag || !isMyTurn) return;
      const dy = e.clientY - drag.startY;
      cardDiv.style.transition = 'transform .2s ease, opacity .2s ease';
      if (dy < -55) {
        cardDiv.dataset.dragPlayed = '1';
        cardDiv.style.transform = 'translateY(-170px) scale(.85)';
        cardDiv.style.opacity = '0';
        setTimeout(() => handlePlayAttempt(card, cardDiv), 110);
      } else {
        cardDiv.style.transform = '';
      }
      drag = null;
    };
    cardDiv.addEventListener('pointerup', endDrag);
    cardDiv.addEventListener('pointercancel', endDrag);

    hand.appendChild(cardDiv);
  });

    if (state.status === 'finished') {
      gameInProgress = false;
      stopTurnTimerUI();
      const iWon = state.winner === username;
      document.getElementById('gameOverIcon').innerHTML = iWon
        ? '<i class="fa-solid fa-trophy"></i>'
        : '<i class="fa-solid fa-face-sad-tear"></i>';
      document.getElementById('gameOverModal').querySelector('.game-over-card').classList.toggle('is-win', iWon);
      document.getElementById('gameOverTitle').textContent = iWon ? 'Kamu Menang! 🎉' : 'Game Selesai';
      document.getElementById('gameOverText').textContent = iWon
        ? 'Mantap! Kamu ngabisin semua kartu duluan.'
        : `${state.winner} menang duluan kali ini. Coba lagi yuk!`;
      openModal('gameOverModal');
    }
  }

  function playCard(uid, chosenColor, extraUids) {
    socket.emit(
      'game:action',
      { roomId: myCurrentRoomId, action: { type: 'play', uid, chosenColor, extraUids: extraUids || [] } },
      (res) => {
        if (!res.ok) toast(res.error, 'error');
      }
    );
  }

  let currentHandCache = [];
  let stagedGroup = []; // [{ card, el }, ...] — kumpulan kartu angka sama yg lagi "ditahan"
  let stagedTimeout = null;

  function clearStaged() {
    if (stagedTimeout) clearTimeout(stagedTimeout);
    stagedTimeout = null;
    stagedGroup.forEach((s) => s.el && s.el.classList.remove('staged'));
    stagedGroup = [];
  }

  function commitStaged() {
    if (stagedTimeout) clearTimeout(stagedTimeout);
    stagedTimeout = null;
    if (stagedGroup.length === 0) return;
    const [first, ...rest] = stagedGroup;
    stagedGroup = [];
    playCard(first.card.uid, null, rest.map((s) => s.card.uid));
  }

  function remainingTwinsInHand() {
    if (stagedGroup.length === 0) return 0;
    const value = stagedGroup[0].card.value;
    const stagedUids = new Set(stagedGroup.map((s) => s.card.uid));
    return currentHandCache.filter((c) => c.type === 'number' && c.value === value && !stagedUids.has(c.uid)).length;
  }

  // Dipanggil setiap kali kartu ditap ATAU ditarik ke atas.
  // - Wild: langsung buka pemilih warna (kartu wild gak bisa didobel).
  // - Kartu angka yang punya kembaran: ditahan (staged) sebentar. Selama masih
  //   ada kembaran lain di tangan, tarik/tap terus kembarannya -> semua kesedot
  //   jadi satu grup dan dimainkan bareng sekaligus (2, 3, atau 4 kartu),
  //   tanpa popup konfirmasi apa pun. Berhenti sebentar / kembaran habis -> auto main.
  // - Selain itu: main langsung, satu kartu, simpel.
  function handlePlayAttempt(card, cardDiv) {
    if (card.type === 'wild' || card.type === 'wild4') {
      commitStaged();
      pendingWildUid = card.uid;
      openModal('colorPickerModal');
      return;
    }

    if (stagedGroup.length > 0 && card.type === 'number' && stagedGroup[0].card.value === card.value) {
      stagedGroup.push({ card, el: cardDiv });
      cardDiv.classList.add('staged');
      if (stagedTimeout) clearTimeout(stagedTimeout);
      if (remainingTwinsInHand() === 0) {
        // udah gak ada kembaran lagi di tangan -> langsung mainkan semua, gak perlu nunggu
        commitStaged();
      } else {
        stagedTimeout = setTimeout(commitStaged, 1400);
      }
      return;
    }

    if (stagedGroup.length > 0) {
      // Kartu baru gak nyambung sama grup yang ditahan -> mainkan grup itu dulu,
      // baru proses kartu baru dari awal.
      commitStaged();
    }

    const hasTwin = card.type === 'number' && currentHandCache.some((c) => c.uid !== card.uid && c.type === 'number' && c.value === card.value);
    if (hasTwin) {
      stagedGroup = [{ card, el: cardDiv }];
      cardDiv.classList.add('staged');
      stagedTimeout = setTimeout(commitStaged, 1400);
    } else {
      playCard(card.uid, null, []);
    }
  }

  document.querySelectorAll('.color-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      closeModal('colorPickerModal');
      if (pendingWildUid) playCard(pendingWildUid, sw.dataset.color);
      pendingWildUid = null;
    });
  });

  document.getElementById('drawPileBtn').addEventListener('click', () => {
    socket.emit('game:action', { roomId: myCurrentRoomId, action: { type: 'draw' } }, (res) => {
      if (!res.ok) toast(res.error, 'error');
    });
  });

  document.getElementById('callUnoBtn').addEventListener('click', () => {
    socket.emit('game:action', { roomId: myCurrentRoomId, action: { type: 'callUno' } });
  });

  document.getElementById('backToRoomBtn').addEventListener('click', () => {
    closeModal('gameOverModal');
    socket.emit('room:backToWaiting', myCurrentRoomId, (res) => {
      if (!res.ok) {
        toast(res.error || 'Gagal kembali ke room', 'error');
        myCurrentRoomId = null;
        showLobby();
        return;
      }
      enterWaitingRoom(res.room.id, res.room.name, res.room.members, res.room.hostUsername);
    });
  });
  document.getElementById('exitToHomeBtn').addEventListener('click', () => {
    closeModal('gameOverModal');
    if (myCurrentRoomId) socket.emit('room:leave', myCurrentRoomId);
    myCurrentRoomId = null;
    showLobby();
  });

  // ---------------- Presence for home stat ----------------
  socket.on('presence', (data) => {
    document.getElementById('onlineCount').textContent = data.online.length;
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') doLogout();
  });
})();
