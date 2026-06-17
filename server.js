// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// Upstash Redis — проверка пароля администратора
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function checkAdminPassword(password) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.warn('Upstash не настроен — admin auth отключён');
    return false;
  }
  try {
    const resp = await fetch(`${REDIS_URL}/get/spy_admin_password`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await resp.json();
    return data.result === password;
  } catch (e) {
    console.error('Redis error:', e);
    return false;
  }
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// load game items JSONs
const GAME_ITEMS = {};
try { GAME_ITEMS.clash = require('./game_items_clash.json').items; }
catch (e) { console.warn('Warning: game_items_clash.json not found'); GAME_ITEMS.clash = []; }
try { GAME_ITEMS.dota = require('./game_items_dota.json').items; }
catch (e) { console.warn('Warning: game_items_dota.json not found'); GAME_ITEMS.dota = []; }

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
    t += 0x6D2B79F5; let r = t;
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
const LOBBIES = {};

// cleanup old lobbies
setInterval(() => {
  const now = Date.now();
  for (const code in LOBBIES) {
    if (now - LOBBIES[code].createdAt > 24 * 60 * 60 * 1000) {
      // clear any vote timers
      if (LOBBIES[code].voteTimer) clearTimeout(LOBBIES[code].voteTimer);
      delete LOBBIES[code];
    }
  }
}, 60 * 60 * 1000);

// REST endpoints
app.get('/', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ ok: true, version: 3, features: ['chat', 'spy_guess', 'vote_kick', 'finish_vote'] }));

// Debug endpoint
app.get('/api/lobbies/debug', async (req, res) => {
  const { sid, password } = req.query;
  if (!sid || !password) return res.status(403).json({ error: 'Forbidden' });
  const valid = await checkAdminPassword(password);
  if (!valid) return res.status(403).json({ error: 'Wrong password' });
  const lobbies = Object.values(LOBBIES).map(l => {
    let roundInfo = null;
    if (l.round) {
      const spies = Object.entries(l.round.assigned)
        .filter(([,role]) => role && role.id === 'spy')
        .map(([idx]) => {
          const p = Object.values(l.players).find(p => p.index === Number(idx));
          return { index: Number(idx), nick: p ? p.nick : '?' };
        });
      roundInfo = { startedAt: l.round.startedAt, sharedItem: l.round.sharedItem, spyCount: l.round.spyCount, spies };
    }
    return {
      code: l.code, gameKey: l.gameKey, state: l.state, createdAt: l.createdAt,
      nextSpyCount: l.nextSpyCount !== undefined && l.nextSpyCount !== null
        ? { mode: 'set', count: l.nextSpyCount } : { mode: 'random' },
      round: roundInfo,
      players: Object.entries(l.players).map(([sid, p]) => ({
        index: p.index, nick: p.nick, isAdmin: sid === l.adminSocketId, kicked: p.kicked, winner: !!p.winner, guessedWrong: !!p.guessedWrong
      }))
    };
  });
  res.json({ count: lobbies.length, lobbies });
});

app.post('/api/admin/auth', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'No password' });
  const valid = await checkAdminPassword(password);
  if (!valid) return res.status(403).json({ error: 'Wrong password' });
  res.json({ ok: true });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function publicLobbyState(lobby) {
  const order = lobby.playerOrder || [];
  const allPlayers = Object.entries(lobby.players).map(([sid, p]) => ({
    socketId: sid, nick: p.nick, index: p.index, state: p.state,
    kicked: !!p.kicked, winner: !!p.winner, guessedWrong: !!p.guessedWrong, color: p.color || '#60a5fa'
  }));
  allPlayers.sort((a, b) => {
    const ia = order.indexOf(a.index);
    const ib = order.indexOf(b.index);
    if (ia === -1 && ib === -1) return a.index - b.index;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return {
    code: lobby.code,
    gameKey: lobby.gameKey,
    playersCount: lobby.playersCount,
    state: lobby.state,
    adminSocketId: lobby.adminSocketId,
    players: allPlayers,
    roundInfo: lobby.round ? { startedAt: lobby.round.startedAt, spyGuessed: lobby.round.spyGuessed } : null,
    createdAt: lobby.createdAt,
    voteState: lobby.voteState || null
  };
}

function addChatMessage(lobby, msg) {
  if (!lobby.chatMessages) lobby.chatMessages = [];
  lobby.chatMessages.push(msg);
  if (lobby.chatMessages.length > 200) lobby.chatMessages = lobby.chatMessages.slice(-200);
  io.to(lobby.code).emit('chat_message', msg);
}

function resolveVote(lobby) {
  // clear timer
  if (lobby.voteTimer) { clearTimeout(lobby.voteTimer); lobby.voteTimer = null; }

  const code = lobby.code;
  const vs = lobby.voteState;
  if (!vs || vs.phase !== 'voting') return;

  const activePlayers = Object.values(lobby.players).filter(canVote);

  // tally votes (skip = null, ignored entirely — no one's tally is incremented)
  const tally = {};
  for (const [, vote] of Object.entries(vs.votes)) {
    if (vote === null) continue; // skip
    tally[vote] = (tally[vote] || 0) + 1;
  }

  // find max
  let maxVotes = 0;
  let maxTarget = null;
  let tie = false;
  for (const [target, count] of Object.entries(tally)) {
    if (count > maxVotes) { maxVotes = count; maxTarget = target; tie = false; }
    else if (count === maxVotes) { tie = true; }
  }

  vs.phase = 'done';
  io.to(code).emit('vote_state', vs);

  // Kick only if the top target's votes form a strict majority of active players
  // (skip votes count toward the total but never toward anyone's tally).
  const actualKicks = maxTarget !== null ? maxVotes : 0;
  if (!maxTarget || tie || actualKicks === 0 || actualKicks <= activePlayers.length / 2) {
    // ничья, все пропустили, или нет реального большинства "за"
    addChatMessage(lobby, { type: 'system', text: '🤝 Голосование завершилось — никто не изгнан.' });
    lobby.voteState = null;
    io.to(code).emit('vote_ended', { kicked: null });
    return;
  }

  // kick the player with most votes
  const targetIndex = Number(maxTarget);
  const targetEntry = Object.entries(lobby.players).find(([, p]) => p.index === targetIndex);
  if (!targetEntry) {
    lobby.voteState = null;
    io.to(code).emit('vote_ended', { kicked: null });
    return;
  }

  const [targetSid, targetPlayer] = targetEntry;
  targetPlayer.kicked = true;
  lobby.playerOrder = lobby.playerOrder.filter(i => i !== targetIndex);

  // determine wasSpy for internal logic only — role NOT revealed in chat
  let wasSpy = false;
  if (lobby.round && lobby.round.assigned) {
    const role = lobby.round.assigned[targetIndex];
    wasSpy = !!(role && role.id === 'spy');
  }

  addChatMessage(lobby, {
    type: 'system',
    text: `🚪 ${escapeNick(targetPlayer.nick)} изгнан голосованием.`
  });

  // NOT kicked from the room — they stay but are marked kicked (silenced)
  // just notify everyone about the updated lobby state
  lobby.voteState = null;

  io.to(code).emit('vote_ended', { kicked: { index: targetIndex, nick: targetPlayer.nick, wasSpy } });
  io.to(code).emit('lobby_update', publicLobbyState(lobby));
}

function escapeNick(s) {
  return String(s).replace(/[<>"'&]/g, '');
}

// A player can participate in votes only if they're not kicked,
// haven't already won by guessing correctly, and haven't used up
// their wrong guess (guessedWrong).
function canVote(p) {
  return !p.kicked && !p.winner && !p.guessedWrong;
}

function getItemName(item) {
  if (!item) return '?';
  if (typeof item === 'string') return item;
  return item.ru || item.en || item.id || '?';
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.data.nick = null;
  socket.data.lobby = null;
  socket.data.color = '#60a5fa';

  socket.on('set_color', (color) => {
    const allowed = ['#60a5fa','#34d399','#f87171','#fbbf24','#a78bfa','#fb923c','#f472b6','#e5e7eb'];
    if (!allowed.includes(color)) return;
    socket.data.color = color;
    const code = socket.data.lobby;
    if (code && LOBBIES[code] && LOBBIES[code].players[socket.id]) {
      LOBBIES[code].players[socket.id].color = color;
      io.to(code).emit('lobby_update', publicLobbyState(LOBBIES[code]));
    }
  });

  socket.on('set_nick', (nick) => {
    socket.data.nick = typeof nick === 'string' ? nick.slice(0, 32) : `Player${socket.id.slice(0,4)}`;
    socket.emit('nick_set', socket.data.nick);
    const code = socket.data.lobby;
    if (code && LOBBIES[code] && LOBBIES[code].players[socket.id]) {
      LOBBIES[code].players[socket.id].nick = socket.data.nick;
      io.to(code).emit('lobby_update', publicLobbyState(LOBBIES[code]));
    }
  });

  socket.on('set_next_spy_count', async ({ code, count, password }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    const valid = await checkAdminPassword(password);
    if (!valid) { if (cb) cb({ error: 'Wrong password' }); return; }
    if (count === null || count === undefined) {
      lobby.nextSpyCount = null;
      if (cb) cb({ ok: true, mode: 'random' });
    } else {
      const n = Number(count);
      if (!Number.isFinite(n) || n < 0) { if (cb) cb({ error: 'Bad count' }); return; }
      lobby.nextSpyCount = n;
      if (cb) cb({ ok: true, mode: 'set', count: n });
    }
  });

  socket.on('change_game', ({ code, gameKey }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    if (lobby.state === 'in-round') { if (cb) cb({ error: 'Round in progress' }); return; }
    if (!GAME_ITEMS[gameKey] || GAME_ITEMS[gameKey].length === 0) { if (cb) cb({ error: 'Unknown game' }); return; }
    lobby.gameKey = gameKey;
    io.to(code).emit('lobby_update', publicLobbyState(lobby));
    if (cb) cb({ ok: true });
  });

  socket.on('reorder_players', ({ code, newOrder }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    if (lobby.state !== 'lobby') { if (cb) cb({ error: 'Can only reorder in lobby state' }); return; }

    const currentIndexes = Object.values(lobby.players).map(p => p.index).sort((a, b) => a - b);
    const sortedNew = [...newOrder].map(Number).sort((a, b) => a - b);
    const valid =
      Array.isArray(newOrder) &&
      sortedNew.length === currentIndexes.length &&
      sortedNew.every((v, i) => v === currentIndexes[i]);

    if (!valid) { if (cb) cb({ error: 'Invalid order' }); return; }

    lobby.playerOrder = newOrder.map(Number);
    io.to(lobby.code).emit('lobby_update', publicLobbyState(lobby));
    if (cb) cb({ ok: true });
  });

  // create lobby
  socket.on('create_lobby', ({ gameKey = 'clash' }, cb) => {
    let code;
    do { code = genLobbyCode(); } while (LOBBIES[code]);
    const seed = randInt32();
    const lobby = {
      id: uuidv4(), code, gameKey, playersCount: 10, seed,
      adminSocketId: socket.id,
      players: {}, state: 'lobby', round: null,
      chatMessages: [], voteState: null, voteTimer: null,
      playerOrder: [],
      createdAt: Date.now()
    };
    const index = 1;
    lobby.players[socket.id] = { nick: socket.data.nick || `Host${socket.id.slice(0,4)}`, index, state: 'in-lobby', kicked: false, winner: false, guessedWrong: false, color: socket.data.color || '#60a5fa' };
    lobby.playerOrder.push(index);
    socket.join(code);
    socket.data.lobby = code;
    LOBBIES[code] = lobby;
    if (cb) cb({ ok: true, code, playersCount: 10, gameKey, yourIndex: index });
    io.to(code).emit('lobby_update', publicLobbyState(lobby));
    addChatMessage(lobby, { type: 'system', text: `🎮 Лобби создано. Код: ${code}` });
  });

  // join lobby
  socket.on('join_lobby', ({ code, index }, cb) => {
    code = (code || '').toUpperCase();
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }

    if (!index || index === 'auto') {
      const takenIndexes = Object.values(lobby.players).map(p => p.index);
      for (let i = 1; i <= lobby.playersCount; i++) {
        if (!takenIndexes.includes(i)) { index = i; break; }
      }
      if (!index) { if (cb) cb({ error: 'Lobby is full' }); return; }
    } else {
      index = Number(index);
      if (!index || index < 1 || index > lobby.playersCount) { if (cb) cb({ error: 'Bad index' }); return; }
      const taken = Object.values(lobby.players).some(p => p.index === index);
      if (taken) { if (cb) cb({ error: 'Index already taken' }); return; }
    }

    lobby.players[socket.id] = { nick: socket.data.nick || `Player${socket.id.slice(0,4)}`, index, state: 'in-lobby', kicked: false, winner: false, guessedWrong: false, color: socket.data.color || '#60a5fa' };
    if (!lobby.playerOrder.includes(index)) lobby.playerOrder.push(index);
    socket.join(code);
    socket.data.lobby = code;
    if (cb) cb({ ok: true, code, yourIndex: index });
    io.to(code).emit('lobby_update', publicLobbyState(lobby));

    const nick = lobby.players[socket.id].nick;
    addChatMessage(lobby, { type: 'system', text: `👋 ${escapeNick(nick)} вошёл в лобби.` });
  });

  // leave lobby
  socket.on('leave_lobby', (data, cb) => {
    const code = socket.data.lobby;
    if (!code) { if (cb) cb({ ok: true, notInLobby: true }); return; }
    const lobby = LOBBIES[code];
    if (!lobby) {
      // stale/invalid session — clear it so the client can still navigate away
      socket.data.lobby = null;
      if (cb) cb({ ok: true, lobbyNotFound: true });
      return;
    }
    const nick = lobby.players[socket.id] ? lobby.players[socket.id].nick : '?';
    const leavingIndex = lobby.players[socket.id]?.index;
    delete lobby.players[socket.id];
    if (leavingIndex !== undefined) lobby.playerOrder = lobby.playerOrder.filter(i => i !== leavingIndex);
    socket.leave(code);
    socket.data.lobby = null;
    if (lobby.adminSocketId === socket.id) {
      const next = Object.keys(lobby.players)[0];
      lobby.adminSocketId = next || null;
    }
    if (Object.keys(lobby.players).length === 0) {
      if (lobby.voteTimer) clearTimeout(lobby.voteTimer);
      delete LOBBIES[code];
    } else {
      addChatMessage(lobby, { type: 'system', text: `🚶 ${escapeNick(nick)} вышел из лобби.` });
      io.to(code).emit('lobby_update', publicLobbyState(lobby));
    }
    if (cb) cb({ ok: true });
  });

  // start round
  socket.on('start_round', ({ code, theme = null }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    const currentPlayersCount = Object.keys(lobby.players).length;
    if (currentPlayersCount < 3) { if (cb) cb({ error: 'Not enough players (min 3)' }); return; }

    let spyCount;
    if (lobby.nextSpyCount !== undefined && lobby.nextSpyCount !== null) {
      spyCount = Math.max(0, Math.min(currentPlayersCount, lobby.nextSpyCount));
    } else {
      const r = Math.random() * 100;
      if (r < 86) spyCount = 1;
      else if (r < 92) spyCount = 2;
      else if (r < 98) spyCount = 0;
      else spyCount = currentPlayersCount;
    }

    const playersArr = Object.entries(lobby.players).map(([sid,p]) => ({ sid, ...p }));
    playersArr.sort((a,b) => a.index - b.index);

    const items = GAME_ITEMS[lobby.gameKey] || [];
    if (!items || items.length === 0) { if (cb) cb({ error: 'No items for this game on server' }); return; }

    const shuffledItems = shuffleWithSeed(items, lobby.seed + 1);
    const sharedItem = shuffledItems[0];

    const rolePool = [];
    for (let i = 0; i < playersArr.length - spyCount; i++) rolePool.push(sharedItem);
    for (let i = 0; i < spyCount; i++) rolePool.push({ id: 'spy', sys: true });
    const shuffledRoles = shuffleWithSeed(rolePool, lobby.seed + 2);

    const assigned = {};
    for (let i = 0; i < playersArr.length; i++) {
      assigned[playersArr[i].index] = shuffledRoles[i];
    }

    lobby.state = 'in-round';
    lobby.round = {
      startedAt: Date.now(), seed: lobby.seed, assigned, theme,
      sharedItem, spyCount,
      spyGuessed: false
    };
    lobby.voteState = null;
    if (lobby.voteTimer) { clearTimeout(lobby.voteTimer); lobby.voteTimer = null; }
    lobby.finishVoteState = null;
    if (lobby.finishVoteTimer) { clearTimeout(lobby.finishVoteTimer); lobby.finishVoteTimer = null; }

    // reset kicked flags — everyone is active in the new round
    for (const p of Object.values(lobby.players)) {
      p.kicked = false;
      p.winner = false;
      p.guessedWrong = false;
    }

    // notify players privately
    for (const [sid, p] of Object.entries(lobby.players)) {
      const role = lobby.round.assigned[p.index];
      const isSpy = role && role.id === 'spy';
      io.to(sid).emit('role_assigned', { role, index: p.index, sharedLabel: lobby.gameKey, isSpy });
    }

    io.to(code).emit('round_started', publicLobbyState(lobby));
    addChatMessage(lobby, { type: 'system', text: `🕵️ Раунд начался! Найдите шпиона!` });
    if (cb) cb({ ok: true });
  });

  // end round (admin)
  socket.on('end_round', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (lobby.adminSocketId !== socket.id) { if (cb) cb({ error: 'Not admin' }); return; }
    if (lobby.voteTimer) { clearTimeout(lobby.voteTimer); lobby.voteTimer = null; }
    if (lobby.finishVoteTimer) { clearTimeout(lobby.finishVoteTimer); lobby.finishVoteTimer = null; }
    lobby.state = 'lobby';
    lobby.round = null;
    lobby.voteState = null;
    lobby.finishVoteState = null;
    lobby.seed = randInt32();
    io.to(code).emit('round_ended', publicLobbyState(lobby));
    addChatMessage(lobby, { type: 'system', text: '🔄 Раунд завершён. Ожидание нового раунда...' });
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

  // ─── CHAT ────────────────────────────────────────────────────────
  socket.on('chat_send', ({ code, text }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'No lobby' }); return; }
    if (!lobby.players[socket.id]) { if (cb) cb({ error: 'Not in lobby' }); return; }
    const nick = lobby.players[socket.id].nick;
    const msg = {
      type: 'player',
      nick: escapeNick(nick),
      color: lobby.players[socket.id].color || '#60a5fa',
      text: String(text).slice(0, 300),
      ts: Date.now()
    };
    addChatMessage(lobby, msg);
    if (cb) cb({ ok: true });
  });

  // get chat history (on join)
  socket.on('get_chat', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'No lobby' }); return; }
    if (cb) cb({ ok: true, messages: lobby.chatMessages || [] });
  });

  // ─── SPY GUESS ────────────────────────────────────────────────────
  // spy submits their final guess (after choosing from local search results)
  socket.on('spy_guess', ({ code, guessId }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby || !lobby.round) { if (cb) cb({ error: 'No active round' }); return; }

    const player = lobby.players[socket.id];
    if (!player) { if (cb) cb({ error: 'Not in lobby' }); return; }
    if (player.kicked) { if (cb) cb({ error: 'Expelled players cannot guess the location' }); return; }

    const role = lobby.round.assigned[player.index];
    if (!role || role.id !== 'spy') { if (cb) cb({ error: 'You are not the spy' }); return; }

    // Per-player check: each spy gets exactly one guess attempt, independent of teammates.
    if (player.winner || player.guessedWrong) {
      if (cb) cb({ error: 'You have already tried to guess' }); return;
    }

    const correctId = lobby.round.sharedItem.id;
    const correct = guessId === correctId;

    if (correct) {
      player.winner = true;
      lobby.round.spyGuessed = true;
      addChatMessage(lobby, {
        type: 'system',
        text: `🎉 Шпион ${escapeNick(player.nick)} угадал карту и победил!`
      });
      socket.emit('spy_guess_result', { correct: true, spyNick: player.nick, guessId, correctId, winner: 'spy' });
      io.to(code).emit('lobby_update', publicLobbyState(lobby));
    } else {
      // Mark as having used their guess (wrong) — excludes them from voting,
      // but does NOT mark them as "kicked" (avoids confusing kicked-by-vote messages).
      player.guessedWrong = true;

      addChatMessage(lobby, {
        type: 'system',
        text: `❌ Шпион ${escapeNick(player.nick)} не угадал карту и выбыл из голосований до конца раунда!`
      });

      // Notify all players about the failed spy guess
      io.to(code).emit('spy_failed', {
        nick: player.nick,
        msg: `🕵️ ${player.nick} попытался угадать, но ошибся и больше не может голосовать в этом раунде!`
      });

      socket.emit('spy_guess_result', { correct: false, spyNick: player.nick, guessId, correctId, winner: 'team' });
      io.to(code).emit('lobby_update', publicLobbyState(lobby));
    }

    if (cb) cb({ ok: true, correct, correctId });
  });

  // ─── VOTE KICK ────────────────────────────────────────────────────
  socket.on('start_vote', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby || !lobby.round) { if (cb) cb({ error: 'No active round' }); return; }
    if (!lobby.players[socket.id]) { if (cb) cb({ error: 'Not in lobby' }); return; }
    if (lobby.players[socket.id].kicked) { if (cb) cb({ error: 'Expelled players cannot start votes' }); return; }
    if (!canVote(lobby.players[socket.id])) { if (cb) cb({ error: 'You can no longer participate in votes' }); return; }
    if (lobby.voteState && lobby.voteState.phase === 'voting') {
      if (cb) cb({ error: 'Vote already in progress' }); return;
    }
    if (lobby.finishVoteState && lobby.finishVoteState.phase === 'voting') {
      if (cb) cb({ error: 'Finish vote in progress' }); return;
    }

    const activePlayers = Object.values(lobby.players).filter(canVote);

    if (activePlayers.length <= 2) {
      if (cb) cb({ error: 'Нельзя голосовать за изгнание при 2 или менее активных игроках.' });
      return;
    }

    const VOTE_DURATION = 60; // seconds

    lobby.voteState = {
      phase: 'voting',
      startedAt: Date.now(),
      endsAt: Date.now() + VOTE_DURATION * 1000,
      votes: {}, // socketId -> playerIndex | null (null=skip)
      initiatorNick: lobby.players[socket.id].nick
    };

    io.to(code).emit('vote_started', {
      voteState: lobby.voteState,
      players: activePlayers.map(p => ({ index: p.index, nick: p.nick })),
      totalActive: activePlayers.length,
      duration: VOTE_DURATION
    });
    addChatMessage(lobby, { type: 'system', text: `⚡ ${escapeNick(lobby.players[socket.id].nick)} начал голосование об изгнании!` });

    // auto-resolve after 60s
    lobby.voteTimer = setTimeout(() => {
      const l = LOBBIES[code];
      if (!l || !l.voteState || l.voteState.phase !== 'voting') return;
      // fill missing votes as skip (null)
      for (const sid of Object.keys(l.players)) {
        if (!(sid in l.voteState.votes)) l.voteState.votes[sid] = null;
      }
      resolveVote(l);
    }, VOTE_DURATION * 1000);

    if (cb) cb({ ok: true });
  });

  socket.on('cast_vote', ({ code, targetIndex }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby || !lobby.voteState || lobby.voteState.phase !== 'voting') {
      if (cb) cb({ error: 'No active vote' }); return;
    }
    if (!lobby.players[socket.id]) { if (cb) cb({ error: 'Not in lobby' }); return; }
    if (lobby.players[socket.id].kicked) { if (cb) cb({ error: 'You are expelled' }); return; }
    if (!canVote(lobby.players[socket.id])) { if (cb) cb({ error: 'You can no longer participate in votes' }); return; }

    // already voted?
    if (socket.id in lobby.voteState.votes) {
      if (cb) cb({ error: 'Already voted' }); return;
    }

    // null = skip, number = target index
    lobby.voteState.votes[socket.id] = targetIndex === null ? null : Number(targetIndex);

    const activePlayers = Object.values(lobby.players).filter(canVote);
    const totalActive = activePlayers.length;
    const votedCount = Object.keys(lobby.voteState.votes).length;

    io.to(code).emit('vote_update', { votedCount, totalActive });
    if (cb) cb({ ok: true });

    // if everyone active voted — resolve early
    if (votedCount >= totalActive) {
      resolveVote(lobby);
    }
  });

  // ─── FINISH MATCH VOTE ────────────────────────────────────────────
  socket.on('start_finish_vote', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby || !lobby.round) { if (cb) cb({ error: 'No active round' }); return; }
    if (!lobby.players[socket.id]) { if (cb) cb({ error: 'Not in lobby' }); return; }
    if (lobby.players[socket.id].kicked) { if (cb) cb({ error: 'Expelled players cannot start votes' }); return; }
    if (!canVote(lobby.players[socket.id])) { if (cb) cb({ error: 'You can no longer participate in votes' }); return; }
    if (lobby.finishVoteState && lobby.finishVoteState.phase === 'voting') {
      if (cb) cb({ error: 'Finish vote already in progress' }); return;
    }
    if (lobby.voteState && lobby.voteState.phase === 'voting') {
      if (cb) cb({ error: 'Kick vote in progress' }); return;
    }

    const VOTE_DURATION = 30;
    lobby.finishVoteState = {
      phase: 'voting',
      startedAt: Date.now(),
      endsAt: Date.now() + VOTE_DURATION * 1000,
      votes: {} // socketId -> 'yes' | 'no'
    };

    const fvActivePlayers = Object.values(lobby.players).filter(canVote);
    io.to(code).emit('finish_vote_started', {
      finishVoteState: lobby.finishVoteState,
      duration: VOTE_DURATION,
      initiatorNick: lobby.players[socket.id].nick,
      totalActive: fvActivePlayers.length
    });
    addChatMessage(lobby, { type: 'system', text: `🏁 ${escapeNick(lobby.players[socket.id].nick)} предлагает завершить матч — все шпионы пойманы?` });

    lobby.finishVoteTimer = setTimeout(() => {
      const l = LOBBIES[code];
      if (!l || !l.finishVoteState || l.finishVoteState.phase !== 'voting') return;
      // fill missing as 'no'
      for (const [sid, p] of Object.entries(l.players)) {
        if (canVote(p) && !(sid in l.finishVoteState.votes)) l.finishVoteState.votes[sid] = 'no';
      }
      resolveFinishVote(l);
    }, VOTE_DURATION * 1000);

    if (cb) cb({ ok: true });
  });

  socket.on('cast_finish_vote', ({ code, answer }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby || !lobby.finishVoteState || lobby.finishVoteState.phase !== 'voting') {
      if (cb) cb({ error: 'No active finish vote' }); return;
    }
    if (!lobby.players[socket.id]) { if (cb) cb({ error: 'Not in lobby' }); return; }
    if (lobby.players[socket.id].kicked) { if (cb) cb({ error: 'Expelled players cannot vote to finish' }); return; }
    if (!canVote(lobby.players[socket.id])) { if (cb) cb({ error: 'You can no longer participate in votes' }); return; }
    if (socket.id in lobby.finishVoteState.votes) { if (cb) cb({ error: 'Already voted' }); return; }

    lobby.finishVoteState.votes[socket.id] = answer === 'yes' ? 'yes' : 'no';

    const totalActive = Object.values(lobby.players).filter(canVote).length;
    const votedCount = Object.keys(lobby.finishVoteState.votes).length;
    io.to(code).emit('finish_vote_update', { votedCount, totalActive });
    if (cb) cb({ ok: true });

    if (votedCount >= totalActive) {
      if (lobby.finishVoteTimer) { clearTimeout(lobby.finishVoteTimer); lobby.finishVoteTimer = null; }
      resolveFinishVote(lobby);
    }
  });

  // get_lobby
  socket.on('get_lobby', ({ code }, cb) => {
    const lobby = LOBBIES[code];
    if (!lobby) { if (cb) cb({ error: 'Lobby not found' }); return; }
    if (cb) cb({ ok: true, lobby: publicLobbyState(lobby) });
  });

  socket.on('ping_keepalive', () => { /* keep alive */ });

  socket.on('disconnect', () => {
    const code = socket.data.lobby;
    if (!code) return;
    const lobby = LOBBIES[code];
    if (!lobby) return;
    const nick = lobby.players[socket.id] ? lobby.players[socket.id].nick : null;
    const disconnectingIndex = lobby.players[socket.id]?.index;
    delete lobby.players[socket.id];
    if (disconnectingIndex !== undefined) lobby.playerOrder = lobby.playerOrder.filter(i => i !== disconnectingIndex);
    socket.leave(code);
    if (lobby.adminSocketId === socket.id) {
      const next = Object.keys(lobby.players)[0] || null;
      lobby.adminSocketId = next;
    }
    if (Object.keys(lobby.players).length === 0) {
      if (lobby.voteTimer) clearTimeout(lobby.voteTimer);
      if (lobby.finishVoteTimer) clearTimeout(lobby.finishVoteTimer);
      delete LOBBIES[code];
    } else {
      if (nick) addChatMessage(lobby, { type: 'system', text: `📴 ${escapeNick(nick)} отключился.` });
      io.to(code).emit('lobby_update', publicLobbyState(lobby));
    }
  });
});

function resolveFinishVote(lobby) {
  if (lobby.finishVoteTimer) { clearTimeout(lobby.finishVoteTimer); lobby.finishVoteTimer = null; }
  const vs = lobby.finishVoteState;
  if (!vs || vs.phase !== 'voting') return;
  vs.phase = 'done';

  const yesVotes = Object.values(vs.votes).filter(v => v === 'yes').length;
  const noVotes  = Object.values(vs.votes).filter(v => v === 'no').length;

  lobby.finishVoteState = null;

  if (yesVotes > noVotes) {
    // match ends — build an objective per-spy status report (no win/lose verdict)
    const spies = [];
    if (lobby.round && lobby.round.assigned) {
      for (const [idxStr, role] of Object.entries(lobby.round.assigned)) {
        if (role && role.id === 'spy') {
          const p = Object.values(lobby.players).find(p2 => p2.index === Number(idxStr));
          const nick = p ? p.nick : `Player${idxStr}`;
          let status;
          if (p && p.winner) status = 'guessed';
          else if (p && p.kicked) status = 'captured';
          else if (p && p.guessedWrong) status = 'failed';
          else status = 'active';
          spies.push({ nick, status });
        }
      }
    }

    const sharedItem = lobby.round ? lobby.round.sharedItem : null;
    const mapName = getItemName(sharedItem);

    const chatSpyReport = spies.length
      ? spies.map(s => {
          if (s.status === 'guessed')  return `${s.nick} (угадал карту)`;
          if (s.status === 'captured') return `${s.nick} (изгнан)`;
          if (s.status === 'failed')   return `${s.nick} (ошибся)`;
          return `${s.nick} (остался в игре)`;
        }).join(', ')
      : 'шпионов не было';
    addChatMessage(lobby, {
      type: 'system',
      text: `🏁 Матч завершён (${yesVotes} за / ${noVotes} против). Карта: ${mapName}. Шпионы: ${chatSpyReport}.`
    });

    // Single unified event — purely factual, no automatic win/lose verdict.
    io.to(lobby.code).emit('match_ended', {
      matchSummary: { mapName, spies },
      yesVotes,
      noVotes
    });

    // automatically reset game state so "Начать раунд" becomes available immediately
    lobby.state = 'lobby';
    lobby.round = null;
    lobby.voteState = null;
    lobby.finishVoteState = null;
    lobby.seed = randInt32(); // new seed so the next round gets a fresh map/spy assignment
    if (lobby.voteTimer) { clearTimeout(lobby.voteTimer); lobby.voteTimer = null; }
    if (lobby.finishVoteTimer) { clearTimeout(lobby.finishVoteTimer); lobby.finishVoteTimer = null; }
    io.to(lobby.code).emit('lobby_update', publicLobbyState(lobby));
  } else {
    addChatMessage(lobby, { type: 'system', text: `❌ Завершение матча не прошло (${yesVotes} за / ${noVotes} против). Игра продолжается!` });
    io.to(lobby.code).emit('finish_vote_rejected', { yesVotes, noVotes });
  }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Lobby server listening on', PORT));