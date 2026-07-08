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
  const target = Math.min(300, Math.max(60, Math.round(worst / 2 + 75)));
  if (force || Math.abs(target - room.mode.targetMs) > 10) {
    room.mode.targetMs = target;
    return true;
  }
  return false;
}

function roomUsers(code) {
  const r = rooms[code];
  if (!r) return [];
  return [...r.users.entries()].map(([id, u]) => ({ id, name: u.name, isHost: id === r.hostId }));
}

io.on('connection', (socket) => {
  let roomCode = null;
  const ip = getIp(socket);
  logAccess(`conexión entrante desde ${ip} (socket ${socket.id})`);

  // Sincronización de reloj estilo NTP: el cliente hace varios pings
  socket.on('clock', (clientTime, cb) => cb({ client: clientTime, server: Date.now() }));

  // Lista de salas públicas para la pantalla de inicio
  socket.on('list-rooms', (cb) => { if (typeof cb === 'function') cb(publicRooms()); });

  socket.on('join', ({ code, name, isPublic }, cb) => {
    code = String(code || '').trim().toUpperCase().slice(0, 8);
    name = String(name || 'Anónimo').trim().slice(0, 24);
    if (!code) return cb({ error: 'Código de sala inválido' });

    if (!rooms[code]) rooms[code] = { hostId: socket.id, users: new Map(), playback: null, mode: { name: 'fast', targetMs: 150 }, pings: {}, lastPingCast: 0, freeControl: false, isPublic: !!isPublic };
    const room = rooms[code];
    if (room.users.size >= 12) {
      logAccess(`RECHAZADO ${ip} "${name}" — sala ${code} llena`);
      return cb({ error: 'Sala llena (máx 12)' });
    }
    logAccess(`${ip} entró a sala ${code} (${room.isPublic ? 'pública' : 'privada'}) como "${name}"`);

    roomCode = code;
    room.users.set(socket.id, { name });
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
      freeControl: room.freeControl
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
      targetMs: Math.min(400, Math.max(60, parseInt(mode.targetMs) || 150))
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

  socket.on('chat', (msg) => {
    if (!roomCode) return;
    const user = rooms[roomCode]?.users.get(socket.id);
    if (!user) return;
    io.to(roomCode).emit('chat', { name: user.name, msg: String(msg).slice(0, 300) });
  });

  socket.on('disconnect', () => {
    logAccess(`desconexión de ${ip} (socket ${socket.id})${roomCode ? ' — sala ' + roomCode : ''}`);
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

