const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client');const {createGameServer}=require('./server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Bang namespace isolates secrets and restores identity without changing Complot',async()=>{
 const host=createGameServer();await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+host.server.address().port;const clients=[];
 function wait(s,event){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('timeout '+event)),4000);s.once(event,v=>{clearTimeout(t);resolve(v);});});}
 async function connect(token){const s=io(url+'/bang',{transports:['websocket'],autoConnect:false,auth:{token}});clients.push(s);s.on('state',v=>s.state=v);s.on('session',v=>s.token=v);const connected=wait(s,'connect');s.connect();await connected;return s;}
 async function send(s,event,data={}){await sleep(85);const result=wait(s,event==='leave'?'left':'state');s.emit('command',{event,data});return result;}
 try{const one=await connect();await send(one,'create',{name:'Sheriff test'});for(let i=1;i<4;i++){const s=await connect();await send(s,'join',{name:'Peer '+i,code:one.state.room.code});await send(s,'ready');}await send(one,'start');await sleep(50);assert.equal(one.state.room.phase,'playing');for(const s of clients){assert(s.state.role);assert.equal(s.state.room.players.filter(p=>p.role).length,1);assert.equal(s.state.room.players[0].hand,undefined);assert.equal(s.state.room.players[0].token,undefined);}const id=one.state.myId,token=one.token;one.disconnect();await sleep(30);assert.equal(clients[1].state.room.paused,true);const re=await connect(token);await sleep(50);assert.equal(re.state.myId,id);assert.equal(re.state.room.paused,false);assert.equal(host.rooms.size,0);assert.equal(host.bang.rooms.size,1);
 }finally{clients.forEach(s=>s.disconnect());await host.close();}
});
