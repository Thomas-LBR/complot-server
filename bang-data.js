// Base game, 80 cards. Suits/ranks verified against dV Games' official card list.
const CHARACTERS = [
 ['Bart Cassidy',4,'Piochez une carte pour chaque point de vie perdu.'],
 ['Black Jack',4,'Révélez votre seconde carte piochée : rouge, piochez-en une troisième.'],
 ['Calamity Janet',4,'Vos BANG ! et Raté ! sont interchangeables.'],
 ['El Gringo',3,'Pour chaque blessure infligée par un joueur, prenez une carte au hasard dans sa main.'],
 ['Jesse Jones',4,'Votre première carte du tour peut être prise au hasard dans une main adverse.'],
 ['Jourdonnais',4,'Une Planque naturelle, cumulable avec une carte Planque.'],
 ['Kit Carlson',4,'Regardez trois cartes, gardez-en deux et replacez la dernière sur la pioche.'],
 ['Lucky Duke',4,'Pour chaque dégaine, révélez deux cartes et choisissez le résultat.'],
 ['Paul Regret',3,'Les autres vous voient à une distance augmentée de 1.'],
 ['Pedro Ramirez',4,'Votre première carte du tour peut venir du sommet de la défausse.'],
 ['Rose Doolan',4,'Vous voyez les autres à une distance réduite de 1.'],
 ['Sid Ketchum',4,'Défaussez deux cartes de votre main pour regagner un point de vie, même hors de votre tour.'],
 ['Slab le flingueur',4,'Vos cartes BANG ! nécessitent deux Raté ! pour être annulées.'],
 ['Suzy Lafayette',4,'Dès que votre main est vide, piochez une carte (après la résolution d’un duel).'],
 ['Sam le vautour',4,'Récupérez en main les cartes en main et en jeu des joueurs éliminés.'],
 ['Willy le Kid',4,'Jouez autant de BANG ! que vous voulez pendant votre tour.'],
].map(([name,hp,description])=>({name,hp,description}));
const CARDS = {
 bang:['BANG !','Tirez sur un adversaire à portée. Un seul BANG ! par tour.','attack'],
 missed:['Raté !','Annule un tir. Calamity Janet peut aussi le jouer comme BANG !.','defense'],
 beer:['Bière','Récupérez 1 vie. Peut sauver d’une blessure mortelle. Inactive à deux survivants.','heal'],
 saloon:['Saloon','Tous les survivants récupèrent 1 vie.','heal'],
 stagecoach:['Convoi','Piochez deux cartes.','draw'],
 wells:['Diligence','Piochez trois cartes.','draw'],
 market:['Magasin','Chacun choisit une carte visible, en commençant par vous.','draw'],
 panic:['Braquage !','Volez une carte en main au hasard ou un équipement, à distance 1.','steal'],
 cat:['Coup de foudre','Défaussez une carte adverse en main au hasard ou un équipement, à toute distance.','steal'],
 gatling:['Gatling','Chaque autre joueur doit annuler un tir ou perdre 1 vie.','attack'],
 indians:['Indiens !','Chaque autre joueur défausse un BANG ! ou perd 1 vie.','attack'],
 duel:['Duel','Échangez des BANG !. Le premier qui renonce perd 1 vie.','attack'],
 barrel:['Planque','Dégainez un cœur pour annuler un tir, une tentative par attaque.','equipment'],
 jail:['Prison','Posez-la devant un adversaire sauf le Shérif. Un cœur le libère, sinon il passe son tour.','equipment'],
 dynamite:['Dynamite','Au début du tour : 2 à 9 de pique, perdez 3 vies ; sinon passez-la à gauche.','equipment'],
 mustang:['Mustang','Les autres vous voient à une distance augmentée de 1.','equipment'],
 scope:['Lunette','Vous voyez les autres à une distance réduite de 1.','equipment'],
 volcanic:['Volcanic','Portée 1. BANG ! illimités pendant votre tour.','weapon'],
 schofield:['Schofield','Arme de portée 2.','weapon'], remington:['Remington','Arme de portée 3.','weapon'],
 carabine:['Carabine','Arme de portée 4.','weapon'], winchester:['Winchester','Arme de portée 5.','weapon'],
};
const RANGE={volcanic:1,schofield:2,remington:3,carabine:4,winchester:5};
function makeDeck(){
 const cards=[];
 const add=(type,suit,ranks)=>ranks.forEach(rank=>cards.push({id:'b'+cards.length,type,suit,rank,name:CARDS[type][0],description:CARDS[type][1],category:CARDS[type][2]}));
 const seq=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
 add('bang','spades',[14]);add('bang','diamonds',seq(2,14));add('bang','clubs',seq(2,9));add('bang','hearts',seq(12,14));
 add('missed','clubs',seq(10,14));add('missed','spades',seq(2,8));add('beer','hearts',seq(6,11));
 add('cat','hearts',[13]);add('cat','diamonds',[9,10,11]);add('stagecoach','spades',[9,9]);
 add('duel','diamonds',[12]);add('duel','spades',[11]);add('duel','clubs',[8]);
 add('market','clubs',[9]);add('market','spades',[12]);add('gatling','hearts',[10]);add('indians','diamonds',[13,14]);
 add('panic','hearts',[11,12,14]);add('panic','diamonds',[8]);add('saloon','hearts',[5]);add('wells','hearts',[3]);
 add('barrel','spades',[12,13]);add('dynamite','hearts',[2]);add('scope','spades',[14]);add('mustang','hearts',[8,9]);
 add('jail','spades',[10,11]);add('jail','hearts',[4]);add('remington','clubs',[13]);add('carabine','clubs',[14]);
 add('schofield','clubs',[11,12]);add('schofield','spades',[13]);add('volcanic','spades',[10]);add('volcanic','clubs',[10]);add('winchester','spades',[8]);
 return cards;
}
module.exports={CHARACTERS,CARDS,RANGE,makeDeck};
