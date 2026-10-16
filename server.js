const express = require('express');
const http = require('http');
const { createHash } = require('crypto');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

// Serve repository files (allow serving index.html from repo root)
app.use(express.static(path.join(__dirname)));

// In-memory lobby store
const lobbies = new Map(); // id -> { id, name, hostId, passwordHash|null, maxPlayers, public, players: Map(socketId->meta) }

function hashPassword(pw) {
  return pw ? createHash('sha256').update(pw).digest('hex') : null;
}
function makeLobbyId() { return Math.random().toString(36).slice(2, 9); }
function getPublicLobbies() {
  const res = [];
  for (const [id, l] of lobbies) {
    if (l.public) res.push({ id: l.id, name: l.name, players: l.players.size, maxPlayers: l.maxPlayers });
  }
  return res;
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('lobby_list', () => socket.emit('lobby_list', getPublicLobbies()));

  socket.on('create_lobby', (opts = {}, cb) => {
    try {
      const name = (opts.name || 'Salon').slice(0, 64);
      const maxPlayers = Math.max(1, Math.min(32, Number(opts.maxPlayers) || 8));
      const isPublic = !!opts.isPublic;
      const passwordHash = hashPassword(opts.password);
      const id = makeLobbyId();
      const lobby = { id, name, hostId: socket.id, passwordHash, maxPlayers, public: isPublic, players: new Map() };
      lobby.players.set(socket.id, { id: socket.id, name: (opts.hostName || 'Host').slice(0, 32), ready: false });
      lobbies.set(id, lobby);
      socket.join(id);
      socket.lobbyId = id;
      socket.emit('lobby_update', { lobby: { id: lobby.id, name: lobby.name, players: Array.from(lobby.players.values()), maxPlayers: lobby.maxPlayers, public: lobby.public } });
      io.emit('lobby_list', getPublicLobbies());
      cb && cb({ ok: true, id });
    } catch (e) { console.error(e); cb && cb({ ok: false, reason: 'Erreur serveur' }); }
  });

  socket.on('join_lobby', (data = {}, cb) => {
    const id = data.id;
    const lobby = lobbies.get(id);
    if (!lobby) return cb && cb({ ok: false, reason: 'Salon introuvable' });
    if (lobby.players.size >= lobby.maxPlayers) return cb && cb({ ok: false, reason: 'Salon plein' });
    if (lobby.passwordHash && lobby.passwordHash !== hashPassword(data.password || '')) return cb && cb({ ok: false, reason: 'Mot de passe incorrect' });
    const name = (data.name || 'Player').slice(0, 32);
    lobby.players.set(socket.id, { id: socket.id, name, ready: false });
    socket.join(id); socket.lobbyId = id;
    const meta = { id: lobby.id, name: lobby.name, players: Array.from(lobby.players.values()), maxPlayers: lobby.maxPlayers, public: lobby.public };
    io.to(id).emit('lobby_update', { lobby: meta });
    io.emit('lobby_list', getPublicLobbies());
    cb && cb({ ok: true, lobby: meta });
  });

  socket.on('leave_lobby', (cb) => {
    const id = socket.lobbyId;
    if (!id) return cb && cb({ ok: false });
    const lobby = lobbies.get(id);
    if (lobby) {
      lobby.players.delete(socket.id);
      socket.leave(id);
      delete socket.lobbyId;
      if (lobby.players.size === 0) lobbies.delete(id);
      else {
        if (lobby.hostId === socket.id) lobby.hostId = lobby.players.keys().next().value;
        io.to(id).emit('lobby_update', { lobby: { id: lobby.id, name: lobby.name, players: Array.from(lobby.players.values()), maxPlayers: lobby.maxPlayers, public: lobby.public } });
      }
      io.emit('lobby_list', getPublicLobbies());
    }
    cb && cb({ ok: true });
  });

  socket.on('lobby_chat', ({ text } = {}) => {
    const id = socket.lobbyId; if (!id) return;
    const sender = socket.id;
    io.to(id).emit('lobby_chat', { from: sender, text: String(text || '').slice(0, 400) });
  });

  socket.on('player_state', (state) => {
    const id = socket.lobbyId; if (!id) return;
    // broadcast to other clients in the same lobby
    socket.to(id).volatile.emit('player_state', { id: socket.id, state });
  });

  socket.on('player_action', (act) => {
    const id = socket.lobbyId; if (!id) return;
    // Basic relay: in a full server authoritative model, validate and apply world updates here
    io.to(id).emit('player_action', { by: socket.id, action: act });
  });

  socket.on('disconnect', () => {
    const id = socket.lobbyId;
    if (id) {
      const lobby = lobbies.get(id);
      if (lobby) {
        lobby.players.delete(socket.id);
        if (lobby.players.size === 0) lobbies.delete(id);
        else {
          if (lobby.hostId === socket.id) lobby.hostId = lobby.players.keys().next().value;
          io.to(id).emit('lobby_update', { lobby: { id: lobby.id, name: lobby.name, players: Array.from(lobby.players.values()), maxPlayers: lobby.maxPlayers, public: lobby.public } });
        }
        io.emit('lobby_list', getPublicLobbies());
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Multiplayer server listening on', PORT));
