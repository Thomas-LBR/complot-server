const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client'),{createGameServer}=require('./server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Château Combo shares one market, validates the turn and reconnects by session',async()=>{
 const host=createGameServer();await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+host.server.address().port,clients=[];
 const wait=(s,event)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout '+event)),4000);s.once(event,v=>{clearTimeout(timer);resolve(v)})});
 async function connect(token){const s=io(url+'/chateau',{transports:['websocket'],autoConnect:false,auth:{token}});clients.push(s);s.on('state',v=>s.state=v);s.on('session',v=>s.token=v);const p=wait(s,'connect');s.connect();await p;return s;}
 async function send(s,event,data={}){await sleep(90);const p=wait(s,'state');s.emit('command',{event,data});return p;}
 try{const a=await connect();await send(a,'create',{name:'Alice'});const b=await connect();await send(b,'join',{name:'Bob',code:a.state.room.code});await send(b,'ready');await send(a,'start');await sleep(20);assert.deepEqual(a.state.room.market,b.state.room.market);assert.equal(a.state.room.players.length,2);
 const actor=a.state.room.players[a.state.room.current].id===a.state.myId?a:b,other=actor===a?b:a;await sleep(90);const err=wait(other,'errorMessage');other.emit('command',{event:'recruit',data:{place:'Village',index:0,position:4,down:true}});assert.match(await err,/tour/);await send(actor,'recruit',{place:'Village',index:0,position:4,down:true});await sleep(20);assert.deepEqual(a.state.room.market,b.state.room.market);assert.equal(a.state.room.players.find(p=>p.id===actor.state.myId).board[4].id,null);
 const token=actor.token,id=actor.state.myId;actor.disconnect();await sleep(20);assert.equal(other.state.room.paused,true);const restored=await connect(token);await sleep(20);assert.equal(restored.state.myId,id);assert.equal(restored.state.room.paused,false);
 }finally{clients.forEach(s=>s.disconnect());await host.close()}
});
