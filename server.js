const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { randomBytes, randomUUID, randomInt } = require('crypto');
const cors = require('cors');

// The server owns every rule and sends each player only their own secret cards.
function createGameServer() {
  const app = express();
  app.use(cors());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  const rooms = new Map();
  const sessions = new Map();
  const baseRoles = ['Duchesse', 'Assassin', 'Capitaine', 'Comtesse'];
  const live = p => p.cards.some(c => !c.revealed);
  const count = p => p.cards.filter(c => !c.revealed).length;
  const roles = r => [...baseRoles, r.variant];
  const shuffle = cards => {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  };
  const card = role => ({ role, revealed: false });
  const player = (r, id) => r.players.find(p => p.id === id);
  const log = (r, text) => {
    r.history.push({ id: ++r.sequence, turn: r.turn, text });
    r.history = r.history.slice(-100);
  };
  // Only public information is ever included in the visual timeline.
  const publicPlayers = r => r.players.map(p => ({
    id: p.id, username: p.username, coins: p.coins, connected: p.connected,
    ready: p.ready, alive: live(p), influenceCount: count(p), drafted: p.drafted,
    wins: p.wins, eliminatedAt: p.eliminatedAt,
    revealedInfluences: p.cards.filter(c => c.revealed).map(c => ({ role: c.role, revealed: true })),
  }));
  function visual(r, kind, data = {}) {
    const a = r.pending;
    const event = { id: r.visualSequence = (r.visualSequence || 0) + 1, at: Date.now(), kind,
      actionId: a?.id, action: a?.type, actorId: a?.actorId, targetId: a?.targetId,
      ...data, players: publicPlayers(r), currentPlayerIndex: r.current };
    r.visualEvents = [...(r.visualEvents || []), event].slice(-40);
  }
  const blockers = (r, a) => a.type === 'foreign_aid' ? ['Duchesse'] : a.type === 'assassinate' ? ['Comtesse'] : a.type === 'steal' ? ['Capitaine', r.variant] : [];
  const responders = (r, a) => r.players.filter(p => live(p) && (
    a.stage === 'challengeAction' ? p.id !== a.actorId :
    a.stage === 'challengeBlock' ? p.id !== a.blockedBy :
    a.stage === 'blockWindow' ? (a.type === 'foreign_aid' ? p.id !== a.actorId : p.id === a.targetId) : false
  )).map(p => p.id);

  function publicRoom(r) {
    const a = r.pending;
    return {
      code: r.code, host: r.host, phase: r.phase, variant: r.variant,
      currentPlayerIndex: r.current, turn: r.turn, round: r.round,
      visualEvents: r.visualEvents || [],
      deckCount: r.deck.length, winnerId: r.winnerId, history: r.history,
      paused: ['playing', 'drafting'].includes(r.phase) && r.players.some(p => !p.connected && (r.phase === 'drafting' || live(p))),
      pendingAction: a ? {
        id: a.id, type: a.type, actorId: a.actorId, targetId: a.targetId || null,
        claimedRole: a.claimedRole || null, stage: a.stage,
        targetRole: a.targetRole || null,
        blockedBy: a.blockedBy || null, blockRole: a.blockRole || null,
        awaitingId: a.awaitingId || null, respondedIds: [...a.passes],
        eligibleIds: responders(r, a),
      } : null,
      players: r.players.map(p => ({
        id: p.id, username: p.username, coins: p.coins, connected: p.connected,
        ready: p.ready, alive: live(p), influenceCount: count(p),
        drafted: p.drafted, wins: p.wins, eliminatedAt: p.eliminatedAt,
        revealedInfluences: p.cards.filter(c => c.revealed).map(c => ({ ...c })),
      })),
    };
  }
  function publish(r) {
    const room = publicRoom(r);
    for (const p of r.players) {
      if (!p.connected) continue;
      const a = r.pending;
      io.to(p.socketId).emit('gameState', {
        room, myId: p.id, myCards: p.cards,
        mustReveal: a?.stage === 'awaitingReveal' && a.awaitingId === p.id ? { reason: a.reason, targetRole: a.revealRole || null } : null,
        exchangeOptions: a?.stage === 'exchange' && a.actorId === p.id ? { currentCards: p.cards.filter(c => !c.revealed), drawnCards: a.drawn.map(card) } : null,
        inspection: a?.stage === 'inspectDecision' && a.actorId === p.id ? { role: player(r, a.targetId).cards[a.inspectedIndex].role, targetName: player(r, a.targetId).username } : null,
        draftRoles: r.phase === 'drafting' && !p.drafted ? roles(r) : [],
      });
    }
  }
  function finish(r) {
    r.pending = null;
    const alive = r.players.filter(live);
    if (alive.length <= 1) {
      r.phase = 'finished';
      r.winnerId = alive[0]?.id || null;
      if (alive[0]) { alive[0].wins++; log(r, `${alive[0].username} remporte la manche !`); }
      else log(r, 'La manche est terminée.');
    } else {
      const previousId = r.players[r.current]?.id;
      do { r.current = (r.current + 1) % r.players.length; } while (!live(r.players[r.current]));
      r.turn++;
      visual(r, 'turn', { actorId: r.players[r.current].id, fromId: previousId });
    }
  }
  function reveal(r, p, index) {
    p.cards[index].revealed = true;
    log(r, `${p.username} révèle ${p.cards[index].role}.`);
    visual(r, 'reveal', { targetId: p.id, role: p.cards[index].role, slot: p.cards.filter(c => c.revealed).length - 1 });
    if (!live(p)) {
      p.coins = 0;
      p.eliminatedAt = r.sequence;
      visual(r, 'eliminate', { targetId: p.id });
      log(r, `${p.username} est éliminé·e. Ses pièces retournent au Trésor.`);
    }
  }
  function requestReveal(r, id, reason, after, revealRole = null) {
    Object.assign(r.pending, { stage: 'awaitingReveal', awaitingId: id, reason, after, revealRole });
  }
  function apply(r) {
    const a = r.pending, actor = player(r, a.actorId), target = player(r, a.targetId);
    if (!live(actor)) return finish(r);
    if (a.type === 'duchess') { actor.coins += 3; visual(r, 'coins', { amount: 3 }); log(r, `${actor.username} prend 3 pièces.`); }
    if (a.type === 'foreign_aid') { actor.coins += 2; visual(r, 'coins', { amount: 2 }); log(r, `${actor.username} reçoit 2 pièces d'aide étrangère.`); }
    if (a.type === 'steal' && target && live(target)) {
      const n = Math.min(2, target.coins); target.coins -= n; actor.coins += n;
      visual(r, 'coins', { amount: n, fromId: target.id });
      log(r, `${actor.username} prend ${n} pièce${n > 1 ? 's' : ''} à ${target.username}.`);
    }
    if (['assassinate', 'coup'].includes(a.type) && target && live(target)) {
      // House rule: an attack names a hidden role. A wrong guess still costs coins.
      if (!target.cards.some(c => !c.revealed && c.role === a.targetRole)) {
        visual(r, 'attack', { outcome: 'miss' });
        log(r, `Attaque manquée : ${target.username} n’a pas de ${a.targetRole} caché. Les pièces de ${actor.username} sont perdues.`);
        return finish(r);
      }
      visual(r, 'attack', { outcome: 'hit' });
      log(r, `Touché : ${target.username} doit révéler ${a.targetRole}.`);
      return requestReveal(r, target.id, a.type === 'coup' ? 'coup' : 'assassinated', 'finish', a.targetRole);
    }
    if (a.type === 'exchange') {
      a.drawn = r.deck.splice(0, r.variant === 'Inquisiteur' ? 1 : 2);
      a.stage = 'exchange'; a.awaitingId = actor.id;
      visual(r, 'cards', { amount: a.drawn.length, outcome: 'draw' });
      return;
    }
    if (a.type === 'inspect' && target && live(target)) {
      a.stage = 'inspectChoose'; a.awaitingId = target.id;
      visual(r, 'inspect');
      return;
    }
    finish(r);
  }
  function actionAccepted(r) {
    const a = r.pending;
    // In these rules, a disproved Assassin pays nothing. A blocked Assassin pays 3.
    if (a.type === 'assassinate' && !a.paid) {
      player(r, a.actorId).coins -= 3; a.paid = true;
      visual(r, 'coins', { amount: -3 });
      log(r, `${player(r, a.actorId).username} paie 3 pièces pour l'Assassin.`);
    }
    if (blockers(r, a).length && (!a.targetId || live(player(r, a.targetId)))) {
      a.stage = 'blockWindow'; a.passes.clear(); a.awaitingId = null;
      if (!responders(r, a).length) apply(r);
    } else apply(r);
  }
  function afterReveal(r) {
    const after = r.pending.after;
    r.pending.awaitingId = null;
    if (after === 'actionValid') actionAccepted(r);
    else if (after === 'blockFail') apply(r);
    else { if (after === 'blockValid') visual(r, 'block', { targetId: r.pending.blockedBy, outcome: 'confirmed' }); finish(r); }
  }
  function advanceResponses(r) {
    const a = r.pending;
    if (!a || !['challengeAction', 'challengeBlock', 'blockWindow'].includes(a.stage)) return;
    if (!responders(r, a).every(id => a.passes.has(id))) return;
    if (a.stage === 'challengeAction') actionAccepted(r);
    else if (a.stage === 'challengeBlock') { visual(r, 'block', { targetId: a.blockedBy, outcome: 'confirmed' }); log(r, 'Le contre est accepté. L’action est annulée.'); finish(r); }
    else apply(r);
  }
  function remove(r, p) {
    if (['waiting', 'finished'].includes(r.phase)) {
      r.players = r.players.filter(q => q.id !== p.id);
      if (r.players.length) r.current %= r.players.length;
    } else if (r.phase === 'drafting') {
      // A departure during the two-player draft returns the table to the lobby.
      r.players = r.players.filter(q => q.id !== p.id);
      r.phase = 'waiting'; r.pending = null; r.deck = [];
      r.players.forEach(q => { q.cards = []; q.ready = false; q.drafted = false; q.coins = 0; });
      log(r, 'Préparation annulée : un joueur a quitté la salle.');
    } else {
      const a = r.pending;
      p.cards.forEach((c, i) => { if (!c.revealed) reveal(r, p, i); });
      if (a?.stage === 'exchange' && a.actorId === p.id) r.deck.push(...a.drawn);
      if (a?.actorId === p.id) finish(r);
      else if (a?.stage === 'awaitingReveal' && a.awaitingId === p.id) afterReveal(r);
      else if (a?.blockedBy === p.id && a.stage === 'challengeBlock') apply(r);
      else if (a?.targetId === p.id && ['inspectChoose', 'inspectDecision'].includes(a.stage)) finish(r);
      else if (a) advanceResponses(r);
      else if (r.players[r.current]?.id === p.id || r.players.filter(live).length <= 1) finish(r);
    }
    if (r.host === p.id) r.host = r.players.find(q => q.id !== p.id && q.connected)?.id || r.players.find(q => q.id !== p.id)?.id || '';
    if (!r.players.some(q => sessions.has(q.token))) rooms.delete(r.code);
  }

  app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
  io.on('connection', socket => {
    let session = sessions.get(socket.handshake.auth?.sessionToken);
    if (!session && socket.handshake.auth?.sessionToken) socket.emit('sessionExpired');
    if (session) {
      const r = rooms.get(session.code), p = r && player(r, session.id);
      if (p) {
        const previous = io.sockets.sockets.get(p.socketId);
        p.socketId = socket.id; p.connected = true;
        if (previous && previous.id !== socket.id) previous.disconnect(true);
        socket.emit('session', { token: p.token }); publish(r);
      } else session = null;
    }
    const error = message => socket.emit('errorMessage', message);
    const context = () => {
      const r = session && rooms.get(session.code), p = r && player(r, session.id);
      return r && p && p.socketId === socket.id ? { r, p } : null;
    };
    socket.on('sync', () => { const ctx = context(); if (ctx) publish(ctx.r); });
    function enter(r, username) {
      const p = { id: randomUUID(), token: randomBytes(32).toString('hex'), socketId: socket.id, username, connected: true, ready: !r.players.length, cards: [], coins: 0, drafted: false, wins: 0, eliminatedAt: null };
      r.players.push(p); if (!r.host) r.host = p.id;
      session = { code: r.code, id: p.id }; sessions.set(p.token, session);
      socket.emit('session', { token: p.token }); publish(r);
    }
    function handle(event, fn, allowPaused = false) {
      socket.on(event, (data = {}) => {
        const ctx = context(); if (!ctx) return error('Rejoignez d’abord une salle.');
        const { r, p } = ctx;
        if (!allowPaused && publicRoom(r).paused) return error('Partie en pause : un joueur se reconnecte.');
        try { fn(r, p, data && typeof data === 'object' ? data : {}); publish(r); }
        catch (e) { error(e.message || 'Action impossible.'); }
      });
    }
    const need = (condition, msg) => { if (!condition) throw new Error(msg); };
    const name = value => typeof value === 'string' ? value.trim().slice(0, 20) : '';
    socket.on('createRoom', data => {
      if (context()) return error('Quittez votre salle avant d’en créer une autre.');
      const username = name(typeof data === 'string' ? data : data?.username);
      if (!username) return error('Choisissez un pseudo.');
      let code; do { code = randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); } while (rooms.has(code));
      const r = { code, host: null, players: [], deck: [], phase: 'waiting', variant: 'Ambassadeur', current: 0, turn: 0, round: 0, pending: null, winnerId: null, history: [], sequence: 0 };
      rooms.set(code, r); enter(r, username);
    });
    socket.on('joinRoom', data => {
      if (context()) return error('Vous êtes déjà dans une salle.');
      const r = rooms.get(String(data?.roomCode || '').trim().toUpperCase());
      const username = name(data?.username);
      if (!r) return error('Cette salle n’existe pas. Vérifiez le code.');
      if (r.phase !== 'waiting') return error('Cette partie a déjà commencé.');
      if (r.players.length >= 8) return error('La salle est complète (8 joueurs).');
      if (!username) return error('Choisissez un pseudo.');
      if (r.players.some(p => p.username.toLowerCase() === username.toLowerCase())) return error('Ce pseudo est déjà utilisé dans la salle.');
      enter(r, username);
    });
    handle('setReady', (r, p) => { need(r.phase === 'waiting', 'La partie a commencé.'); p.ready = !p.ready; }, true);
    handle('setVariant', (r, p, d) => {
      need(r.host === p.id && r.phase === 'waiting', 'Seul l’hôte règle la partie.');
      need(['Ambassadeur', 'Inquisiteur'].includes(d.variant), 'Variante inconnue.');
      r.variant = d.variant; r.players.forEach(q => { q.ready = q.id === p.id; });
    }, true);
    handle('startGame', (r, p) => {
      need(p.id === r.host && r.phase === 'waiting', 'Seul l’hôte peut lancer la partie.');
      need(r.players.length >= 2 && r.players.length <= 8, 'Il faut entre 2 et 8 joueurs.');
      need(r.players.every(q => q.ready && q.connected), 'Attendez que tout le monde soit prêt.');
      const lastWinner = r.winnerId;
      r.current = Math.max(0, r.players.findIndex(q => q.id === lastWinner));
      r.visualEvents = [];
      r.round++; r.turn = 1; r.history = []; r.sequence = 0; r.winnerId = null; r.pending = null;
      r.players.forEach(q => { q.cards = []; q.coins = 2; q.drafted = false; q.eliminatedAt = null; });
      if (r.players.length === 2) {
        r.deck = shuffle(roles(r)); r.players.forEach(q => q.cards.push(card(r.deck.pop())));
        r.players[r.current].coins = 1; r.phase = 'drafting';
        log(r, 'Duel : chacun choisit son second personnage. Le premier joueur commence avec 1 pièce.');
      } else {
        r.deck = shuffle(Array.from({ length: r.players.length >= 7 ? 4 : 3 }, () => roles(r)).flat());
        r.players.forEach(q => { q.cards = [card(r.deck.pop()), card(r.deck.pop())]; });
        r.phase = 'playing'; log(r, `Manche ${r.round} : ${r.players.length} joueurs, variante ${r.variant}.`);
      }
    });
    handle('draftRole', (r, p, d) => {
      need(r.phase === 'drafting' && !p.drafted && roles(r).includes(d.role), 'Choix de personnage impossible.');
      p.cards.push(card(d.role)); p.drafted = true;
      if (r.players.every(q => q.drafted)) { r.phase = 'playing'; log(r, 'Les personnages sont choisis. Le duel commence !'); }
    });
    handle('act', (r, p, d) => {
      need(r.phase === 'playing' && !r.pending && r.players[r.current].id === p.id && live(p), 'Ce n’est pas votre tour.');
      need(['income', 'foreign_aid', 'duchess', 'steal', 'assassinate', 'coup', 'exchange', 'inspect'].includes(d.type), 'Action inconnue.');
      need(p.coins < 10 || d.type === 'coup', 'À 10 pièces ou plus, l’assassinat à 7 pièces est obligatoire.');
      const target = player(r, d.targetId);
      if (['steal', 'assassinate', 'coup', 'inspect'].includes(d.type)) need(target && target.id !== p.id && live(target), 'Choisissez un adversaire en jeu.');
      if (d.type === 'inspect') need(r.variant === 'Inquisiteur', 'L’Inquisiteur n’est pas en jeu.');
      if (d.type === 'assassinate') need(p.coins >= 3, 'Il vous faut 3 pièces.');
      if (d.type === 'coup') need(p.coins >= 7, 'Il vous faut 7 pièces.');
      if (['assassinate', 'coup'].includes(d.type)) need(roles(r).includes(d.targetRole), 'Choisissez le rôle caché que vous voulez éliminer.');
      if (d.type === 'income') { p.coins++; visual(r, 'coins', { action: 'income', actorId: p.id, amount: 1 }); log(r, `${p.username} prend 1 pièce de revenu.`); return finish(r); }
      const claims = { duchess: 'Duchesse', steal: 'Capitaine', assassinate: 'Assassin', exchange: r.variant, inspect: 'Inquisiteur' };
      const names = { duchess: 'la Duchesse', steal: 'le Capitaine', assassinate: 'l’Assassin', exchange: r.variant, inspect: 'l’Inquisiteur', foreign_aid: 'l’aide étrangère', coup: 'un assassinat à 7 pièces' };
      r.pending = { id: randomUUID(), type: d.type, actorId: p.id, targetId: target?.id || null, targetRole: ['assassinate', 'coup'].includes(d.type) ? d.targetRole : null, claimedRole: claims[d.type], stage: d.type === 'foreign_aid' ? 'blockWindow' : 'challengeAction', passes: new Set() };
      visual(r, 'announce');
      log(r, `${p.username} annonce ${names[d.type]}${target ? ` contre ${target.username}` : ''}${r.pending.targetRole ? ` et vise ${r.pending.targetRole}` : ''}.`);
      if (d.type === 'coup') { p.coins -= 7; visual(r, 'coins', { amount: -7 }); apply(r); }
    });
    handle('pass', (r, p) => {
      const a = r.pending;
      need(a && responders(r, a).includes(p.id) && !a.passes.has(p.id), 'Vous n’avez pas de réponse à donner.');
      a.passes.add(p.id); advanceResponses(r);
    });
    handle('challenge', (r, p) => {
      const a = r.pending;
      need(a && ['challengeAction', 'challengeBlock'].includes(a.stage) && responders(r, a).includes(p.id) && !a.passes.has(p.id), 'Contestation impossible.');
      const isBlock = a.stage === 'challengeBlock';
      const accused = player(r, isBlock ? a.blockedBy : a.actorId), role = isBlock ? a.blockRole : a.claimedRole;
      const index = accused.cards.findIndex(c => !c.revealed && c.role === role);
      visual(r, 'challenge', { actorId: p.id, targetId: accused.id });
      visual(r, 'verdict', { actorId: p.id, targetId: accused.id, outcome: index >= 0 ? 'failed' : 'success' });
      if (isBlock && index < 0) visual(r, 'block', { targetId: accused.id, outcome: 'broken' });
      log(r, `${p.username} met en doute ${accused.username} (${role}).`);
      if (index >= 0) {
        r.deck.push(role); shuffle(r.deck); accused.cards[index] = card(r.deck.pop());
        visual(r, 'cards', { actorId: accused.id, amount: 1, outcome: 'replace' });
        log(r, `${accused.username} prouve ${role} et échange cette carte avec la Cour.`);
        requestReveal(r, p.id, 'challenge_lost', isBlock ? 'blockValid' : 'actionValid');
      } else {
        log(r, `Le bluff de ${accused.username} est démasqué !`);
        requestReveal(r, accused.id, 'challenge_failed', isBlock ? 'blockFail' : 'actionFail');
      }
    });
    handle('block', (r, p, d) => {
      const a = r.pending;
      need(a?.stage === 'blockWindow' && responders(r, a).includes(p.id) && !a.passes.has(p.id) && blockers(r, a).includes(d.role), 'Ce contre n’est pas autorisé.');
      a.blockedBy = p.id; a.blockRole = d.role; a.stage = 'challengeBlock'; a.passes.clear();
      visual(r, 'block', { targetId: p.id, outcome: 'proposed' });
      log(r, `${p.username} contre avec ${d.role}.`);
    });
    handle('reveal', (r, p, d) => {
      const a = r.pending;
      need(a?.stage === 'awaitingReveal' && a.awaitingId === p.id && Number.isInteger(d.index) && p.cards[d.index] && !p.cards[d.index].revealed, 'Choisissez une influence cachée.');
      need(!a.revealRole || p.cards[d.index].role === a.revealRole, `Vous devez révéler ${a.revealRole}.`);
      reveal(r, p, d.index); afterReveal(r);
    });
    handle('exchange', (r, p, d) => {
      const a = r.pending;
      need(a?.stage === 'exchange' && a.actorId === p.id, 'Aucun échange en cours.');
      const pool = [...p.cards.filter(c => !c.revealed).map(c => c.role), ...a.drawn];
      need(Array.isArray(d.indices) && d.indices.length === count(p) && new Set(d.indices).size === d.indices.length && d.indices.every(i => Number.isInteger(i) && i >= 0 && i < pool.length), 'Choisissez le bon nombre de cartes différentes.');
      p.cards = [...p.cards.filter(c => c.revealed), ...d.indices.map(i => card(pool[i]))];
      r.deck.push(...pool.filter((_, i) => !d.indices.includes(i))); shuffle(r.deck);
      visual(r, 'cards', { amount: a.drawn.length, outcome: 'return' });
      log(r, `${p.username} a terminé son échange avec la Cour.`); finish(r);
    });
    handle('inspectChoose', (r, p, d) => {
      const a = r.pending;
      need(a?.stage === 'inspectChoose' && a.targetId === p.id && Number.isInteger(d.index) && p.cards[d.index] && !p.cards[d.index].revealed, 'Choisissez une carte cachée à montrer.');
      a.inspectedIndex = d.index; a.stage = 'inspectDecision'; a.awaitingId = a.actorId;
      visual(r, 'cards', { actorId: a.actorId, fromId: p.id, amount: 1, outcome: 'draw' });
    });
    handle('inspectDecide', (r, p, d) => {
      const a = r.pending;
      need(a?.stage === 'inspectDecision' && a.actorId === p.id && typeof d.replace === 'boolean', 'Aucune inspection en cours.');
      const target = player(r, a.targetId);
      if (d.replace) { r.deck.push(target.cards[a.inspectedIndex].role); shuffle(r.deck); target.cards[a.inspectedIndex] = card(r.deck.pop()); }
      visual(r, 'cards', { actorId: target.id, amount: 1, outcome: d.replace ? 'replace' : 'draw' });
      log(r, `${p.username} ${d.replace ? 'fait remplacer' : 'rend'} la carte de ${target.username}.`); finish(r);
    });
    handle('rematch', (r, p) => {
      need(r.host === p.id && r.phase === 'finished', 'Seul l’hôte peut proposer une revanche.');
      r.players = r.players.filter(q => sessions.has(q.token));
      r.phase = 'waiting'; r.pending = null; r.deck = [];
      r.players.forEach(q => { q.ready = q.id === p.id; q.cards = []; q.coins = 0; q.drafted = false; });
    }, true);
    handle('removeDisconnected', (r, p, d) => {
      const other = player(r, d.id);
      need(r.host === p.id && other && !other.connected && other.id !== p.id, 'Seul un joueur déconnecté peut être retiré par l’hôte.');
      sessions.delete(other.token); log(r, `${other.username} quitte la table.`); remove(r, other);
    }, true);
    handle('leaveRoom', (r, p) => {
      sessions.delete(p.token); p.connected = false; log(r, `${p.username} quitte la table.`);
      remove(r, p); session = null; socket.emit('leftRoom');
    }, true);
    socket.on('disconnect', () => {
      const ctx = context(); if (!ctx) return;
      ctx.p.connected = false;
      if (ctx.r.host === ctx.p.id) ctx.r.host = ctx.r.players.find(p => p.connected)?.id || ctx.p.id;
      publish(ctx.r);
    });
  });
  // Abandoned rooms are retained for one hour, allowing accidental reloads to recover.
  const cleanup = setInterval(() => {
    for (const r of rooms.values()) {
      if (r.players.some(p => p.connected)) r.emptySince = null;
      else if (!r.emptySince) r.emptySince = Date.now();
      else if (Date.now() - r.emptySince > 3600000) {
        r.players.forEach(p => sessions.delete(p.token)); rooms.delete(r.code);
      }
    }
  }, 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return { server, io, rooms, close: () => new Promise(resolve => io.close(resolve)) };
}

if (require.main === module) {
  const { server } = createGameServer();
  server.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => console.log(`Complot prêt sur le port ${server.address().port}`));
}
module.exports = { createGameServer };
