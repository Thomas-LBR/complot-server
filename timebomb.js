const { randomInt, randomBytes, randomUUID } = require('crypto');
const COLORS = ['yellow', 'blue', 'red', 'pink', 'green', 'orange'];
const LABELS = { yellow:'Jaune', blue:'Bleue', red:'Rouge', pink:'Rose', green:'Verte', orange:'Orange', safe:'Désamorçage' };
const need = (ok, message) => { if (!ok) throw Error(message); };
function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a; }
function createRoom(code) { return {code,players:[],hostId:null,phase:'waiting',mode:'evolution',firstId:null,round:0,cuts:0,limit:0,activeId:null,forcedId:null,colors:[],revealed:[],protected:[],pending:null,lastType:null,history:[],sequence:0,winner:null,reason:''}; }
function addPlayer(r,name) { const p={id:randomUUID(),token:randomBytes(24).toString('hex'),name,ready:!r.players.length,connected:true,role:null,cards:[]};r.players.push(p);r.hostId ||= p.id;return p; }
function log(r,text){r.history.push({id:++r.sequence,text});if(r.history.length>120)r.history.shift();}
function finish(r,winner,reason){r.phase='finished';r.winner=winner;r.reason=reason;r.pending=null;log(r,reason);}
function count(r,type){return r.revealed.filter(c=>c.type===type).length;}
function explodes(r,color){return !r.protected.includes(color)&&count(r,color)>=(r.mode==='evolution'&&color==='green'?3:4);}
function deal(r,cards){shuffle(cards);const n=cards.length/r.players.length;need(Number.isInteger(n),'Distribution impossible.');for(const p of r.players)p.cards=cards.splice(0,n).map(c=>({id:randomUUID(),type:c.type}));}
function start(r,p){need(p.id===r.hostId,'Seul l’hôte lance la partie.');need(r.phase==='waiting'||r.phase==='finished','Partie déjà commencée.');need(r.players.length>=4&&r.players.length<=6,'Il faut 4 à 6 joueurs.');need(r.players.every(q=>q.ready&&q.connected),'Tous les joueurs doivent être prêts et connectés.');
 const n=r.players.length,roles=shuffle([...Array(n===6?4:3).fill('Sherlock'),'Moriarty','Moriarty']);
 r.colors=shuffle([...COLORS]).slice(0,n);r.revealed=[];r.protected=[];r.pending=null;r.lastType=null;r.forcedId=null;r.history=[];r.sequence=0;r.round=1;r.cuts=0;r.limit=n;r.winner=null;r.reason='';r.phase='playing';
 r.players.forEach(q=>q.role=roles.pop());const bombs=shuffle(r.colors.flatMap(type=>Array.from({length:5},()=>({type}))));bombs.splice(0,n);deal(r,[...bombs,...Array.from({length:n},()=>({type:'safe'}))]);r.activeId=r.players.some(q=>q.id===r.firstId)?r.firstId:r.hostId;log(r,'Manche 1 : chacun reçoit 5 câbles.');
}
function advance(r){if(r.phase!=='playing'||r.pending)return;
 if(r.cuts>=r.limit){if(r.round===4){finish(r,'Moriarty','Minuit a sonné : les câbles de désamorçage n’ont pas tous été trouvés.');return;}r.round++;r.cuts=0;deal(r,r.players.flatMap(p=>p.cards));r.limit=r.players.length-(r.mode==='evolution'&&r.round===4?count(r,'orange'):0);log(r,'Manche '+r.round+' : '+(6-r.round)+' câbles par joueur, '+Math.max(0,r.limit)+' coupures possibles.');if(r.limit<=0){finish(r,'Moriarty','Les bombes orange ne laissent aucune coupure avant minuit.');return;}}
 if(r.forcedId){const target=r.players.find(p=>p.id===r.forcedId);if(!target.cards.length){r.activeId=target.id;r.forcedId=null;log(r,target.name+' n’a plus de câbles et reçoit la pince.');}}
}
function command(r,p,event,d={}) {
 if(event==='ready'){need(r.phase==='waiting','La partie a déjà commencé.');p.ready=!p.ready;return;}
 if(event==='settings'){need(p.id===r.hostId&&r.phase==='waiting','Réglages réservés à l’hôte avant la partie.');need(['base','evolution'].includes(d.mode),'Mode invalide.');need(r.players.some(q=>q.id===d.firstId),'Premier joueur invalide.');r.mode=d.mode;r.firstId=d.firstId;return;}
 if(event==='start'||event==='rematch'){start(r,p);return;}
 need(r.phase==='playing','Aucune partie en cours.');need(r.players.every(q=>q.connected),'La partie attend la reconnexion d’un joueur.');
 if(event==='choose'){
   const a=r.pending;need(a&&a.actorId===p.id,'Ce choix ne vous appartient pas.');need(a.options.includes(d.color),'Couleur indisponible.');
   if(a.type==='protect'){r.protected.push(d.color);log(r,p.name+' désamorce la bombe '+LABELS[d.color].toLowerCase()+'.');}
   else{r.protected=r.protected.filter(c=>c!==d.color);log(r,p.name+' retire la protection '+LABELS[d.color].toLowerCase()+'.');if(explodes(r,d.color)){finish(r,'Moriarty','La bombe '+LABELS[d.color].toLowerCase()+' explose après le retrait de sa protection.');return;}}
   r.pending=null;advance(r);return;
 }
 need(event==='cut','Action inconnue.');need(!r.pending,'Résolvez d’abord le choix en cours.');need(r.activeId===p.id,'Vous n’avez pas la pince.');const target=r.players.find(q=>q.id===d.targetId);need(target,'Joueur introuvable.');need(r.forcedId?target.id===r.forcedId:target.id!==p.id,'Choisissez un câble adverse autorisé.');const i=target.cards.findIndex(c=>c.id===d.cardId);need(i>=0,'Ce câble n’est plus disponible.');
 const card=target.cards.splice(i,1)[0],previous=r.lastType;r.lastType=card.type;r.revealed.push({type:card.type,actorId:p.id,targetId:target.id,round:r.round,number:r.revealed.length+1});r.cuts++;r.activeId=target.id;r.forcedId=null;log(r,p.name+' coupe chez '+target.name+' : '+LABELS[card.type]+'.');
 if(card.type==='safe'){
   if(count(r,'safe')===r.players.length){finish(r,'Sherlock','Tous les câbles de désamorçage ont été trouvés : Londres est sauvée !');return;}
   if(r.mode==='evolution'){const options=r.colors.filter(c=>c!=='yellow'&&count(r,c)>0&&!r.protected.includes(c));if(options.length)r.pending={type:'protect',actorId:p.id,options};}
 }else{
   if(r.mode==='evolution'&&card.type==='pink'&&previous==='pink'){finish(r,'Moriarty','Deux bombes roses consécutives : explosion, même avec une protection !');return;}
   if(explodes(r,card.type)){finish(r,'Moriarty','La bombe '+LABELS[card.type].toLowerCase()+' explose !');return;}
   if(r.mode==='evolution'&&card.type==='blue'&&r.protected.length)r.pending={type:'unprotect',actorId:p.id,options:[...r.protected]};
   if(r.mode==='evolution'&&card.type==='red'){const index=r.players.indexOf(target),number=randomInt(r.players.length);r.forcedId=r.players[(index+number)%r.players.length].id;log(r,'Tirage rouge : '+number+'. '+target.name+' devra couper chez '+r.players.find(q=>q.id===r.forcedId).name+'.');}
 }
 advance(r);
}
function snapshot(r,p){return {myId:p.id,role:p.role,composition:['safe',...COLORS].map(type=>({type,count:p.cards.filter(c=>c.type===type).length})).filter(c=>c.count),room:{code:r.code,hostId:r.hostId,phase:r.phase,mode:r.mode,firstId:r.firstId,round:r.round,cuts:r.cuts,limit:r.limit,activeId:r.activeId,forcedId:r.forcedId,colors:r.colors,revealed:r.revealed,protected:r.protected,pending:r.pending,history:r.history,winner:r.winner,reason:r.reason,paused:r.phase==='playing'&&r.players.some(q=>!q.connected),players:r.players.map(q=>({id:q.id,name:q.name,ready:q.ready,connected:q.connected,role:r.phase==='finished'?q.role:null,cards:q.cards.map(c=>({id:c.id}))}))}};}
function leave(r,p){if(r.phase==='playing')finish(r,null,p.name+' a quitté : la partie est interrompue, sans vainqueur.');r.players=r.players.filter(q=>q!==p);if(r.hostId===p.id)r.hostId=r.players.find(q=>q.connected)?.id||r.players[0]?.id||null;}
function attachTimebomb(io){const ns=io.of('/timebomb'),rooms=new Map(),sessions=new Map();
 const publish=r=>{for(const p of r.players)if(p.connected)ns.to(p.socketId).emit('state',snapshot(r,p));};
 ns.on('connection',s=>{let session=sessions.get(s.handshake.auth?.token);const context=()=>{const r=session&&rooms.get(session.code),p=r?.players.find(q=>q.id===session.id);return p&&p.socketId===s.id?{r,p}:null;};
 if(session){const r=rooms.get(session.code),p=r?.players.find(q=>q.id===session.id);if(p){const old=ns.sockets.get(p.socketId);p.socketId=s.id;p.connected=true;old?.disconnect(true);s.emit('session',p.token);publish(r);}else{session=null;s.emit('expired');}}else if(s.handshake.auth?.token)s.emit('expired');
 let last=0;s.on('command',(packet={})=>{try{need(Date.now()-last>=80,'Un instant…');last=Date.now();need(packet&&typeof packet==='object','Commande invalide.');const {event,data={}}=packet;need(typeof event==='string'&&data&&typeof data==='object','Commande invalide.');const ctx=context();
 if(event==='create'||event==='join'){need(!ctx,'Quittez votre salle actuelle.');const name=String(data.name||'').trim().slice(0,20);need(name,'Choisissez un nom.');let r;if(event==='create'){need(rooms.size<300,'Le serveur est complet.');let code;do{code=randomBytes(3).toString('hex').slice(0,5).toUpperCase();}while(rooms.has(code));r=createRoom(code);rooms.set(code,r);}else{r=rooms.get(String(data.code||'').trim().toUpperCase());need(r&&r.phase==='waiting','Salle introuvable ou partie déjà commencée.');need(r.players.length<6,'Salle complète.');need(!r.players.some(p=>p.name.toLowerCase()===name.toLowerCase()),'Ce nom est déjà pris.');}const p=addPlayer(r,name);p.socketId=s.id;session={code:r.code,id:p.id};sessions.set(p.token,session);s.emit('session',p.token);publish(r);return;}
 need(ctx,'Rejoignez une salle.');const {r,p}=ctx;
 if(event==='leave'){sessions.delete(p.token);leave(r,p);session=null;s.emit('left');if(!r.players.length)rooms.delete(r.code);else publish(r);return;}
 if(event==='remove'){need(p.id===r.hostId&&r.phase!=='playing','Retrait possible par l’hôte hors partie.');const q=r.players.find(q=>q.id===data.id);need(q&&!q.connected,'Ce joueur est connecté.');sessions.delete(q.token);leave(r,q);publish(r);return;}
 if(event==='abort'){need(p.id===r.hostId&&r.phase==='playing','Action réservée à l’hôte pendant la partie.');finish(r,null,'L’hôte a interrompu la partie, sans vainqueur.');publish(r);return;}
 if(event!=='sync')command(r,p,event,data);publish(r);
 }catch(e){s.emit('errorMessage',e.message);}});
 s.on('disconnect',()=>{const ctx=context();if(ctx){ctx.p.connected=false;if(ctx.r.hostId===ctx.p.id)ctx.r.hostId=ctx.r.players.find(p=>p.connected)?.id||ctx.p.id;publish(ctx.r);}});
 });
 const timer=setInterval(()=>{for(const r of rooms.values()){if(r.players.some(p=>p.connected))r.emptySince=null;else if(!r.emptySince)r.emptySince=Date.now();else if(Date.now()-r.emptySince>3600000){r.players.forEach(p=>sessions.delete(p.token));rooms.delete(r.code);}}},60000);timer.unref();io.httpServer?.on('close',()=>clearInterval(timer));return {rooms,sessions};
}
module.exports={createRoom,addPlayer,start,command,snapshot,advance,leave,attachTimebomb,COLORS};
