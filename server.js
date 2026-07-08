// ─────────────────────────────────────────────────────────────
// Karaoke Sin Delay — servidor de señalización y sincronización
// El audio de las voces NUNCA pasa por aquí: viaja P2P (WebRTC).
// Este servidor solo: conecta peers, sincroniza relojes,
// coordina la reproducción de la pista y sirve los MP3 subidos.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

// ── Archivos estáticos y subida de pistas ──
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/tracks', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, Date.now() + '_' + safe);
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    cb(null, /audio\/(mpeg|mp3|wav|ogg|x-m4a|mp4|aac)/.test(file.mimetype));
  }
});

app.post('/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo inválido (solo audio, máx 30MB)' });
  res.json({ url: '/tracks/' + req.file.filename, name: req.file.originalname });
});

// ── Estado de las salas ──
// rooms[code] = { hostId, users: Map<socketId, {name}>, playback: {...} }
const rooms = {};

// ── Base de datos simple en archivo (usuarios registrados + favoritas) ──
// Sin dependencias externas: JSON en disco con guardado diferido.
// Contraseñas NUNCA en texto plano: hash scrypt con salt por usuario.
const DB_FILE = path.join(__dirname, 'db.json');
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) {}
if (!db.users) db.users = {};
let dbTimer = null;
function saveDb() {
  clearTimeout(dbTimer);
  dbTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), () => {}), 300);
}
function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 32).toString('hex');
}

// Fuente de canción validada (evita que un cliente meta basura)
function sanitizeSource(s) {
  if (!s || (s.type !== 'mp3' && s.type !== 'yt')) return null;
  const out = { type: s.type, name: String(s.name || 'Canción').slice(0, 80) };
  if (s.type === 'mp3') {
    if (typeof s.url !== 'string' || !s.url.startsWith('/tracks/')) return null;
    out.url = s.url.slice(0, 200);
  } else {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(s.videoId || ''))) return null;
    out.videoId = s.videoId;
  }
  return out;
}

// ── Registro de conexiones (SOLO backend: consola + access.log) ──
// Los usuarios nunca ven las IPs; esto es para que el administrador
// pueda revisar quién intenta conectarse.
const LOG_FILE = path.join(__dirname, 'access.log');
function logAccess(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}
function getIp(socket) {
  // detrás de un túnel/proxy (cloudflared, ngrok, Caddy) la IP real viene en x-forwarded-for
  const fwd = socket.handshake.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : '') || socket.handshake.address;
}

// Salas públicas visibles en la pantalla de inicio (las privadas no aparecen)
function publicRooms() {
  return Object.entries(rooms)
    .filter(([, r]) => r.isPublic)
    .map(([code, r]) => ({
      code,
      users: r.users.size,
      track: r.playback?.source?.name || null,
      playing: r.playback?.state === 'playing'
    }));
}

// Modo auto: retardo objetivo = peor ping de la sala / 2 (ida) + ~75ms de
// margen (códec + jitter). Devuelve true si el objetivo cambió lo suficiente.
function recomputeAutoTarget(room, force) {
  const worst = Math.max(0, ...Object.values(room.pings));
  const target = Math.min(1000, Math.max(60, Math.round(worst / 2 + 75)));
  if (force || Math.abs(target - room.mode.targetMs) > 10) {
    room.mode.targetMs = target;
    return true;
  }
  return false;
}

// ── Presencia global: qué usuarios registrados están conectados ──
const onlineUsers = new Map(); // userKey -> Set<socket.id>

function friendsView(key) {
  const u = db.users[key];
  if (!u) return [];
  return (u.friends = u.friends || []).map(fk => {
    const f = db.users[fk];
    const socks = onlineUsers.get(fk);
    let room = null;
    if (socks && socks.size) {
      // busca en qué sala está; las privadas no se revelan
      outer: for (const [code, r] of Object.entries(rooms)) {
        for (const sid of r.users.keys()) {
          if (socks.has(sid)) { room = r.isPublic ? code : '(sala privada)'; break outer; }
        }
      }
    }
    return { name: f ? f.name : fk, online: !!(socks && socks.size), room };
  });
}

// Propuestas visibles (sin exponer quién votó qué, solo conteos)
function publicProposals(room) {
  return Object.entries(room.proposals || {}).map(([id, p]) => ({
    id,
    source: p.source,
    by: p.by,
    count: p.songs ? p.songs.length : undefined,
    yes: Object.values(p.votes).filter(v => v).length,
    no: Object.values(p.votes).filter(v => !v).length
  }));
}

function roomUsers(code) {
  const r = rooms[code];
  if (!r) return [];
  return [...r.users.entries()].map(([id, u]) => ({ id, name: u.name, profile: u.profile, isHost: id === r.hostId }));
}

io.on('connection', (socket) => {
  let roomCode = null;
  const ip = getIp(socket);
  logAccess(`conexión entrante desde ${ip} (socket ${socket.id})`);

  // Sincronización de reloj estilo NTP: el cliente hace varios pings
  socket.on('clock', (clientTime, cb) => cb({ client: clientTime, server: Date.now() }));

  // Lista de salas públicas para la pantalla de inicio
  socket.on('list-rooms', (cb) => { if (typeof cb === 'function') cb(publicRooms()); });

  socket.on('join', ({ code, name, isPublic, pass }, cb) => {
    code = String(code || '').trim().toUpperCase().slice(0, 8);
    name = String(name || 'Anónimo').trim().slice(0, 24);
    if (!code) return cb({ error: 'Código de sala inválido' });

    // ── Cuentas: nombre registrado exige su contraseña; contraseña nueva crea cuenta ──
    const userKey = name.toLowerCase();
    const acc = db.users[userKey];
    let registered = false, favorites = [];
    if (acc) {
      if (!pass || hashPass(pass, acc.salt) !== acc.hash) {
        logAccess(`RECHAZADO ${ip} — nombre "${name}" registrado, contraseña ausente o incorrecta`);
        return cb({ error: `El nombre "${name}" está registrado. Escribe su contraseña para usarlo (o elige otro nombre).` });
      }
      registered = true;
      favorites = acc.favorites || [];
      logAccess(`${ip} inició sesión como usuario registrado "${name}"`);
    } else if (pass) {
      const salt = crypto.randomBytes(16).toString('hex');
      db.users[userKey] = { name, salt, hash: hashPass(pass, salt), favorites: [], createdAt: new Date().toISOString() };
      saveDb();
      registered = true;
      logAccess(`${ip} registró la cuenta nueva "${name}"`);
    }
    socket.data.userKey = registered ? userKey : null;
    const profile = (registered && db.users[userKey].profile) || { emoji: '🎤', color: '#e94560' };
    const playlists = registered ? (db.users[userKey].playlists || []) : [];
    if (registered) {
      if (!onlineUsers.has(userKey)) onlineUsers.set(userKey, new Set());
      onlineUsers.get(userKey).add(socket.id);
    }

    if (!rooms[code]) rooms[code] = { hostId: socket.id, users: new Map(), playback: null, mode: { name: 'fast', targetMs: 150 }, pings: {}, lastPingCast: 0, freeControl: false, isPublic: !!isPublic, playlist: [], proposals: {}, propSeq: 0 };
    const room = rooms[code];
    if (room.users.size >= 12) {
      logAccess(`RECHAZADO ${ip} "${name}" — sala ${code} llena`);
      return cb({ error: 'Sala llena (máx 12)' });
    }
    logAccess(`${ip} entró a sala ${code} (${room.isPublic ? 'pública' : 'privada'}) como "${name}"`);

    roomCode = code;
    room.users.set(socket.id, { name, profile });
    socket.join(code);

    // Los peers existentes reciben al nuevo y le inician la oferta WebRTC
    socket.to(code).emit('peer-joined', { id: socket.id, name });
    cb({
      ok: true,
      selfId: socket.id,
      isHost: room.hostId === socket.id,
      users: roomUsers(code),
      playback: room.playback, // para incorporarse a una canción ya en curso
      mode: room.mode,
      freeControl: room.freeControl,
      registered,
      favorites,
      profile,
      playlists,
      friends: registered ? friendsView(userKey) : [],
      playlist: room.playlist,
      proposals: publicProposals(room)
    });
    io.to(code).emit('users', roomUsers(code));
  });

  // ── Señalización WebRTC (relay de ofertas/respuestas/candidatos) ──
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // ── Control de reproducción (solo el host) ──
  function isHost() { return roomCode && rooms[roomCode] && rooms[roomCode].hostId === socket.id; }
  // Control de música: el host siempre; los invitados solo si el host lo permite
  function canControl() { return isHost() || (roomCode && rooms[roomCode]?.freeControl); }

  // Test de palmas: metrónomo sincronizado para calibrar latencias reales.
  // Cada cliente mide localmente cuándo le llegan las palmadas de los demás.
  socket.on('calib-start', () => {
    if (!canControl()) return;
    io.to(roomCode).emit('calib', { startAt: Date.now() + 2000, interval: 600, count: 12, countIn: 4 });
  });

  // El host puede transferir su rol a otro participante
  socket.on('transfer-host', ({ to }) => {
    if (!isHost()) return;
    const room = rooms[roomCode];
    if (!room.users.has(to)) return;
    room.hostId = to;
    logAccess(`host de sala ${roomCode} transferido a socket ${to}`);
    io.to(roomCode).emit('new-host', { id: to });
    io.to(roomCode).emit('users', roomUsers(roomCode));
  });

  // El host decide si los invitados pueden controlar la reproducción
  socket.on('set-free-control', (enabled) => {
    if (!isHost()) return;
    rooms[roomCode].freeControl = !!enabled;
    io.to(roomCode).emit('free-control', rooms[roomCode].freeControl);
  });

  // source: {type:'mp3', url, name} | {type:'yt', videoId, name}
  socket.on('load-track', (source) => {
    if (!canControl()) return;
    rooms[roomCode].playback = { source, state: 'loaded', startAt: null, offset: 0 };
    io.to(roomCode).emit('load-track', source);
  });

  socket.on('play', ({ offset }) => {
    if (!canControl()) return;
    const pb = rooms[roomCode].playback;
    if (!pb) return;
    // Arranca 1.2s en el futuro para que a todos les dé tiempo de programarlo
    pb.state = 'playing';
    pb.offset = offset || 0;
    pb.startAt = Date.now() + 1200;
    io.to(roomCode).emit('play', { startAt: pb.startAt, offset: pb.offset });
  });

  socket.on('pause', ({ offset }) => {
    if (!canControl()) return;
    const pb = rooms[roomCode].playback;
    if (!pb) return;
    pb.state = 'paused';
    pb.offset = offset || 0;
    pb.startAt = null;
    io.to(roomCode).emit('pause', { offset: pb.offset });
  });

  socket.on('stop', () => {
    if (!canControl()) return;
    const pb = rooms[roomCode].playback;
    if (!pb) return;
    pb.state = 'loaded'; pb.offset = 0; pb.startAt = null;
    io.to(roomCode).emit('stop');
  });

  // ── Modo de voz de la sala (solo el host lo cambia) ──
  // fast    = jitter buffer en 0, delay mínimo pero distinto con cada persona
  // aligned = todas las voces llegan con el MISMO retardo objetivo (mejor para coros)
  socket.on('set-mode', (mode) => {
    if (!isHost()) return;
    const name = ['fast', 'aligned', 'auto'].includes(mode.name) ? mode.name : 'fast';
    rooms[roomCode].mode = {
      name,
      targetMs: Math.min(1000, Math.max(60, parseInt(mode.targetMs) || 150))
    };
    if (name === 'auto') recomputeAutoTarget(rooms[roomCode], true);
    io.to(roomCode).emit('mode', rooms[roomCode].mode);
  });

  // ── Reporte de pings P2P: cada cliente envía sus RTT medidos ──
  // El servidor guarda el peor enlace de cada usuario y lo comparte con la sala.
  socket.on('ping-report', (rtts) => {
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    let max = 0;
    for (const v of Object.values(rtts || {})) {
      const n = Number(v);
      if (Number.isFinite(n) && n > max && n < 5000) max = n;
    }
    room.pings[socket.id] = Math.round(max);
    const now = Date.now();
    if (now - room.lastPingCast > 1500) {
      room.lastPingCast = now;
      io.to(roomCode).emit('pings', room.pings);
      if (room.mode.name === 'auto' && recomputeAutoTarget(room, false)) {
        io.to(roomCode).emit('mode', room.mode);
      }
    }
  });

  // ── Favoritas (solo usuarios registrados) ──
  socket.on('fav-add', (source) => {
    const key = socket.data.userKey;
    const src = sanitizeSource(source);
    if (!key || !db.users[key] || !src) return;
    const favs = db.users[key].favorites;
    const sig = src.videoId || src.url;
    if (!favs.some(f => (f.videoId || f.url) === sig)) {
      favs.push(src);
      if (favs.length > 100) favs.shift();
      saveDb();
    }
    socket.emit('favorites', favs);
  });
  socket.on('fav-remove', (idx) => {
    const key = socket.data.userKey;
    if (!key || !db.users[key]) return;
    const favs = db.users[key].favorites;
    idx = parseInt(idx);
    if (idx >= 0 && idx < favs.length) { favs.splice(idx, 1); saveDb(); }
    socket.emit('favorites', favs);
  });

  // ── Perfil (emoji + color; persiste si está registrado) ──
  socket.on('profile-update', (p) => {
    if (!roomCode || !rooms[roomCode]) return;
    const prof = {
      emoji: String(p?.emoji || '🎤').slice(0, 4),
      color: /^#[0-9a-fA-F]{6}$/.test(p?.color) ? p.color : '#e94560'
    };
    const u = rooms[roomCode].users.get(socket.id);
    if (u) u.profile = prof;
    if (socket.data.userKey && db.users[socket.data.userKey]) {
      db.users[socket.data.userKey].profile = prof;
      saveDb();
    }
    io.to(roomCode).emit('users', roomUsers(roomCode));
  });

  // ── Playlists personales (solo registrados) ──
  const myPls = () => {
    const k = socket.data.userKey;
    if (!k || !db.users[k]) return null;
    return (db.users[k].playlists = db.users[k].playlists || []);
  };
  socket.on('pl-create', (name) => {
    const pls = myPls();
    if (!pls || pls.length >= 20) return;
    pls.push({ id: 'pl' + Date.now() + Math.floor(Math.random() * 1e4), name: String(name || 'Playlist').slice(0, 40), songs: [] });
    saveDb(); socket.emit('playlists', pls);
  });
  socket.on('pl-delete', (id) => {
    const pls = myPls(); if (!pls) return;
    const i = pls.findIndex(p => p.id === id);
    if (i >= 0) { pls.splice(i, 1); saveDb(); }
    socket.emit('playlists', pls);
  });
  socket.on('pl-add-song', ({ id, source }) => {
    const pls = myPls(); const src = sanitizeSource(source);
    if (!pls || !src) return;
    const pl = pls.find(p => p.id === id);
    if (!pl || pl.songs.length >= 50) return;
    pl.songs.push(src); saveDb(); socket.emit('playlists', pls);
  });
  socket.on('pl-remove-song', ({ id, idx }) => {
    const pls = myPls(); if (!pls) return;
    const pl = pls.find(p => p.id === id); if (!pl) return;
    idx = parseInt(idx);
    if (idx >= 0 && idx < pl.songs.length) { pl.songs.splice(idx, 1); saveDb(); }
    socket.emit('playlists', pls);
  });
  // Compartir playlist a la sala: entra como UNA propuesta; si la mayoría
  // vota sí, TODAS sus canciones pasan a la cola
  socket.on('pl-share', (id) => {
    if (!roomCode || !rooms[roomCode]) return;
    const pls = myPls(); if (!pls) return;
    const pl = pls.find(p => p.id === id);
    if (!pl || !pl.songs.length) return;
    const room = rooms[roomCode];
    if (Object.keys(room.proposals).length >= 20) return;
    const pid = 'p' + (++room.propSeq);
    const by = room.users.get(socket.id)?.name || '?';
    room.proposals[pid] = { source: { type: 'playlist', name: pl.name }, songs: pl.songs.slice(0, 50), by, votes: { [socket.id]: true } };
    evaluateProposal(pid);
    castProposals();
  });

  // ── Amigos (solo registrados): agregar por nombre, ver quién está en línea ──
  socket.on('friend-add', (name, cb) => {
    const k = socket.data.userKey;
    if (!k || !db.users[k]) return cb?.({ error: 'Necesitas una cuenta (entra con contraseña)' });
    const fk = String(name || '').trim().toLowerCase();
    if (!fk || fk === k) return cb?.({ error: 'Nombre inválido' });
    if (!db.users[fk]) return cb?.({ error: 'No existe un usuario registrado con ese nombre' });
    const fr = (db.users[k].friends = db.users[k].friends || []);
    if (!fr.includes(fk) && fr.length < 100) { fr.push(fk); saveDb(); }
    cb?.({ ok: true });
    socket.emit('friends', friendsView(k));
  });
  socket.on('friend-remove', (name) => {
    const k = socket.data.userKey;
    if (!k || !db.users[k]) return;
    const fk = String(name || '').trim().toLowerCase();
    const fr = db.users[k].friends || [];
    const i = fr.indexOf(fk);
    if (i >= 0) { fr.splice(i, 1); saveDb(); }
    socket.emit('friends', friendsView(k));
  });
  socket.on('friends-refresh', () => {
    const k = socket.data.userKey;
    if (k && db.users[k]) socket.emit('friends', friendsView(k));
  });

  // ── Playlist con votación ──
  const castPlaylist = () => io.to(roomCode).emit('playlist', rooms[roomCode].playlist);
  const castProposals = () => io.to(roomCode).emit('proposals', publicProposals(rooms[roomCode]));

  // Mayoría simple: sí > mitad de los presentes → a la cola; no > mitad → se descarta
  function evaluateProposal(id) {
    const room = rooms[roomCode];
    const p = room.proposals[id];
    if (!p) return;
    const votes = Object.values(p.votes);
    const yes = votes.filter(v => v).length;
    const no = votes.length - yes;
    const half = room.users.size / 2;
    if (yes > half) {
      if (p.songs) {
        // playlist aprobada: todas sus canciones entran a la cola
        for (const s of p.songs) room.playlist.push({ id: 'q' + (++room.propSeq), source: s, by: p.by });
      } else {
        room.playlist.push({ id, source: p.source, by: p.by });
      }
      while (room.playlist.length > 50) room.playlist.shift();
      delete room.proposals[id];
      castPlaylist();
    } else if (no > half) {
      delete room.proposals[id];
    }
  }

  socket.on('propose-song', (source) => {
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    const src = sanitizeSource(source);
    if (!src || Object.keys(room.proposals).length >= 20) return;
    const id = 'p' + (++room.propSeq);
    const by = room.users.get(socket.id)?.name || '?';
    room.proposals[id] = { source: src, by, votes: { [socket.id]: true } }; // el proponente vota sí
    evaluateProposal(id);
    castProposals();
  });

  socket.on('vote', ({ id, yes }) => {
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    if (!room.proposals[id]) return;
    room.proposals[id].votes[socket.id] = !!yes;
    evaluateProposal(id);
    castProposals();
  });

  // El host reordena o quita; reproducir desde la cola lo hace quien tenga control
  socket.on('playlist-move', ({ id, dir }) => {
    if (!isHost()) return;
    const pl = rooms[roomCode].playlist;
    const i = pl.findIndex(it => it.id === id);
    const j = i + (dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= pl.length) return;
    [pl[i], pl[j]] = [pl[j], pl[i]];
    castPlaylist();
  });
  socket.on('playlist-remove', (id) => {
    if (!isHost()) return;
    const pl = rooms[roomCode].playlist;
    const i = pl.findIndex(it => it.id === id);
    if (i >= 0) { pl.splice(i, 1); castPlaylist(); }
  });
  socket.on('playlist-play', (id) => {
    if (!canControl()) return;
    const room = rooms[roomCode];
    const i = room.playlist.findIndex(it => it.id === id);
    if (i < 0) return;
    const [it] = room.playlist.splice(i, 1);
    room.playback = { source: it.source, state: 'loaded', startAt: null, offset: 0 };
    io.to(roomCode).emit('load-track', it.source);
    castPlaylist();
  });

  socket.on('chat', (msg) => {
    if (!roomCode) return;
    const user = rooms[roomCode]?.users.get(socket.id);
    if (!user) return;
    io.to(roomCode).emit('chat', { name: user.name, msg: String(msg).slice(0, 300) });
  });

  socket.on('disconnect', () => {
    logAccess(`desconexión de ${ip} (socket ${socket.id})${roomCode ? ' — sala ' + roomCode : ''}`);
    const uk = socket.data.userKey;
    if (uk && onlineUsers.has(uk)) {
      onlineUsers.get(uk).delete(socket.id);
      if (!onlineUsers.get(uk).size) onlineUsers.delete(uk);
    }
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    room.users.delete(socket.id);
    delete room.pings[socket.id];
    socket.to(roomCode).emit('peer-left', { id: socket.id });
    if (room.users.size === 0) {
      delete rooms[roomCode];
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.users.keys().next().value; // el más antiguo hereda el host
        io.to(roomCode).emit('new-host', { id: room.hostId });
      }
      io.to(roomCode).emit('users', roomUsers(roomCode));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Karaoke Sin Delay escuchando en http://localhost:${PORT}`);
  console.log('Recuerda: el micrófono solo funciona con HTTPS (o en localhost).');
});

