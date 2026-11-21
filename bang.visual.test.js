const test=require('node:test'),assert=require('node:assert/strict');
const b=require('./bang'),data=require('./bang-data');
function room(){const r=b.createRoom('FX');for(let i=0;i<4;i++)b.addPlayer(r,'P'+i).ready=true;b.start(r);r.pending=null;r.queue=[];r.stage='play';r.activeId=r.players[0].id;r.players.forEach((p,i)=>{p.character=data.CHARACTERS.find(c=>c.name==='Rose Doolan');p.hp=p.maxHp=4;p.hand=[];p.equipment=[];p.role=['Shérif','Hors-la-loi','Hors-la-loi','Renégat'][i];});r.visuals=[];return r;}
let seq=0;
function give(p,type){const c={...data.makeDeck().find(c=>c.type===type),id:'fx'+seq++};p.hand.push(c);return c;}
test('visual attack announces target; only resolved damage causes impact, defense does not',()=>{
 const r=room(),[p,q]=r.players;b.command(r,p,'play',{cardId:give(p,'bang').id,targetId:q.id});assert.equal(r.visuals.at(-1).kind,'attack');assert.equal(r.visuals.at(-1).targetId,q.id);assert(!r.visuals.some(e=>e.kind==='damage'));
 b.command(r,q,'respond',{cardId:give(q,'missed').id});assert(r.visuals.some(e=>e.kind==='defense'));assert(!r.visuals.some(e=>e.kind==='damage'));
 r.bangs=0;b.command(r,p,'play',{cardId:give(p,'bang').id,targetId:q.id});b.command(r,q,'respond',{choice:'take'});assert.equal(r.visuals.at(-1).kind,'damage');assert.equal(r.visuals.at(-1).count,1);
});
test('Kit only commits after response and public animation cannot reveal his draw or return',()=>{
 const r=room(),[p,q]=r.players;q.character=data.CHARACTERS.find(c=>c.name==='Kit Carlson');b.command(r,p,'end');assert.equal(r.pending.type,'kit');const ids=r.pending.cards.map(c=>c.id),reject=ids[1];assert.equal(q.hand.length,0);
 assert.throws(()=>b.command(r,q,'respond',{cardId:'forged'}));assert.equal(q.hand.length,0);
 b.command(r,q,'respond',{cardId:reject});assert.deepEqual(q.hand.map(c=>c.id).sort(),ids.filter(id=>id!==reject).sort());assert.equal(r.deck.at(-1).id,reject);
 const events=b.snapshot(r,p).room.visuals;assert.deepEqual(events,b.snapshot(r,q).room.visuals);for(const id of ids)assert(!JSON.stringify(events).includes(id));assert(events.some(e=>e.kind==='return'));
 assert(events.every(e=>Object.keys(e).sort().join(',')==='actorId,at,cardType,count,id,kind,targetId'));
});
test('collective attacks target each responder in order, prison and draws have public cues',()=>{
 const r=room(),[p,q]=r.players;b.command(r,p,'play',{cardId:give(p,'indians').id});for(const target of r.players.slice(1)){assert.equal(r.visuals.filter(e=>e.kind==='attack').at(-1).targetId,target.id);b.command(r,target,'respond',{cardId:give(target,'bang').id});}
 b.command(r,p,'play',{cardId:give(p,'jail').id,targetId:q.id});assert.equal(r.visuals.at(-1).kind,'prison');assert.equal(r.visuals.at(-1).targetId,q.id);
 b.command(r,p,'play',{cardId:give(p,'stagecoach').id});assert.equal(r.visuals.at(-1).kind,'draw');assert.equal(r.visuals.at(-1).count,2);
});
