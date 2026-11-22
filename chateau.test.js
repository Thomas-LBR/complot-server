const {test}=require('node:test');
const assert=require('node:assert/strict');
const game=require('./chateau');

function room(){const r=game.createRoom('ABCDE'),a=game.addPlayer(r,'Alice'),b=game.addPlayer(r,'Bob');b.ready=true;game.start(r,a);return {r,a,b};}

test('78 unique cards, two 39-card decks, and face-down identity stays hidden',()=>{
 const {r,a,b}=room();assert.equal(Object.keys(game.cards).length,78);assert.equal(r.market.Village.length,3);assert.equal(r.market.Castle.length,3);assert.equal(r.decks.Village.length,36);assert.equal(r.decks.Castle.length,36);
 const p=r.players[r.current];game.command(r,p,'recruit',{place:'Village',index:0,position:4,down:true});assert.equal(p.gold,21);assert.equal(p.keys,4);assert.deepEqual(game.snapshot(r,p).room.players.find(x=>x.id===p.id).board[4],{id:null,down:true,stored:0});
 assert.equal(game.snapshot(r,p).room.market.Village.length,3);
});

test('one optional key action and legal adjacent placement are enforced by server',()=>{
 const {r}=room(),p=r.players[r.current];game.command(r,p,'key',{action:'move'});assert.equal(r.messenger,'Castle');assert.equal(p.keys,1);assert.throws(()=>game.command(r,p,'key',{action:'refresh'}),/Clé déjà dépensée/);
 game.command(r,p,'recruit',{place:'Castle',index:0,position:0,down:true});
 const q=r.players[r.current];game.command(r,q,'recruit',{place:r.messenger,index:0,position:0,down:true});
 assert.equal(r.players[r.current],p);assert.throws(()=>game.command(r,p,'recruit',{place:r.messenger,index:0,position:8,down:true}),/Emplacement invalide/);
});

test('permanent discount excludes its own purchase and end scores use keys and stored gold',()=>{
 const {r,a,b}=room();const card=game.cards.V18;a.board[4]={id:'V18',down:false,stored:0};a.gold=8;a.keys=3;b.board[4]={id:'V27',down:false,stored:2};b.gold=1;b.keys=2;
 game.finish(r);assert.equal(r.phase,'finished');assert.equal(a.score,3+2*Math.min(8,5));assert.equal(b.score,2+2*3);assert.deepEqual(r.winners,[a.id]);assert.equal(card.purse,5);
});

test('Baker counts both its own shield and Village banner',()=>{
 const {r}=room(),p=r.players[r.current];r.market.Village[0]='V26';game.command(r,p,'recruit',{place:'Village',index:0,position:4});assert.equal(p.gold,16);assert.equal(p.keys,3);
});
