const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, perMessageDeflate: true });
app.use(express.static(path.join(__dirname, 'public')));

const TILE=48, RW=15, RH=11, MAX_DOORS=50;
const TF=0,TW=1,TD=2,TL=3,TE=6,TT=7,TWD=8;

// === TEK ORTAK DÜNYA ===
let rooms=[], doorCount=0, rushActive=false, rushX=0, rushSpeed=0;
let rushPersist=false, nextRushAt=5+Math.floor(Math.random()*8);
let monsters=[], currentRoom=0;
let items=[], gameStarted=false;
let gamePhase='lobby'; // lobby | playing | gameover | win

// === OYUNCULAR ===
let players = {};

// === ODA ÜRETME ===
function genRoom(n){
  const types=['normal','library','dungeon','church','forest'];
  const type=n===0?'normal':types[Math.floor(Math.random()*types.length)];
  const g=[];
  for(let y=0;y<RH;y++){g[y]=[];for(let x=0;x<RW;x++)g[y][x]=(x===0||x===RW-1||y===0||y===RH-1)?TW:TF;}
  const ey=Math.floor(RH/2);
  g[ey][0]=TF;
  const isLast=n>=MAX_DOORS;
  const locked=!isLast&&n>2&&Math.random()<0.3;
  g[ey][RW-1]=isLast?TE:(locked?TL:TD);

  if(type==='library'){for(let x=2;x<RW-2;x+=3)g[1][x]=TW;for(let i=0;i<3;i++){const tx=3+Math.floor(Math.random()*(RW-6)),ty=3+Math.floor(Math.random()*(RH-6));if(g[ty][tx]===TF)g[ty][tx]=TT;}}
  else if(type==='dungeon'){g[Math.floor(RH/3)][Math.floor(RW/3)]=TW;g[Math.floor(RH*2/3)][Math.floor(RW/3)]=TW;g[Math.floor(RH/3)][Math.floor(RW*2/3)]=TW;g[Math.floor(RH*2/3)][Math.floor(RW*2/3)]=TW;}
  else if(type==='church'){for(let x=3;x<RW-3;x++){if(g[3][x]===TF)g[3][x]=TT;if(g[RH-4][x]===TF)g[RH-4][x]=TT;}}
  else if(type==='forest'){for(let i=0;i<7;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF)g[ty][tx]=TW;}}
  else{for(let i=0;i<4;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF){const r=Math.random();g[ty][tx]=r<0.5?TW:r<0.75?TT:TWD;}}}

  // Garanti dolap
  let hasWD=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD=true;
  if(!hasWD){for(let t=0;t<30;t++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF&&ty!==ey){g[ty][tx]=TWD;break;}}}

  for(let x=1;x<RW-1;x++)if([TW,TT,TWD].includes(g[ey][x]))g[ey][x]=TF;

  // Items
  const ri=[];
  function rp(){let x,y,t=0;do{x=2+Math.floor(Math.random()*(RW-4));y=2+Math.floor(Math.random()*(RH-4));t++;}while(g[y][x]!==TF&&t<30);return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};}
  if(locked){const p=rp();ri.push({id:Math.random().toString(36).slice(2),type:'key',x:p.x,y:p.y,label:'Anahtar'});}
  if(Math.random()<0.55){const p=rp();ri.push({id:Math.random().toString(36).slice(2),type:'bandage',x:p.x,y:p.y,label:'Sargı'});}
  if(Math.random()<0.35){const p=rp();ri.push({id:Math.random().toString(36).slice(2),type:'oil',x:p.x,y:p.y,label:'Fener Yağı'});}
  if(Math.random()<0.2){const p=rp();ri.push({id:Math.random().toString(36).slice(2),type:'gold',x:p.x,y:p.y,label:'Altın'});}

  // Canavar
  let monster=null;
  if(n>0&&n<MAX_DOORS){
    if(n===25) monster='seek';
    else{const r=Math.random();if(r<0.5&&n>=8)monster='screech';else if(r<0.85&&n>=3)monster='ambush';}
  }

  let hasWD2=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD2=true;
  return{g,ey,items:ri,monster,hasWardrobe:hasWD2,hasFigure:n===MAX_DOORS,type,n,w:RW*TILE,h:RH*TILE};
}

function initWorld(){
  rooms=[];for(let i=0;i<=MAX_DOORS;i++)rooms.push(genRoom(i));
  currentRoom=0; doorCount=0;
  items=[...rooms[0].items];
  monsters=spawnMonsters(rooms[0]);
  rushActive=false;rushPersist=false;
  nextRushAt=5+Math.floor(Math.random()*8);
  gamePhase='playing';
}

function spawnMonsters(room){
  const ms=[];
  if(room.hasFigure) ms.push({id:'figure',type:'figure',x:(RW-3)*TILE,y:Math.floor(RH/2)*TILE,radius:18,alive:true,alerted:false,alertTimer:0,pAngle:0,angle:0,solved:false});
  if(room.monster==='screech') ms.push({id:'s'+Date.now(),type:'screech',x:(2+Math.floor(Math.random()*(RW-4)))*TILE,y:(2+Math.floor(Math.random()*(RH-4)))*TILE,radius:10,alive:true,triggered:false,warnTimer:0,warned:false,timer:0,angle:0});
  if(room.monster==='seek') ms.push({id:'sk'+Date.now(),type:'seek',x:(RW-2)*TILE,y:Math.floor(RH/2)*TILE,radius:14,alive:true,speed:1.2,angle:0,pAngle:0});
  if(room.monster==='ambush') ms.push({id:'a'+Date.now(),type:'ambush',x:(RW-3)*TILE+TILE/2,y:(2+Math.floor(Math.random()*(RH-4)))*TILE+TILE/2,radius:16,alive:true,triggered:false,triggerTimer:0,warned1:false,warned2:false,warned3:false,angle:0,pAngle:Math.random()*Math.PI*2});
  return ms;
}

function dist2(a,b){return(a.x-b.x)**2+(a.y-b.y)**2;}
function isSolid(rx,ry,room){
  const tx=Math.floor(rx/TILE),ty=Math.floor(ry/TILE);
  if(ty<0||ty>=RH||tx<0||tx>=RW)return true;
  const t=room.g[ty][tx];return[TW,TL,TT,TWD].includes(t);
}
function moveEnt(e,dx,dy,room){
  const r=(e.radius||12)-3,nx=e.x+dx,ny=e.y+dy;
  const pts=[[-r,-r],[r,-r],[-r,r],[r,r]];
  let cx=true,cy=true;
  for(const[ox,oy]of pts){if(isSolid(nx+ox,e.y+oy,room))cx=false;if(isSolid(e.x+ox,ny+oy,room))cy=false;}
  if(cx)e.x=nx;if(cy)e.y=ny;
}

// === SERVER TICK ===
const TICK=50;
setInterval(()=>{
  if(gamePhase!=='playing')return;
  const room=rooms[currentRoom];
  if(!room)return;

  // Rush güncelle
  if(rushActive&&rushX>-99999){
    rushX+=rushSpeed;
    // Dolaptaki oyuncular korunur
    for(const[id,p] of Object.entries(players)){
      if(!p.alive||p.inWardrobe)continue;
      if(Math.abs(p.x-rushX)<38){
        p.alive=false;p.health=0;
        io.to(id).emit('youDied',{msg:'Rush tarafından yutuldun!'});
        io.emit('playerDied',{id,name:p.name});
      }
    }
    if(rushX>room.w+300){rushActive=false;rushPersist=false;io.emit('rushEnd');}
  }

  // Canavar güncelle
  const alivePlayers=Object.values(players).filter(p=>p.alive&&!p.inWardrobe);
  monsters=monsters.filter(m=>{
    if(!m.alive)return false;
    if(alivePlayers.length===0)return true;
    // En yakın oyuncuyu hedefle
    let target=alivePlayers[0];
    let minD=dist2(m,target);
    for(const p of alivePlayers){const d=dist2(m,p);if(d<minD){minD=d;target=p;}}
    const dx=target.x-m.x,dy=target.y-m.y,dist=Math.sqrt(dx*dx+dy*dy);

    if(m.type==='figure'){
      if(m.solved)return true;
      if(m.alerted){
        m.alertTimer--;if(m.alertTimer<=0&&dist>260)m.alerted=false;
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*2.5,Math.sin(m.angle)*2.5,room);
        if(dist<m.radius+target.radius+5){target.health-=1.8;if(target.health<=0){target.alive=false;target.health=0;io.to(Object.keys(players).find(k=>players[k]===target)).emit('youDied',{msg:'Figure tarafından yakalandın!'});}}
      }else{m.pAngle+=0.01;moveEnt(m,Math.cos(m.pAngle)*1,Math.sin(m.pAngle)*1,room);m.angle=m.pAngle;if(dist<130)m.alerted=true;}
    }
    else if(m.type==='screech'){
      if(!m.triggered&&dist<220){
        if(!m.warned){m.warned=true;io.emit('monsterWarning',{type:'screech',x:m.x,y:m.y});}
        m.warnTimer++;
        if(m.warnTimer>60){m.triggered=true;io.emit('monsterAlert',{type:'screech',x:m.x,y:m.y});}
      }
      if(m.triggered){
        m.timer++;m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*2.5,Math.sin(m.angle)*2.5,room);
        if(dist<m.radius+target.radius+4){target.alive=false;target.health=0;const tid=Object.keys(players).find(k=>players[k]===target);if(tid)io.to(tid).emit('youDied',{msg:'Screech tarafından yakalandın!'});}
        if(m.timer>300){m.alive=false;return false;}
      }
    }
    else if(m.type==='seek'){
      const anyLight=alivePlayers.some(p=>p.lanternOn);
      if(!anyLight){
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*m.speed,Math.sin(m.angle)*m.speed,room);
        if(dist<m.radius+target.radius+4){target.health-=0.8;if(target.health<=0){target.alive=false;target.health=0;const tid=Object.keys(players).find(k=>players[k]===target);if(tid)io.to(tid).emit('youDied',{msg:'Seek tarafından yutulandın!'});}}
      }else{m.pAngle+=0.02;m.x+=Math.cos(m.pAngle)*0.5;m.y+=Math.sin(m.pAngle)*0.5;}
    }
    else if(m.type==='ambush'){
      if(!m.triggered){
        m.pAngle+=0.008;moveEnt(m,Math.cos(m.pAngle)*0.5,Math.sin(m.pAngle)*0.5,room);
        if(dist<220&&!m.warned1){m.warned1=true;io.emit('monsterWarning',{type:'ambush',level:1,x:m.x,y:m.y});}
        if(dist<150&&!m.warned2){m.warned2=true;io.emit('monsterWarning',{type:'ambush',level:2,x:m.x,y:m.y});}
        if(dist<100&&!m.warned3){m.warned3=true;io.emit('monsterWarning',{type:'ambush',level:3,x:m.x,y:m.y});}
        if(dist<70){m.triggered=true;m.triggerTimer=0;io.emit('monsterAlert',{type:'ambush',x:m.x,y:m.y});}
      }else{
        m.angle=Math.atan2(dy,dx);moveEnt(m,Math.cos(m.angle)*4,Math.sin(m.angle)*4,room);
        if(dist<m.radius+target.radius+4){target.alive=false;target.health=0;const tid=Object.keys(players).find(k=>players[k]===target);if(tid)io.to(tid).emit('youDied',{msg:'Ambush tarafından yakalandın!'});}
        m.triggerTimer++;if(m.triggerTimer>300){m.alive=false;return false;}
      }
    }
    return true;
  });

  // Tüm oyuncular ölürse game over
  const alive=Object.values(players).filter(p=>p.alive);
  if(Object.keys(players).length>0&&alive.length===0){
    gamePhase='gameover';
    io.emit('gameOver',{doorCount});
  }

  // State broadcast
  io.emit('gameState',{
    players:Object.fromEntries(Object.entries(players).map(([id,p])=>[id,{
      x:Math.round(p.x),y:Math.round(p.y),angle:+p.angle.toFixed(2),
      health:Math.round(p.health),maxHealth:p.maxHealth,
      radius:p.radius,color:p.color,name:p.name,alive:p.alive,
      inWardrobe:p.inWardrobe,lanternOn:p.lanternOn,
      level:p.level,score:p.score
    }])),
    monsters:monsters.filter(m=>m.alive).map(m=>({
      id:m.id,type:m.type,x:Math.round(m.x),y:Math.round(m.y),
      angle:+m.angle.toFixed(2),alerted:m.alerted,triggered:m.triggered,alive:m.alive
    })),
    items:items.map(i=>({id:i.id,type:i.type,x:Math.round(i.x),y:Math.round(i.y),label:i.label})),
    rushActive,rushX:Math.round(rushX),
    doorCount,currentRoom,
    phase:gamePhase
  });

  // Can yenileme
  for(const p of Object.values(players)){
    if(!p.alive)continue;
    if(p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+0.05);
    if(p.lanternOn)p.lanternFuel=Math.max(0,p.lanternFuel-0.007);
    if(p.lanternFuel<=0)p.lanternOn=false;
    io.to(Object.keys(players).find(k=>players[k]===p)).emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
  }
},TICK);

// Kapı geçişi — tüm oyuncular hazır olunca
function tryAdvance(){
  const alive=Object.values(players).filter(p=>p.alive);
  if(alive.length===0)return;
  const allReady=alive.every(p=>p.readyForNext);
  if(!allReady)return;
  // Hepsini sıfırla
  for(const p of alive)p.readyForNext=false;

  doorCount++;
  if(doorCount>=MAX_DOORS){
    gamePhase='win';
    io.emit('gameWin',{doorCount});
    return;
  }
  currentRoom++;
  items=[...rooms[currentRoom].items];
  monsters=spawnMonsters(rooms[currentRoom]);

  // Spawn pozisyonları
  const spawnY=rooms[currentRoom].ey*TILE+TILE/2;
  let si=0;
  for(const p of Object.values(players)){
    if(!p.alive)continue;
    p.x=TILE*2;p.y=spawnY+(si-Math.floor(alive.length/2))*28;si++;
    p.readyForNext=false;
  }

  // Rush RNG
  if(doorCount===nextRushAt&&rooms[currentRoom].hasWardrobe&&doorCount<MAX_DOORS){
    rushActive=true;rushX=-800;rushSpeed=3+Math.random()*1.5;rushPersist=true;
    nextRushAt=doorCount+5+Math.floor(Math.random()*10);
    io.emit('rushStart',{speed:rushSpeed});
  } else if(!rushPersist){
    rushActive=false;
  } else {
    rushX=-(canvas_W/2+100); // persist
  }

  io.emit('roomChanged',{
    room:serializeRoom(rooms[currentRoom]),
    doorCount,currentRoom,
    rushActive,rushX
  });
}

function serializeRoom(r){
  return{g:r.g,ey:r.ey,type:r.type,n:r.n,w:r.w,h:r.h,hasFigure:r.hasFigure};
}

// === SOCKET EVENTS ===
io.on('connection',(socket)=>{
  console.log('Bağlandı:',socket.id);
  const colors=['#1ab8ff','#3af0c0','#ffdd44','#ff8844','#aa44ff','#ff4499','#44ff99','#ff6644'];
  const color=colors[Object.keys(players).length%colors.length];

  players[socket.id]={
    x:TILE*2,y:Math.floor(RH/2)*TILE+TILE/2,
    radius:12,angle:0,health:100,maxHealth:100,speed:2.6,
    color,name:'Oyuncu',alive:true,
    score:0,level:1,xp:0,xpNeeded:100,
    upgradePoints:0,inventory:[],
    lanternFuel:100,lanternOn:true,
    inWardrobe:false,readyForNext:false,lastShot:0
  };

  // İlk bağlantıda dünya yoksa oluştur
  if(rooms.length===0) initWorld();

  socket.emit('init',{
    id:socket.id,
    room:serializeRoom(rooms[currentRoom]),
    items,monsters:monsters.map(m=>({id:m.id,type:m.type,x:m.x,y:m.y,radius:m.radius,alive:m.alive})),
    doorCount,currentRoom,
    rushActive,rushX,
    phase:gamePhase
  });

  socket.broadcast.emit('playerJoined',{id:socket.id,name:'Oyuncu',color});

  socket.on('setName',(name)=>{if(players[socket.id])players[socket.id].name=String(name).slice(0,16)||'Oyuncu';});

  socket.on('input',(data)=>{
    const p=players[socket.id];if(!p||!p.alive||p.inWardrobe)return;
    const spd=data.sprint?p.speed*1.75:p.speed;
    const diag=data.dx!==0&&data.dy!==0?0.707:1;
    const room=rooms[currentRoom];
    p.x+=data.dx*spd*diag;p.y+=data.dy*spd*diag;
    p.x=Math.max(p.radius,Math.min(room.w-p.radius,p.x));
    p.y=Math.max(p.radius,Math.min(room.h-p.radius,p.y));
    p.angle=data.angle;
    // Koşarken figure uyarır
    if(data.sprint){const fig=monsters.find(m=>m.type==='figure');if(fig&&!fig.alerted){const d=Math.sqrt(dist2(p,fig));if(d<360){fig.alerted=true;fig.alertTimer=210;}}}
  });

  socket.on('interact',(data)=>{
    const p=players[socket.id];if(!p||!p.alive)return;
    const room=rooms[currentRoom];
    if(data.type==='door'){
      const dt=room.g[room.ey][RW-1];
      if(dt===TD||dt===TE){p.readyForNext=true;socket.emit('waitingForOthers');tryAdvance();}
      else if(dt===TL){const ki=p.inventory.findIndex(i=>i.type==='key');if(ki>=0){p.inventory.splice(ki,1);room.g[room.ey][RW-1]=TD;io.emit('doorUnlocked');}}
    }
    if(data.type==='wardrobe'){p.inWardrobe=!p.inWardrobe;socket.emit('wardrobeState',{inWardrobe:p.inWardrobe});}
    if(data.type==='item'){
      const idx=items.findIndex(i=>i.id===data.itemId);if(idx<0)return;
      const item=items[idx];items.splice(idx,1);
      if(item.type==='bandage'){p.health=Math.min(p.maxHealth,p.health+35);}
      else if(item.type==='oil'){p.lanternFuel=Math.min(100,p.lanternFuel+45);p.lanternOn=true;}
      else if(p.inventory.length<3)p.inventory.push(item);
      io.emit('itemPickedUp',{itemId:item.id,playerId:socket.id});
      socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
    }
    if(data.type==='dropItem'){
      const ki=p.inventory.findIndex(i=>i.type===data.itemType);
      if(ki>=0){const dropped=p.inventory.splice(ki,1)[0];dropped.x=p.x+(Math.random()-0.5)*60;dropped.y=p.y+(Math.random()-0.5)*60;dropped.id=Math.random().toString(36).slice(2);items.push(dropped);io.emit('itemDropped',{item:dropped});}
    }
    if(data.type==='lantern'){p.lanternOn=!p.lanternOn;socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});}
    if(data.type==='puzzleSolve'){
      const fig=monsters.find(m=>m.type==='figure');
      if(fig){fig.alive=false;fig.solved=true;p.score+=500;io.emit('figureDefeated');io.emit('floatText',{x:fig.x,y:fig.y,text:'BULMACA ÇÖZÜLDÜ!',color:'#44ff88'});}
    }
  });

  socket.on('ping_c',()=>socket.emit('pong_c'));

  socket.on('disconnect',()=>{
    console.log('Ayrıldı:',socket.id);
    const name=players[socket.id]?.name||'?';
    delete players[socket.id];
    io.emit('playerLeft',{id:socket.id,name});
    // Eğer kimse kalmadıysa dünyayı sıfırla
    if(Object.keys(players).length===0){
      rooms=[];gamePhase='lobby';monsters=[];items=[];doorCount=0;currentRoom=0;rushActive=false;
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`DOORS sunucu: http://localhost:${PORT}`));
