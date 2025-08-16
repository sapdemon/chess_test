'use strict';

(function () {
  const socket = io({ transports: ['websocket', 'polling'] });

  const roomMatch = window.location.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
  const roomId = roomMatch ? roomMatch[1] : '';

  const boardEl = document.getElementById('board');
  const roomLinkEl = document.getElementById('roomLink');
  const copyBtn = document.getElementById('copyLink');
  const roleInfoEl = document.getElementById('roleInfo');
  const turnInfoEl = document.getElementById('turnInfo');
  const gameStatusEl = document.getElementById('gameStatus');
  const messagesEl = document.getElementById('messages');
  const resignBtn = document.getElementById('resignBtn');
  const restartBtn = document.getElementById('restartBtn');

  roomLinkEl.value = window.location.href;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showMessage('Ссылка скопирована');
    } catch {
      roomLinkEl.select();
      document.execCommand('copy');
      showMessage('Ссылка скопирована');
    }
  });

  const pieceToChar = {
    p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
    P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔'
  };

  let myColor = 's';
  let currentFEN = '';
  let turn = 'w';
  let selectedSquare = null;
  let lastMove = null;

  function showMessage(text) {
    messagesEl.textContent = text || '';
    if (!text) return;
    setTimeout(() => { if (messagesEl.textContent === text) messagesEl.textContent = ''; }, 3000);
  }

  function squaresOrder() {
    const whiteOrder = [];
    const files = ['a','b','c','d','e','f','g','h'];
    for (let rank = 8; rank >= 1; rank--) {
      for (let f = 0; f < 8; f++) {
        whiteOrder.push(files[f] + String(rank));
      }
    }
    if (myColor === 'b') return whiteOrder.slice().reverse();
    return whiteOrder;
  }

  function parseFENBoard(fen) {
    const board = [];
    const parts = fen.split(' ');
    const boardPart = parts[0];
    const ranks = boardPart.split('/');
    for (let r = 0; r < 8; r++) {
      const row = ranks[r];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (/[1-8]/.test(ch)) {
          const empties = parseInt(ch, 10);
          for (let k = 0; k < empties; k++) board.push('');
        } else {
          board.push(ch);
        }
      }
    }
    return board; // 64 entries from a8..h1
  }

  function boardMapBySquare(fen) {
    const flat = parseFENBoard(fen); // a8..h1
    const files = ['a','b','c','d','e','f','g','h'];
    const map = {};
    let idx = 0;
    for (let rank = 8; rank >= 1; rank--) {
      for (let f = 0; f < 8; f++) {
        const sq = files[f] + String(rank);
        map[sq] = flat[idx++];
      }
    }
    return map;
  }

  function isMyTurn() {
    return myColor === turn && (myColor === 'w' || myColor === 'b');
  }

  function isMyPiece(piece) {
    if (!piece) return false;
    if (myColor === 'w') return piece === piece.toUpperCase();
    if (myColor === 'b') return piece === piece.toLowerCase();
    return false;
  }

  function tryMove(from, to) {
    let promotion;
    const piece = boardMapBySquare(currentFEN)[from];
    if (piece && (piece === 'P' || piece === 'p')) {
      const fromRank = parseInt(from[1], 10);
      const toRank = parseInt(to[1], 10);
      if ((piece === 'P' && toRank === 8) || (piece === 'p' && toRank === 1)) {
        const answer = prompt('Превращение пешки: q (ферзь), r (ладья), b (слон), n (конь)', 'q');
        const valid = ['q','r','b','n'];
        promotion = valid.includes(String(answer).toLowerCase()) ? String(answer).toLowerCase() : 'q';
      }
    }
    socket.emit('move', { from, to, promotion });
  }

  function renderBoard() {
    const map = boardMapBySquare(currentFEN);
    const order = squaresOrder();

    boardEl.innerHTML = '';

    for (let i = 0; i < order.length; i++) {
      const sq = order[i];
      const rank = parseInt(sq[1], 10);
      const fileIndex = sq.charCodeAt(0) - 'a'.charCodeAt(0);
      const isLight = (rank + fileIndex) % 2 === 0;

      const cell = document.createElement('div');
      cell.className = `square ${isLight ? 'light' : 'dark'}`;
      cell.dataset.square = sq;
      cell.setAttribute('role', 'gridcell');
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
        cell.classList.add('lastmove');
      }

      const piece = map[sq];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece';
        span.textContent = pieceToChar[piece] || '';
        span.style.color = (piece === piece.toUpperCase()) ? '#222' : '#111';
        cell.appendChild(span);
      }

      if (selectedSquare && selectedSquare === sq) {
        cell.classList.add('selected');
      }

      cell.addEventListener('click', () => onSquareClick(sq));

      boardEl.appendChild(cell);
    }

    const roleText = myColor === 'w' ? 'Вы играете белыми' : myColor === 'b' ? 'Вы играете черными' : 'Вы наблюдаете';
    roleInfoEl.textContent = roleText;

    const turnText = turn === 'w' ? 'Ход белых' : 'Ход черных';
    turnInfoEl.textContent = turnText + (isMyTurn() ? ' — ваш ход' : '');

    gameStatusEl.textContent = '';
  }

  function onSquareClick(square) {
    if (!isMyTurn()) {
      if (!selectedSquare && boardMapBySquare(currentFEN)[square]) showMessage('Сейчас не ваш ход');
      return;
    }

    const piece = boardMapBySquare(currentFEN)[square];

    if (!selectedSquare) {
      if (!isMyPiece(piece)) return;
      selectedSquare = square;
      renderBoard();
      return;
    }

    if (square === selectedSquare) {
      selectedSquare = null;
      renderBoard();
      return;
    }

    tryMove(selectedSquare, square);
    selectedSquare = null;
  }

  resignBtn.addEventListener('click', () => {
    if (myColor === 'w' || myColor === 'b') {
      if (confirm('Вы уверены, что хотите сдаться?')) socket.emit('resign');
    }
  });

  restartBtn.addEventListener('click', () => {
    socket.emit('restart');
  });

  socket.on('connect', () => {
    socket.emit('join', { roomId });
  });

  socket.on('init', (payload) => {
    myColor = payload.color || 's';
    currentFEN = payload.fen;
    turn = payload.turn;
    lastMove = null;
    renderBoard();
  });

  socket.on('state', (payload) => {
    currentFEN = payload.fen;
    turn = payload.turn;
    if (payload.move) lastMove = { from: payload.move.from, to: payload.move.to };
    if (payload.isGameOver) {
      let text = 'Игра окончена.';
      if (payload.isCheckmate) text += ' Мат.';
      if (payload.isDraw) text += ' Ничья.';
      gameStatusEl.textContent = text;
    }
    renderBoard();
  });

  socket.on('room_state', (payload) => {
    const players = payload.players || {};
    const w = players.w ? 'занято' : 'свободно';
    const b = players.b ? 'занято' : 'свободно';
    showMessage(`Белые: ${w}, Черные: ${b}`);
  });

  socket.on('status_message', (text) => showMessage(text));
  socket.on('error_message', (text) => showMessage(text));
  socket.on('invalid_move', (text) => showMessage(text || 'Недопустимый ход'));

  socket.on('game_over', (data) => {
    const winnerText = data.winner === 'w' ? 'Белые' : 'Черные';
    gameStatusEl.textContent = `Игра окончена. Победитель: ${winnerText} (${data.reason === 'resign' ? 'сдаться' : data.reason})`;
  });

})();