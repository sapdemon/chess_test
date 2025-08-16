const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const roomId = nanoid(6);
  res.redirect(`/r/${roomId}`);
});

app.get('/r/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      game: new Chess(),
      players: { w: null, b: null },
      spectators: new Set(),
      createdAt: Date.now(),
      status: 'waiting'
    });
  }
  return rooms.get(roomId);
}

function assignColor(room, socket) {
  if (room.players.w === null) {
    room.players.w = socket.id;
    return 'w';
  }
  if (room.players.b === null) {
    room.players.b = socket.id;
    return 'b';
  }
  room.spectators.add(socket.id);
  return 's';
}

function buildStatePayload(room) {
  const game = room.game;
  return {
    fen: game.fen(),
    turn: game.turn(),
    isGameOver: game.isGameOver(),
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isDraw: game.isDraw(),
    isStalemate: game.isStalemate(),
    isThreefoldRepetition: game.isThreefoldRepetition(),
    isInsufficientMaterial: game.isInsufficientMaterial(),
    status: room.status
  };
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = {
    players: {
      w: room.players.w,
      b: room.players.b
    },
    spectators: Array.from(room.spectators)
  };
  io.to(roomId).emit('room_state', payload);
}

io.on('connection', socket => {
  socket.on('join', ({ roomId, name }) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('error_message', 'Некорректный идентификатор комнаты');
      return;
    }
    const room = getOrCreateRoom(roomId);
    const color = assignColor(room, socket);
    socket.data.roomId = roomId;
    socket.data.color = color;
    socket.data.name = name || null;

    socket.join(roomId);

    if (room.players.w && room.players.b) {
      room.status = 'playing';
    } else {
      room.status = 'waiting';
    }

    socket.emit('init', {
      roomId,
      color,
      ...buildStatePayload(room)
    });

    broadcastRoomState(roomId);
    io.to(roomId).emit('status_message', color === 's' ? 'Наблюдатель подключился' : 'Игрок подключился');
  });

  socket.on('move', (payload) => {
    try {
      const roomId = socket.data.roomId;
      const color = socket.data.color;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      if (color !== room.game.turn()) {
        socket.emit('invalid_move', 'Сейчас не ваш ход');
        return;
      }
      if (color !== 'w' && color !== 'b') {
        socket.emit('invalid_move', 'Нельзя ходить наблюдателю');
        return;
      }

      const from = payload && typeof payload.from === 'string' ? payload.from : null;
      const to = payload && typeof payload.to === 'string' ? payload.to : null;
      const promotion = payload && typeof payload.promotion === 'string' ? payload.promotion : undefined;

      if (!from || !to) {
        socket.emit('invalid_move', 'Неверные координаты хода');
        return;
      }

      const beforeMoveTurn = room.game.turn();
      const moveObj = { from, to };
      if (promotion) moveObj.promotion = promotion;

      let result = room.game.move(moveObj);
      if (!result && !promotion) {
        result = room.game.move({ from, to, promotion: 'q' });
      }
      if (!result) {
        socket.emit('invalid_move', 'Недопустимый ход');
        return;
      }

      if (room.game.isGameOver()) {
        room.status = 'finished';
      }

      io.to(roomId).emit('state', {
        move: { from, to, san: result.san, color: beforeMoveTurn },
        ...buildStatePayload(room)
      });
    } catch (err) {
      socket.emit('invalid_move', 'Ошибка обработки хода');
    }
  });

  socket.on('resign', () => {
    const roomId = socket.data.roomId;
    const color = socket.data.color;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (color !== 'w' && color !== 'b') return;
    room.status = 'finished';
    const winner = color === 'w' ? 'b' : 'w';
    io.to(roomId).emit('game_over', { reason: 'resign', winner, fen: room.game.fen() });
  });

  socket.on('restart', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.game = new Chess();
    room.status = room.players.w && room.players.b ? 'playing' : 'waiting';
    io.to(roomId).emit('state', buildStatePayload(room));
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const color = socket.data.color;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (color === 'w' && room.players.w === socket.id) {
      room.players.w = null;
    } else if (color === 'b' && room.players.b === socket.id) {
      room.players.b = null;
    } else {
      room.spectators.delete(socket.id);
    }
    if (!room.players.w && !room.players.b && room.spectators.size === 0) {
      rooms.delete(roomId);
    } else {
      if (room.status === 'playing' && (!room.players.w || !room.players.b)) {
        room.status = 'waiting';
      }
      broadcastRoomState(roomId);
      io.to(roomId).emit('status_message', 'Кто-то отключился');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});