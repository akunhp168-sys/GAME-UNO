// server.js — UNO Game App backend (Express + Socket.io)
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { UnoGame } = require('./unoLogic');

const PORT = process.env.PORT || 10001;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function recordGameResult(participantUsernames, winnerUsername) {
  const users = loadUsers();
  for (const uname of participantUsernames) {
    const key = uname.toLowerCase();
    const u = users[key];
    if (!u) continue;
    u.gamesPlayed = (u.gamesPlayed || 0) + 1;
    if (uname === winnerUsername) u.gamesWon = (u.gamesWon || 0) + 1;
  }
  saveUsers(users);
}

function getProfile(uname) {
  const users = loadUsers();
  const u = users[(uname || '').toLowerCase()];
  if (!u) return null;
  const gamesPlayed = u.gamesPlayed || 0;
  const gamesWon = u.gamesWon || 0;
  const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;
  return {
    username: u.username,
    createdAt: u.createdAt,
    gamesPlayed,
    gamesWon,
    winRate,
    bio: u.bio || '',
    avatar: u.avatar || null,
  };
}

function updateProfile(uname, { bio, avatar }) {
  const users = loadUsers();
  const key = (uname || '').toLowerCase();
  const u = users[key];
  if (!u) return null;
  if (typeof bio === 'string') u.bio = bio.slice(0, 160);
  if (typeof avatar === 'string') {
    if (avatar.length > 5_500_000) throw new Error('Foto terlalu besar');
    u.avatar = avatar;
  } else if (avatar === null) {
    u.avatar = null;
  }
  saveUsers(users);
  return getProfile(uname);
}

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map(); // token -> username
function createSession(uname) {
  const token = crypto.createHash('sha256').update(uname + Date.now() + Math.random()).digest('hex');
  sessions.set(token, uname);
  return token;
}

// ---------- Auth REST endpoints ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username dan password wajib diisi' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ ok: false, error: 'Username harus 3-20 karakter' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'Password minimal 6 karakter' });
  }
  const users = loadUsers();
  const key = username.toLowerCase();
  if (users[key]) {
    return res.status(409).json({ ok: false, error: 'Username sudah dipakai' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  users[key] = {
    username,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
    gamesPlayed: 0,
    gamesWon: 0,
    bio: '',
    avatar: null,
  };
  saveUsers(users);
  const token = createSession(username);
  res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const key = (username || '').toLowerCase();
  const user = users[key];
  if (!user || hashPassword(password, user.salt) !== user.hash) {
    return res.status(401).json({ ok: false, error: 'Username atau password salah' });
  }
  const token = createSession(user.username);
  res.json({ ok: true, token, username: user.username });
});

function authFromToken(token) {
  return sessions.get(token) || null;
}

// ---------- In-memory chat & room state ----------
const publicMessages = []; // { id, from, text, ts }
const privateThreads = new Map(); // key "userA|userB" (sorted) -> [messages]
const rooms = new Map(); // roomId -> { id, name, hostUsername, maxPlayers, password, members: [username], game: UnoGame|null, status }

const TURN_MS = 20000; // 20 detik per giliran

function clearRoomTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

// PENTING: jangan pakai io.to(`room-${id}`) buat broadcast ke anggota room.
// Kalau ada yang sempat pindah halaman (Profil/Info) lalu balik lagi, koneksi
// socket barunya gak otomatis ikut channel itu lagi -> pesan dari orang lain
// jadi kelihatan "gak masuk". Broadcast manual ke tiap anggota (via onlineUsers)
// selalu aman karena gak bergantung status join channel sama sekali.
function broadcastToRoom(room, event, payload) {
  for (const member of room.members) {
    const sid = onlineUsers.get(member);
    if (sid) io.to(sid).emit(event, payload);
  }
}

function broadcastGameState(room) {
  for (const member of room.members) {
    const sid = onlineUsers.get(member);
    if (sid) {
      const state = room.game.publicState(member);
      state.players = state.players.map((p) => ({ ...p, avatar: getProfile(p.id)?.avatar || null }));
      io.to(sid).emit('game:state', { ...state, turnEndsAt: room.turnEndsAt });
    }
  }
}

function finishGame(room, winner) {
  room.status = 'finished';
  clearRoomTimer(room);
  recordGameResult(room.members, winner);
  room.chatMessages = []; // riwayat chat room dibersihkan tiap game kelar
  broadcastToRoom(room, 'game:over', { winner });
  io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
}

function scheduleTurnTimer(room) {
  clearRoomTimer(room);
  if (!room.game || room.game.status !== 'playing') return;
  room.turnEndsAt = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    if (!room.game || room.game.status !== 'playing') return;
    const currentId = room.game.currentPlayer().id;
    const action = room.game.getRandomValidAction();
    let result = room.game.applyAction(currentId, action);
    if (!result.ok) {
      // fallback: force draw kalau aksi acak gagal, biar giliran tetap lewat
      result = room.game.applyAction(currentId, { type: 'draw' });
    }
    if (result.gameOver) {
      broadcastGameState(room);
      finishGame(room, result.winner);
      return;
    }
    // Penting: set timer/deadline baru DULU sebelum broadcast, supaya client
    // gak pernah nerima state dengan waktu giliran yang sudah basi/habis.
    scheduleTurnTimer(room);
    broadcastGameState(room);
  }, TURN_MS);
}

function threadKey(a, b) {
  return [a, b].sort().join('|');
}

function roomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    hostUsername: room.hostUsername,
    maxPlayers: room.maxPlayers,
    memberCount: room.members.length,
    hasPassword: !!room.password,
    status: room.status,
  };
}

function genRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---------- Socket.io ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const onlineUsers = new Map(); // username -> socketId
const pendingDisconnects = new Map(); // username -> timeout handle
const DISCONNECT_GRACE_MS = 10000; // toleransi pindah halaman (mis. buka /profile.html) sebelum dianggap keluar beneran

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const username = authFromToken(token);
  if (!username) return next(new Error('unauthorized'));
  socket.username = username;
  next();
});

io.on('connection', (socket) => {
  const username = socket.username;

  // Batalin pembersihan room kalau ini cuma reconnect cepat (pindah halaman,
  // koneksi sempat putus-nyambung, dll) — bukan beneran keluar/nutup app.
  if (pendingDisconnects.has(username)) {
    clearTimeout(pendingDisconnects.get(username));
    pendingDisconnects.delete(username);
  }

  onlineUsers.set(username, socket.id);
  socket.join('public-lobby');

  socket.emit('bootstrap', {
    username,
    publicMessages: publicMessages.slice(-100),
    rooms: Array.from(rooms.values()).map(roomSummary),
  });

  io.emit('presence', { online: Array.from(onlineUsers.keys()) });

  // ---- Public chat ----
  socket.on('chat:public:send', (text) => {
    if (!text || typeof text !== 'string' || !text.trim()) return;
    const msg = {
      id: crypto.randomUUID(),
      from: username,
      text: text.trim().slice(0, 1000),
      ts: Date.now(),
    };
    publicMessages.push(msg);
    if (publicMessages.length > 500) publicMessages.shift();
    for (const sid of onlineUsers.values()) io.to(sid).emit('chat:public:new', msg);
  });

  // ---- Private chat ----
  socket.on('chat:private:send', ({ to, text }, cb) => {
    if (!to || !text || !text.trim()) return cb && cb({ ok: false, error: 'Pesan kosong' });
    const key = threadKey(username, to);
    const msg = {
      id: crypto.randomUUID(),
      from: username,
      to,
      text: text.trim().slice(0, 1000),
      ts: Date.now(),
    };
    if (!privateThreads.has(key)) privateThreads.set(key, []);
    privateThreads.get(key).push(msg);
    // PENTING: gak usah echo balik ke pengirim lewat event terpisah -- itu
    // penyebab race yang bikin pesan kelihatan hilang. Pengirim render pesannya
    // sendiri (optimistic) begitu ack ini balik; cukup kirim ke lawan bicara.
    const targetSocketId = onlineUsers.get(to);
    if (targetSocketId) io.to(targetSocketId).emit('chat:private:new', msg);
    cb && cb({ ok: true, message: msg });
  });

  socket.on('chat:private:history', (withUser) => {
    const key = threadKey(username, withUser);
    socket.emit('chat:private:history', {
      withUser,
      messages: privateThreads.get(key) || [],
    });
  });

  socket.on('chat:private:delete', ({ withUser, messageId }) => {
    const key = threadKey(username, withUser);
    const thread = privateThreads.get(key);
    if (!thread) return;
    const idx = thread.findIndex((m) => m.id === messageId && m.from === username);
    if (idx !== -1) {
      thread.splice(idx, 1);
      const targetSocketId = onlineUsers.get(withUser);
      socket.emit('chat:private:deleted', { withUser, messageId });
      if (targetSocketId) io.to(targetSocketId).emit('chat:private:deleted', { withUser: username, messageId });
    }
  });

  socket.on('user:search', (query, cb) => {
    const users = loadUsers();
    const q = (query || '').toLowerCase();
    const matches = Object.values(users)
      .map((u) => u.username)
      .filter((u) => u.toLowerCase().includes(q) && u !== username)
      .slice(0, 20);
    cb && cb(matches);
  });

  // ---- Rooms / Game ----
  socket.on('room:create', ({ name, maxPlayers, password }, cb) => {
    const id = genRoomId();
    const room = {
      id,
      name: (name || `Room ${id}`).slice(0, 40),
      hostUsername: username,
      maxPlayers: Math.min(Math.max(parseInt(maxPlayers, 10) || 4, 2), 10),
      password: password || null,
      members: [username],
      game: null,
      status: 'waiting',
      chatMessages: [],
    };
    rooms.set(id, room);
    socket.join(`room-${id}`);
    io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
    cb && cb({ ok: true, room: roomSummary(room) });
  });

  socket.on('room:list', (cb) => {
    cb && cb(Array.from(rooms.values()).map(roomSummary));
  });

  // ---- Chat di dalam room (lobi tunggu maupun pas main) ----
  socket.on('room:chat:send', ({ roomId, text }, cb) => {
    const room = rooms.get(roomId);
    if (!room || !room.members.includes(username)) return cb && cb({ ok: false });
    if (!text || !text.trim()) return cb && cb({ ok: false });
    const msg = { id: crypto.randomUUID(), from: username, text: text.trim().slice(0, 200), ts: Date.now() };
    room.chatMessages = room.chatMessages || [];
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 60) room.chatMessages.shift();
    broadcastToRoom(room, 'room:chat:new', msg);
    cb && cb({ ok: true });
  });

  socket.on('room:chat:history', (roomId, cb) => {
    const room = rooms.get(roomId);
    cb && cb(room ? room.chatMessages || [] : []);
  });

  socket.on('room:join', ({ roomId, password }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'Room tidak ditemukan' });
    if (room.password && room.password !== password) {
      return cb && cb({ ok: false, error: 'Password salah' });
    }
    if (room.members.length >= room.maxPlayers) {
      return cb && cb({ ok: false, error: 'Room penuh' });
    }
    if (!room.members.includes(username)) room.members.push(username);
    socket.join(`room-${roomId}`);
    broadcastToRoom(room, 'room:update', {
      ...roomSummary(room),
      members: room.members,
    });
    io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
    cb && cb({ ok: true, room: { ...roomSummary(room), members: room.members } });
  });

  socket.on('room:leave', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const isHost = room.hostUsername === username;
    socket.leave(`room-${roomId}`);

    if (isHost) {
      // Kalau host keluar, room langsung dihapus & semua member dikembalikan ke lobi
      clearRoomTimer(room);
      const otherMembers = room.members.filter((m) => m !== username);
      rooms.delete(roomId);
      for (const member of otherMembers) {
        const sid = onlineUsers.get(member);
        if (sid) io.to(sid).emit('room:closed', { roomId, reason: 'host_left' });
      }
      io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
      return;
    }

    room.members = room.members.filter((m) => m !== username);
    if (room.members.length === 0) {
      clearRoomTimer(room);
      rooms.delete(roomId);
    } else {
      room.chatMessages = []; // ada yang keluar -> riwayat chat room dibersihkan
      broadcastToRoom(room, 'room:chat:cleared', {});
      broadcastToRoom(room, 'room:update', { ...roomSummary(room), members: room.members });
    }
    io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
  });

  // Dipanggil dari layar "Game Selesai" waktu pemain pilih "Kembali ke Room"
  // (bukan keluar total ke Home) supaya bisa lanjut main lagi bareng2.
  socket.on('room:backToWaiting', (roomId, cb) => {
    const room = rooms.get(roomId);
    if (!room || !room.members.includes(username)) return cb && cb({ ok: false, error: 'Room tidak ditemukan' });
    if (room.status === 'finished') {
      room.status = 'waiting';
      room.game = null;
      broadcastToRoom(room, 'room:update', { ...roomSummary(room), members: room.members });
      io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
    }
    cb && cb({ ok: true, room: { ...roomSummary(room), members: room.members } });
  });

  socket.on('room:start', (roomId, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb && cb({ ok: false, error: 'Room tidak ditemukan' });
    if (room.hostUsername !== username) return cb && cb({ ok: false, error: 'Hanya host yang bisa mulai game' });
    if (room.members.length < 2) return cb && cb({ ok: false, error: 'Minimal 2 pemain' });
    room.game = new UnoGame(roomId, room.members);
    room.status = 'playing';
    scheduleTurnTimer(room);
    broadcastGameState(room);
    io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
    cb && cb({ ok: true });
  });

  socket.on('game:action', ({ roomId, action }, cb) => {
    const room = rooms.get(roomId);
    if (!room || !room.game) return cb && cb({ ok: false, error: 'Game belum dimulai' });
    const result = room.game.applyAction(username, action);
    if (!result.ok) return cb && cb(result);
    if (result.gameOver) {
      broadcastGameState(room);
      finishGame(room, result.winner);
    } else if (action.type === 'callUno') {
      // callUno gak mengganti giliran -> jangan reset timer siapa pun,
      // cukup broadcast biar semua lihat lambang 🗣️ di panel pemain itu.
      broadcastGameState(room);
    } else {
      scheduleTurnTimer(room); // giliran baru = timer baru, di-set SEBELUM broadcast
      broadcastGameState(room);
    }
    cb && cb({ ok: true });
  });

  // ---- Profile ----
  socket.on('user:profile', (targetUsername, cb) => {
    const profile = getProfile(targetUsername || username);
    cb && cb(profile ? { ok: true, profile } : { ok: false, error: 'User tidak ditemukan' });
  });

  socket.on('user:profile:update', ({ bio, avatar }, cb) => {
    try {
      const profile = updateProfile(username, { bio, avatar });
      cb && cb(profile ? { ok: true, profile } : { ok: false, error: 'Gagal menyimpan' });
    } catch (err) {
      cb && cb({ ok: false, error: err.message || 'Gagal menyimpan' });
    }
  });

  socket.on('chat:public:delete', (messageId) => {
    const idx = publicMessages.findIndex((m) => m.id === messageId && m.from === username);
    if (idx !== -1) {
      publicMessages.splice(idx, 1);
      io.emit('chat:public:deleted', { messageId });
    }
  });

  socket.on('disconnect', () => {
    // JANGAN langsung bersihin room. Tunggu dulu beberapa detik siapa tau
    // ini cuma pindah halaman (profile.html/dev-info.html) yang bikin socket
    // lama putus sebentar sebelum socket baru nyambung lagi.
    const timeout = setTimeout(() => {
      pendingDisconnects.delete(username);
      // Kalau username ini udah punya socket lain yang aktif (reconnect
      // berhasil), berarti bukan keluar beneran -> jangan bersihin apa-apa.
      if (onlineUsers.get(username) !== socket.id) return;

      onlineUsers.delete(username);
      io.emit('presence', { online: Array.from(onlineUsers.keys()) });

      // Bersihkan room kalau host yang bener-bener keluar/putus lama
      for (const [roomId, room] of rooms) {
        if (!room.members.includes(username)) continue;
        if (room.hostUsername === username) {
          clearRoomTimer(room);
          const otherMembers = room.members.filter((m) => m !== username);
          rooms.delete(roomId);
          for (const member of otherMembers) {
            const sid = onlineUsers.get(member);
            if (sid) io.to(sid).emit('room:closed', { roomId, reason: 'host_left' });
          }
        } else if (room.status === 'waiting') {
          room.members = room.members.filter((m) => m !== username);
          if (room.members.length === 0) rooms.delete(roomId);
          else broadcastToRoom(room, 'room:update', { ...roomSummary(room), members: room.members });
        }
        // kalau game sedang berjalan dan member (bukan host) disconnect, biarkan
        // slotnya tetap ada supaya bisa reconnect; timer giliran akan otomatis
        // melewati gilirannya kalau dia tidak merespon.
      }
      io.emit('room:list', Array.from(rooms.values()).map(roomSummary));
    }, DISCONNECT_GRACE_MS);
    pendingDisconnects.set(username, timeout);
  });
});

server.listen(PORT, () => {
  console.log(`UNO Game App jalan di http://localhost:${PORT}`);
});
