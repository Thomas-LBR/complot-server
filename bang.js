const {randomInt,randomBytes,randomUUID}=require('crypto');
const {CHARACTERS,CARDS,RANGE,makeDeck}=require('./bang-data');
const need=(ok,msg)=>{if(!ok)throw new Error(msg);};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const living=r=>r.players.filter(p=>p.alive);
const byId=(r,id)=>r.players.find(p=>p.id===id);
const has=(p,type)=>p.equipment.some(c=>c.type===type);
const active=r=>byId(r,r.activeId);
const isBang=(p,c)=>c.type==='bang'||(p.character?.name==='Calamity Janet'&&c.type==='missed');
const isMissed=(p,c)=>c.type==='missed'||(p.character?.name==='Calamity Janet'&&c.type==='bang');
function log(r,text,kind='info',actorId=null,targetId=null){r.history.push({id:++r.sequence,text,kind,actorId,targetId});r.history=r.history.slice(-100);}
function distance(r,a,b){const list=living(r),i=list.indexOf(a),j=list.indexOf(b);if(i<0||j<0)return 99;const d=Math.abs(i-j);return Math.max(1,Math.min(d,list.length-d)+Number(has(b,'mustang'))+Number(b.character?.name==='Paul Regret')-Number(has(a,'scope'))-Number(a.character?.name==='Rose Doolan'));}
const range=p=>RANGE[p.equipment.find(c=>RANGE[c.type])?.type]||1;
function take(r){if(!r.deck.length&&r.discard.length){r.deck=shuffle(r.discard.splice(0));log(r,'La défausse est mélangée pour reformer la pioche.');}return r.deck.pop();}
function draw(r,p,n){for(let i=0;i<n;i++){const c=take(r);if(c)p.hand.push(c);}}
function suzy(r){if(r.phase!=='playing')return;for(const p of living(r)){if(p.hp>0&&p.character.name==='Suzy Lafayette'&&!p.hand.length&&!(r.pending?.kind==='duel'&&[r.pending.actorId,r.pending.targetId].includes(p.id)))draw(r,p,1);}}
function stealHand(r,from,to){if(from.hand.length)to.hand.push(from.hand.splice(randomInt(from.hand.length),1)[0]);suzy(r);}
function createRoom(code){return {code,phase:'waiting',players:[],hostId:null,activeId:null,turn:0,stage:'waiting',deck:[],discard:[],held:[],queue:[],pending:null,history:[],sequence:0,winner:null};}
function addPlayer(r,name){const p={id:randomUUID(),token:randomBytes(24).toString('hex'),name,connected:true,ready:!r.players.length,alive:true,hp:0,maxHp:0,hand:[],equipment:[],character:null,role:null};r.players.push(p);if(!r.hostId)r.hostId=p.id;return p;}
function start(r){need(r.players.length>=4&&r.players.length<=7,'Bang! se joue de 4 à 7 joueurs.');need(r.players.every(p=>p.connected&&p.ready),'Tous les joueurs doivent être connectés et prêts.');
 const n=r.players.length,roles=['Shérif','Renégat','Hors-la-loi','Hors-la-loi'];if(n>=5)roles.push('Adjoint');if(n>=6)roles.push('Hors-la-loi');if(n===7)roles.push('Adjoint');shuffle(roles);const chars=shuffle([...CHARACTERS]);
 r.phase='playing';r.deck=shuffle(makeDeck());r.discard=[];r.held=[];r.queue=[];r.pending=null;r.history=[];r.sequence=0;r.winner=null;r.turn=0;
 for(const p of r.players){p.role=roles.pop();p.character=chars.pop();p.maxHp=p.character.hp+Number(p.role==='Shérif');p.hp=p.maxHp;p.alive=true;p.hand=[];p.equipment=[];draw(r,p,p.hp);}
 r.activeId=r.players.find(p=>p.role==='Shérif').id;begin(r);
}
function win(r){const alive=living(r);let winner=null;if(!alive.some(p=>p.role==='Shérif'))winner=alive.length===1&&alive[0].role==='Renégat'?'Renégat':'Hors-la-loi';else if(!alive.some(p=>p.role==='Hors-la-loi'||p.role==='Renégat'))winner='Shérif et Adjoints';if(winner){r.winner=winner;r.phase='finished';r.stage='finished';r.pending=null;r.queue=[];r.discard.push(...r.held.splice(0));log(r,'Victoire : '+winner+' !','victory');}return !!winner;}
function eliminate(r,p,killer){p.alive=false;p.hp=0;log(r,p.name+' est éliminé·e : '+p.role+'.','elimination',killer?.id,p.id);const loot=[...p.hand.splice(0),...p.equipment.splice(0)];const sam=living(r).find(q=>q.character.name==='Sam le vautour');if(sam)sam.hand.push(...loot);else r.discard.push(...loot);
 if(win(r))return;
 if(killer?.alive&&p.role==='Hors-la-loi'){draw(r,killer,3);log(r,killer.name+' reçoit 3 cartes de récompense.','draw',killer.id);}
 if(killer?.alive&&killer.role==='Shérif'&&p.role==='Adjoint'){r.discard.push(...killer.hand.splice(0),...killer.equipment.splice(0));log(r,'Le Shérif a éliminé un Adjoint : toutes ses cartes sont défaussées.');}suzy(r);
}
function damage(r,p,n,killer){if(!p.alive)return;p.hp-=n;log(r,p.name+' perd '+n+' point'+(n>1?'s':'')+' de vie.','damage',killer?.id,p.id);
 if(p.character.name==='Bart Cassidy')draw(r,p,n);
 if(p.character.name==='El Gringo'&&killer&&killer.id!==p.id)for(let i=0;i<n;i++)stealHand(r,killer,p);
 if(p.hp<=0)r.pending={type:'dying',targetId:p.id,actorId:killer?.id||null,needed:1-p.hp};
}
function next(r){if(r.phase!=='playing')return;const index=r.players.findIndex(p=>p.id===r.activeId);for(let i=1;i<=r.players.length;i++){const p=r.players[(index+i)%r.players.length];if(p.alive){r.activeId=p.id;begin(r);return;}}}
function begin(r){const p=active(r);r.turn++;r.bangs=0;r.stage='start';r.pending=null;r.queue=[{type:'hazard',kind:'dynamite',targetId:p.id},{type:'hazard',kind:'jail',targetId:p.id},{type:'draw',targetId:p.id}];log(r,'Au tour de '+p.name+'.','turn',p.id);advance(r);}
function check(r,p,context){const cards=[take(r)];if(p.character.name==='Lucky Duke')cards.push(take(r));const available=cards.filter(Boolean);if(!available.length){resolveCheck(r,context,false);return;}if(available.length===2){r.pending={type:'check',targetId:p.id,cards:available,context};log(r,p.name+' choisit une carte pour dégainer.','check',p.id);return;}r.discard.push(available[0]);finishCheck(r,context,available[0]);}
function finishCheck(r,ctx,c){const good=ctx.kind==='dynamite'?!(c.suit==='spades'&&c.rank>=2&&c.rank<=9):c.suit==='hearts';log(r,byId(r,ctx.targetId).name+' dégaine '+c.name+' ('+c.rank+' '+({hearts:'♥',spades:'♠',diamonds:'♦',clubs:'♣'}[c.suit])+') : '+(good?'réussite.':'échec.'),'check',ctx.targetId);resolveCheck(r,ctx,good);}
function resolveCheck(r,ctx,good){const p=byId(r,ctx.targetId);if(ctx.kind==='barrel'){
 r.pending=ctx.attack;if(good){r.pending.remaining--;if(r.pending.remaining<=0){log(r,p.name+' esquive le tir.','defense',p.id);r.pending=null;}}return;
 }
 if(ctx.kind==='jail'){const i=p.equipment.findIndex(c=>c.type==='jail');if(i>=0)r.discard.push(p.equipment.splice(i,1)[0]);if(!good){r.queue=[];log(r,p.name+' reste en prison et passe son tour.');next(r);}return;}
 const i=p.equipment.findIndex(c=>c.type==='dynamite');if(i<0)return;const c=p.equipment.splice(i,1)[0];if(!good){r.discard.push(c);damage(r,p,3,null);}else{const ix=r.players.indexOf(p);for(let j=1;j<r.players.length;j++){const q=r.players[(ix+j)%r.players.length];if(q.alive&&!has(q,'dynamite')){q.equipment.push(c);log(r,'La Dynamite passe de '+p.name+' à '+q.name+'.','danger',p.id,q.id);return;}}r.discard.push(c);}
}
function advance(r){let guard=0;while(r.phase==='playing'&&!r.pending&&r.queue.length&&guard++<100){const t=r.queue.shift(),p=byId(r,t.targetId);if(!p?.alive)continue;
 if(t.type==='hazard'){if(has(p,t.kind))check(r,p,{kind:t.kind,targetId:p.id});}
 else if(t.type==='attack'){r.pending={...t,remaining:t.remaining||1,barrelUsed:[]};log(r,byId(r,t.actorId).name+' vise '+p.name+' : '+({bang:'BANG !',gatling:'Gatling',indians:'Indiens !',duel:'Duel'}[t.kind])+'.','attack',t.actorId,p.id);}
 else if(t.type==='draw'){r.stage='draw';if(['Kit Carlson','Jesse Jones','Pedro Ramirez'].includes(p.character.name)){if(p.character.name==='Kit Carlson'){const cards=[take(r),take(r),take(r)].filter(Boolean);r.pending={type:'kit',targetId:p.id,cards};}else r.pending={type:'drawChoice',targetId:p.id};}else{draw(r,p,1);const c=take(r);if(c){p.hand.push(c);if(p.character.name==='Black Jack'){log(r,p.name+' révèle sa seconde carte : '+c.name+' '+c.rank+' '+c.suit+'.','draw',p.id);if(['hearts','diamonds'].includes(c.suit))draw(r,p,1);}}r.stage='play';}}
 }
 if(r.phase==='playing'&&!r.pending&&!r.queue.length){r.discard.push(...r.held.splice(0));if(!active(r)?.alive)next(r);else if(r.stage==='start'||r.stage==='draw')r.stage='play';}suzy(r);
}
function useHand(r,p,id){const i=p.hand.findIndex(c=>c.id===id);need(i>=0,'Cette carte n’est pas dans votre main.');return p.hand.splice(i,1)[0];}
function respond(r,p,d){const a=r.pending;need(a&&a.targetId===p.id,'Ce n’est pas à vous de répondre.');
 if(a.type==='dying'){if(d.choice==='giveup'){r.pending=null;eliminate(r,p,byId(r,a.actorId));}else{const cards=d.cardIds;need(Array.isArray(cards)&&new Set(cards).size===cards.length,'Choisissez vos cartes.');const selected=cards.map(id=>p.hand.find(c=>c.id===id));need(selected.every(Boolean),'Carte invalide.');const beers=selected.filter(c=>c.type==='beer').length;need(selected.length===beers&&living(r).length>2,'Seules les Bières peuvent vous sauver ici.');need(beers>=1-p.hp,'Il faut '+(1-p.hp)+' Bières pour survivre.');selected.forEach(c=>r.discard.push(useHand(r,p,c.id)));p.hp=Math.min(p.maxHp,p.hp+beers);r.pending=null;log(r,p.name+' survit grâce à la Bière.','heal',p.id);}advance(r);return;}
 if(a.type==='check'){const c=a.cards.find(c=>c.id===d.cardId);need(c,'Choisissez une carte révélée.');r.pending=null;r.discard.push(...a.cards);finishCheck(r,a.context,c);advance(r);return;}
 if(a.type==='kit'){const c=a.cards.find(c=>c.id===d.cardId);need(c,'Choisissez la carte à remettre sur la pioche.');r.deck.push(c);p.hand.push(...a.cards.filter(q=>q.id!==c.id));r.pending=null;r.stage='play';advance(r);return;}
 if(a.type==='drawChoice'){if(d.choice==='steal'){need(p.character.name==='Jesse Jones','Pouvoir indisponible.');const target=byId(r,d.targetId);need(target?.alive&&target.id!==p.id&&target.hand.length,'Choisissez une main adverse non vide.');stealHand(r,target,p);log(r,p.name+' prend sa première carte dans la main de '+target.name+'.','steal',p.id,target.id);}else if(d.choice==='discard'){need(p.character.name==='Pedro Ramirez'&&r.discard.length,'La défausse est vide.');p.hand.push(r.discard.pop());}else{need(d.choice==='deck','Choix inconnu.');draw(r,p,1);}draw(r,p,1);r.pending=null;r.stage='play';advance(r);return;}
 if(a.type==='market'){const i=a.cards.findIndex(c=>c.id===d.cardId);need(i>=0,'Choisissez une carte du magasin.');const c=a.cards.splice(i,1)[0];p.hand.push(c);log(r,p.name+' choisit '+c.name+' au Magasin.','draw',p.id);a.order=a.order.filter(id=>id!==p.id&&byId(r,id)?.alive);if(a.order.length&&a.cards.length)a.targetId=a.order[0];else{r.discard.push(...a.cards);r.pending=null;}advance(r);return;}
 need(a.type==='attack','Réponse impossible.');
 if(d.choice==='barrel'){
 need(['bang','gatling'].includes(a.kind),'La Planque ne protège pas contre cette attaque.');const key=d.source==='character'?'character':'barrel';need(!a.barrelUsed.includes(key),'Cette protection a déjà été utilisée.');need(key==='character'?p.character.name==='Jourdonnais':has(p,'barrel'),'Vous n’avez pas cette protection.');a.barrelUsed.push(key);r.pending=null;check(r,p,{kind:'barrel',targetId:p.id,attack:a});
 }else if(d.choice==='take'){
 r.pending=null;damage(r,p,1,byId(r,a.actorId));
 }else{const c=p.hand.find(c=>c.id===d.cardId);need(c&&(a.kind==='duel'||a.kind==='indians'?isBang(p,c):isMissed(p,c)),'Cette carte ne peut pas répondre à cette attaque.');r.discard.push(useHand(r,p,c.id));
 if(a.kind==='duel'){const old=a.actorId;a.actorId=p.id;a.targetId=old;log(r,p.name+' répond au Duel : à '+byId(r,old).name+' de répondre.','attack',p.id,old);}else{a.remaining--;if(a.remaining<=0){r.pending=null;log(r,p.name+' évite l’attaque.','defense',p.id);}}}
 advance(r);
}
function play(r,p,d){need(r.phase==='playing'&&r.activeId===p.id&&!r.pending&&r.stage==='play','Attendez votre phase de jeu.');const c=p.hand.find(c=>c.id===d.cardId);need(c,'Choisissez une carte de votre main.');const t=byId(r,d.targetId),type=c.type;const bang=isBang(p,c);let taken=null;
 if(bang){need(t?.alive&&t!==p,'Choisissez un adversaire vivant.');need(distance(r,p,t)<=range(p),'Ce joueur est hors de portée.');need(!r.bangs||has(p,'volcanic')||p.character.name==='Willy le Kid','Un seul BANG ! par tour.');}
 else if(['duel','jail','panic','cat'].includes(type)){need(t?.alive&&t!==p,'Choisissez un adversaire vivant.');if(type==='jail')need(t.role!=='Shérif'&&!has(t,'jail'),'Le Shérif ne peut pas être emprisonné, ni un joueur déjà en prison.');if(type==='panic')need(distance(r,p,t)<=1,'Braquage ! exige une distance de 1.');if(type==='panic'||type==='cat'){if(d.zone==='equipment'){taken=t.equipment.find(x=>x.id===d.targetCardId);need(taken,'Choisissez un équipement visible.');}else{need(d.zone==='hand'&&t.hand.length,'Cette main est vide.');taken=t.hand[randomInt(t.hand.length)];}}}
 else if(type==='beer')need(p.hp<p.maxHp&&living(r).length>2,'La Bière ne peut pas vous soigner maintenant.');
 else if(c.category==='equipment')need(!has(p,type),'Vous avez déjà cet équipement.');
 else need(type!=='missed','Raté ! se joue en défense.');
 const used=useHand(r,p,c.id);log(r,p.name+' joue '+c.name+(t?' sur '+t.name:'')+'.',bang?'attack':c.category,p.id,t?.id);
 if(c.category==='equipment'||c.category==='weapon'){const owner=type==='jail'?t:p;if(c.category==='weapon'){const old=p.equipment.find(x=>RANGE[x.type]);if(old)r.discard.push(p.equipment.splice(p.equipment.indexOf(old),1)[0]);}owner.equipment.push(used);}
 else {r.held.push(used);
 if(bang){r.bangs++;r.queue.push({type:'attack',kind:'bang',actorId:p.id,targetId:t.id,remaining:p.character.name==='Slab le flingueur'?2:1});}
 else if(type==='duel')r.queue.push({type:'attack',kind:'duel',actorId:p.id,targetId:t.id});
 else if(type==='gatling'||type==='indians'){const index=r.players.indexOf(p);for(let i=1;i<r.players.length;i++){const target=r.players[(index+i)%r.players.length];if(target.alive)r.queue.push({type:'attack',kind:type,actorId:p.id,targetId:target.id});}}
 else if(type==='beer'){p.hp++;log(r,p.name+' récupère une vie.','heal',p.id);}
 else if(type==='saloon'){living(r).forEach(q=>q.hp=Math.min(q.maxHp,q.hp+1));log(r,'Le Saloon soigne tous les survivants.','heal',p.id);}
 else if(type==='stagecoach'||type==='wells')draw(r,p,type==='wells'?3:2);
 else if(type==='panic'||type==='cat'){const list=d.zone==='equipment'?t.equipment:t.hand;list.splice(list.indexOf(taken),1);if(type==='panic')p.hand.push(taken);else r.discard.push(taken);}
 else if(type==='market'){const list=living(r),index=list.indexOf(p),order=[...list.slice(index),...list.slice(0,index)].map(q=>q.id);const cards=order.map(()=>take(r)).filter(Boolean);if(cards.length)r.pending={type:'market',targetId:p.id,order,cards};}
 }advance(r);
}
function command(r,p,event,d={}){
 need(d&&typeof d==='object'&&!Array.isArray(d),'Commande invalide.');
 if(event==='ready'){need(r.phase==='waiting','La partie a commencé.');p.ready=!p.ready;return;}
 if(event==='start'){need(r.hostId===p.id&&r.phase==='waiting','Seul l’hôte lance la partie.');start(r);return;}
 if(event==='rematch'){need(r.hostId===p.id&&r.phase==='finished','Seul l’hôte relance après la fin.');r.phase='waiting';r.pending=null;r.players.forEach(q=>{q.ready=q.id===r.hostId;q.hand=[];q.equipment=[];q.role=null;q.character=null;q.hp=0;q.alive=true;});return;}
 need(r.phase==='playing'&&p.alive,'Vous ne pouvez pas agir.');need(living(r).every(q=>q.connected),'Partie en pause : un joueur se reconnecte.');
 if(event==='play')play(r,p,d);
 else if(event==='respond')respond(r,p,d);
 else if(event==='end'){need(r.activeId===p.id&&!r.pending&&r.stage==='play','Attendez la résolution.');if(p.hand.length>p.hp){r.stage='discard';log(r,p.name+' doit défausser '+(p.hand.length-p.hp)+' carte(s).');}else next(r);}
 else if(event==='discard'){need(r.activeId===p.id&&r.stage==='discard'&&!r.pending,'Ce n’est pas la phase de défausse.');const ids=d.cardIds;need(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.length===Math.max(0,p.hand.length-p.hp)&&ids.every(id=>p.hand.some(c=>c.id===id)),'Sélectionnez exactement '+Math.max(0,p.hand.length-p.hp)+' cartes.');ids.forEach(id=>r.discard.push(useHand(r,p,id)));next(r);}
 else if(event==='sid'){need(p.character.name==='Sid Ketchum'&&p.hp<p.maxHp,'Pouvoir indisponible.');need(!r.pending||r.pending.type!=='dying'||r.pending.targetId===p.id,'Attendez le sauvetage en cours.');const ids=d.cardIds;need(Array.isArray(ids)&&ids.length===2&&new Set(ids).size===2&&ids.every(id=>p.hand.some(c=>c.id===id)),'Sélectionnez deux cartes de votre main.');ids.forEach(id=>r.discard.push(useHand(r,p,id)));p.hp++;log(r,p.name+' défausse deux cartes et récupère une vie.','heal',p.id);if(r.pending?.type==='dying'&&p.hp>0)r.pending=null;advance(r);}
 else throw new Error('Action inconnue.');
}
function snapshot(r,p){const a=r.pending;let pending=null;if(a){pending={type:a.type,kind:a.kind,targetId:a.targetId,actorId:a.actorId,remaining:a.remaining,needed:a.type==='dying'?1-byId(r,a.targetId).hp:undefined,barrelUsed:a.barrelUsed};if(['market','check'].includes(a.type)||(a.type==='kit'&&a.targetId===p.id))pending.cards=a.cards;if(a.type==='check')pending.kind=a.context.kind;}
 return {myId:p.id,hand:p.hand,role:p.role,room:{code:r.code,hostId:r.hostId,phase:r.phase,stage:r.stage,activeId:r.activeId,turn:r.turn,bangs:r.bangs||0,paused:r.phase==='playing'&&living(r).some(q=>!q.connected),winner:r.winner,deckCount:r.deck.length,discardTop:r.discard.at(-1)||null,pending,history:r.history,players:r.players.map(q=>({id:q.id,name:q.name,connected:q.connected,ready:q.ready,alive:q.alive,hp:q.hp,maxHp:q.maxHp,character:q.character,handCount:q.hand.length,equipment:q.equipment,range:range(q),distance:q.id===p.id?0:distance(r,p,q),role:q.role==='Shérif'||!q.alive||r.phase==='finished'?q.role:null}))}};
}
function leave(r,p){p.connected=false;if(r.phase==='waiting'||r.phase==='finished'){r.players=r.players.filter(q=>q!==p);}else if(p.alive){
 const a=r.pending;if(a?.type==='attack'&&a.kind==='duel'&&a.actorId===p.id)r.pending=null;if(a?.targetId===p.id){if(a.type==='kit'||a.type==='check')r.discard.push(...a.cards);if(a.type==='market'){a.order=a.order.filter(id=>id!==p.id&&byId(r,id)?.alive);if(a.order.length)a.targetId=a.order[0];else{r.discard.push(...a.cards);r.pending=null;}}else r.pending=null;}
 eliminate(r,p,null);advance(r);
 }if(r.hostId===p.id)r.hostId=r.players.find(q=>q.connected)?.id||r.players[0]?.id;}
function attachBang(io){const ns=io.of('/bang'),rooms=new Map(),sessions=new Map();
 const publish=r=>{suzy(r);for(const p of r.players)if(p.connected)ns.to(p.socketId).emit('state',snapshot(r,p));};
 ns.on('connection',s=>{let session=sessions.get(s.handshake.auth?.token);const context=()=>{const r=session&&rooms.get(session.code),p=r&&byId(r,session.id);return p&&p.socketId===s.id?{r,p}:null;};
 if(session){const r=rooms.get(session.code),p=r&&byId(r,session.id);if(p){const old=ns.sockets.get(p.socketId);p.socketId=s.id;p.connected=true;if(old)old.disconnect(true);s.emit('session',p.token);publish(r);}else{session=null;s.emit('expired');}}else if(s.handshake.auth?.token)s.emit('expired');
 const enter=(r,name)=>{const p=addPlayer(r,name);p.socketId=s.id;session={code:r.code,id:p.id};sessions.set(p.token,session);s.emit('session',p.token);publish(r);};
 let last=0;s.on('command',(packet={})=>{try{need(Date.now()-last>=80,'Un instant…');last=Date.now();const {event,data={}}=packet;need(typeof event==='string'&&data&&typeof data==='object','Commande invalide.');const ctx=context();if(event==='create'||event==='join'){need(!ctx,'Quittez votre salle actuelle.');const name=String(data.name||'').trim().slice(0,20);need(name,'Choisissez un nom.');if(event==='create'){need(rooms.size<300,'Le serveur est complet.');let code;do{code=randomBytes(3).toString('hex').slice(0,5).toUpperCase();}while(rooms.has(code));const r=createRoom(code);rooms.set(code,r);enter(r,name);}else{const r=rooms.get(String(data.code||'').trim().toUpperCase());need(r&&r.phase==='waiting','Salle introuvable ou partie déjà commencée.');need(r.players.length<7,'La salle est complète.');need(!r.players.some(p=>p.name.toLowerCase()===name.toLowerCase()),'Ce nom est déjà pris.');enter(r,name);}return;}
 need(ctx,'Rejoignez une salle.');const {r,p}=ctx;
 if(event==='leave'){sessions.delete(p.token);leave(r,p);session=null;s.emit('left');if(!r.players.some(q=>q.connected)){r.players.forEach(q=>sessions.delete(q.token));rooms.delete(r.code);}else publish(r);return;}
 if(event==='remove'){const q=byId(r,data.id);need(r.hostId===p.id&&q&&!q.connected,'Seul l’hôte peut retirer un joueur déconnecté.');sessions.delete(q.token);leave(r,q);publish(r);return;}
 if(event!=='sync')command(r,p,event,data);publish(r);
 }catch(e){s.emit('errorMessage',e.message);}});
 s.on('disconnect',()=>{const ctx=context();if(ctx){ctx.p.connected=false;if(ctx.r.hostId===ctx.p.id)ctx.r.hostId=ctx.r.players.find(p=>p.connected)?.id||ctx.p.id;publish(ctx.r);}});
 });
 const timer=setInterval(()=>{for(const r of rooms.values()){if(r.players.some(p=>p.connected))r.emptySince=null;else if(!r.emptySince)r.emptySince=Date.now();else if(Date.now()-r.emptySince>3600000){r.players.forEach(p=>sessions.delete(p.token));rooms.delete(r.code);}}},60000);timer.unref();io.httpServer?.on('close',()=>clearInterval(timer));return {rooms,sessions};
}
module.exports={attachBang,createRoom,addPlayer,start,command,snapshot,distance,range,advance,damage,eliminate,leave,CHARACTERS,CARDS,makeDeck};
