const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generatePieces() {
  const pieces = [];
  for (let i = 0; i <= 6; i++) for (let j = i; j <= 6; j++) pieces.push([i, j]);
  return pieces;
}
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

function canPlayPiece(piece, board) {
  if (board.pieces.length === 0) return ['any'];
  const [a, b] = piece;
  const sides = [];
  if (a === board.leftEnd || b === board.leftEnd) sides.push('left');
  if (a === board.rightEnd || b === board.rightEnd) sides.push('right');
  if (sides.length === 2 && board.leftEnd === board.rightEnd) return ['left'];
  return sides;
}
function placePiece(piece, side, board) {
  const [a, b] = piece;
  const isDouble = a === b;
  if (board.pieces.length === 0) {
    board.pieces.push({ left: a, right: b, isDouble });
    board.leftEnd = a;
    board.rightEnd = b;
    return;
  }

  if (side === 'left') {
    if (a === board.leftEnd) {
      board.pieces.unshift({ left: b, right: a, isDouble });
      board.leftEnd = b;
    } else {
      board.pieces.unshift({ left: a, right: b, isDouble });
      board.leftEnd = a;
    }
    return;
  }

  if (a === board.rightEnd) {
    board.pieces.push({ left: a, right: b, isDouble });
    board.rightEnd = b;
  } else {
    board.pieces.push({ left: b, right: a, isDouble });
    board.rightEnd = a;
  }
}
function piecesMatch(p1, p2) {
  return (p1[0] === p2[0] && p1[1] === p2[1]) || (p1[0] === p2[1] && p1[1] === p2[0]);
}
function handSum(hand) {
  return hand.reduce((sum, piece) => sum + piece[0] + piece[1], 0);
}
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function otherTeam(team) {
  return team === 0 ? 1 : 0;
}
function getStarterDecisionPayload(room, playerId) {
  const decision = room.game?.starterDecision;
  if (!decision) return null;
  const members = decision.playerIds.map(id => {
    const player = room.players.find(entry => entry.id === id);
    return {
      id,
      name: player?.name || 'Jogador',
      choice: decision.responses[id] || null
    };
  });
  return {
    pending: true,
    team: decision.team,
    myChoice: decision.responses[playerId] || null,
    members
  };
}
function createStarterDecision(room, team) {
  const players = room.players.filter(player => player.team === team);
  if (players.length !== 2) return null;
  return {
    team,
    playerIds: players.map(player => player.id),
    responses: {}
  };
}
function resolveStarterDecision(room) {
  const decision = room.game?.starterDecision;
  if (!decision) return null;

  const [firstId, secondId] = decision.playerIds;
  const firstChoice = decision.responses[firstId];
  const secondChoice = decision.responses[secondId];
  if (!firstChoice || !secondChoice) return null;

  let chosenId;
  let random = false;

  if (firstChoice === secondChoice) {
    chosenId = decision.playerIds[Math.floor(Math.random() * decision.playerIds.length)];
    random = true;
  } else {
    chosenId = firstChoice === 'self' ? firstId : secondId;
  }

  const chosenIdx = room.players.findIndex(player => player.id === chosenId);
  if (chosenIdx === -1) return null;

  room.game.currentPlayerIndex = chosenIdx;
  room.game.starterDecision = null;

  return {
    player: room.players[chosenIdx],
    random
  };
}

function gameIsBlocked(board, allHands, pile) {
  if (pile.length > 0) return false;
  for (const hand of allHands) {
    for (const piece of hand) {
      if (canPlayPiece(piece, board).length > 0) return false;
    }
  }
  return true;
}
function matchesBothEnds(piece, board) {
  if (!board || board.pieces.length === 0) return false;
  const [a, b] = piece;
  return (a === board.leftEnd || b === board.leftEnd) && (a === board.rightEnd || b === board.rightEnd);
}
function countPlayablePieces(allHands, board) {
  let total = 0;
  for (const hand of allHands) for (const piece of hand) if (canPlayPiece(piece, board).length > 0) total++;
  return total;
}
function detectCloseType(played, boardBefore, allHandsBefore) {
  if (countPlayablePieces(allHandsBefore, boardBefore) === 1) return 'mandatory';
  const hasOtherPlay = allHandsBefore.some(hand => hand.some(piece => !piecesMatch(piece, played) && canPlayPiece(piece, boardBefore).length > 0));
  return hasOtherPlay ? 'voluntary' : 'mandatory';
}
function handHasValue(hand, value) {
  return hand.some(([a, b]) => a === value || b === value);
}
function getBlockedWinnerTeam(room, closerTeam = null) {
  const counts = room.players.map(player => ({ team: player.team, sum: handSum(player.hand) }));
  const lowest = Math.min(...counts.map(entry => entry.sum));
  const leaders = counts.filter(entry => entry.sum === lowest);
  if (leaders.length === 1) return leaders[0].team;
  if (closerTeam == null) return -1;
  return otherTeam(closerTeam);
}
function buildCounts(room) {
  return room.players.map(player => ({ name: player.name, sum: handSum(player.hand), team: player.team }));
}

function detectClassicWinType(piece, wasDrawn) {
  const [a, b] = piece;
  if (a === 0 && b === 0) return 'buchuda';
  if (wasDrawn) return 'pela';
  if (a === b) return 'carroca';
  return 'simples';
}
function detectBaianoWinType(piece, boardBefore, allHandsAfter, playerIdx, returnedToPlayer) {
  const isDouble = piece[0] === piece[1];
  const isLasquine = matchesBothEnds(piece, boardBefore);

  if (isLasquine) {
    const endValues = [...new Set([boardBefore.leftEnd, boardBefore.rightEnd])];
    const presa = !allHandsAfter.some((hand, idx) => idx !== playerIdx && endValues.some(value => handHasValue(hand, value)));
    if (presa && returnedToPlayer) return 'dobrada';
    if (presa) return 'lasquinepresa';
    return 'lasquine';
  }

  if (isDouble) return 'bucha';
  return 'simples';
}

function checkMatchWin(room, team) {
  if (room.config.mode === 'baiano' && room.game.teamPecas[team] >= room.config.targetPecas) {
    room.game.matchWinner = team;
  }
}
function setBaianoMatchWinner(room, team) {
  room.game.matchWinner = team;
  room.game.teamPecas[team] = Math.max(room.game.teamPecas[team], room.config.targetPecas);
}
function awardBaianoPecas(room, team, amount, opts = {}) {
  const { preservePoints = true, finishMatch = false } = opts;
  room.game.teamPecas[team] += amount;
  if (!preservePoints) {
    room.game.teamPoints = [0, 0];
    room.game.baianoRaceTarget = 3;
  }
  if (finishMatch) setBaianoMatchWinner(room, team);
  else checkMatchWin(room, team);
}
function applyBaianoSimple(room, team) {
  const rival = otherTeam(team);
  const points = room.game.teamPoints;
  const mine = points[team];
  const theirs = points[rival];

  // Em 5: ganha peça e zera os dois
  if (mine === 5) {
    points[0] = 0;
    points[1] = 0;
    room.game.teamPecas[team]++;
    checkMatchWin(room, team);
    return { earnedPeca: true };
  }

  // Empate 3x3: quem ganhou vai pra 5, quem perdeu zera
  if (mine === 3 && theirs === 3) {
    points[team] = 5;
    points[rival] = 0;
    return { earnedPeca: false };
  }

  // Avanco normal: 0→3, 3→5
  points[team] = mine === 0 ? 3 : 5;
  return { earnedPeca: false };
}

const CLASSIC_PTS = { simples: 1, carroca: 2, pela: 3, buchuda: 3 };
function applyClassicWin(room, team, winType) {
  const points = CLASSIC_PTS[winType] || 1;
  room.game.teamScores[team] = (room.game.teamScores[team] || 0) + points;
  room.players.filter(player => player.team === team).forEach(player => {
    player.score = (player.score || 0) + points;
  });
}
function getWinnerTeam(room) {
  const { players } = room;
  if (players.length === 4) {
    const score0 = players.filter(player => player.team === 0).reduce((sum, player) => sum + handSum(player.hand), 0);
    const score1 = players.filter(player => player.team === 1).reduce((sum, player) => sum + handSum(player.hand), 0);
    return score0 < score1 ? 0 : score1 < score0 ? 1 : -1;
  }
  const sorted = [...players].sort((a, b) => handSum(a.hand) - handSum(b.hand));
  if (sorted.length > 1 && handSum(sorted[0].hand) === handSum(sorted[1].hand)) return -1;
  return sorted[0].team;
}

function getBaianoRaceLabel(room) {
  const [t0, t1] = room.game.teamPoints;
  if (t0 === 0 && t1 === 0 && room.game.baianoRaceTarget === 5) return '0 a 0 pra 5';
  if (t0 === 0 && t1 === 0 && room.game.baianoRaceTarget === 'piece') return '0 a 0 pra peca';
  return `${t0} x ${t1}`;
}
function getBaianoTeamLabel(room, team) {
  return `${room.game.teamPecas[team]} peca(s) e ${room.game.teamPoints[team]} ponto(s)`;
}
function getBaianoScoreSummary(room) {
  return `Time 1 ${getBaianoTeamLabel(room, 0)} | Time 2 ${getBaianoTeamLabel(room, 1)} (${getBaianoRaceLabel(room)})`;
}
function buildBaianoPtsLabel(room) {
  return getBaianoScoreSummary(room);
}

const WIN_META = {
  simples: { emoji: '🎉', label: 'Batida Simples' },
  carroca: { emoji: '🦴', label: 'Batida de Carroca' },
  pela: { emoji: '⚡', label: 'Batida Pela' },
  buchuda: { emoji: '👑', label: 'Batida Buchuda [0|0]' },
  bucha: { emoji: '🦴', label: 'Bateu de Bucha' },
  lasquine: { emoji: '🎯', label: 'Lasquine' },
  lasquinepresa: { emoji: '💥', label: 'Lasquine Presa' },
  dobrada: { emoji: '🔥', label: 'Dobrada' }
};

function buildReason(winType, name, mode, room) {
  if (mode !== 'baiano') {
    const map = {
      simples: `${name} jogou todas as pecas normalmente. Vale 1 ponto.`,
      carroca: `${name} terminou com uma carroca. Vale 2 pontos.`,
      pela: `${name} comprou do estoque e bateu na mesma rodada. Vale 3 pontos.`,
      buchuda: `${name} terminou com o [0|0]. Vale 3 pontos.`
    };
    return map[winType] || '';
  }

  const score = `Placar: ${getBaianoScoreSummary(room)}.`;
  const map = {
    simples: `${name} bateu simples. ${score}`,
    bucha: `${name} bateu com uma bucha. Vale 1 peca direta e os pontos continuam valendo. ${score}`,
    lasquine: `${name} bateu de lasquine, encaixando a ultima peca nas duas pontas ao mesmo tempo. Vale 1 peca direta. ${score}`,
    lasquinepresa: `${name} bateu de lasquine presa. Ninguem mais tinha os valores das pontas. Vale 2 pecas diretas. ${score}`,
    dobrada: `${name} jogou duas vezes seguidas depois da mesa inteira passar e bateu de dobrada. Vale 2 pecas diretas. ${score}`
  };
  return map[winType] || score;
}

function resolveBaianoBlock(room, closerTeam, closerName, closingPiece, closeType) {
  const winnerTeam = getBlockedWinnerTeam(room, closerTeam);
  const counts = buildCounts(room);

  if (closeType === 'mandatory') {
    if (winnerTeam !== -1) applyBaianoSimple(room, winnerTeam);
    const folgandoBucha = closingPiece && closingPiece[0] === closingPiece[1];
    return {
      closeType,
      winnerTeam,
      emoji: '🔒',
      label: folgandoBucha ? 'Fechada Folgando Bucha' : 'Fechada Obrigatoria',
      reason: `A unica peca jogavel fechava a mesa dos dois lados. Vale so uma batida simples. ${getBaianoScoreSummary(room)}.`,
      counts
    };
  }

  if (winnerTeam === closerTeam) {
    awardBaianoPecas(room, closerTeam, 1, { preservePoints: true });
    return {
      closeType: 'voluntary_win',
      winnerTeam: closerTeam,
      emoji: '🏆',
      label: 'Fechou e Ganhou',
      reason: `${closerName} fechou o jogo e a menor mao individual ficou com sua dupla. Vale 1 peca direta. ${getBaianoScoreSummary(room)}.`,
      counts
    };
  }

  const punishedTeam = closerTeam == null ? otherTeam(winnerTeam) : otherTeam(closerTeam);
  if (winnerTeam !== -1) awardBaianoPecas(room, winnerTeam, 2, { preservePoints: true });
  return {
    closeType: 'voluntary_lose',
    winnerTeam,
    emoji: '😢',
    label: 'Chorao',
    reason: `${closerName} fechou, mas perdeu na menor mao individual. A outra dupla ganha 2 pecas e a partida acaba se atingir a meta. ${getBaianoScoreSummary(room)}.`,
    counts
  };
}

function startGame(room) {
  const pieces = shuffle(generatePieces());
  const numPlayers = room.players.length;
  const mode = room.config.mode;
  const hadWinner = room.game?.matchWinner != null;

  const prevTeamPoints = room.game?.teamPoints;
  const prevTeamPecas = room.game?.teamPecas;
  const prevRaceTarget = room.game?.baianoRaceTarget;
  const prevScores = room.game?.teamScores;

  room.players.forEach((player, idx) => {
    player.hand = pieces.splice(0, 7);
    player.team = numPlayers === 4 ? idx % 2 : idx;
    if (hadWinner) player.score = 0;
  });

  let firstIdx = 0;
  let requiredFirst = null;
  let starterDecision = null;

  const canWinnerChooseStart = mode === 'baiano' && numPlayers === 4 && room.lastRoundWinnerTeam != null && !hadWinner;

  if (canWinnerChooseStart) {
    starterDecision = createStarterDecision(room, room.lastRoundWinnerTeam);
    firstIdx = null;
  } else if (mode === 'baiano') {
    for (let i = 0; i < numPlayers; i++) {
      if (room.players[i].hand.some(piece => piece[0] === 1 && piece[1] === 1)) {
        firstIdx = i;
        requiredFirst = [1, 1];
        break;
      }
    }
    if (!requiredFirst) {
      let highestDouble = -1;
      room.players.forEach((player, idx) => {
        player.hand.forEach(piece => {
          if (piece[0] === piece[1] && piece[0] > highestDouble) {
            highestDouble = piece[0];
            firstIdx = idx;
            requiredFirst = piece;
          }
        });
      });
    }
  } else {
    let highestDouble = -1;
    room.players.forEach((player, idx) => {
      player.hand.forEach(piece => {
        if (piece[0] === piece[1] && piece[0] > highestDouble) {
          highestDouble = piece[0];
          firstIdx = idx;
          requiredFirst = piece;
        }
      });
    });
  }

  const numTeams = numPlayers === 4 ? 2 : numPlayers;
  const teamScores = hadWinner ? new Array(numTeams).fill(0) : (prevScores?.length === numTeams ? [...prevScores] : new Array(numTeams).fill(0));
  const teamPoints = mode === 'baiano'
    ? (hadWinner ? [0, 0] : (prevTeamPoints?.length === 2 ? [...prevTeamPoints] : [0, 0]))
    : new Array(numTeams).fill(0);
  const teamPecas = mode === 'baiano'
    ? (hadWinner ? [0, 0] : (prevTeamPecas?.length === 2 ? [...prevTeamPecas] : [0, 0]))
    : new Array(numTeams).fill(0);
  const baianoRaceTarget = mode === 'baiano' ? (hadWinner ? 3 : (prevRaceTarget || 3)) : 3;

  if (hadWinner) room.lastRoundWinnerTeam = null;

  room.game = {
    board: { pieces: [], leftEnd: null, rightEnd: null },
    pile: pieces,
    currentPlayerIndex: firstIdx,
    started: true,
    passCount: 0,
    lastDrawnPiece: null,
    requiredFirst,
    teamScores,
    teamPoints,
    teamPecas,
    baianoRaceTarget,
    starterDecision,
    matchWinner: null,
    lastPlayedById: null,
    returnTurnPlayerId: null,
    lastPlayContext: null,
    turnTimer: null,
    turnStartTime: null
  };
}

function clearTurnTimer(room) {
  if (room.game?.turnTimer) {
    clearTimeout(room.game.turnTimer);
    room.game.turnTimer = null;
  }
}
function startTurnTimer(room) {
  clearTurnTimer(room);
  const secs = room.config?.timePerTurn;
  if (room.game?.currentPlayerIndex == null) {
    room.game.turnStartTime = null;
    return;
  }
  if (!secs || secs <= 0) return;
  room.game.turnStartTime = Date.now();
  room.game.turnTimer = setTimeout(() => autoPass(room), secs * 1000);
}
function autoPass(room) {
  if (!room?.game?.started) return;
  if (room.game.currentPlayerIndex == null) return;
  const { game, players, config } = room;
  const curr = players[game.currentPlayerIndex];
  game.passCount++;
  game.lastDrawnPiece = null;
  io.to(room.code).emit('player-passed', { name: curr.name, id: curr.id });
  if (game.passCount >= players.length) {
    if (config.mode === 'baiano') {
      const ctx = game.lastPlayContext;
      const closeType = ctx ? detectCloseType(ctx.piece, ctx.boardBefore, ctx.allHandsBefore) : 'voluntary';
      const payload = resolveBaianoBlock(room, ctx?.closerTeam ?? null, ctx?.closerName || 'A mesa', ctx?.piece || null, closeType);
      return endRound(room, 'game-blocked', payload);
    }
    const winnerTeam = getWinnerTeam(room);
    if (winnerTeam !== -1) applyClassicWin(room, winnerTeam, 'simples');
    return endRound(room, 'game-blocked', {
      closeType: 'blocked', winnerTeam, emoji: '🔒', label: 'Jogo Travado',
      reason: 'Todos passaram. Menor contagem vence. Vale 1 ponto.',
      counts: buildCounts(room)
    });
  }
  const nextIndex = (game.currentPlayerIndex + 1) % players.length;
  if (game.passCount === players.length - 1 && players[nextIndex].id === game.lastPlayedById) {
    game.returnTurnPlayerId = game.lastPlayedById;
  }
  game.currentPlayerIndex = nextIndex;
  broadcastState(room);
}

function broadcastState(room) {
  const { game, players, config } = room;
  startTurnTimer(room);
  players.forEach(player => {
    const sock = io.sockets.sockets.get(player.id);
    if (!sock) return;
    const currentPlayer = game.currentPlayerIndex == null ? null : players[game.currentPlayerIndex];
    sock.emit('game-state', {
      hand: player.hand,
      board: game.board,
      currentPlayerId: currentPlayer?.id || null,
      currentPlayerName: currentPlayer?.name || null,
      pileCount: game.pile.length,
      players: players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar || '?', handCount: p.hand.length, team: p.team, score: p.score || 0 })),
      requiredFirst: game.requiredFirst,
      starterDecision: getStarterDecisionPayload(room, player.id),
      config,
      teamScores: game.teamScores,
      teamPoints: game.teamPoints,
      teamPecas: game.teamPecas,
      baianoRaceTarget: game.baianoRaceTarget,
      turnStartTime: game.turnStartTime || null,
      timePerTurn: config.timePerTurn || 0
    });
  });
}

function endRound(room, eventName, data) {
  clearTurnTimer(room);
  room.game.started = false;
  room.lastRoundWinnerTeam = room.config.mode === 'baiano' && Number.isInteger(data.winnerTeam) && data.winnerTeam >= 0
    ? data.winnerTeam
    : null;
  data.board = room.game.board;
  data.allHands = room.players.map(player => ({ id: player.id, name: player.name, hand: player.hand, team: player.team }));
  data.teamScores = room.game.teamScores;
  data.teamPoints = room.game.teamPoints;
  data.teamPecas = room.game.teamPecas;
  data.baianoRaceTarget = room.game.baianoRaceTarget;
  data.config = room.config;
  data.matchWinner = room.game.matchWinner;
  data.players = room.players.map(player => ({
    id: player.id,
    name: player.name,
    avatar: player.avatar || '?',
    score: player.score || 0,
    team: player.team,
    handCount: player.hand.length
  }));
  io.to(room.code).emit(eventName, data);
}

function emitRoomUpdate(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room-update', {
    players: room.players.map(player => ({ id: player.id, name: player.name, avatar: player.avatar || '?', score: player.score || 0 })),
    config: room.config,
    hostId: room.host
  });
}

io.on('connection', socket => {
  socket.on('create-room', ({ name, avatar }) => {
    const code = generateCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name, avatar: avatar || '?', hand: [], team: 0, score: 0 }],
      config: { mode: 'classic', targetPecas: 6, timePerTurn: 0 },
      lastRoundWinnerTeam: null,
      game: null
    };
    socket.join(code);
    socket.data.code = code;
    socket.data.name = name;
    socket.emit('room-created', { code });
    emitRoomUpdate(code);
  });

  socket.on('join-room', ({ code, name, avatar }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { msg: 'Sala nao encontrada.' });
    if (room.game?.started) return socket.emit('error', { msg: 'Jogo ja em andamento.' });
    if (room.players.length >= 4) return socket.emit('error', { msg: 'Sala cheia.' });
    const chosenAvatar = avatar || '?';
    const takenBy = chosenAvatar !== '?' ? room.players.find(p => p.avatar === chosenAvatar) : null;
    if (takenBy) return socket.emit('error', { msg: `${chosenAvatar} ja foi escolhido por ${takenBy.name}. Escolha outro personagem.` });
    room.players.push({ id: socket.id, name, avatar: chosenAvatar, hand: [], team: room.players.length, score: 0 });
    socket.join(code);
    socket.data.code = code;
    socket.data.name = name;
    socket.emit('room-joined', { code });
    emitRoomUpdate(code);
  });

  socket.on('rejoin', ({ code, name }) => {
    const room = rooms[code];
    if (!room) return socket.emit('rejoin-fail');
    const player = room.players.find(p => p.name === name);
    if (!player) return socket.emit('rejoin-fail');
    const oldId = player.id;
    player.id = socket.id;
    socket.data.code = code;
    socket.data.name = name;
    socket.join(code);
    if (room.host === oldId) room.host = socket.id;
    if (room.game?.started) {
      broadcastState(room);
    } else {
      socket.emit('room-joined', { code });
      emitRoomUpdate(code);
    }
  });

  socket.on('set-config', ({ mode, targetPecas, timePerTurn }) => {
    const room = rooms[socket.data.code];
    if (!room || room.host !== socket.id) return;
    if (mode !== undefined) room.config.mode = ['classic', 'baiano'].includes(mode) ? mode : room.config.mode;
    if (targetPecas !== undefined) room.config.targetPecas = Math.max(1, Math.min(20, parseInt(targetPecas, 10) || 6));
    if (timePerTurn !== undefined) room.config.timePerTurn = Math.max(0, Math.min(120, parseInt(timePerTurn, 10) || 0));
    if (mode !== undefined) room.lastRoundWinnerTeam = null;
    emitRoomUpdate(room.code);
  });

  socket.on('change-avatar', ({ avatar }) => {
    const room = rooms[socket.data.code];
    if (!room || room.game?.started) return;
    const validAvatars = ['🦁','🐯','🐻','🦊','🐺','🐸','🐙','🦅','🦋','🐲','🦄','🐬','🦈','🦉','🐧','🦚'];
    if (!validAvatars.includes(avatar)) return socket.emit('error', { msg: 'Personagem invalido.' });
    const takenBy = room.players.find(p => p.id !== socket.id && p.avatar === avatar);
    if (takenBy) return socket.emit('error', { msg: `${avatar} ja foi escolhido por ${takenBy.name}.` });
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.avatar = avatar;
    emitRoomUpdate(room.code);
  });

  socket.on('start-game', () => {
    const room = rooms[socket.data.code];
    if (!room || room.host !== socket.id) return;
    if (room.config.mode === 'baiano' && room.players.length !== 4) {
      return socket.emit('error', { msg: 'O Baiano exige 4 jogadores em 2 duplas.' });
    }
    if (room.players.length < 2) return socket.emit('error', { msg: 'Minimo 2 jogadores.' });
    startGame(room);
    broadcastState(room);
  });

  socket.on('play-piece', ({ pieceIndex, side }) => {
    const room = rooms[socket.data.code];
    if (!room?.game?.started) return;
    if (room.game.currentPlayerIndex == null) return socket.emit('error', { msg: 'Aguardando a dupla vencedora decidir quem abre.' });

    const { game, players, config } = room;
    const curr = players[game.currentPlayerIndex];
    if (curr.id !== socket.id) return socket.emit('error', { msg: 'Nao e sua vez.' });

    const piece = curr.hand[pieceIndex];
    if (!piece) return socket.emit('error', { msg: 'Peca invalida.' });

    if (game.requiredFirst) {
      if (!piecesMatch(piece, game.requiredFirst)) {
        return socket.emit('error', { msg: `Primeira peca: [${game.requiredFirst[0]}|${game.requiredFirst[1]}]` });
      }
      game.requiredFirst = null;
    }

    const validSides = canPlayPiece(piece, game.board);
    if (validSides.length === 0) return socket.emit('error', { msg: 'Peca nao encaixa.' });

    let actualSide = side;
    if (game.board.pieces.length === 0) actualSide = 'right';
    else if (validSides.length === 1) actualSide = validSides[0];
    else if (!['left', 'right'].includes(side) || !validSides.includes(side)) return socket.emit('error', { msg: 'Escolha um lado.' });

    const wasDrawn = game.lastDrawnPiece && piecesMatch(piece, game.lastDrawnPiece);
    const boardBefore = deepCopy(game.board);
    const allHandsBefore = players.map(player => player.hand.map(tile => [...tile]));
    const playerIdx = game.currentPlayerIndex;
    const returnedToPlayer = game.returnTurnPlayerId === curr.id;

    placePiece(piece, actualSide, game.board);
    curr.hand.splice(pieceIndex, 1);

    game.lastDrawnPiece = null;
    game.passCount = 0;
    game.lastPlayedById = curr.id;
    game.returnTurnPlayerId = null;
    game.lastPlayContext = {
      piece: [...piece],
      boardBefore,
      allHandsBefore,
      closerTeam: curr.team,
      closerName: curr.name
    };

    if (curr.hand.length === 0) {
      let winType;
      let ptsLabel = '';

      if (config.mode === 'baiano') {
        winType = detectBaianoWinType(piece, boardBefore, players.map(player => player.hand), playerIdx, returnedToPlayer);

        if (winType === 'lasquinepresa') {
          awardBaianoPecas(room, curr.team, 2, { preservePoints: true });
          ptsLabel = '+2 pecas diretas';
        } else if (winType === 'dobrada') {
          awardBaianoPecas(room, curr.team, 2, { preservePoints: true });
          ptsLabel = '+2 pecas diretas';
        } else if (winType === 'lasquine' || winType === 'bucha') {
          awardBaianoPecas(room, curr.team, 1, { preservePoints: true });
          ptsLabel = '+1 peca direta';
        } else {
          const result = applyBaianoSimple(room, curr.team);
          ptsLabel = result.earnedPeca ? 'Subiu peca' : buildBaianoPtsLabel(room);
        }
      } else {
        winType = detectClassicWinType(piece, wasDrawn);
        applyClassicWin(room, curr.team, winType);
        ptsLabel = `+${CLASSIC_PTS[winType] || 1} ponto(s)`;
      }

      const info = WIN_META[winType] || { emoji: '🎉', label: winType };
      const reason = buildReason(winType, curr.name, config.mode, room);
      return endRound(room, 'game-over', {
        winnerId: curr.id,
        winnerName: curr.name,
        winnerTeam: curr.team,
        winType,
        ptsLabel,
        ...info,
        reason
      });
    }

    if (gameIsBlocked(game.board, players.map(player => player.hand), game.pile)) {
      const closeType = detectCloseType(piece, boardBefore, allHandsBefore);

      if (config.mode === 'baiano') {
        return endRound(room, 'game-blocked', resolveBaianoBlock(room, curr.team, curr.name, piece, closeType));
      }

      const winnerTeam = getWinnerTeam(room);
      if (winnerTeam !== -1) applyClassicWin(room, winnerTeam, 'simples');
      return endRound(room, 'game-blocked', {
        closeType: 'blocked',
        winnerTeam,
        emoji: '🔒',
        label: 'Jogo Travado',
        reason: 'Ninguem pode jogar. Menor contagem de pontos vence. Vale 1 ponto.',
        counts: buildCounts(room)
      });
    }

    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % players.length;
    broadcastState(room);
  });

  socket.on('draw-piece', () => {
    const room = rooms[socket.data.code];
    if (!room?.game?.started) return;
    if (room.game.currentPlayerIndex == null) return socket.emit('error', { msg: 'Aguardando a dupla vencedora decidir quem abre.' });

    const { game, players } = room;
    const curr = players[game.currentPlayerIndex];
    if (curr.id !== socket.id) return;
    if (game.pile.length === 0) return socket.emit('error', { msg: 'Estoque vazio.' });

    const drawn = game.pile.pop();
    curr.hand.push(drawn);
    game.lastDrawnPiece = drawn;
    socket.emit('piece-drawn', { piece: drawn });
    broadcastState(room);
  });

  socket.on('pass-turn', () => {
    const room = rooms[socket.data.code];
    if (!room?.game?.started) return;
    if (room.game.currentPlayerIndex == null) return socket.emit('error', { msg: 'Aguardando a dupla vencedora decidir quem abre.' });
    if (room.players[room.game.currentPlayerIndex].id !== socket.id) return;
    autoPass(room);
  });

  socket.on('starter-choice', ({ choice }) => {
    const room = rooms[socket.data.code];
    if (!room?.game?.started) return;
    const decision = room.game.starterDecision;
    if (!decision) return socket.emit('error', { msg: 'Nao ha escolha pendente para abrir a rodada.' });
    if (!['self', 'partner'].includes(choice)) return socket.emit('error', { msg: 'Escolha invalida.' });
    if (!decision.playerIds.includes(socket.id)) return socket.emit('error', { msg: 'So a dupla vencedora pode decidir quem abre.' });
    if (decision.responses[socket.id]) return socket.emit('error', { msg: 'Sua escolha ja foi enviada.' });

    decision.responses[socket.id] = choice;
    const resolved = resolveStarterDecision(room);
    if (resolved) {
      io.to(room.code).emit('starter-selected', {
        playerId: resolved.player.id,
        name: resolved.player.name,
        team: resolved.player.team,
        random: resolved.random
      });
    }
    broadcastState(room);
  });

  socket.on('play-again', () => {
    const room = rooms[socket.data.code];
    if (!room || room.host !== socket.id) return;
    if (room.config.mode === 'baiano' && room.players.length !== 4) return;
    startGame(room);
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    clearTurnTimer(room);
    room.players = room.players.filter(player => player.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[code];
      return;
    }

    if (room.host === socket.id) room.host = room.players[0].id;
    io.to(code).emit('player-left', { name: socket.data.name });
    emitRoomUpdate(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Domino rodando em http://localhost:${PORT}`));
