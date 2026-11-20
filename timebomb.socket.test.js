const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client'),{createGameServer}=require('./server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Time Bomb isolates state, rejects forged cuts, reconnects and broadcasts cuts to all',async()=>{
 const host=createGameServer();await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+host.server.address().port,clients=[];
 function wait(s,event){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout '+event)),4000);s.once(event,value=>{clearTimeout(timer);resolve(value);});});}
 async function connect(token){const s=io(url+'/timebomb',{transports:['websocket'],autoConnect:false,auth:{token}});clients.push(s);s.on('state',v=>s.state=v);s.on('session',v=>s.token=v);const p=wait(s,'connect');s.connect();await p;return s;}
 async function send(s,event,data={}){await sleep(90);const p=wait(s,event==='leave'?'left':'state');s.emit('command',{event,data});return p;}
 try{const first=await connect();await send(first,'create',{name:'Host'});for(let i=1;i<4;i++){const s=await connect();await send(s,'join',{name:'Peer '+i,code:first.state.room.code});await send(s,'ready');}await send(first,'settings',{mode:'base',firstId:first.state.myId});await send(first,'start');await sleep(20);
 for(const s of clients){assert(s.state.role);assert(s.state.room.players.every(p=>p.role===null&&p.token===undefined&&p.cards.every(c=>c.type===undefined)));}assert.equal(host.rooms.size,0);assert.equal(host.bang.rooms.size,0);
 await sleep(90);const error=wait(clients[2],'errorMessage');clients[2].emit('command',{event:'cut',data:{targetId:first.state.myId,cardId:first.state.room.players[0].cards[0].id}});await error;assert.equal(first.state.room.revealed.length,0);
 const victim=first.state.room.players[1];await send(first,'cut',{targetId:victim.id,cardId:victim.cards[0].id});await sleep(20);for(const s of clients)assert.deepEqual(s.state.room.revealed,first.state.room.revealed);
 const token=first.token,id=first.state.myId;first.disconnect();await sleep(30);assert(clients[1].state.room.paused);const restored=await connect(token);await sleep(30);assert.equal(restored.state.myId,id);assert.equal(restored.state.room.paused,false);
 await send(restored,'leave');await sleep(20);assert.equal(clients[1].state.room.phase,'finished');assert.equal(clients[1].state.room.winner,null);
 }finally{clients.forEach(s=>s.disconnect());await host.close();}
});
