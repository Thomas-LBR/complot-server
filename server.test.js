const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createGameServer } = require('./server');

const wait = async fn => { const end = Date.now() + 2500; while (!fn()) { if (Date.now() > end) throw new Error('Timed out waiting for game state'); await new Promise(r => setTimeout(r, 5)); } };
async function fixture(t, n = 3, variant = 'Ambassadeur', start = true) {
  const game = createGameServer(); await new Promise(r => game.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${game.server.address().port}`, clients = [];
  async function connect(token) {
    const c = { state: null, token, error: null, socket: io(url, { transports: ['websocket'], forceNew: true, auth: { sessionToken: token }, autoConnect: false }) };
    c.socket.on('gameState', s => c.state = s); c.socket.on('session', s => c.token = s.token); c.socket.on('errorMessage', e => c.error = e);
    c.socket.connect(); await wait(() => c.socket.connected); clients.push(c); return c;
  }
  t.after(async () => { clients.forEach(c => c.socket.disconnect()); await game.close(); });
  const host = await connect(); host.socket.emit('createRoom', { username: 'Alice' }); await wait(() => host.state);
  const code = host.state.room.code;
  for (let i = 1; i < n; i++) { const c = await connect(); c.socket.emit('joinRoom', { roomCode: code, username: `Joueur ${i + 1}` }); await wait(() => c.state); }
  const room = game.rooms.get(code);
  const send = async (c, event, data = {}) => {
    const before = c.state; c.error = null; c.socket.emit(event, data);
    await wait(() => c.state !== before || c.error); return c.state;
  };
  if (variant !== 'Ambassadeur') await send(host, 'setVariant', { variant });
  if (start) {
    for (const c of clients) if (!room.players.find(p => p.id === c.state.myId).ready) await send(c, 'setReady');
    await send(host, 'startGame');
  }
  const p = i => room.players.find(p => p.id === clients[i].state.myId);
  const setCards = (i, roles) => { p(i).cards = roles.map(role => ({ role, revealed: false })); };
  const resolve = async () => {
    for (let i = 0; i < 20 && room.pending; i++) {
      const a = room.pending;
      if (!['challengeAction', 'challengeBlock', 'blockWindow'].includes(a.stage)) return;
      const state = clients.find(c => c.socket.connected).state.room.pendingAction;
      const id = state.eligibleIds.find(id => !state.respondedIds.includes(id));
      if (!id) { await new Promise(r => setTimeout(r, 5)); continue; }
      await send(clients.find(c => c.state.myId === id), 'pass');
    }
  };
  return { ...game, clients, room, send, p, setCards, resolve, connect };
}

test('lobby validates names, capacity, readiness and authority', async t => {
  const f = await fixture(t, 8, 'Ambassadeur', false), { clients: c, room: r, send } = f;
  await send(c[0], 'startGame'); assert.match(c[0].error, /prêt/); assert.equal(r.phase, 'waiting');
  await send(c[1], 'setVariant', { variant: 'Inquisiteur' }); assert.ok(c[1].error);
  const extra = await f.connect(); extra.socket.emit('joinRoom', { roomCode: r.code, username: 'Extra' }); await wait(() => extra.error); assert.match(extra.error, /complète/);
});
test('3–6 and 7–8 players get the correct deck and private snapshots', async t => {
  for (const n of [3, 6, 7, 8]) {
    const f = await fixture(t, n), r = f.room;
    assert.equal(r.deck.length, (n >= 7 ? 20 : 15) - 2 * n);
    assert.ok(r.players.every(p => p.coins === 2 && p.cards.length === 2));
    const state = f.clients[0].state;
    assert.equal(state.myCards.length, 2);
    assert.ok(state.room.players.every(p => !('cards' in p) && !('token' in p) && !('socketId' in p)));
    assert.ok(!('deck' in state.room));
  }
});
test('duel has one random and one chosen card, three in court, one coin for first', async t => {
  const f = await fixture(t, 2), { clients: c, room: r, send } = f;
  assert.equal(r.phase, 'drafting'); assert.equal(r.deck.length, 3); assert.equal(f.p(0).coins, 1); assert.equal(f.p(1).coins, 2);
  await send(c[0], 'draftRole', { role: 'Assassin' }); assert.equal(r.phase, 'drafting');
  await send(c[1], 'draftRole', { role: 'Comtesse' }); assert.equal(r.phase, 'playing'); assert.equal(f.p(0).cards[1].role, 'Assassin');
});
test('turn ownership and mandatory seven-coin assassination are enforced', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  await send(c[1], 'act', { type: 'income' }); assert.ok(c[1].error);
  f.p(0).coins = 10; await send(c[0], 'act', { type: 'duchess' }); assert.match(c[0].error, /obligatoire/); assert.equal(r.pending, null);
  await send(c[0], 'act', { type: 'coup', targetId: f.p(1).id, targetRole: f.p(1).cards[1].role }); assert.equal(f.p(0).coins, 3); assert.equal(r.pending.stage, 'awaitingReveal');
  await send(c[1], 'reveal', { index: 1 }); assert.equal(f.p(1).cards[1].revealed, true); assert.equal(r.current, 1);
});
test('a disproved Assassin does not spend the three coins', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.setCards(0, ['Duchesse', 'Capitaine']); f.p(0).coins = 3;
  await send(c[0], 'act', { type: 'assassinate', targetId: f.p(1).id, targetRole: f.p(1).cards[1].role });
  await send(c[1], 'challenge'); await send(c[0], 'reveal', { index: 0 });
  assert.equal(f.p(0).coins, 3); assert.equal(r.pending, null); assert.equal(f.p(1).cards.filter(c => c.revealed).length, 0);
});
test('a blocked Assassin pays three; actor can challenge the block', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.setCards(0, ['Assassin', 'Duchesse']); f.setCards(1, ['Comtesse', 'Duchesse']); f.p(0).coins = 3;
  await send(c[0], 'act', { type: 'assassinate', targetId: f.p(1).id, targetRole: f.p(1).cards[1].role });
  await send(c[1], 'pass'); await send(c[2], 'pass'); assert.equal(f.p(0).coins, 0);
  await send(c[1], 'block', { role: 'Comtesse' }); await send(c[0], 'challenge');
  assert.equal(r.pending.awaitingId, f.p(0).id); await send(c[0], 'reveal', { index: 0 }); assert.equal(r.pending, null);
  assert.ok(f.p(1).cards.every(c => !c.revealed));
});
test('failed Comtesse bluff can lose two influences in the same turn', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.setCards(0, ['Assassin', 'Duchesse']); f.setCards(1, ['Capitaine', 'Duchesse']); f.p(0).coins = 3;
  await send(c[0], 'act', { type: 'assassinate', targetId: f.p(1).id, targetRole: f.p(1).cards[1].role }); await send(c[1], 'pass'); await send(c[2], 'pass');
  await send(c[1], 'block', { role: 'Comtesse' }); await send(c[0], 'challenge');
  await send(c[1], 'reveal', { index: 0 }); assert.equal(r.pending.stage, 'awaitingReveal'); assert.equal(c[1].state.mustReveal.reason, 'assassinated');
  await send(c[1], 'reveal', { index: 1 }); assert.equal(f.p(1).coins, 0); assert.equal(r.current, 2);
  await send(c[1], 'challenge'); assert.ok(c[1].error);
});
test('failed challenge against Assassin can also cost two influences', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.setCards(0, ['Assassin', 'Duchesse']); f.p(0).coins = 3;
  await send(c[0], 'act', { type: 'assassinate', targetId: f.p(1).id, targetRole: f.p(1).cards[1].role }); await send(c[1], 'challenge');
  await send(c[1], 'reveal', { index: 0 }); assert.equal(r.pending.stage, 'blockWindow');
  await send(c[1], 'pass'); await send(c[1], 'reveal', { index: 1 }); assert.equal(f.p(1).coins, 0);
});
test('only theft target can block; passing twice or changing response is rejected', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.p(1).coins = 1; await send(c[0], 'act', { type: 'steal', targetId: f.p(1).id });
  await send(c[1], 'pass'); await send(c[1], 'challenge'); assert.ok(c[1].error);
  await send(c[2], 'pass'); await send(c[2], 'block', { role: 'Capitaine' }); assert.ok(c[2].error);
  await send(c[1], 'pass'); assert.equal(r.pending, null); assert.equal(f.p(0).coins, 3); assert.equal(f.p(1).coins, 0);
});
test('exchange validates stage and distinct indices, keeps one remaining influence', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  await send(c[0], 'exchange', { indices: [0, 1] }); assert.ok(c[0].error);
  f.p(0).cards[0].revealed = true; const deckSize = r.deck.length;
  await send(c[0], 'act', { type: 'exchange' }); await f.resolve(); assert.equal(r.pending.stage, 'exchange');
  assert.equal(c[0].state.exchangeOptions.currentCards.length, 1); assert.equal(c[1].state.exchangeOptions, null);
  await send(c[0], 'exchange', { indices: [0, 0] }); assert.ok(c[0].error);
  await send(c[0], 'exchange', { indices: [2] }); assert.equal(r.deck.length, deckSize); assert.equal(f.p(0).cards.filter(c => !c.revealed).length, 1);
});
test('Inquisiteur inspection stays private and replacement preserves court size', async t => {
  const f = await fixture(t, 3, 'Inquisiteur'), { clients: c, send, room: r } = f;
  const size = r.deck.length; await send(c[0], 'act', { type: 'inspect', targetId: f.p(1).id }); await f.resolve();
  assert.equal(r.pending.stage, 'inspectChoose'); await send(c[1], 'inspectChoose', { index: 0 });
  assert.equal(c[0].state.inspection.role, f.p(1).cards[0].role); assert.equal(c[2].state.inspection, null); assert.ok(!('inspectedIndex' in c[2].state.room.pendingAction));
  await send(c[0], 'inspectDecide', { replace: true }); assert.equal(r.deck.length, size); assert.equal(r.pending, null);
});
test('Inquisiteur exchange draws only one card', async t => {
  const f = await fixture(t, 3, 'Inquisiteur'); await f.send(f.clients[0], 'act', { type: 'exchange' }); await f.resolve();
  assert.equal(f.clients[0].state.exchangeOptions.drawnCards.length, 1);
});
test('reload restores identity, hand, pending reveal and pauses while disconnected', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.p(0).coins = 7; await send(c[0], 'act', { type: 'coup', targetId: f.p(1).id, targetRole: f.p(1).cards[1].role });
  const token = c[1].token, id = f.p(1).id, cards = JSON.stringify(f.p(1).cards); c[1].socket.disconnect(); await wait(() => !f.p(1).connected);
  await send(c[0], 'act', { type: 'income' }); assert.match(c[0].error, /pause/);
  const resumed = await f.connect(token); await wait(() => resumed.state);
  assert.equal(resumed.state.myId, id); assert.equal(JSON.stringify(resumed.state.myCards), cards); assert.equal(resumed.state.mustReveal.reason, 'coup');
  await send(resumed, 'reveal', { index: 1 }); assert.equal(r.pending, null);
});
test('foreign aid resolves when disconnected responder is removed', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  await send(c[0], 'act', { type: 'foreign_aid' }); await send(c[1], 'pass'); const id = f.p(2).id;
  c[2].socket.disconnect(); await wait(() => !f.p(2).connected); await send(c[0], 'removeDisconnected', { id });
  assert.equal(r.pending, null); assert.equal(f.p(0).coins, 4); assert.equal(c[0].state.room.paused, false);
});
test('outsider cannot influence another room and malformed payload does not crash', async t => {
  const f = await fixture(t), outsider = await f.connect();
  outsider.socket.emit('challenge', { roomCode: f.room.code }); await wait(() => outsider.error); assert.ok(outsider.error);
  await f.send(f.clients[0], 'act', { type: 'steal', targetId: 'missing' }); assert.ok(f.clients[0].error);
  await f.send(f.clients[0], 'act', { type: 'income' }); assert.equal(f.room.current, 1);
});
test('victory, accurate elimination order and rematch with previous winner first', async t => {
  const f = await fixture(t), { clients: c, send, room: r } = f;
  f.p(0).cards.forEach(x => x.revealed = true); f.p(0).coins = 0;
  r.current = 1; f.p(1).coins = 7; f.p(2).cards[0].revealed = true;
  await send(c[1], 'act', { type: 'coup', targetId: f.p(2).id, targetRole: f.p(2).cards[1].role }); await send(c[2], 'reveal', { index: 1 });
  assert.equal(r.phase, 'finished'); assert.equal(r.winnerId, f.p(1).id); assert.equal(f.p(1).wins, 1);
  await send(c[0], 'rematch'); assert.equal(r.phase, 'waiting');
  await send(c[1], 'setReady'); await send(c[2], 'setReady'); await send(c[0], 'startGame');
  assert.equal(r.current, 1); assert.equal(r.round, 2);
});

test('wrong guessed role costs coins and eliminates nothing for both attacks', async t => {
  for (const [type, cost] of [['assassinate', 3], ['coup', 7]]) {
    const f = await fixture(t), { clients: c, send, room: r } = f;
    f.p(0).coins = 9; f.setCards(1, ['Duchesse', 'Capitaine']);
    await send(c[0], 'act', { type, targetId: f.p(1).id, targetRole: 'Assassin' });
    await f.resolve();
    assert.equal(f.p(0).coins, 9 - cost); assert.equal(r.pending, null); assert.equal(r.current, 1);
    assert.ok(f.p(1).cards.every(c => !c.revealed));
    assert.ok(r.history.some(e => e.text.includes('Attaque manquée')));
  }
});
test('an attack requires a valid guessed role before charging coins', async t => {
  const f = await fixture(t); f.p(0).coins = 9;
  for (const type of ['assassinate', 'coup']) {
    await f.send(f.clients[0], 'act', { type, targetId: f.p(1).id });
    assert.match(f.clients[0].error, /rôle caché/); assert.equal(f.p(0).coins, 9);
    await f.send(f.clients[0], 'act', { type, targetId: f.p(1).id, targetRole: 'Inquisiteur' });
    assert.ok(f.clients[0].error); assert.equal(f.room.pending, null);
  }
});
test('only the guessed hidden role may be revealed, for either attack', async t => {
  for (const type of ['assassinate', 'coup']) {
    const f = await fixture(t); f.p(0).coins = 9; f.setCards(1, ['Capitaine', 'Assassin']);
    await f.send(f.clients[0], 'act', { type, targetId: f.p(1).id, targetRole: 'Assassin' }); await f.resolve();
    assert.equal(f.clients[1].state.mustReveal.targetRole, 'Assassin');
    await f.send(f.clients[1], 'reveal', { index: 0 }); assert.match(f.clients[1].error, /révéler Assassin/); assert.ok(!f.p(1).cards[0].revealed);
    await f.send(f.clients[1], 'reveal', { index: 1 }); assert.equal(f.p(1).cards[1].revealed, true); assert.equal(f.room.pending, null);
  }
});
test('revealed roles do not count as a hit and duplicate roles lose only one card', async t => {
  const f = await fixture(t); f.p(0).coins = 7; f.setCards(1, ['Assassin', 'Comtesse']); f.p(1).cards[0].revealed = true;
  await f.send(f.clients[0], 'act', { type: 'coup', targetId: f.p(1).id, targetRole: 'Assassin' });
  assert.equal(f.room.pending, null); assert.equal(f.p(0).coins, 0); assert.ok(!f.p(1).cards[1].revealed);
  f.room.current = 0; f.p(0).coins = 7; f.setCards(1, ['Assassin', 'Assassin']);
  await f.send(f.clients[0], 'act', { type: 'coup', targetId: f.p(1).id, targetRole: 'Assassin' });
  await f.send(f.clients[1], 'reveal', { index: 0 }); assert.equal(f.p(1).cards.filter(c => c.revealed).length, 1);
});

test('visual actions are identical for peers and attacks wait for response windows', async t => {
  const f = await fixture(t), { clients: c, room: r, send } = f;
  f.p(0).coins = 3; f.setCards(0, ['Assassin', 'Duchesse']); f.setCards(1, ['Capitaine', 'Duchesse']);
  await send(c[0], 'act', { type: 'assassinate', targetId: f.p(1).id, targetRole: 'Capitaine' });
  assert.deepEqual(r.visualEvents.map(e => e.kind), ['announce']);
  await send(c[1], 'pass'); await send(c[2], 'pass');
  assert.deepEqual(r.visualEvents.map(e => e.kind), ['announce', 'coins']);
  assert.equal(r.visualEvents[1].amount, -3);
  await send(c[1], 'pass');
  assert.equal(r.visualEvents.at(-1).kind, 'attack'); assert.equal(r.visualEvents.at(-1).outcome, 'hit');
  assert.ok(!r.visualEvents.some(e => e.kind === 'reveal'));
  await send(c[1], 'reveal', { index: 0 });
  await wait(() => c.every(peer => peer.state.room.visualEvents.at(-1)?.id === r.visualEvents.at(-1).id));
  assert.deepEqual(c[0].state.room.visualEvents, c[2].state.room.visualEvents);
  assert.deepEqual(r.visualEvents.slice(-2).map(e => e.kind), ['reveal', 'turn']);
  assert.equal(r.visualEvents.find(e => e.kind === 'reveal').role, 'Capitaine');
});
test('accepted shield cancels impact and a disproved shield breaks before attack', async t => {
  for (const challenge of [false, true]) {
    const f = await fixture(t), { clients: c, room: r, send } = f;
    f.p(0).coins = 3; f.setCards(0, ['Assassin', 'Duchesse']); f.setCards(1, ['Capitaine', 'Duchesse']);
    await send(c[0], 'act', { type: 'assassinate', targetId: f.p(1).id, targetRole: 'Duchesse' });
    await send(c[1], 'pass'); await send(c[2], 'pass');
    await send(c[1], 'block', { role: 'Comtesse' });
    assert.equal(r.visualEvents.at(-1).outcome, 'proposed');
    if (challenge) {
      await send(c[0], 'challenge');
      assert.equal(r.visualEvents.at(-1).outcome, 'broken');
      assert.ok(!r.visualEvents.some(e => e.kind === 'attack'));
      await send(c[1], 'reveal', { index: 0 });
      assert.equal(r.visualEvents.at(-1).kind, 'attack');
    } else {
      await f.resolve();
      assert.ok(r.visualEvents.some(e => e.kind === 'block' && e.outcome === 'confirmed'));
      assert.ok(!r.visualEvents.some(e => e.kind === 'attack'));
    }
  }
});
test('exchange animation payloads never include secret roles, deck or credentials', async t => {
  const f = await fixture(t), { clients: c, room: r, send } = f;
  await send(c[0], 'act', { type: 'exchange' }); await f.resolve();
  const draw = r.visualEvents.at(-1); assert.equal(draw.kind, 'cards'); assert.equal(draw.amount, 2);
  assert.ok(draw.players.every(p => p.revealedInfluences.length === 0));
  const forbidden = ['cards', 'drawn', 'deck', 'token', 'socketId', 'role', 'inspectedIndex'];
  const visit = value => { if (!value || typeof value !== 'object') return; for (const [k, v] of Object.entries(value)) { assert.ok(!forbidden.includes(k), `private key ${k}`); visit(v); } };
  r.visualEvents.forEach(visit);
  await send(c[0], 'exchange', { indices: [0, 1] });
  assert.ok(r.visualEvents.some(e => e.kind === 'cards' && e.outcome === 'return'));
});
test('visual synchronization is idempotent, bounded and records wrong guesses without reveals', async t => {
  const f = await fixture(t), { clients: c, room: r, send } = f;
  f.p(0).coins = 7; f.setCards(1, ['Duchesse', 'Comtesse']);
  await send(c[0], 'act', { type: 'coup', targetId: f.p(1).id, targetRole: 'Assassin' });
  assert.equal(r.visualEvents.find(e => e.kind === 'attack').outcome, 'miss');
  assert.ok(!r.visualEvents.some(e => e.kind === 'reveal'));
  const before = JSON.stringify(r.visualEvents); await send(c[0], 'sync'); assert.equal(JSON.stringify(r.visualEvents), before);
  for (let i = 0; i < 25; i++) { const client = c.find(peer => peer.state.myId === r.players[r.current].id); r.players[r.current].coins = 1; await send(client, 'act', { type: 'income' }); }
  assert.equal(r.visualEvents.length, 40); assert.ok(r.visualEvents.every((e, i, all) => !i || e.id === all[i - 1].id + 1));
});
