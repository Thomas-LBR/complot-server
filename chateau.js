const {randomBytes,randomUUID,randomInt}=require('crypto');
const source=require('./cards-full.json');
const art=require('./card-map.json');
const cards=Object.fromEntries(source.map(c=>[c.id,{...c,image:(c.place==='Village'?'v':'c')+String(art[c.place==='Village'?'v':'c'].indexOf(Number(c.id.slice(1)))+1).padStart(2,'0'),shields:c.shields.split(',').map(x=>x.trim()),purse:Number(c.score.match(/purse capacity (\d+)/)?.[1]||0)}]));
const TYPES=['Military','Peasantry','Faith','Craftsmanship','Nobility','Scholarship'];
const need=(ok,msg)=>{if(!ok)throw Error(msg)};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a};
const createRoom=code=>({code,hostId:null,phase:'waiting',players:[],current:0,messenger:'Village',market:{Village:[],Castle:[]},decks:{Village:[],Castle:[]},discard:{Village:[],Castle:[]},keyUsed:false,pending:null,history:[],sequence:0,winners:[]});
const addPlayer=(r,name)=>{const p={id:randomUUID(),token:randomBytes(24).toString('hex'),name,connected:true,ready:!r.players.length,gold:15,keys:2,board:Array(9).fill(null),score:null};r.players.push(p);r.hostId ||=p.id;return p};
const log=(r,text)=>{r.history.push({id:++r.sequence,text});r.history=r.history.slice(-100)};
const face=p=>p.board.filter(x=>x&&!x.down).map(x=>cards[x.id]);
const all=p=>p.board.filter(x=>x&&!x.down);
const shields=p=>face(p).flatMap(x=>x.shields);
const count=(p,type)=>shields(p).filter(x=>x===type).length;
const banner=(p,place)=>face(p).filter(x=>x.place===place).length;
const scoreCard=(p,b,index)=>{
 const c=cards[b.id],s=c.score.replace(/[’�]/g,"'"),n=Number(s.match(/^(\d+) points?/)?.[1]||0),row=Math.floor(index/3),col=index%3;
 const axis=s.includes("row and column")?p.board.map((v,i)=>i).filter(i=>Math.floor(i/3)===row||i%3===col):s.includes("row")?p.board.map((v,i)=>i).filter(i=>Math.floor(i/3)===row):s.includes("column")?p.board.map((v,i)=>i).filter(i=>i%3===col):p.board.map((v,i)=>i);
 const involved=axis.map(i=>p.board[i]).filter(x=>x&&!x.down).map(x=>cards[x.id]),ss=involved.flatMap(x=>x.shields);
 if(s.includes('Gold on this card'))return n*b.stored;
 if(s.includes('Gold stored across all purses'))return n*all(p).reduce((t,x)=>t+x.stored,0);
 if(s.includes('Key you have'))return n*p.keys;
 if(s.includes('shield type absent'))return n*(TYPES.length-new Set(shields(p)).size);
 if(s.includes('complete set of'))return n*Math.min(...[...s.matchAll(/(Military|Peasantry|Faith|Craftsmanship|Nobility|Scholarship)/g)].map(m=>count(p,m[1])));
 if(s.includes('set of three identical'))return n*TYPES.reduce((t,x)=>t+Math.floor(count(p,x)/3),0);
 if(s.includes('set of one')&&s.includes('shield'))return n*Math.min(...[...s.matchAll(/(Military|Peasantry|Faith|Craftsmanship|Nobility|Scholarship)/g)].map(m=>count(p,m[1])));
 if(s.includes('pair of Village'))return n*Math.floor(banner(p,'Village')/2);
 if(s.includes('set of one Castle banner'))return n*Math.min(banner(p,'Castle'),banner(p,'Village'));
 if(s.includes('different shield type'))return n*new Set(ss).size;
 if(s.includes('shield in')){const type=TYPES.find(x=>s.includes(x+' shield'));return n*ss.filter(x=>x===type).length;}
 if(s.includes('banner in'))return n*banner(p,s.includes('Village banner')?'Village':'Castle');
 if(s.includes('printed cost of at least'))return n*face(p).filter(x=>x.cost>=Number(s.match(/at least (\d+)/)?.[1])).length;
 if(s.includes('printed cost of'))return n*face(p).filter(x=>x.cost===Number(s.match(/cost of (\d+)/)?.[1])).length;
 if(s.includes('card with two shields'))return n*face(p).filter(x=>x.shields.length===2).length;
 if(s.includes('discount ability'))return n*face(p).filter(x=>x.ability.startsWith('Permanent discount')).length;
 if(s.includes('no ')){const type=TYPES.find(x=>s.includes('no '+x));return type&&!count(p,type)?n:0;}
 if(s.includes('face-down'))return p.board.some(x=>x?.down)?n:0;
 if(s.includes('top row'))return row===0?n:0;if(s.includes('middle row'))return row===1?n:0;if(s.includes('bottom row'))return row===2?n:0;
 if(s.includes('leftmost column'))return col===0?n:0;if(s.includes('middle column'))return col===1?n:0;if(s.includes('rightmost column'))return col===2?n:0;
 if(s.includes('corner'))return row!==1&&col!==1?n:0;if(s.includes('center of an outer edge'))return (row===1)!==(col===1)?n:0;
 return 0;
};
function finish(r){r.phase='finished';for(const p of r.players){for(const b of p.board.filter(x=>x&&!x.down&&cards[x.id].purse)){const cap=cards[b.id].purse-b.stored,amount=Math.min(p.gold,cap);b.stored+=amount;p.gold-=amount;}p.score=p.keys+p.board.reduce((sum,b,i)=>sum+(b&&!b.down?scoreCard(p,b,i):0),0);}const top=Math.max(...r.players.map(p=>p.score));const gold=Math.max(...r.players.filter(p=>p.score===top).map(p=>p.gold));r.winners=r.players.filter(p=>p.score===top&&p.gold===gold).map(p=>p.id);log(r,'Fin de partie : '+r.players.filter(p=>r.winners.includes(p.id)).map(p=>p.name).join(' et ')+' gagne !')}
function refill(r,place){while(r.market[place].length<3){if(!r.decks[place].length){if(!r.discard[place].length)break;r.decks[place]=shuffle(r.discard[place].splice(0));}r.market[place].push(r.decks[place].pop());}}
function next(r){r.pending=null;r.keyUsed=false;refill(r,'Village');refill(r,'Castle');if(r.players.every(p=>p.board.every(Boolean))){finish(r);return;}do{r.current=(r.current+1)%r.players.length}while(r.players[r.current].board.every(Boolean));log(r,'Au tour de '+r.players[r.current].name+'.')}
function start(r,p){need(p.id===r.hostId,'Seul l’hôte lance la partie.');need(['waiting','finished'].includes(r.phase),'Partie en cours.');need(r.players.length>=2&&r.players.length<=5,'Il faut 2 à 5 joueurs.');need(r.players.every(q=>q.ready&&q.connected),'Tous les joueurs doivent être prêts et connectés.');r.decks.Village=shuffle(source.filter(x=>x.place==='Village').map(x=>x.id));r.decks.Castle=shuffle(source.filter(x=>x.place==='Castle').map(x=>x.id));r.market={Village:[],Castle:[]};r.discard={Village:[],Castle:[]};r.messenger='Village';r.current=randomInt(r.players.length);r.pending=null;r.keyUsed=false;r.history=[];r.sequence=0;r.winners=[];r.phase='playing';for(const q of r.players){q.gold=15;q.keys=2;q.board=Array(9).fill(null);q.score=null;}refill(r,'Village');refill(r,'Castle');log(r,'La partie commence. '+r.players[r.current].name+' joue en premier.')}
function discount(p,place){return face(p).filter(c=>c.ability.startsWith('Permanent discount')&&(c.ability.includes('Castle and Village')||c.ability.includes(place+' characters'))).length}
function placeAllowed(p,pos){if(!Number.isInteger(pos)||pos<0||pos>8||p.board[pos])return false;if(!p.board.some(Boolean))return true;return [pos-3,pos+3,pos%3?pos-1:-1,pos%3<2?pos+1:-1].some(i=>i>=0&&i<9&&p.board[i]);}
const gain=(p,resource,n)=>{if(resource==='Gold')p.gold+=n;else p.keys+=n};
function applyEffect(r,p,c){const a=c.ability.replace(/[’�]/g,"'"),own=face(p),ss=shields(p),others=r.players.filter(x=>x!==p);const value=type=>ss.filter(x=>x===type).length;
 const purse=(amount,limit=Infinity)=>{for(const b of all(p).filter(x=>cards[x.id].purse).slice(0,limit))b.stored=Math.min(cards[b.id].purse,b.stored+amount)};
 if(a.startsWith('Permanent discount'))return next(r);
 if(c.id==='V26'){p.gold+=count(p,'Peasantry');p.keys+=banner(p,'Village');return next(r);}
 if(a.startsWith('Discard one')){r.pending={type:'discard',actorId:p.id,place:a.includes('Village')?'Village':'Castle',resource:a.includes('Keys')?'Key':'Gold',cardId:c.id};return;}
 if(a.includes('neighbor')){r.pending={type:'neighbor',actorId:p.id,cardId:c.id,options:[r.players[(r.players.indexOf(p)+r.players.length-1)%r.players.length].id,r.players[(r.players.indexOf(p)+1)%r.players.length].id],alternate:a.includes('or gain 2 Keys')};return;}
 if(c.id==='C08'){r.pending={type:'banker',actorId:p.id,cardId:c.id};return;}
 if(c.id==='C29'){if(!all(p).some(x=>cards[x.id].purse&&x.stored<cards[x.id].purse))return next(r);r.pending={type:'steward',actorId:p.id,cardId:c.id,remaining:2};return;}
 if(a.startsWith('Place 2 Gold')||a.startsWith('Fill up'))purse(2);
 if(a.includes('Each opponent gains 2 Gold'))others.forEach(x=>gain(x,'Gold',2));
 if(a.startsWith('Each opponent gains 1 Gold'))others.forEach(x=>gain(x,'Gold',1));
 if(a.includes('each opponent gains 1 Key'))others.forEach(x=>gain(x,'Key',1));
 if(a.startsWith('Every player'))r.players.forEach(x=>gain(x,'Key',1));
 if(a.includes('each shield type absent'))gain(p,a.includes('Gold')?'Gold':'Key',TYPES.length-new Set(ss).size);
 else if(a.includes('per different shield type'))gain(p,a.includes('Gold')?'Gold':'Key',new Set(ss).size);
 else if(a.includes('per empty space'))gain(p,'Gold',9-own.length-p.board.filter(x=>x?.down).length);
 else if(a.includes('per occupied space'))gain(p,'Gold',p.board.filter(Boolean).length);
 else if(a.includes('per card with a purse'))gain(p,'Key',own.filter(x=>x.purse).length);
 else if(a.includes('per card with two shields'))gain(p,'Key',own.filter(x=>x.shields.length===2).length);
 else if(a.includes('per card with exactly one shield'))gain(p,a.includes('Gold')?'Gold':'Key',own.filter(x=>x.shields.length===1).length);
 else if(a.includes('per card with a printed cost of'))gain(p,'Gold',own.filter(x=>x.cost===Number(a.match(/cost of (\d+)/)?.[1])).length*Number(a.match(/Gain (\d+)/)?.[1]||1));
 else if(a.includes('per Castle banner'))gain(p,a.includes('Gold')?'Gold':'Key',banner(p,'Castle'));
 else if(a.includes('per Village banner'))gain(p,a.includes('Gold')?'Gold':'Key',banner(p,'Village'));
 else if(a.includes('per')&&a.includes('shield')){for(const m of a.matchAll(/(\d+) (Gold|Key) per (Military|Peasantry|Faith|Craftsmanship|Nobility|Scholarship) shield/g))gain(p,m[2],Number(m[1])*value(m[3]));if(c.id==='V26')p.keys+=banner(p,'Village');}
 else {const m=a.match(/^Gain (\d+) (Gold|Keys?)/);if(m)gain(p,m[2].startsWith('Key')?'Key':'Gold',Number(m[1]));}
 next(r);
}
function resolve(r,p,d){const q=r.pending;need(q&&q.actorId===p.id,'Aucun choix à résoudre.');const c=cards[q.cardId],a=c.ability.replace(/[’�]/g,"'");
 if(q.type==='discard'){need(d.place===q.place&&Number.isInteger(d.index)&&d.index>=0&&d.index<r.market[q.place].length,'Carte invalide.');const id=r.market[q.place].splice(d.index,1)[0];r.discard[q.place].push(id);gain(p,q.resource,cards[id].cost);log(r,p.name+' défausse '+cards[id].name+'.');return next(r);}
 if(q.type==='neighbor'){need(q.options.includes(d.playerId),'Voisin invalide.');if(d.alternate){need(q.alternate,'Choix indisponible.');p.keys+=2;return next(r);}const neighbor=r.players.find(x=>x.id===d.playerId);if(c.id==='V16'){p.gold+=count(p,'Peasantry');p.keys+=count(neighbor,'Faith');return next(r);}if(c.id==='V30'){p.gold+=count(p,'Scholarship');p.keys+=count(neighbor,'Military');return next(r);}if(c.id==='C15'){p.gold+=count(neighbor,'Faith');p.keys+=count(p,'Military');return next(r);}const type=a.match(/per (Castle banner|Military|Peasantry|Faith|Craftsmanship|Nobility|Scholarship)(?: shield)? in (?:one neighbor|their|that neighbor)/)?.[1],n=type==='Castle banner'?banner(neighbor,'Castle'):count(neighbor,type);const m=a.match(/(?:gain |Gain )(\d+) (Gold|Key)/);if(m)gain(p,m[2],Number(m[1])*n);return next(r);}
 if(q.type==='banker'){need(['purse','keys'].includes(d.choice),'Choix invalide.');if(d.choice==='keys')p.keys+=3;else for(const b of all(p).filter(x=>cards[x.id].purse))b.stored=Math.min(cards[b.id].purse,b.stored+2);return next(r);}
 if(q.type==='steward'){need(Number.isInteger(d.position)&&d.position>=0&&d.position<9,'Position invalide.');const b=p.board[d.position];need(b&&!b.down&&cards[b.id].purse&&b.stored<cards[b.id].purse,'Choisissez une bourse à remplir.');b.stored=cards[b.id].purse;q.remaining--;if(!q.remaining||!all(p).some(x=>cards[x.id].purse&&x.stored<cards[x.id].purse))return next(r);return;}
}
function command(r,p,event,d={}){
 if(event==='ready'){need(r.phase==='waiting','La partie a commencé.');p.ready=!p.ready;return;}
 if(event==='start'||event==='rematch')return start(r,p);
 need(r.phase==='playing','Aucune partie en cours.');need(r.players.every(x=>x.connected),'En attente de reconnexion.');
 if(event==='resolve')return resolve(r,p,d);
 need(r.players[r.current]===p,'Ce n’est pas votre tour.');need(!r.pending,'Terminez le choix en cours.');
 if(event==='key'){need(!r.keyUsed&&p.keys>0,'Clé déjà dépensée ou indisponible.');need(['move','refresh'].includes(d.action),'Action invalide.');p.keys--;r.keyUsed=true;if(d.action==='move')r.messenger=r.messenger==='Village'?'Castle':'Village';else{r.discard[r.messenger].push(...r.market[r.messenger]);r.market[r.messenger]=[];refill(r,r.messenger);}log(r,p.name+' dépense une clé pour '+(d.action==='move'?'déplacer le Messager.':'renouveler le marché.'));return;}
 if(event==='recruit'){need(placeAllowed(p,d.position),'Emplacement invalide.');need(d.place===r.messenger,'Le Messager est dans l’autre lieu.');need(Number.isInteger(d.index)&&d.index>=0&&d.index<r.market[d.place].length,'Carte indisponible.');const id=r.market[d.place][d.index],c=cards[id],price=Math.max(0,c.cost-discount(p,c.place));need(d.down||p.gold>=price,'Or insuffisant.');r.market[d.place].splice(d.index,1);p.board[d.position]={id,down:!!d.down,stored:0};if(d.down){p.gold+=6;p.keys+=2;log(r,p.name+' recrute une carte face cachée (+6 Or, +2 clés).');return next(r);}p.gold-=price;log(r,p.name+' recrute '+c.label+' pour '+price+' Or.');if(c.messenger==='Castle'||c.messenger==='Village')r.messenger=c.messenger;return applyEffect(r,p,c);}
 need(false,'Action inconnue.');
}
function snapshot(r,p){return {myId:p.id,room:{code:r.code,hostId:r.hostId,phase:r.phase,current:r.current,messenger:r.messenger,keyUsed:r.keyUsed,pending:r.pending,market:r.market,decks:{Village:r.decks.Village.length,Castle:r.decks.Castle.length},discard:{Village:r.discard.Village.length,Castle:r.discard.Castle.length},history:r.history,winners:r.winners,paused:r.phase==='playing'&&r.players.some(x=>!x.connected),players:r.players.map(x=>({id:x.id,name:x.name,ready:x.ready,connected:x.connected,gold:x.gold,keys:x.keys,board:x.board.map(b=>b?.down?{id:null,down:true,stored:0}:b),score:x.score}))}}}
function attachChateau(io){const ns=io.of('/chateau'),rooms=new Map(),sessions=new Map();const publish=r=>{for(const p of r.players)if(p.connected)ns.to(p.socketId).emit('state',snapshot(r,p));};ns.on('connection',s=>{let session=sessions.get(s.handshake.auth?.token);const context=()=>{const r=session&&rooms.get(session.code),p=r?.players.find(x=>x.id===session.id);return p?.socketId===s.id?{r,p}:null};if(session){const r=rooms.get(session.code),p=r?.players.find(x=>x.id===session.id);if(p){ns.sockets.get(p.socketId)?.disconnect(true);p.socketId=s.id;p.connected=true;s.emit('session',p.token);publish(r);}else{session=null;s.emit('expired');}}else if(s.handshake.auth?.token)s.emit('expired');let last=0;s.on('command',({event,data={}}={})=>{try{need(Date.now()-last>=80,'Un instant…');last=Date.now();const ctx=context();if(['create','join'].includes(event)){need(!ctx,'Quittez votre salle actuelle.');const name=String(data.name||'').trim().slice(0,20);need(name,'Choisissez un nom.');let r;if(event==='create'){need(rooms.size<300,'Serveur complet.');let code;do{code=randomBytes(3).toString('hex').slice(0,5).toUpperCase();}while(rooms.has(code));r=createRoom(code);rooms.set(code,r);}else{r=rooms.get(String(data.code||'').trim().toUpperCase());need(r&&r.phase==='waiting','Salle introuvable ou déjà commencée.');need(r.players.length<5,'Salle complète.');need(!r.players.some(x=>x.name.toLowerCase()===name.toLowerCase()),'Nom déjà pris.');}const p=addPlayer(r,name);p.socketId=s.id;session={code:r.code,id:p.id};sessions.set(p.token,session);s.emit('session',p.token);publish(r);return;}need(ctx,'Rejoignez une salle.');const {r,p}=ctx;if(event==='leave'){sessions.delete(p.token);r.players=r.players.filter(x=>x!==p);session=null;s.emit('left');if(!r.players.length)rooms.delete(r.code);else{if(r.hostId===p.id)r.hostId=r.players[0].id;if(r.phase==='playing'){r.phase='finished';log(r,p.name+' a quitté : partie interrompue.');}publish(r);}return;}if(event==='remove'){need(p.id===r.hostId&&r.phase!=='playing','Action réservée à l’hôte.');const x=r.players.find(x=>x.id===data.id);need(x&&!x.connected,'Joueur connecté.');sessions.delete(x.token);r.players=r.players.filter(q=>q!==x);publish(r);return;}if(event==='abort'){need(p.id===r.hostId&&r.phase==='playing','Action réservée à l’hôte.');r.phase='finished';log(r,'Partie interrompue.');publish(r);return;}if(event!=='sync')command(r,p,event,data);publish(r);}catch(e){s.emit('errorMessage',e.message);}});s.on('disconnect',()=>{const x=context();if(x){x.p.connected=false;publish(x.r);}});});const timer=setInterval(()=>{for(const r of rooms.values()){if(r.players.some(p=>p.connected))r.emptySince=null;else if(!r.emptySince)r.emptySince=Date.now();else if(Date.now()-r.emptySince>3600000){r.players.forEach(p=>sessions.delete(p.token));rooms.delete(r.code);}}},60000);timer.unref();io.httpServer?.on('close',()=>clearInterval(timer));return {rooms,sessions}}
module.exports={cards,createRoom,addPlayer,start,command,snapshot,scoreCard,finish,attachChateau,placeAllowed};
