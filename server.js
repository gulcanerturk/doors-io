const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'},perMessageDeflate:true});
app.use(express.static(path.join(__dirname,'public')));

const TILE=48,RW=15,RH=11,MAX_DOORS=50;
const TF=0,TW=1,TD=2,TL=3,TE=6,TT=7,TWD=8;

let rooms=[],doorCount=0,rushActive=false,rushX=0,rushSpeed=0;
let rushPersist=false,nextRushAt=5+Math.floor(Math.random()*8);
let monsters=[],currentRoom=0,items=[],gamePhase='lobby';
let players={};

// ============================================================
// ODA TİPLERİ — 8 farklı tip
// ============================================================
const ROOM_TYPES=['normal','library','dungeon','church','forest','cave','lab','mansion'];

function genRoom(n){
  const type=n===0?'normal':ROOM_TYPES[Math.floor(Math.random()*ROOM_TYPES.length)];
  const g=[];
  for(let y=0;y<RH;y++){g[y]=[];for(let x=0;x<RW;x++)g[y][x]=(x===0||x===RW-1||y===0||y===RH-1)?TW:TF;}
  const ey=Math.floor(RH/2);
  g[ey][0]=TF;
  const isLast=n>=MAX_DOORS;
  const locked=!isLast&&n>2&&Math.random()<0.3;
  g[ey][RW-1]=isLast?TE:(locked?TL:TD);

  // Oda dekorasyonu — tip'e göre
  if(type==='library'){
    // Kitaplıklar üst duvara
    for(let x=2;x<RW-2;x+=2)if(x!==ey)g[1][x]=TW;
    // Okuma masaları ortada
    for(let x=4;x<RW-4;x+=4){const ty=Math.floor(RH/2);if(g[ty][x]===TF)g[ty][x]=TT;}
    // Rastgele kitaplık
    for(let i=0;i<3;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF)g[ty][tx]=TT;}
  }
  else if(type==='dungeon'){
    // Kafes duvarları
    for(let y=3;y<RH-3;y+=3)for(let x=4;x<RW-4;x+=4){if(g[y][x]===TF)g[y][x]=TW;}
    // Hücre köşeleri
    g[2][4]=TW;g[2][RW-5]=TW;g[RH-3][4]=TW;g[RH-3][RW-5]=TW;
  }
  else if(type==='church'){
    // Sıra sıraya banklar
    for(let x=3;x<RW-3;x++){if(g[3][x]===TF)g[3][x]=TT;}
    for(let x=3;x<RW-3;x++){if(g[RH-4][x]===TF)g[RH-4][x]=TT;}
    // Ortada sütunlar
    g[2][Math.floor(RW/2)]=TW;g[RH-3][Math.floor(RW/2)]=TW;
  }
  else if(type==='forest'){
    // Ağaç kütükleri
    for(let i=0;i<8;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF)g[ty][tx]=TW;}
    // Taşlar
    for(let i=0;i<3;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF)g[ty][tx]=TT;}
  }
  else if(type==='cave'){
    // Sütunlar köşelerde
    [[2,2],[2,RH-3],[RW-3,2],[RW-3,RH-3]].forEach(([x,y])=>g[y][x]=TW);
    // Taş oluşumları
    for(let i=0;i<5;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF)g[ty][tx]=TW;}
    // Mağara tişleri üstte
    for(let x=2;x<RW-2;x+=3)g[1][x]=TW;
  }
  else if(type==='lab'){
    // Deney masaları
    for(let x=2;x<6;x++)if(g[2][x]===TF)g[2][x]=TT;
    for(let x=RW-6;x<RW-2;x++)if(g[2][x]===TF)g[2][x]=TT;
    for(let x=2;x<6;x++)if(g[RH-3][x]===TF)g[RH-3][x]=TT;
    for(let x=RW-6;x<RW-2;x++)if(g[RH-3][x]===TF)g[RH-3][x]=TT;
    // Merkez ekipman
    if(g[Math.floor(RH/2)][Math.floor(RW/2)]===TF)g[Math.floor(RH/2)][Math.floor(RW/2)]=TT;
  }
  else if(type==='mansion'){
    // Mobilyalar duvarlara yatay
    for(let y=2;y<RH-2;y+=3)if(g[y][2]===TF)g[y][2]=TWD;
    for(let y=2;y<RH-2;y+=3)if(g[y][RW-3]===TF)g[y][RW-3]=TWD;
    // Ortada halı (masa)
    if(g[Math.floor(RH/2)][Math.floor(RW/2)]===TF)g[Math.floor(RH/2)][Math.floor(RW/2)]=TT;
    if(g[Math.floor(RH/2)-1][Math.floor(RW/2)]===TF)g[Math.floor(RH/2)-1][Math.floor(RW/2)]=TT;
    if(g[Math.floor(RH/2)+1][Math.floor(RW/2)]===TF)g[Math.floor(RH/2)+1][Math.floor(RW/2)]=TT;
  }
  else{
    // Normal: rastgele eşyalar
    for(let i=0;i<4;i++){
      const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));
      if(g[ty][tx]===TF){const r=Math.random();g[ty][tx]=r<0.4?TW:r<0.7?TT:TWD;}
    }
  }

  // Garanti 1 dolap — tüm odalar
  let hasWD=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD=true;
  if(!hasWD){
    for(let t=0;t<50;t++){
      const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));
      if(g[ty][tx]===TF&&ty!==ey&&Math.abs(ty-ey)>1){g[ty][tx]=TWD;break;}
    }
  }

  // Geçit yolunu temizle
  for(let x=1;x<RW-1;x++){
    if([TW,TT,TWD].includes(g[ey][x]))g[ey][x]=TF;
  }
  // Giriş ve çıkış çevresini temizle
  for(let dy2=-1;dy2<=1;dy2++){
    const y=ey+dy2;if(y<1||y>=RH-1)continue;
    if(g[y][1]!==TF)g[y][1]=TF;
    if(g[y][RW-2]!==TF&&g[y][RW-2]!==TD&&g[y][RW-2]!==TL&&g[y][RW-2]!==TE)g[y][RW-2]=TF;
  }

  // Item yerleştir — SADECE zemin karelere
  const ri=[];
  function rp(){
    for(let t=0;t<100;t++){
      const x=2+Math.floor(Math.random()*(RW-4));
      const y=2+Math.floor(Math.random()*(RH-4));
      if(g[y][x]===TF&&Math.abs(y-ey)>0) return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};
    }
    // Fallback: geçit üzerindeki güvenli nokta
    return{x:3*TILE+TILE/2,y:ey*TILE+TILE/2};
  }
  if(locked){const p=rp();ri.push({id:uid(),type:'key',x:p.x,y:p.y,label:'Anahtar'});}
  if(Math.random()<0.55){const p=rp();ri.push({id:uid(),type:'bandage',x:p.x,y:p.y,label:'Sargı'});}
  if(Math.random()<0.35){const p=rp();ri.push({id:uid(),type:'oil',x:p.x,y:p.y,label:'Fener Yağı'});}
  if(Math.random()<0.2){const p=rp();ri.push({id:uid(),type:'gold',x:p.x,y:p.y,label:'Altın'});}

  // Canavar
  let monster=null;
  if(n>0&&n<MAX_DOORS){
    if(n===25)monster='seek';
    else{const r=Math.random();if(r<0.5&&n>=8)monster='screech';else if(r<0.85&&n>=3)monster='ambush';}
  }

  let hasWD2=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD2=true;
  return{g,ey,items:ri,monster,hasWardrobe:hasWD2,hasFigure:n===MAX_DOORS,type,n,w:RW*TILE,h:RH*TILE};
}

function uid(){return Math.random().toString(36).slice(2);}

function initWorld(){
  rooms=[];for(let i=0;i<=MAX_DOORS;i++)rooms.push(genRoom(i));
  currentRoom=0;doorCount=0;
  items=rooms[0].items.map(i=>({...i}));
  monsters=spawnMonsters(rooms[0]);
  rushActive=false;rushPersist=false;
  nextRushAt=5+Math.floor(Math.random()*8);
  gamePhase='playing';
}

// Canavar spawn — SADECE zemin karelere
function safePosInRoom(room,excludeEy=true){
  for(let t=0;t<100;t++){
    const x=2+Math.floor(Math.random()*(RW-4));
    const y=2+Math.floor(Math.random()*(RH-4));
    if(room.g[y][x]===TF&&(!excludeEy||Math.abs(y-room.ey)>1))
      return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};
  }
  // Fallback sağ taraf
  return{x:(RW-4)*TILE+TILE/2,y:room.ey*TILE+TILE/2};
}

function spawnMonsters(room){
  const ms=[];
  if(room.hasFigure){
    const p=safePosInRoom(room);
    ms.push({id:'figure',type:'figure',x:p.x,y:p.y,radius:18,alive:true,alerted:false,alertTimer:0,pAngle:0,angle:0,solved:false});
  }
  if(room.monster==='screech'){
    const p=safePosInRoom(room);
    ms.push({id:'s'+Date.now(),type:'screech',x:p.x,y:p.y,radius:10,alive:true,triggered:false,warnTimer:0,warned:false,timer:0,angle:0});
  }
  if(room.monster==='seek'){
    const p=safePosInRoom(room);
    ms.push({id:'sk'+Date.now(),type:'seek',x:p.x,y:p.y,radius:14,alive:true,speed:1.2,angle:0,pAngle:0});
  }
  if(room.monster==='ambush'){
    // Ambush sağ tarafta spawn — oyuncu solda başlar
    const p=safePosInRoom(room);
    ms.push({id:'a'+Date.now(),type:'ambush',x:p.x,y:p.y,radius:16,alive:true,
      triggered:false,triggerTimer:0,warned1:false,warned2:false,warned3:false,
      angle:0,pAngle:Math.random()*Math.PI*2});
  }
  return ms;
}

// ============================================================
// KOLİZYON — düzeltildi
// ============================================================
function isSolid(rx,ry,room){
  const tx=Math.floor(rx/TILE),ty=Math.floor(ry/TILE);
  if(ty<1||ty>=RH-1||tx<0||tx>=RW)return true;
  const t=room.g[ty][tx];
  return t===TW||t===TL||t===TT||t===TWD;
}

function moveEnt(e,dx,dy,room){
  const r=Math.max(4,(e.radius||12)-4);
  // X ekseni
  const nx=e.x+dx;
  const xBlocked=[[-r,-r],[r,-r],[-r,r],[r,r]].some(([ox,oy])=>isSolid(nx+ox,e.y+oy,room));
  if(!xBlocked)e.x=nx;
  // Y ekseni
  const ny=e.y+dy;
  const yBlocked=[[-r,-r],[r,-r],[-r,r],[r,r]].some(([ox,oy])=>isSolid(e.x+ox,ny+oy,room));
  if(!yBlocked)e.y=ny;
  // Sınır
  e.x=Math.max(r+TILE,Math.min(room.w-r-TILE,e.x));
  e.y=Math.max(r+TILE,Math.min(room.h-r-TILE,e.y));
}

function dist2(a,b){return(a.x-b.x)**2+(a.y-b.y)**2;}
function findId(target){return Object.keys(players).find(k=>players[k]===target);}

// ============================================================
// OYUN TICK
// ============================================================
setInterval(()=>{
  if(gamePhase!=='playing')return;
  const room=rooms[currentRoom];if(!room)return;

  // Rush
  if(rushActive&&rushX>-99999){
    rushX+=rushSpeed;
    for(const[id,p]of Object.entries(players)){
      if(!p.alive||p.inWardrobe)continue;
      if(Math.abs(p.x-rushX)<42){
        p.alive=false;p.health=0;
        io.to(id).emit('youDied',{msg:'Rush tarafından yutuldun!'});
        io.emit('playerDied',{id,name:p.name});
      }
    }
    if(rushX>room.w+300){rushActive=false;rushPersist=false;io.emit('rushEnd');}
  }

  // Canavarlar
  const aliveP=Object.values(players).filter(p=>p.alive&&!p.inWardrobe);
  monsters=monsters.filter(m=>{
    if(!m.alive)return false;
    if(aliveP.length===0)return true;
    let target=aliveP[0];
    let minD=dist2(m,target);
    for(const p of aliveP){const d=dist2(m,p);if(d<minD){minD=d;target=p;}}
    const dx=target.x-m.x,dy=target.y-m.y,dist=Math.sqrt(minD);

    if(m.type==='figure'){
      if(m.solved)return true;
      if(m.alerted){
        m.alertTimer--;if(m.alertTimer<=0&&dist>260)m.alerted=false;
        m.angle=Math.atan2(dy,dx);
        const figSpd=3.8+(m.alertTimer>100?1.2:0); // hızlandı
        moveEnt(m,Math.cos(m.angle)*figSpd,Math.sin(m.angle)*figSpd,room);
        if(dist<m.radius+target.radius+5){
          target.health-=2.5; // daha fazla hasar
          if(target.health<=0){target.alive=false;target.health=0;const tid=findId(target);if(tid)io.to(tid).emit('youDied',{msg:'Figure tarafından yakalandın!'});}
        }
      }else{m.pAngle+=0.015;moveEnt(m,Math.cos(m.pAngle)*1.5,Math.sin(m.pAngle)*1.5,room);m.angle=m.pAngle;if(dist<160)m.alerted=true;} // daha geniş algı
    }
    else if(m.type==='screech'){
      if(!m.triggered&&dist<240){ // daha geniş tetik mesafesi
        if(!m.warned){m.warned=true;io.emit('monsterWarning',{type:'screech',x:m.x,y:m.y});}
        m.warnTimer++;
        if(m.warnTimer>40){m.triggered=true;io.emit('monsterAlert',{type:'screech',x:m.x,y:m.y});} // daha hızlı tetik
      }
      if(m.triggered){
        m.timer++;m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*4.5,Math.sin(m.angle)*4.5,room); // çok hızlı
        if(dist<m.radius+target.radius+4){
          target.alive=false;target.health=0;const tid=findId(target);if(tid)io.to(tid).emit('youDied',{msg:'Screech tarafından yakalandın!'});
        }
        if(m.timer>240){m.alive=false;return false;} // daha az süre (4sn)
      }
    }
    else if(m.type==='seek'){
      const anyLight=aliveP.some(p=>p.lanternOn);
      if(!anyLight){
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*(m.speed*1.8),Math.sin(m.angle)*(m.speed*1.8),room); // hızlandı
        if(dist<m.radius+target.radius+4){
          target.health-=1.5; // daha fazla hasar
          if(target.health<=0){target.alive=false;target.health=0;const tid=findId(target);if(tid)io.to(tid).emit('youDied',{msg:'Seek tarafından yutulandın!'});}
        }
      }else{m.pAngle+=0.02;moveEnt(m,Math.cos(m.pAngle)*0.5,Math.sin(m.pAngle)*0.5,room);}
    }
    else if(m.type==='ambush'){
      if(!m.triggered){
        m.pAngle+=0.008;moveEnt(m,Math.cos(m.pAngle)*0.5,Math.sin(m.pAngle)*0.5,room);
        if(dist<220&&!m.warned1){m.warned1=true;io.emit('monsterWarning',{type:'ambush',level:1,x:m.x,y:m.y});}
        if(dist<150&&!m.warned2){m.warned2=true;io.emit('monsterWarning',{type:'ambush',level:2,x:m.x,y:m.y});}
        if(dist<100&&!m.warned3){m.warned3=true;io.emit('monsterWarning',{type:'ambush',level:3,x:m.x,y:m.y});}
        if(dist<80){m.triggered=true;m.triggerTimer=0;io.emit('monsterAlert',{type:'ambush',x:m.x,y:m.y});} // daha erken saldırı
      }else{
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*5.5,Math.sin(m.angle)*5.5,room); // çok hızlı
        if(dist<m.radius+target.radius+4){
          target.alive=false;target.health=0;const tid=findId(target);if(tid)io.to(tid).emit('youDied',{msg:'Ambush tarafından yakalandın!'});
        }
        m.triggerTimer++;if(m.triggerTimer>240){m.alive=false;return false;} // daha az süre
      }
    }
    return true;
  });

  // Tüm oyuncular öldü?
  const alive=Object.values(players).filter(p=>p.alive);
  if(Object.keys(players).length>0&&alive.length===0){gamePhase='gameover';io.emit('gameOver',{doorCount});}

  // State
  io.emit('gameState',{
    players:Object.fromEntries(Object.entries(players).map(([id,p])=>[id,{
      x:Math.round(p.x),y:Math.round(p.y),angle:+p.angle.toFixed(2),
      health:Math.round(p.health),maxHealth:p.maxHealth,
      radius:p.radius,color:p.color,name:p.name,alive:p.alive,
      inWardrobe:p.inWardrobe,lanternOn:p.lanternOn,score:p.score
    }])),
    monsters:monsters.filter(m=>m.alive).map(m=>({
      id:m.id,type:m.type,x:Math.round(m.x),y:Math.round(m.y),
      angle:+m.angle.toFixed(2),alerted:m.alerted,triggered:m.triggered,warned1:m.warned1,warned:m.warned,alive:m.alive
    })),
    items:items.map(i=>({id:i.id,type:i.type,x:Math.round(i.x),y:Math.round(i.y),label:i.label})),
    rushActive,rushX:Math.round(rushX),doorCount,currentRoom,phase:gamePhase
  });

  // Stat güncelle
  for(const[id,p]of Object.entries(players)){
    if(!p.alive)continue;
    if(p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+0.05);
    if(p.lanternOn)p.lanternFuel=Math.max(0,p.lanternFuel-0.007);
    if(p.lanternFuel<=0)p.lanternOn=false;
    io.to(id).emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
  }
},50);

// ============================================================
// ODA GEÇİŞİ
// ============================================================
function tryAdvance(){
  const alive=Object.values(players).filter(p=>p.alive);
  if(alive.length===0)return;
  if(!alive.every(p=>p.readyForNext))return;
  for(const p of alive)p.readyForNext=false;

  doorCount++;
  if(doorCount>=MAX_DOORS){gamePhase='win';io.emit('gameWin',{doorCount});return;}
  currentRoom++;

  items=rooms[currentRoom].items.map(i=>({...i}));
  monsters=spawnMonsters(rooms[currentRoom]);

  const spawnY=rooms[currentRoom].ey*TILE+TILE/2;
  alive.forEach((p,i)=>{
    p.x=TILE*2+TILE/2;
    p.y=spawnY+(i-Math.floor(alive.length/2))*30;
    p.readyForNext=false;
  });

  // Rush RNG
  if(!rushPersist&&doorCount===nextRushAt&&rooms[currentRoom].hasWardrobe){
    rushActive=true;rushX=-800;rushSpeed=3+Math.random()*1.5;rushPersist=true;
    nextRushAt=doorCount+5+Math.floor(Math.random()*10);
    io.emit('rushStart');
  } else if(rushPersist){
    rushX=-800; // persist: yeni odada tekrar baştan
  } else {
    rushActive=false;
  }

  io.emit('roomChanged',{
    room:serRoom(rooms[currentRoom]),
    items,doorCount,currentRoom,rushActive,rushX
  });
}

function serRoom(r){
  return{g:r.g,ey:r.ey,type:r.type,n:r.n,w:r.w,h:r.h,hasFigure:r.hasFigure};
}

// ============================================================
// SOCKET
// ============================================================
io.on('connection',(socket)=>{
  console.log('Bağlandı:',socket.id);
  const COLORS=['#1ab8ff','#3af0c0','#ffdd44','#ff8844','#aa44ff','#ff4499','#44ff99','#ff6644'];
  const color=COLORS[Object.keys(players).length%COLORS.length];

  if(rooms.length===0)initWorld();

  const room=rooms[currentRoom];
  const spawnY=room.ey*TILE+TILE/2;
  players[socket.id]={
    x:TILE*2+TILE/2,y:spawnY,
    radius:12,angle:0,health:100,maxHealth:100,speed:2.6,
    color,name:'Oyuncu',alive:true,
    score:0,inventory:[],
    lanternFuel:100,lanternOn:true,
    inWardrobe:false,readyForNext:false
  };

  socket.emit('init',{
    id:socket.id,
    room:serRoom(room),
    items,
    monsters:monsters.map(m=>({id:m.id,type:m.type,x:m.x,y:m.y,radius:m.radius,alive:m.alive})),
    doorCount,currentRoom,rushActive,rushX,phase:gamePhase
  });
  socket.broadcast.emit('playerJoined',{name:'Oyuncu',color});

  socket.on('setName',(name)=>{if(players[socket.id])players[socket.id].name=String(name).slice(0,16)||'Oyuncu';});

  socket.on('input',(data)=>{
    const p=players[socket.id];if(!p||!p.alive||p.inWardrobe)return;
    const room=rooms[currentRoom];if(!room)return;
    const spd=(data.sprint?p.speed*1.75:p.speed);
    const diag=data.dx!==0&&data.dy!==0?0.707:1;
    moveEnt(p,data.dx*spd*diag,data.dy*spd*diag,room);
    p.angle=data.angle;
    if(data.sprint){const fig=monsters.find(m=>m.type==='figure');if(fig&&!fig.alerted){if(Math.sqrt(dist2(p,fig))<360){fig.alerted=true;fig.alertTimer=210;}}}
  });

  socket.on('interact',(data)=>{
    const p=players[socket.id];if(!p||!p.alive)return;
    const room=rooms[currentRoom];if(!room)return;

    if(data.type==='door'){
      const dt=room.g[room.ey][RW-1];
      if(dt===TD||dt===TE){
        p.readyForNext=true;
        socket.emit('waitingForOthers');
        tryAdvance();
      } else if(dt===TL){
        // ANAHTAR KONTROLÜ — envanterde ara
        const ki=p.inventory.findIndex(i=>i.type==='key');
        if(ki>=0){
          p.inventory.splice(ki,1);
          room.g[room.ey][RW-1]=TD;
          io.emit('doorUnlocked');
          // myStats güncelle
          socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
        } else {
          socket.emit('msg',{text:'Anahtar lazım!',color:'#ff4444'});
        }
      }
    }

    if(data.type==='wardrobe'){
      p.inWardrobe=!p.inWardrobe;
      socket.emit('wardrobeState',{inWardrobe:p.inWardrobe});
    }

    if(data.type==='item'){
      const idx=items.findIndex(i=>i.id===data.itemId);if(idx<0)return;
      const item=items[idx];
      items.splice(idx,1);
      if(item.type==='bandage'){p.health=Math.min(p.maxHealth,p.health+35);}
      else if(item.type==='oil'){p.lanternFuel=Math.min(100,p.lanternFuel+45);p.lanternOn=true;}
      else if(p.inventory.length<3){p.inventory.push(item);}
      else{
        // Dolu: en eski düşür yeni al
        const dropped=p.inventory.shift();
        dropped.x=p.x+(Math.random()-0.5)*60;dropped.y=p.y+(Math.random()-0.5)*60;dropped.id=uid();
        items.push(dropped);io.emit('itemDropped',{item:dropped});
        p.inventory.push(item);
      }
      io.emit('itemPickedUp',{itemId:item.id,playerId:socket.id});
      socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
    }

    if(data.type==='dropItem'){
      const ki=p.inventory.findIndex(i=>i.type===data.itemType);
      if(ki>=0){
        const dropped=p.inventory.splice(ki,1)[0];
        dropped.x=p.x+(Math.random()-0.5)*60;dropped.y=p.y+(Math.random()-0.5)*60;dropped.id=uid();
        items.push(dropped);io.emit('itemDropped',{item:dropped});
        socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
      }
    }

    if(data.type==='lantern'){
      p.lanternOn=!p.lanternOn;
      socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory});
    }

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
    if(Object.keys(players).length===0){
      rooms=[];gamePhase='lobby';monsters=[];items=[];doorCount=0;currentRoom=0;rushActive=false;
      console.log('Sunucu sıfırlandı');
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('DOORS sunucu: http://localhost:'+PORT));
