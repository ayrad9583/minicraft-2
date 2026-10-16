// Petit serveur WebSocket + Express pour servir le jeu et gérer les salons
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
// servir les fichiers statiques du dépôt (index.html à la racine)
app.use(express.static('.'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map(); // roomId => Set of ws clients
const clientMeta = new Map(); // ws => {room, playerId, name}

function broadcastToRoom(roomId, message, exceptWs = null) {
  const s = rooms.get(roomId);
  if (!s) return;
  const data = JSON.stringify(message);
  for (const c of s) {
    if (c.readyState === WebSocket.OPEN && c !== exceptWs) c.send(data);
  }
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function listRooms() {
  const res = [];
  for (const [id, set] of rooms.entries()) {
    res.push({ id, players: set.size });
  }
  return res;
}

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  clientMeta.set(ws, { playerId, room: null, name: null });
  // send initial room list
  send(ws, { type: 'rooms', rooms: listRooms() });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const meta = clientMeta.get(ws);

    switch (msg.type) {
      case 'create_room': {
        const roomId = msg.roomId || uuidv4().slice(0, 8);
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        send(ws, { type: 'room_created', roomId });
        // broadcast updated room list
        for (const c of wss.clients) send(c, { type: 'rooms', rooms: listRooms() });
        break;
      }
      case 'join_room': {
        const roomId = msg.roomId;
        if (!rooms.has(roomId)) { send(ws, { type: 'error', message: 'Room not found' }); return; }
        // leave old room
        if (meta.room && rooms.has(meta.room)) {
          rooms.get(meta.room).delete(ws);
          broadcastToRoom(meta.room, { type: 'player_left', playerId: meta.playerId });
        }
        rooms.get(roomId).add(ws);
        meta.room = roomId;
        meta.name = msg.name || ('P' + meta.playerId.slice(0,4));
        send(ws, { type: 'joined', roomId, playerId: meta.playerId, name: meta.name });
        // notify others
        broadcastToRoom(roomId, { type: 'player_joined', playerId: meta.playerId, name: meta.name }, ws);
        // send updated room list to all
        for (const c of wss.clients) send(c, { type: 'rooms', rooms: listRooms() });
        break;
      }
      case 'leave_room': {
        const r = meta.room;
        if (r && rooms.has(r)) {
          rooms.get(r).delete(ws);
          broadcastToRoom(r, { type: 'player_left', playerId: meta.playerId });
          meta.room = null;
        }
        break;
      }
      case 'room_message': {
        // generic relay inside a room (chat, pos, actions...)
        if (!meta.room) { send(ws, { type: 'error', message: 'Not in a room' }); return; }
        const payload = msg.payload || {};
        payload.playerId = meta.playerId;
        payload.name = meta.name;
        broadcastToRoom(meta.room, { type: 'room_message', subtype: msg.subtype, payload }, ws);
        break;
      }
      case 'list_rooms': {
        send(ws, { type: 'rooms', rooms: listRooms() });
        break;
      }
      default:
        send(ws, { type: 'error', message: 'Unknown message type' });
    }
  });

  ws.on('close', () => {
    const meta = clientMeta.get(ws) || {};
    if (meta.room && rooms.has(meta.room)) {
      rooms.get(meta.room).delete(ws);
      broadcastToRoom(meta.room, { type: 'player_left', playerId: meta.playerId });
    }
    clientMeta.delete(ws);
    // update room list
    for (const c of wss.clients) send(c, { type: 'rooms', rooms: listRooms() });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on', PORT));
