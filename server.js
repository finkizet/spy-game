const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

function randInt32() {
  return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
}

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

// In-memory store: { lobbyId: {seed, game, playersCount, slots: {index: token}, tokens: {token: index}, assigned: {index:role}, items} }
const LOBBIES = {};

// Generate short human code for lobby (6 chars)
function genLobbyCode() {
  const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusing chars
  let out = '';
  for (let i = 0; i < 6; i++) out += s[Math.floor(Math.random() * s.length)];
  return out;
}

// Create lobby
app.post('/create', (req, res) => {
  const { gameKey, playersCount } = req.body;
  if (!gameKey || !playersCount) return res.status(400).json({ error: 'gameKey and playersCount required' });
  // create code
  let code;
  do { code = genLobbyCode(); } while (LOBBIES[code]);
  const seed = randInt32();
  LOBBIES[code] = {
    seed,
    gameKey,
    playersCount,
    slots: {},      // index -> token
    tokens: {},     // token -> index
    assigned: {},   // index -> item (object)
    createdAt: Date.now()
  };
  return res.json({ lobbyId: code });
});

// Join lobby: claim a playerIndex
app.post('/lobby/:id/join', (req, res) => {
  const id = req.params.id;
  const { playerIndex } = req.body;
  const lobby = LOBBIES[id];
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  if (!Number.isInteger(playerIndex) || playerIndex < 1 || playerIndex > lobby.playersCount)
    return res.status(400).json({ error: 'Bad playerIndex' });
  if (lobby.slots[playerIndex]) return res.status(409).json({ error: 'Index already taken' });
  const token = uuidv4();
  lobby.slots[playerIndex] = token;
  lobby.tokens[token] = playerIndex;
  return res.json({ token, playerIndex, lobbyId: id });
});

// Get role — must send Authorization: Bearer <token>
app.post('/lobby/:id/role', (req, res) => {
  const id = req.params.id;
  const lobby = LOBBIES[id];
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

  const auth = req.headers.authorization || '';
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'No token provided' });
  const token = parts[1];
  const playerIndex = lobby.tokens[token];
  if (!playerIndex) return res.status(403).json({ error: 'Invalid token' });

  // Get items list for this game from a simple built-in map (we'll put small map here)
  const GAMES = {
    clash: require('./game_items_clash.json'),
    dota: require('./game_items_dota.json')
  };
  const gameItems = (GAMES[lobby.gameKey] && GAMES[lobby.gameKey].items) || null;
  if (!gameItems) return res.status(500).json({ error: 'Game items not found on server' });

  // If already assigned — return it
  if (lobby.assigned[playerIndex]) {
    return res.json({ role: lobby.assigned[playerIndex], repeated: true });
  }

  // Determine shared item deterministically from lobby.seed
  const shuffledItems = shuffleWithSeed(gameItems, lobby.seed + 1);
  const sharedItem = shuffledItems[0];

  const roles = [];
  for (let i = 0; i < lobby.playersCount - 1; i++) roles.push(sharedItem);
  roles.push({ id: 'spy', sys: true });

  const shuffledRoles = shuffleWithSeed(roles, lobby.seed + 2);
  const assigned = shuffledRoles[playerIndex - 1];

  // save and return
  lobby.assigned[playerIndex] = assigned;
  return res.json({ role: assigned, repeated: false });
});

// Simple lobby info (public)
app.get('/lobby/:id/info', (req, res) => {
  const lobby = LOBBIES[req.params.id];
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  return res.json({
    lobbyId: req.params.id,
    gameKey: lobby.gameKey,
    playersCount: lobby.playersCount,
    createdAt: lobby.createdAt
  });
});

// For debug: list lobbies (only allowed in dev)
if (process.env.NODE_ENV !== 'production') {
  app.get('/_debug/lobbies', (req, res) => res.json(LOBBIES));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Lobby server listening on', PORT));
