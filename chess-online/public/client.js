'use strict';

(function () {
  const socket = io({ 
    transports: ['websocket', 'polling'],
    timeout: 20000,
    forceNew: true
  });

  // Инициализация элементов DOM в самом начале
  const boardEl = document.getElementById('board');
  const roomLinkEl = document.getElementById('roomLink');
  const copyBtn = document.getElementById('copyLink');
  const roleInfoEl = document.getElementById('roleInfo');
  const turnInfoEl = document.getElementById('turnInfo');
  const gameStatusEl = document.getElementById('gameStatus');
  const messagesEl = document.getElementById('messages');
  const resignBtn = document.getElementById('resignBtn');
  const restartBtn = document.getElementById('restartBtn');

  // Функция показа сообщений
  function showMessage(text) {
    if (messagesEl) {
      messagesEl.textContent = text || '';
      if (!text) return;
      setTimeout(() => { if (messagesEl.textContent === text) messagesEl.textContent = ''; }, 3000);
    }
  }

  const roomMatch = window.location.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
  const roomId = roomMatch ? roomMatch[1] : '';

  // Проверяем, есть ли корректный roomId
  if (!roomId) {
    // Если нет roomId и мы не на главной странице, перенаправляем на главную
    if (window.location.pathname !== '/') {
      console.log('Redirecting to main page from:', window.location.pathname);
      window.location.replace('/');
      return;
    }
    
    // Если мы на главной странице, показываем сообщение и создаем комнату
    console.log('On main page, creating new room...');
    showMessage('Создание новой комнаты...');
    
    // Попробуем создать комнату через AJAX
    fetch('/create-room')
      .then(response => response.json())
      .then(data => {
        console.log('Room created via AJAX:', data);
        showMessage('Комната создана, переход...');
        window.location.replace(data.redirectUrl);
      })
      .catch(error => {
        console.error('AJAX room creation failed:', error);
        // Fallback: прямой редирект
        console.log('Falling back to direct redirect...');
        window.location.replace('/');
      });
    return;
  }
  
  // Дополнительная валидация формата roomId
  if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) {
    showMessage('Некорректный формат идентификатора комнаты');
    window.location.href = '/';
    return;
  }

  // Проверка длины roomId
  if (roomId.length < 3 || roomId.length > 50) {
    showMessage('Некорректная длина идентификатора комнаты');
    window.location.href = '/';
    return;
  }

  // Проверяем, что все необходимые элементы существуют
  if (!boardEl || !roomLinkEl || !copyBtn || !roleInfoEl || !turnInfoEl || !gameStatusEl || !messagesEl || !resignBtn || !restartBtn) {
    console.error('Не все элементы DOM найдены');
    return;
  }

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
    // Черные фигуры (строчные) - используем те же символы, что и для белых
    p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔',
    // Белые фигуры (заглавные)
    P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔'
  };

  let myColor = 's';
  let currentFEN = '';
  let turn = 'w';
  let selectedSquare = null;
  let lastMove = null;

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
        
        // Различаем белые и черные фигуры по цвету
        if (piece === piece.toUpperCase()) {
          // Белые фигуры (заглавные)
          span.style.color = '#ffffff';
          span.style.textShadow = '0 1px 2px rgba(0,0,0,0.8)';
        } else {
          // Черные фигуры (строчные)
          span.style.color = '#2c3e50';
          span.style.textShadow = '0 1px 2px rgba(0,0,0,0.5)';
        }
        
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
    if (!socket.connected) {
      showMessage('Нет подключения к серверу');
      return;
    }
    if (myColor === 'w' || myColor === 'b') {
      if (confirm('Вы уверены, что хотите сдаться?')) socket.emit('resign');
    }
  });

  restartBtn.addEventListener('click', () => {
    if (socket.connected) {
      socket.emit('restart');
    } else {
      showMessage('Нет подключения к серверу');
    }
  });

  socket.on('connecting', () => {
    console.log('Connecting to server...');
    showMessage('Подключение к серверу...');
  });

  socket.on('connect', () => {
    console.log('Connected to server');
    console.log('Current pathname:', window.location.pathname);
    console.log('RoomId:', roomId);
    
    // Подключаемся к комнате только если есть roomId
    if (roomId) {
      console.log('Attempting to join room:', roomId);
      showMessage('Подключено к серверу');
      socket.emit('join', { roomId });
    } else {
      console.log('No roomId available, waiting for redirect...');
      showMessage('Ожидание создания комнаты...');
    }
  });

  socket.on('init', (payload) => {
    console.log('Received init:', payload);
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

  socket.on('status_message', (text) => {
    console.log('Status message:', text);
    showMessage(text);
  });
  
  socket.on('error_message', (text) => {
    console.error('Error message:', text);
    showMessage(text);
    
    // Если ошибка связана с roomId, перенаправляем на главную страницу
    if (text.includes('идентификатор') || text.includes('комнаты')) {
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    }
  });
  
  socket.on('invalid_move', (text) => {
    console.log('Invalid move:', text);
    showMessage(text || 'Недопустимый ход');
  });

  socket.on('game_over', (data) => {
    const winnerText = data.winner === 'w' ? 'Белые' : 'Черные';
    gameStatusEl.textContent = `Игра окончена. Победитель: ${winnerText} (${data.reason === 'resign' ? 'сдаться' : data.reason})`;
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    showMessage('Ошибка подключения к серверу');
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    showMessage('Отключено от сервера');
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Reconnection attempt', attemptNumber);
    showMessage(`Попытка переподключения ${attemptNumber}...`);
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    showMessage('Переподключено к серверу');
    socket.emit('join', { roomId });
  });

  socket.on('reconnect_failed', () => {
    console.log('Reconnection failed');
    showMessage('Не удалось переподключиться к серверу');
  });

  socket.on('reconnect_error', (error) => {
    console.log('Reconnection error:', error);
    showMessage('Ошибка переподключения');
  });

})();