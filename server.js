// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // при необходимости указать конкретный домен
    methods: ['GET', 'POST']
  }
});

// load game items JSONs
const GAME_ITEMS = {};
try {
  GAME_ITEMS.clash = require('./game_items_clash.json').items;
} catch (e) {
  console.warn('Warning: game_items_clash.json not found or invalid');
  GAME_ITEMS.clash = [];
}
try {
  GAME_ITEMS.dota = require('./game_items_dota.json').items;
} catch (e) {
  console.warn('Warning: game_items_dota.json not found or invalid');
  GAME_ITEMS.dota = [];
}

// utils
function genLobbyCode() {
  const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += s[Math.floor(Math.random() * s.length)];
  return out;
}
function randInt32() { return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0; }
function mulberry32(seed) {
  let t = seed | 0;
  return function() {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    r ^= r >>> 14;
    return (r >>> 0) / 4294967296;
  };
}
function shuffleWithSeed(array, seed) {
  const rand = mulberry32(seed);
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// In-memory store
// lobby: { id, code, gameKey, playersCount, seed, adminSocketId, players: { socketId: {nick, index, state} }, state: 'lobby'|'in-round', round: {...}, createdAt }
const LOBBIES = {};

// cleanup old lobbies (optional)
setInterval(() => {
  const now = Date.now();
  for (const code in LOBBIES) {
    if (now - LOBBIES[code].createdAt > 24 * 60 * 60 * 1000) {
      delete LOBBIES[code];
    }
  }
}, 60 * 60 * 1000);

// REST endpoints for debug/info
app.get('/', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ ok: true, version: 2, features: ['change_game', 'nick_in_lobby'] }));

// Debug endpoint — просмотр всех лобби через консоль браузера
app.get('/api/lobbies/debug', (req, res) => {
  const sid = req.query.sid;
  if (!sid) return res.status(403).json({ error: 'Forbidden' });
  // проверяем что этот socket.id является админом хотя бы одного лобби
  const isAdmin = Object.values(LOBBIES).some(l => l.adminSocketId === sid);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
  const lobbies = Object.values(LOBBIES).map(l => {
    let roundInfo = null;
    if (l.round) {
      const spies = Object.entries(l.round.assigned)
        .filter(([,role]) => role && role.id === 'spy')
        .map(([idx]) => {
          const p = Object.values(l.players).find(p => p.index === Number(idx));
          return { index: Number(idx), nick: p ? p.nick : '?' };
        });
      roundInfo = {
        startedAt: l.round.startedAt,
        sharedItem: l.round.sharedItem,
        spyCount: l.round.spyCount,
        spies
      };
    }
    return {
      code: l.code,
      gameKey: l.gameKey,
      state: l.state,
      createdAt: l.createdAt,
      nextSpyCount: l.nextSpyCount !== undefined && l.nextSpyCount !== null
        ? { mode: 'set', count: l.nextSpyCount }
        : { mode: 'random' },
      round: roundInfo,
      players: Object.entries(l.players).map(([sid, p]) => ({
        index: p.index,
        nick: p.nick,
        isAdmin: sid === l.adminSocketId
      }))
    };
  });
  res.json({ count: lobbies.length, lobbies });
});

// Socket.IO events
io.on('connection', (socket) => {
  socket.data.nick = null;
  socket.data.lobby = null;

  // set or change nickname (stored in client localStorage and sent)
  socket.on('set_nick', (nick) => {
    socket.data.nick = typeof nick === 'string' ? nick.slice(0, 32) : `Player${socket.id.slice(0,4)}`;
    socket.emit('nick_set', socket.data.nick);
    console.log('[set_nick]', socket.id, '->', socket.data.nick);
    const code = socket.data.lobby;
    if (code && LOBBIES[code] && LOBBIES[code].players[socket.id]) {
      LOBBIES[code].players[socket.id].nick = socket.data.nick;
      io.to(code).emit('lobby_update', publicLobbyState(LOBBIES[code]));
      console.log('[set_nick] updated lobby', code);
    }
  });

  socket.on('change_game', ({ code, gameKey }, cb) => {
    console.log('[change_game]', socket.id, code, gameKey);
    const lobby = LOBBIES[code];
    if (!lobby) { console.log('[change_game] lobby not found'); if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { console.log('[change_game] not admin'); if (cb) cb({ error: 'Not admin' }); return; }
    if (lobby.state === 'in-round') { if (cb) cb({ error: 'Round in progress' }); return; }
    if (!GAME_ITEMS[gameKey] || GAME_ITEMS[gameKey].length === 0) { if (cb) cb({ error: 'Unknown game' }); return; }
    lobby.gameKey = gameKey;
    io.to(code).emit('lobby_update', publicLobbyState(lobby));
    console.log('[change_game] ok, new gameKey:', gameKey);
    if (cb) cb({ ok: true });
  });

  // create lobby
  socket.on('create_lobby', ({ gameKey = 'clash', playersCount = 4 }, cb) => {
    playersCount = 10;
    let code;
    do {
      code = genLobbyCode();
    } while (LOBBIES[code]);
    const seed = randInt32();
    const lobby = {
      id: uuidv4(),
      code,
      gameKey,
      playersCount,
      seed,
      adminSocketId: socket.id,
      players: {},
      state: 'lobby',
      round: null,
      createdAt: Date.now()
    };
    // add creator as player (assign next free index)
    const index = 1;
    lobby.players[socket.id] = { nick: socket.data.nick || `Host${socket.id.slice(0,4)}`, index, state: 'in-lobby' };
    socket.join(code);
    socket.data.lobby = code;
    LOBBIES[code] = lobby;
    // reply
    if (cb) cb({ ok: true, code, playersCount, gameKey, yourIndex: index });
    io.to(code).emit('lobby_update', publicLobbyState(lobby));
  });

  // join lobby
  socket.on('join_lobby', ({ code, index }, cb) => {
  code = (code || '').toUpperCase();
  const lobby = LOBBIES[code];
  if (!lobby) {
    if (cb) cb({ error: 'Lobby not found' });
    return;
  }
  
  // Если index не указан или null - автоматически выбираем свободный
  if (!index || index === 'auto') {
    const takenIndexes = Object.values(lobby.players).map(p => p.index);
    for (let i = 1; i <= lobby.playersCount; i++) {
      if (!takenIndexes.includes(i)) {
        index = i;
        break;
      }
    }
    if (!index) {
      if (cb) cb({ error: 'Lobby is full' });
      return;
    }
  } else {
    index = Number(index);
    if (!index || index < 1 || index > lobby.playersCount) {
      if (cb) cb({ error: 'Bad index' });
      return;
    }
    // проверяем что не занят
    const taken = Object.values(lobby.players).some(p => p.index === index);
    if (taken) {
      if (cb) cb({ error: 'Index already taken' });
      return;
    }
  }
  
  // добавляем игрока
  lobby.players[socket.id] = { nick: socket.data.nick || `Player${socket.id.slice(0,4)}`, index, state: 'in-lobby' };
  socket.join(code);
  socket.data.lobby = code;
  if (cb) cb({ ok: true, code, yourIndex: index });
  io.to(code).emit('lobby_update', publicLobbyState(lobby));
});

  // leave lobby (explicit)
  socket.on('leave_lobby', (data, cb) => {
    const code = socket.data.lobby;
    if (!code) return;
    const lobby = LOBBIES[code];
    if (!lobby) return;
    delete lobby.players[socket.id];
    socket.leave(code);
    socket.data.lobby = null;
    // if admin left -> pass to next player (lowest index)
    if (lobby.adminSocketId === socket.id) {
      const next = Object.keys(lobby.players)[0];
      lobby.adminSocketId = next || null;
    }
    // if no players left -> destroy lobby
    if (Object.keys(lobby.players).length === 0) {
      delete LOBBIES[code];
    } else {
      io.to(code).emit('lobby_update', publicLobbyState(lobby));
    }
    if (cb) cb({ ok: true });
  });

  socket.on('start_round', ({ code, theme = null }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }

    const currentPlayersCount = Object.keys(lobby.players).length;
    if (currentPlayersCount < 3) { if (cb) cb({ error: 'Not enough players (min 3)' }); return; }

    // определяем кол-во шпионов
    let spyCount;
    if (lobby.nextSpyCount !== undefined && lobby.nextSpyCount !== null) {
      // задано вручную через консоль
      spyCount = Math.max(0, Math.min(currentPlayersCount, lobby.nextSpyCount));
    } else {
      // случайный режим: 86% = 1 шпион, 6% = 2, 6% = 0, 2% = все шпионы
      const r = Math.random() * 100;
      if (r < 86)       spyCount = 1;
      else if (r < 92)  spyCount = 2;
      else if (r < 98)  spyCount = 0;
      else              spyCount = currentPlayersCount;
    }

    // build playerIndex list sorted by index
    const playersArr = Object.entries(lobby.players).map(([sid,p]) => ({ sid, ...p }));
    playersArr.sort((a,b)=>a.index - b.index);

    // determine shared item using lobby.seed
    const items = GAME_ITEMS[lobby.gameKey] || [];
    if (!items || items.length === 0) {
      if (cb) cb({ error: 'No items for this game on server' });
      return;
    }
    const shuffledItems = shuffleWithSeed(items, lobby.seed + 1);
    const sharedItem = shuffledItems[0];

    const rolePool = [];
    for (let i = 0; i < playersArr.length - spyCount; i++) rolePool.push(sharedItem);
    for (let i = 0; i < spyCount; i++) rolePool.push({ id: 'spy', sys: true });
    const shuffledRoles = shuffleWithSeed(rolePool, lobby.seed + 2);
    
    // assign roles by playersArr order
    const assigned = {};
    for (let i=0; i<playersArr.length; i++) {
      const p = playersArr[i];
      assigned[p.index] = shuffledRoles[i];
    }
    
    // store round
    lobby.state = 'in-round';
    lobby.round = {
      startedAt: Date.now(),
      seed: lobby.seed,
      assigned,
      theme,
      sharedItem,
      spyCount
    };
    
    // notify players privately with their role
    for (const [sid, p] of Object.entries(lobby.players)) {
      const role = lobby.round.assigned[p.index];
      io.to(sid).emit('role_assigned', { role, index: p.index, sharedLabel: lobby.gameKey });
    }
    io.to(code).emit('round_started', publicLobbyState(lobby));
    if (cb) cb({ ok: true });
  });

  // end round (admin) -> generate new seed so next round different
  socket.on('end_round', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    lobby.state = 'lobby';
    lobby.round = null;
    lobby.votes = {};
    lobby.seed = randInt32(); // new seed for next round
    io.to(code).emit('round_ended', publicLobbyState(lobby));
    if (cb) cb({ ok: true });
  });

  // kick player (admin)
  socket.on('kick', ({ code, targetIndex }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    const targetSid = Object.keys(lobby.players).find(sid => lobby.players[sid].index === Number(targetIndex));
    if (!targetSid) { if (cb) cb({ error: 'Player not found' }); return; }
    io.to(targetSid).emit('kicked', { reason: 'Kicked by admin' });
    delete lobby.players[targetSid];
    const kickedSocket = io.sockets.sockets.get(targetSid);
    if (kickedSocket) kickedSocket.leave(code);
    io.to(code).emit('lobby_update', publicLobbyState(lobby));
    if (cb) cb({ ok: true });
  });

  // vote for spy (simple voting)
  socket.on('vote', ({ code, votedIndex }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby || !lobby.round) { if (cb) cb({ error: 'No active round' }); return; }
    if (!lobby.votes) lobby.votes = {};
    lobby.votes[socket.id] = Number(votedIndex);
    // broadcast votes count (anonymized)
    const votesCount = Object.values(lobby.votes).reduce((acc, v) => { acc[v] = (acc[v]||0)+1; return acc; }, {});
    io.to(code).emit('vote_update', { votesCount, totalVotes: Object.keys(lobby.votes).length, players: Object.keys(lobby.players).length });
    if (cb) cb({ ok: true });
  });

  // request lobby state
  socket.on('get_lobby', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (cb) cb({ ok: true, lobby: publicLobbyState(lobby) });
  });

  socket.on('ping_keepalive', () => { /* просто держим сервер живым */ });

  socket.on('disconnect', () => {
    const code = socket.data.lobby;
    if (!code) return;
    const lobby = LOBBIES[code];
    if (!lobby) return;
    delete lobby.players[socket.id];
    socket.leave(code);
    // admin handoff
    if (lobby.adminSocketId === socket.id) {
      const next = Object.keys(lobby.players)[0] || null;
      lobby.adminSocketId = next;
    }
    if (Object.keys(lobby.players).length === 0) {
      delete LOBBIES[code];
    } else {
      io.to(code).emit('lobby_update', publicLobbyState(lobby));
    }
  });
});

// helper to build public state
function publicLobbyState(lobby) {
  return {
    code: lobby.code,
    gameKey: lobby.gameKey,
    playersCount: lobby.playersCount,
    state: lobby.state,
    adminSocketId: lobby.adminSocketId,
    players: Object.entries(lobby.players).map(([sid, p]) => ({ socketId: sid, nick: p.nick, index: p.index, state: p.state })),
    roundInfo: lobby.round ? { startedAt: lobby.round.startedAt } : null,
    createdAt: lobby.createdAt
  };
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Lobby server listening on', PORT));
