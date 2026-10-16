// network.js — minimal WebSocket client for lobbies
(function () {
  const WS_URL = (location.hostname === 'localhost' ? 'ws://localhost:3000' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  const ws = new WebSocket(WS_URL);

  let currentRoom = null;
  const events = new EventTarget();

  ws.addEventListener('open', () => console.log('MP: WS open'));
  ws.addEventListener('message', (ev) => {
    let msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'rooms':
        events.dispatchEvent(new CustomEvent('rooms', { detail: msg.rooms }));
        break;
      case 'joined':
        currentRoom = msg.roomId;
        events.dispatchEvent(new CustomEvent('joined', { detail: msg }));
        break;
      case 'player_joined':
      case 'player_left':
      case 'room_message':
        events.dispatchEvent(new CustomEvent('room_event', { detail: msg }));
        break;
      case 'room_created':
        events.dispatchEvent(new CustomEvent('room_created', { detail: msg }));
        break;
      case 'error':
        console.error('MP error', msg.message);
        break;
    }
  });

  function createRoom(roomId) {
    ws.send(JSON.stringify({ type: 'create_room', roomId }));
  }
  function joinRoom(roomId, name) {
    ws.send(JSON.stringify({ type: 'join_room', roomId, name }));
  }
  function leaveRoom() {
    ws.send(JSON.stringify({ type: 'leave_room' }));
    currentRoom = null;
  }
  function sendRoomMessage(subtype, payload) {
    ws.send(JSON.stringify({ type: 'room_message', subtype, payload }));
  }
  function requestRooms() {
    ws.send(JSON.stringify({ type: 'list_rooms' }));
  }

  // expose API
  window.MP = { createRoom, joinRoom, leaveRoom, sendRoomMessage, requestRooms, events };
})();
