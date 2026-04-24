const socket = io();
const S = {
  myId: null,
  myName: null,
  roomCode: null,
  isHost: false,
  hand: [],
  board: null,
  currentPlayerId: null,
  players: [],
  pileCount: 0,
  selectedIdx: null,
  requiredFirst: null,
  config: { mode: 'classic', targetPecas: 6, timePerTurn: 0 },
  teamScores: [],
  teamPoints: [0, 0],
  teamPecas: [0, 0],
  baianoRaceTarget: 3,
  starterDecision: null,
  timePerTurn: 0,
  turnStartTime: null
};
let timerInterval = null;

const $ = id => document.getElementById(id);
const screens = { lobby: $('screenLobby'), waiting: $('screenWaiting'), game: $('screenGame') };
const SVG_NS = 'http://www.w3.org/2000/svg';
// Dot coords within a 50×50 half. H=horizontal layout, V=vertical (doubles).
const DOT_COORDS = {
  0: [],
  1: [[25, 25]],
  2: [[15, 15], [35, 35]],
  3: [[15, 15], [25, 25], [35, 35]],
  4: [[15, 15], [35, 15], [15, 35], [35, 35]],
  5: [[15, 15], [35, 15], [25, 25], [15, 35], [35, 35]],
  6: [[13, 15], [25, 15], [37, 15], [13, 35], [25, 35], [37, 35]]  // 3 across top, 3 across bottom
};
const DOT_COORDS_V = {
  ...DOT_COORDS,
  6: [[15, 13], [15, 25], [15, 37], [35, 13], [35, 25], [35, 37]]  // 2 columns of 3
};

function showScreen(name) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  screens[name].classList.add('active');
}
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.replace('show', 'hidden'), 3000);
}
function canPlayPiece(piece, board) {
  if (!board || board.pieces.length === 0) return ['any'];
  const [a, b] = piece;
  const sides = [];
  if (a === board.leftEnd || b === board.leftEnd) sides.push('left');
  if (a === board.rightEnd || b === board.rightEnd) sides.push('right');
  if (sides.length === 2 && board.leftEnd === board.rightEnd) return ['left'];
  return sides;
}
function hasAnyMove(hand, board) {
  return hand.some(piece => canPlayPiece(piece, board).length > 0);
}

function makePiece(left, right, opts = {}) {
  const orientation = opts.orientation || (left === right ? 'v' : 'h');
  const isV = orientation === 'v';
  const W = isV ? 50 : 100;
  const H = isV ? 100 : 50;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.className.baseVal = `domino ${orientation}`;
  if (opts.selectable) svg.classList.add('selectable');
  if (opts.selected) svg.classList.add('selected');
  if (opts.disabled) svg.classList.add('disabled');
  if (opts.newPiece) svg.classList.add('new-piece');

  const el = (tag, attrs) => {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };

  svg.appendChild(el('rect', { width: W, height: H, rx: 5, ry: 5, class: 'dom-bg' }));
  svg.appendChild(el('rect', { width: W, height: H, rx: 5, ry: 5, fill: 'url(#dg-sheen)', 'pointer-events': 'none' }));
  svg.appendChild(el('rect', { x: 1, y: 1, width: W - 2, height: H - 2, rx: 4, ry: 4, fill: 'none', class: 'dom-border' }));
  if (isV) {
    svg.appendChild(el('line', { x1: 4, y1: 50, x2: W - 4, y2: 50, class: 'dom-div' }));
  } else {
    svg.appendChild(el('line', { x1: 50, y1: 4, x2: 50, y2: H - 4, class: 'dom-div' }));
  }

  const coords = isV ? DOT_COORDS_V : DOT_COORDS;
  const addDots = (value, ox, oy) => {
    (coords[value] || []).forEach(([dx, dy]) => {
      svg.appendChild(el('circle', { cx: dx + ox, cy: dy + oy, r: 3.8, class: 'dom-dot' }));
    });
  };
  addDots(left, 0, 0);
  addDots(right, isV ? 0 : 50, isV ? 50 : 0);

  return svg;
}
function renderLogoPiece() {
  const host = $('logoPiece');
  if (!host) return;
  host.replaceChildren(makePiece(6, 6, { orientation: 'h' }));
}

function formatBaianoRaceLabel(points = S.teamPoints, raceTarget = S.baianoRaceTarget) {
  const team0 = points?.[0] || 0;
  const team1 = points?.[1] || 0;
  if (team0 === 0 && team1 === 0 && raceTarget === 5) return '0 a 0 pra 5';
  if (team0 === 0 && team1 === 0 && raceTarget === 'piece') return '0 a 0 pra peca';
  return `${team0} x ${team1}`;
}
function formatBaianoTeamLabel(team, points = S.teamPoints, pecas = S.teamPecas) {
  const teamPoints = points?.[team] || 0;
  const teamPecas = pecas?.[team] || 0;
  return `${teamPecas} peca${teamPecas === 1 ? '' : 's'} e ${teamPoints}`;
}
function getMyPlayer() {
  return S.players.find(player => player.id === S.myId) || null;
}
function getStarterContext() {
  const decision = S.starterDecision;
  if (!decision?.pending) return null;
  return {
    decision,
    me: decision.members?.find(member => member.id === S.myId) || null,
    partner: decision.members?.find(member => member.id !== S.myId) || null,
    myPlayer: getMyPlayer()
  };
}
function formatStarterChoice(choice) {
  if (choice === 'self') return 'eu começo';
  if (choice === 'partner') return 'pode começar';
  return 'aguardando';
}
function syncStarterDecisionModal() {
  const modal = $('modalStarter');
  const ctx = getStarterContext();
  if (!ctx || ctx.myPlayer?.team !== ctx.decision.team || !ctx.me || !ctx.partner) {
    modal.classList.add('hidden');
    return;
  }

  $('starterTitle').textContent = 'Quem abre a rodada?';
  $('starterText').textContent = `Voce e ${ctx.partner.name} ganharam a rodada anterior. Decidam quem vai começar.`;
  $('starterHint').textContent = ctx.me.choice
    ? 'Se os dois escolherem a mesma opcao, o sistema sorteia automaticamente entre voces.'
    : `Escolha "Eu começo" para abrir ou "Pode começar" para deixar ${ctx.partner.name} abrir.`;

  const status = $('starterStatus');
  status.innerHTML = '';
  [ctx.me, ctx.partner].forEach(member => {
    const row = document.createElement('div');
    row.className = 'starter-row';
    row.innerHTML = `<span>${member.id === S.myId ? 'Voce' : member.name}</span><span>${formatStarterChoice(member.choice)}</span>`;
    status.appendChild(row);
  });

  const locked = Boolean(ctx.me.choice);
  $('btnStarterSelf').disabled = locked;
  $('btnStarterPartner').disabled = locked;
  modal.classList.remove('hidden');
}

function renderBoard(board, animated = false) {
  const container = $('board');
  container.innerHTML = '';
  if (!board || board.pieces.length === 0) {
    $('endLeft').textContent = '';
    $('endRight').textContent = '';
    $('pileCount').textContent = S.pileCount;
    return;
  }

  board.pieces.forEach((piece, idx) => {
    container.appendChild(makePiece(piece.left, piece.right, { newPiece: animated && idx === board.pieces.length - 1 }));
  });
  $('endLeft').textContent = board.leftEnd;
  $('endRight').textContent = board.rightEnd;
  $('pileCount').textContent = S.pileCount;
  requestAnimationFrame(() => {
    const scroll = $('boardScroll');
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
  });
}

function renderHand() {
  const container = $('myHand');
  container.innerHTML = '';
  const isMyTurn = S.currentPlayerId === S.myId;

  S.hand.forEach((piece, idx) => {
    const [a, b] = piece;
    const validSides = canPlayPiece(piece, S.board);
    const playable = isMyTurn && validSides.length > 0;
    const mustPlay = S.requiredFirst
      ? (a === S.requiredFirst[0] && b === S.requiredFirst[1]) || (a === S.requiredFirst[1] && b === S.requiredFirst[0])
      : true;
    const ok = playable && mustPlay;
    const el = makePiece(a, b, { selectable: ok, selected: S.selectedIdx === idx, disabled: isMyTurn && !ok });
    if (ok) el.addEventListener('click', () => handlePieceClick(idx, piece, validSides));
    container.appendChild(el);
  });
}

function getPositions() {
  const count = S.players.length;
  const myIdx = S.players.findIndex(player => player.id === S.myId);
  if (myIdx === -1) return { top: null, left: null, right: null };
  if (count === 2) return { top: S.players[(myIdx + 1) % 2], left: null, right: null };
  if (count === 3) return { top: S.players[(myIdx + 1) % 3], left: null, right: S.players[(myIdx + 2) % 3] };
  return {
    top: S.players[(myIdx + 2) % 4],
    left: S.players[(myIdx + 3) % 4],
    right: S.players[(myIdx + 1) % 4]
  };
}
function renderSlot(slotId, player, pos) {
  const slot = $(slotId);
  slot.innerHTML = '';
  if (!player) return;

  const myTeam = S.players.find(p => p.id === S.myId)?.team;
  const isPartner = S.players.length === 4 && player.team === myTeam;
  const isActive = player.id === S.currentPlayerId;
  const isSide = pos === 'left' || pos === 'right';

  const name = document.createElement('div');
  name.className = `opp-name${isActive ? ' active-player pulsing' : ''}`;
  name.textContent = player.name;
  slot.appendChild(name);

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:.65rem;color:var(--gold);font-weight:700;';
  meta.textContent = S.config.mode === 'baiano' ? `time ${player.team + 1}` : `${player.score || 0}pt`;
  slot.appendChild(meta);

  if (isPartner) {
    const badge = document.createElement('div');
    badge.className = 'partner-badge';
    badge.textContent = 'parceiro';
    slot.appendChild(badge);
  }

  const piecesWrap = document.createElement('div');
  piecesWrap.className = 'opp-pieces';
  const show = Math.min(player.handCount, isSide ? 7 : 14);
  for (let i = 0; i < show; i++) {
    const back = document.createElement('div');
    back.className = 'piece-back';
    piecesWrap.appendChild(back);
  }
  if (player.handCount > show) {
    const more = document.createElement('div');
    more.style.cssText = 'font-size:.65rem;color:var(--muted);';
    more.textContent = `+${player.handCount - show}`;
    piecesWrap.appendChild(more);
  }
  slot.appendChild(piecesWrap);
}
function renderOpponents() {
  const positions = getPositions();
  renderSlot('slotTop', positions.top, 'top');
  renderSlot('slotLeft', positions.left, 'left');
  renderSlot('slotRight', positions.right, 'right');
}

function renderTurnBar() {
  const bar = $('turnBar');
  const starter = getStarterContext();
  if (starter) {
    if (starter.myPlayer?.team === starter.decision.team && starter.partner) {
      bar.textContent = starter.me?.choice
        ? `Aguardando ${starter.partner.name} confirmar quem abre...`
        : `Voce e ${starter.partner.name} precisam decidir quem abre.`;
      bar.style.color = 'var(--gold2)';
      return;
    }
    bar.textContent = `Aguardando o time ${starter.decision.team + 1} decidir quem abre...`;
    bar.style.color = 'var(--muted)';
    return;
  }
  if (S.currentPlayerId === S.myId) {
    bar.textContent = 'Sua vez!';
    bar.style.color = 'var(--gold2)';
    return;
  }
  const current = S.players.find(player => player.id === S.currentPlayerId);
  bar.textContent = current ? `Vez de ${current.name}...` : '';
  bar.style.color = 'var(--muted)';
}
function renderControls() {
  if (S.starterDecision?.pending || !S.currentPlayerId) {
    $('btnDraw').classList.add('hidden');
    $('btnPass').classList.add('hidden');
    return;
  }
  const isMyTurn = S.currentPlayerId === S.myId;
  const canMove = hasAnyMove(S.hand, S.board);
  $('btnDraw').classList.toggle('hidden', !isMyTurn || canMove || S.pileCount === 0);
  $('btnPass').classList.toggle('hidden', !isMyTurn || canMove || S.pileCount > 0);
}
function renderPecasBar() {
  const bar = $('pecasBar');
  if (S.config.mode !== 'baiano') {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = [
    `<span>Time 1: ${formatBaianoTeamLabel(0)}</span>`,
    '<span class="pb-sep">vs</span>',
    `<span>Time 2: ${formatBaianoTeamLabel(1)}</span>`,
    '<span class="pb-sep">|</span>',
    `<span>${formatBaianoRaceLabel()}</span>`,
    '<span class="pb-sep">|</span>',
    `<span>Meta: ${S.config.targetPecas} pecas</span>`
  ].join('');
}
function renderAll(animated = false) {
  deactivateBoardTargets();
  S.selectedIdx = null;
  renderBoard(S.board, animated);
  renderHand();
  renderOpponents();
  renderTurnBar();
  renderControls();
  renderPecasBar();
  syncStarterDecisionModal();
}

function activateBoardTargets(pieceIdx) {
  const el = $('endLeft'), er = $('endRight');
  el.classList.add('playable');
  er.classList.add('playable');
  el._orig = el.textContent;
  er._orig = er.textContent;
  el.textContent = '← ' + el._orig;
  er.textContent = er._orig + ' →';
  el._h = () => { deactivateBoardTargets(); doPlay(pieceIdx, 'left'); };
  er._h = () => { deactivateBoardTargets(); doPlay(pieceIdx, 'right'); };
  el.addEventListener('click', el._h);
  er.addEventListener('click', er._h);
  toast('Clique em um lado do tabuleiro', '');
}
function deactivateBoardTargets() {
  const el = $('endLeft'), er = $('endRight');
  el.classList.remove('playable');
  er.classList.remove('playable');
  if (el._orig != null) { el.textContent = el._orig; el._orig = null; }
  if (er._orig != null) { er.textContent = er._orig; er._orig = null; }
  if (el._h) { el.removeEventListener('click', el._h); el._h = null; }
  if (er._h) { er.removeEventListener('click', er._h); er._h = null; }
}

function handlePieceClick(idx, piece, validSides) {
  if (S.selectedIdx === idx) {
    S.selectedIdx = null;
    deactivateBoardTargets();
    renderHand();
    return;
  }
  deactivateBoardTargets();
  S.selectedIdx = idx;
  renderHand();
  if (!S.board || S.board.pieces.length === 0 || validSides.length === 1) {
    doPlay(idx, validSides[0] === 'any' ? 'right' : validSides[0]);
    return;
  }
  activateBoardTargets(idx);
}
function doPlay(idx, side) {
  S.selectedIdx = null;
  deactivateBoardTargets();
  playPieceSound();
  socket.emit('play-piece', { pieceIndex: idx, side });
}

function playPieceSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 3000;
    bpf.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    src.connect(bpf);
    bpf.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
  } catch (e) {}
}

function playKnock() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    function knock(t) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.start(t);
      osc.stop(t + 0.13);
    }
    knock(ctx.currentTime);
    knock(ctx.currentTime + 0.22);
  } catch (e) {}
}

function stopClientTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  $('timerBar').classList.add('hidden');
}
function startClientTimer(startTime, duration) {
  stopClientTimer();
  if (!startTime || !duration || duration <= 0) return;
  const bar = $('timerBar');
  bar.classList.remove('hidden');
  function tick() {
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.max(0, duration - elapsed);
    const pct = (remaining / duration) * 100;
    $('timerFill').style.width = pct + '%';
    $('timerSecs').textContent = Math.ceil(remaining) + 's';
    $('timerFill').classList.toggle('timer-warn', remaining <= 5);
    if (remaining <= 0) stopClientTimer();
  }
  tick();
  timerInterval = setInterval(tick, 200);
}

function showPassAnimation(name) {
  playKnock();
  const el = document.createElement('div');
  el.className = 'pass-slam';
  el.innerHTML = `<span class="slam-hand">✊</span><span class="slam-name">Duro, ${name}!</span>`;
  $('screenGame').appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  const board = $('boardScroll');
  board.classList.add('board-shake');
  board.addEventListener('animationend', () => board.classList.remove('board-shake'), { once: true });
}

function renderAllHands(allHands) {
  const container = $('allHands');
  container.innerHTML = '';
  allHands.forEach(playerHand => {
    const box = document.createElement('div');
    box.className = 'hand-reveal';
    const name = document.createElement('div');
    name.className = 'hr-name';
    name.textContent = playerHand.name + (playerHand.id === S.myId ? ' (voce)' : '');
    box.appendChild(name);
    const piecesWrap = document.createElement('div');
    piecesWrap.className = 'hr-pieces';
    if (!playerHand.hand || playerHand.hand.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hr-empty';
      empty.textContent = 'Bateu!';
      piecesWrap.appendChild(empty);
    } else {
      playerHand.hand.forEach(piece => piecesWrap.appendChild(makePiece(piece[0], piece[1])));
    }
    box.appendChild(piecesWrap);
    container.appendChild(box);
  });
}

function showEndModal(data, isBlock) {
  $('modalStarter').classList.add('hidden');
  $('overEmoji').textContent = data.emoji || '🎉';
  $('overTitle').textContent = data.label || '';
  $('overLabel').textContent = data.ptsLabel || (data.config?.mode === 'baiano' ? `Corrida: ${formatBaianoRaceLabel(data.teamPoints, data.baianoRaceTarget)}` : '');
  $('overReason').textContent = data.reason || '';

  const scores = $('overScores');
  scores.innerHTML = '';
  const count = data.players?.length || 0;
  if (count === 4 && data.config?.mode === 'baiano') {
    [0, 1].forEach(team => {
      const row = document.createElement('div');
      row.className = 'score-row';
      const names = data.players.filter(player => player.team === team).map(player => player.name).join(' & ');
      row.innerHTML = `<span>Time ${team + 1}: ${names}</span><span class="pts">${formatBaianoTeamLabel(team, data.teamPoints, data.teamPecas)}</span>`;
      scores.appendChild(row);
    });
  } else if (count === 4 && data.teamScores) {
    [0, 1].forEach(team => {
      const row = document.createElement('div');
      row.className = 'score-row';
      const names = data.players.filter(player => player.team === team).map(player => player.name).join(' & ');
      row.innerHTML = `<span>Time ${team + 1}: ${names}</span><span class="pts">${data.teamScores[team] || 0} pt</span>`;
      scores.appendChild(row);
    });
  } else if (data.players) {
    data.players.forEach(player => {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<span>${player.name}</span><span class="pts">${player.score || 0}pt</span>`;
      scores.appendChild(row);
    });
  }

  const banner = $('matchBanner');
  if (data.matchWinner != null && data.config?.mode === 'baiano') {
    banner.textContent = `Time ${data.matchWinner + 1} venceu a partida!`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  if (isBlock && data.counts) {
    const countsBox = $('countsBox');
    countsBox.classList.remove('hidden');
    countsBox.innerHTML = '<div class="reveal-title">Contagem das maos</div>' +
      data.counts.map(countRow => `<div class="count-row"><span>${countRow.name}</span><span>${countRow.sum} pts</span></div>`).join('');
  } else {
    $('countsBox').classList.add('hidden');
  }

  if (data.allHands) renderAllHands(data.allHands);
  const matchOver = data.matchWinner != null;
  $('btnAgain').classList.toggle('hidden', !S.isHost || matchOver);
  $('waitingNextRound').classList.toggle('hidden', S.isHost || matchOver);
  $('modalOver').classList.remove('hidden');
}

function updateWaitingHint(playerCount = S.players.length) {
  if (S.config.mode === 'baiano') {
    $('waitingMsg').textContent = playerCount < 4
      ? `Aguardando jogadores... (${playerCount}/4 no Baiano)`
      : '4 jogadores prontos para iniciar.';
    return;
  }
  $('waitingMsg').textContent = playerCount < 2
    ? 'Aguardando jogadores... (minimo 2)'
    : 'Sala pronta para iniciar.';
}
function canStartMatch() {
  return S.config.mode === 'baiano' ? S.players.length === 4 : S.players.length >= 2;
}
function syncStartButtonVisibility() {
  $('btnStart').classList.toggle('hidden', !S.isHost || !canStartMatch());
}
function renderWaitingPlayers(players) {
  const container = $('waitingPlayers');
  container.innerHTML = '';
  players.forEach((player, idx) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    const avatar = document.createElement('div');
    avatar.className = `avatar av${idx}`;
    avatar.textContent = player.name[0].toUpperCase();
    row.appendChild(avatar);

    const name = document.createElement('span');
    name.textContent = player.name;
    row.appendChild(name);

    if (idx === 0) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'host-badge';
      hostBadge.textContent = 'host';
      row.appendChild(hostBadge);
    }

    if (S.config.mode !== 'baiano' && player.score > 0) {
      const score = document.createElement('span');
      score.style.cssText = 'margin-left:auto;color:var(--gold);font-size:.82rem;font-weight:700;';
      score.textContent = `${player.score}pt`;
      row.appendChild(score);
    }

    container.appendChild(row);
  });
  updateWaitingHint(players.length);
}
function updateConfigUI(cfg) {
  document.querySelectorAll('.mode-btn').forEach(button => button.classList.toggle('active', button.dataset.mode === cfg.mode));
  $('baianoConfig').classList.toggle('hidden', cfg.mode !== 'baiano');
  if (cfg.targetPecas) $('inputPecas').value = cfg.targetPecas;
  if (cfg.timePerTurn !== undefined) $('inputTimer').value = cfg.timePerTurn;
  updateWaitingHint();
  syncStartButtonVisibility();
}

function setRulesTab(tab) {
  document.querySelectorAll('.rtab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $('rulesClassic').classList.toggle('hidden', tab !== 'classic');
  $('rulesBaiano').classList.toggle('hidden', tab !== 'baiano');
}
function openRules(tab = S.config.mode || 'classic') {
  setRulesTab(tab);
  $('modalRules').classList.remove('hidden');
}

socket.on('connect', () => {
  S.myId = socket.id;
});
socket.on('room-created', ({ code }) => {
  S.roomCode = code;
  S.isHost = true;
  S.players = [{ id: S.myId, name: S.myName, score: 0 }];
  $('displayCode').textContent = code;
  showScreen('waiting');
  $('configSection').classList.remove('hidden');
  $('btnRulesGuest').classList.add('hidden');
  syncStartButtonVisibility();
});
socket.on('room-joined', ({ code }) => {
  S.roomCode = code;
  S.isHost = false;
  $('displayCode').textContent = code;
  showScreen('waiting');
  $('configSection').classList.add('hidden');
  $('btnRulesGuest').classList.remove('hidden');
  syncStartButtonVisibility();
});
socket.on('room-update', ({ players, config, hostId }) => {
  S.players = players;
  if (config) {
    S.config = config;
    updateConfigUI(config);
  }
  renderWaitingPlayers(players);
  S.isHost = hostId === S.myId;
  $('configSection').classList.toggle('hidden', !S.isHost);
  $('btnRulesGuest').classList.toggle('hidden', S.isHost);
  syncStartButtonVisibility();
});
socket.on('game-state', data => {
  const prevBoardCount = S.board?.pieces?.length || 0;
  const prevTurnId = S.currentPlayerId;
  $('modalOver').classList.add('hidden');
  S.hand = data.hand;
  S.board = data.board;
  S.currentPlayerId = data.currentPlayerId;
  S.players = data.players;
  S.pileCount = data.pileCount;
  S.requiredFirst = data.requiredFirst;
  S.starterDecision = data.starterDecision || null;
  S.config = data.config || S.config;
  S.teamScores = data.teamScores || [];
  S.teamPoints = data.teamPoints || [0, 0];
  S.teamPecas = data.teamPecas || [0, 0];
  S.baianoRaceTarget = data.baianoRaceTarget || 3;
  S.timePerTurn = data.timePerTurn || 0;
  S.turnStartTime = data.turnStartTime || null;
  if ((data.board?.pieces?.length || 0) > prevBoardCount && prevTurnId !== S.myId) playPieceSound();
  showScreen('game');
  renderAll(true);
  if (S.currentPlayerId && S.turnStartTime) startClientTimer(S.turnStartTime, S.timePerTurn);
  else stopClientTimer();
});
socket.on('piece-drawn', ({ piece }) => {
  toast(`Comprou: [${piece[0]}|${piece[1]}]`, 'ok');
});
socket.on('starter-selected', ({ name, random }) => {
  toast(random ? `${name} abre a rodada por sorteio.` : `${name} abre a rodada.`, 'ok');
});
socket.on('game-over', data => {
  stopClientTimer();
  S.board = data.board || S.board;
  S.players = data.players || S.players;
  S.starterDecision = null;
  S.teamScores = data.teamScores || S.teamScores;
  S.teamPoints = data.teamPoints || S.teamPoints;
  S.teamPecas = data.teamPecas || S.teamPecas;
  S.baianoRaceTarget = data.baianoRaceTarget || S.baianoRaceTarget;
  renderBoard(S.board);
  renderOpponents();
  renderPecasBar();
  showEndModal(data, false);
});
socket.on('game-blocked', data => {
  stopClientTimer();
  S.board = data.board || S.board;
  S.players = data.players || S.players;
  S.starterDecision = null;
  S.teamScores = data.teamScores || S.teamScores;
  S.teamPoints = data.teamPoints || S.teamPoints;
  S.teamPecas = data.teamPecas || S.teamPecas;
  S.baianoRaceTarget = data.baianoRaceTarget || S.baianoRaceTarget;
  renderBoard(S.board);
  renderOpponents();
  renderPecasBar();
  showEndModal(data, true);
});
socket.on('player-left', ({ name }) => toast(`${name} saiu.`, 'err'));
socket.on('player-passed', ({ name, id }) => { if (id !== S.myId) showPassAnimation(name); });
socket.on('error', ({ msg }) => {
  if (screens.lobby.classList.contains('active')) $('lobbyErr').textContent = msg;
  else toast(msg, 'err');
  S.selectedIdx = null;
  if (screens.game.classList.contains('active')) renderHand();
});

$('btnCreate').addEventListener('click', () => {
  const name = $('inputName').value.trim();
  if (!name) return $('lobbyErr').textContent = 'Digite seu apelido.';
  $('lobbyErr').textContent = '';
  S.myName = name;
  socket.emit('create-room', { name });
});
$('btnJoin').addEventListener('click', doJoin);
$('inputCode').addEventListener('keydown', event => event.key === 'Enter' && doJoin());
$('inputName').addEventListener('keydown', event => event.key === 'Enter' && $('btnCreate').click());
function doJoin() {
  const name = $('inputName').value.trim();
  const code = $('inputCode').value.trim().toUpperCase();
  if (!name) return $('lobbyErr').textContent = 'Digite seu apelido.';
  if (code.length !== 4) return $('lobbyErr').textContent = 'Codigo deve ter 4 letras.';
  $('lobbyErr').textContent = '';
  S.myName = name;
  socket.emit('join-room', { name, code });
}

$('btnCopy').addEventListener('click', () => {
  navigator.clipboard.writeText(S.roomCode).catch(() => {});
  toast('Codigo copiado!', 'ok');
});
$('btnStart').addEventListener('click', () => socket.emit('start-game'));
$('btnDraw').addEventListener('click', () => socket.emit('draw-piece'));
$('btnPass').addEventListener('click', () => {
  showPassAnimation(S.myName);
  socket.emit('pass-turn');
});
$('btnStarterSelf').addEventListener('click', () => socket.emit('starter-choice', { choice: 'self' }));
$('btnStarterPartner').addEventListener('click', () => socket.emit('starter-choice', { choice: 'partner' }));
$('btnAgain').addEventListener('click', () => {
  $('modalOver').classList.add('hidden');
  socket.emit('play-again');
});
$('btnOverLobby').addEventListener('click', () => {
  $('modalOver').classList.add('hidden');
  showScreen('lobby');
});

document.querySelectorAll('.mode-btn').forEach(button => {
  button.addEventListener('click', () => socket.emit('set-config', { mode: button.dataset.mode }));
});

$('inputPecas').addEventListener('change', () => socket.emit('set-config', { targetPecas: parseInt($('inputPecas').value) || 6 }));
$('inputTimer').addEventListener('change', () => socket.emit('set-config', { timePerTurn: parseInt($('inputTimer').value) || 0 }));

$('btnRules').addEventListener('click', () => openRules(S.config.mode));
$('btnRulesGuest').addEventListener('click', () => openRules(S.config.mode));
$('btnRulesGame').addEventListener('click', () => openRules(S.config.mode));
$('btnCloseRules').addEventListener('click', () => $('modalRules').classList.add('hidden'));
document.querySelectorAll('.rtab').forEach(button => button.addEventListener('click', () => setRulesTab(button.dataset.tab)));

renderLogoPiece();
