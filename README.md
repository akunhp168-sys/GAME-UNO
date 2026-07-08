# UNO GAME App

Aplikasi web UNO real-time: login/register, home, chat (grup publik + pribadi), dan room game UNO multiplayer.

## Cara Menjalankan

1. Extract zip ini, lalu masuk ke foldernya:
   ```bash
   cd uno-app
   ```

2. Install dependency (butuh Node.js 18+):
   ```bash
   npm install
   ```

3. Jalankan server:
   ```bash
   npm start
   ```
   Server otomatis jalan di port **10001**. Kalau mau ganti port:
   ```bash
   PORT=8080 npm start
   ```

4. Buka di browser:
   ```
   http://localhost:10001
   ```

5. Untuk main bareng orang lain di jaringan yang sama, buka `http://<IP-server-kamu>:10001` di device lain.

## Fitur

- **Login & Register** — username + password, disimpan aman (hashed) di `data/users.json`.
- **Home** — sapaan, banner iklan placeholder, statistik pemain online & room terbuka.
- **Chat** — grup publik (semua user otomatis gabung) + chat pribadi (cari username, hapus/salin/teruskan pesan).
- **Game** — buat room (jumlah pemain 2-4, password opsional), cari room lewat ID, gabung room, lalu main UNO asli (kartu angka, skip, reverse, draw two, wild, wild draw four, aturan UNO standar).

## Struktur Folder

```
uno-app/
├── server.js          # Backend Express + Socket.io
├── unoLogic.js         # Logika aturan kartu UNO (server-authoritative)
├── package.json
├── data/
│   └── users.json      # Data akun (dibuat otomatis)
└── public/
    ├── index.html       # Halaman login/register
    ├── app.html          # Halaman utama (home/chat/game)
    ├── css/style.css
    └── js/
        ├── auth.js
        └── app.js
```

## Catatan

- Ini bukan game judi — tidak ada deposit, withdraw, atau nilai uang apa pun. Murni untuk seru-seruan.
- Data user & pesan chat disimpan di memori server (kecuali akun, yang disimpan di `data/users.json`), jadi chat & room akan reset kalau server di-restart.
- Untuk produksi (banyak user beneran), sebaiknya ganti penyimpanan chat/room ke database (misalnya MongoDB/PostgreSQL) dan tambah HTTPS.
