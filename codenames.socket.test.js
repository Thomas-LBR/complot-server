const test=require('node:test'),assert=require('node:assert/strict');
const {io}=require('socket.io-client'),{createGameServer}=require('./server');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const mode of ['classic','duo'])test(`Codenames ${mode}: room creation, private snapshots, stale actions and reconnection`,async()=>{
 const host=createGameServer();await new Promise(resolve=>host.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+host.server.address().port,clients=[];
 function wait(s,event){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('timeout '+event)),4000);s.once(event,v=>{clearTimeout(timeout);resolve(v);});});}
 async function connect(token){const s=io(url+'/codenames',{transports:['websocket'],autoConnect:false,auth:{token}});clients.push(s);s.on('state',v=>s.state=v);s.on('session',v=>s.token=v);const ready=wait(s,'connect');s.connect();await ready;return s;}
 async function send(s,event,data={}){await sleep(80);const done=wait(s,'state');s.emit('command',{event,data,revision:s.state?.room.revision});await done;await sleep(10);}
 try{
  const first=await connect();await send(first,'create',{name:'Hôte'});await send(first,'settings',{mode,turns:9,errors:9});
  for(let i=1;i<(mode==='duo'?2:4);i++){const s=await connect();await send(s,'join',{name:'Joueur '+i,code:first.state.room.code});}
  for(const s of clients)await send(s,'ready');await send(first,'start');
  assert.equal(host.rooms.size,0);assert.equal(host.bang.rooms.size,0);assert.equal(host.codenames.rooms.size,1);
  const internal=host.codenames.rooms.get(first.state.room.code);
  for(const s of clients){const p=s.state.room.players.find(p=>p.id===s.state.myId);assert.equal(!!s.state.privateKey,mode==='duo'||p.role==='spy');assert.equal(s.state.allKeys,null);assert(s.state.room.players.every(p=>p.token===undefined&&p.socketId===undefined));assert.equal(s.state.room.keys,undefined);}
  if(mode==='duo')assert.notDeepEqual(clients[0].state.privateKey,clients[1].state.privateKey);
  const spy=clients.find(s=>s.state.canClue);await send(spy,'clue',{word:'VOCABULAIRE',number:1});const agent=clients.find(s=>s.state.canGuess),revision=agent.state.room.revision;
  const color=mode==='duo'?'green':internal.team,index=internal.keys[internal.team].indexOf(color);await send(agent,'guess',{index});
  for(const s of clients)assert.equal(s.state.room.board[index].revealed,color);
  await sleep(80);const error=wait(agent,'errorMessage');agent.emit('command',{event:'guess',data:{index},revision});assert.match(await error,/table a changé/);assert.equal(internal.guesses,1);
  const id=agent.state.myId,token=agent.token;agent.disconnect();await sleep(30);assert.equal(spy.state.room.paused,true);const restored=await connect(token);await sleep(30);assert.equal(restored.state.myId,id);assert.equal(restored.state.room.paused,false);assert.equal(restored.state.room.board[index].revealed,color);
 }finally{clients.forEach(s=>s.disconnect());await host.close();}
});
