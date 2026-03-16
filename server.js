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
let monsters=[],currentRoom=0,items=[],gamePhase='lobby',players={};
let tick=0;

function uid(){return Math.random().toString(36).slice(2,9);}

// ── ODA TİPLERİ ──────────────────────────────────────────────
const RTYPES=['normal','library','dungeon','church','forest','cave','lab','mansion','prison','ruins'];

function genRoom(n){
  const type=n===0?'normal':RTYPES[Math.floor(Math.random()*RTYPES.length)];
  const g=[];
  for(let y=0;y<RH;y++){g[y]=[];for(let x=0;x<RW;x++)g[y][x]=(x===0||x===RW-1||y===0||y===RH-1)?TW:TF;}
  const ey=Math.floor(RH/2);
  g[ey][0]=TF;
  const isLast=n>=MAX_DOORS,locked=!isLast&&n>2&&Math.random()<0.3;
  g[ey][RW-1]=isLast?TE:(locked?TL:TD);

  const place=(tx,ty,t)=>{if(ty>=1&&ty<RH-1&&tx>=1&&tx<RW-1&&g[ty][tx]===TF)g[ty][tx]=t;};
  if(type==='library'){
    for(let x=2;x<RW-2;x+=2)place(x,1,TW);
    for(let i=0;i<4;i++){const tx=3+Math.floor(Math.random()*(RW-6)),ty=3+Math.floor(Math.random()*(RH-6));place(tx,ty,TT);}
  }else if(type==='dungeon'){
    [[4,2],[RW-5,2],[4,RH-3],[RW-5,RH-3]].forEach(([x,y])=>place(x,y,TW));
    for(let y=3;y<RH-3;y+=3)for(let x=5;x<RW-5;x+=4)place(x,y,TW);
  }else if(type==='church'){
    for(let x=3;x<RW-3;x++){place(x,3,TT);place(x,RH-4,TT);}
    place(Math.floor(RW/2),2,TW);place(Math.floor(RW/2),RH-3,TW);
  }else if(type==='forest'){
    for(let i=0;i<10;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));place(tx,ty,TW);}
    for(let i=0;i<3;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));place(tx,ty,TT);}
  }else if(type==='cave'){
    for(let x=2;x<RW-2;x+=3)place(x,1,TW);
    [[2,2],[RW-3,2],[2,RH-3],[RW-3,RH-3]].forEach(([x,y])=>place(x,y,TW));
    for(let i=0;i<4;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));place(tx,ty,TW);}
  }else if(type==='lab'){
    for(let x=2;x<6;x++){place(x,2,TT);place(x,RH-3,TT);}
    for(let x=RW-6;x<RW-2;x++){place(x,2,TT);place(x,RH-3,TT);}
    place(Math.floor(RW/2),Math.floor(RH/2),TT);
  }else if(type==='mansion'){
    for(let y=2;y<RH-2;y+=3){place(2,y,TWD);place(RW-3,y,TWD);}
    [Math.floor(RH/2)-1,Math.floor(RH/2),Math.floor(RH/2)+1].forEach(y=>place(Math.floor(RW/2),y,TT));
  }else if(type==='prison'){
    for(let y=2;y<RH-2;y+=2)place(Math.floor(RW/3),y,TW);
    for(let y=2;y<RH-2;y+=2)place(Math.floor(RW*2/3),y,TW);
    for(let i=0;i<3;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));place(tx,ty,TT);}
  }else if(type==='ruins'){
    for(let i=0;i<12;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));place(tx,ty,Math.random()<0.6?TW:TT);}
  }else{
    for(let i=0;i<4;i++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));const r=Math.random();place(tx,ty,r<0.4?TW:r<0.7?TT:TWD);}
  }

  // Garanti dolap
  let hasWD=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD=true;
  if(!hasWD){for(let t=0;t<60;t++){const tx=2+Math.floor(Math.random()*(RW-4)),ty=2+Math.floor(Math.random()*(RH-4));if(g[ty][tx]===TF&&Math.abs(ty-ey)>1){g[ty][tx]=TWD;break;}}}

  // Geçit temizle
  for(let x=1;x<RW-1;x++)if(g[ey][x]!==TD&&g[ey][x]!==TL&&g[ey][x]!==TE)g[ey][x]=TF;
  for(let dy=-1;dy<=1;dy++){const y=ey+dy;if(y>=1&&y<RH-1){if(g[y][1]!==TF)g[y][1]=TF;if(g[y][2]!==TF)g[y][2]=TF;if(g[y][RW-2]!==TD&&g[y][RW-2]!==TL&&g[y][RW-2]!==TE)g[y][RW-2]=TF;}}

  // İtem yerleştir — zemin karelere, çakışmasın
  const usedCells=new Set();
  function rp(){
    for(let t=0;t<200;t++){
      const x=2+Math.floor(Math.random()*(RW-4));
      const y=2+Math.floor(Math.random()*(RH-4));
      const key=`${x},${y}`;
      if(g[y][x]===TF&&Math.abs(y-ey)>0&&!usedCells.has(key)){usedCells.add(key);return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};}
    }
    return null;
  }
  const ri=[];
  if(locked){const p=rp();if(p)ri.push({id:uid(),type:'key',x:p.x,y:p.y,label:'Anahtar'});}
  if(Math.random()<0.55){const p=rp();if(p)ri.push({id:uid(),type:'bandage',x:p.x,y:p.y,label:'Sargı'});}
  if(Math.random()<0.4){const p=rp();if(p)ri.push({id:uid(),type:'oil',x:p.x,y:p.y,label:'Fener Yağı'});}
  if(Math.random()<0.25){const p=rp();if(p)ri.push({id:uid(),type:'gold',x:p.x,y:p.y,label:'Altın'});}
  // Yeni item: kalkan
  if(Math.random()<0.15&&n>5){const p=rp();if(p)ri.push({id:uid(),type:'shield',x:p.x,y:p.y,label:'Kalkan'});}

  let monster=null;
  if(n>0&&n<MAX_DOORS){
    if(n===25)monster='seek';
    else if(n===15)monster='mimic'; // yeni canavar
    else{const r=Math.random();if(r<0.35&&n>=8)monster='screech';else if(r<0.65&&n>=3)monster='ambush';else if(r<0.75&&n>=20)monster='shadow';}
  }
  let hasWD2=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD2=true;
  return{g,ey,items:ri,monster,hasWardrobe:hasWD2,hasFigure:n===MAX_DOORS,type,n,w:RW*TILE,h:RH*TILE};
}

function initWorld(){
  rooms=[];for(let i=0;i<=MAX_DOORS;i++)rooms.push(genRoom(i));
  currentRoom=0;doorCount=0;
  items=rooms[0].items.map(i=>({...i}));
  monsters=spawnMonsters(rooms[0]);
  rushActive=false;rushPersist=false;
  nextRushAt=5+Math.floor(Math.random()*8);
  gamePhase='playing';
}

function safePosInRoom(room,side='right'){
  const tries=200;
  for(let t=0;t<tries;t++){
    const x=side==='right'?Math.floor(RW*0.6)+Math.floor(Math.random()*(RW*0.35)):2+Math.floor(Math.random()*(RW-4));
    const y=2+Math.floor(Math.random()*(RH-4));
    if(x>=1&&x<RW-1&&y>=1&&y<RH-1&&room.g[y][x]===TF&&Math.abs(y-room.ey)>0)
      return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};
  }
  return{x:(RW-4)*TILE+TILE/2,y:room.ey*TILE+TILE/2};
}

function spawnMonsters(room){
  const ms=[];
  if(room.hasFigure){const p=safePosInRoom(room);ms.push({id:'figure',type:'figure',x:p.x,y:p.y,radius:20,alive:true,alerted:false,alertTimer:0,pAngle:0,angle:0,solved:false});}
  if(room.monster==='screech'){const p=safePosInRoom(room);ms.push({id:'s'+uid(),type:'screech',x:p.x,y:p.y,radius:12,alive:true,triggered:false,warnTimer:0,warned:false,timer:0,angle:0});}
  if(room.monster==='seek'){const p=safePosInRoom(room);ms.push({id:'sk'+uid(),type:'seek',x:p.x,y:p.y,radius:16,alive:true,speed:2.2,angle:0,pAngle:0});}
  if(room.monster==='ambush'){const p=safePosInRoom(room,'right');ms.push({id:'a'+uid(),type:'ambush',x:p.x,y:p.y,radius:18,alive:true,triggered:false,triggerTimer:0,warned1:false,warned2:false,warned3:false,angle:0,pAngle:Math.random()*Math.PI*2});}
  if(room.monster==='shadow'){const p=safePosInRoom(room);ms.push({id:'sh'+uid(),type:'shadow',x:p.x,y:p.y,radius:14,alive:true,speed:2.8,angle:0,pAngle:0,visible:false,visibleTimer:0});}
  if(room.monster==='mimic'){const p=safePosInRoom(room);ms.push({id:'m'+uid(),type:'mimic',x:p.x,y:p.y,radius:12,alive:true,triggered:false,angle:0,disguised:true});}
  return ms;
}

// ── KOLİZYON ────────────────────────────────────────────────
function isSolid(rx,ry,room){
  const tx=Math.floor(rx/TILE),ty=Math.floor(ry/TILE);
  if(tx<0||tx>=RW||ty<0||ty>=RH)return true;
  const t=room.g[ty][tx];
  return t===TW||t===TL||t===TT||t===TWD;
}

function moveEnt(e,dx,dy,room){
  const r=Math.max(3,(e.radius||12)-5);
  const nx=e.x+dx;
  if(![[-r,-r],[r,-r],[-r,r],[r,r]].some(([ox,oy])=>isSolid(nx+ox,e.y+oy,room)))e.x=nx;
  const ny=e.y+dy;
  if(![[-r,-r],[r,-r],[-r,r],[r,r]].some(([ox,oy])=>isSolid(e.x+ox,ny+oy,room)))e.y=ny;
  e.x=Math.max(TILE,Math.min(room.w-TILE,e.x));
  e.y=Math.max(TILE,Math.min(room.h-TILE,e.y));
}

function dist2(a,b){return(a.x-b.x)**2+(a.y-b.y)**2;}
function findId(t){return Object.keys(players).find(k=>players[k]===t);}

function killPlayer(target,msg){
  if(!target.alive)return;
  target.alive=false;target.health=0;
  const tid=findId(target);
  if(tid)io.to(tid).emit('youDied',{msg});
  io.emit('playerDied',{id:tid,name:target.name});
}

function damagePlayer(target,dmg){
  if(!target.alive)return;
  // Kalkan varsa bloke et
  if(target.shielded){target.shielded=false;io.emit('floatText',{x:target.x,y:target.y-30,text:'KALKAN KIRILD!',color:'#44aaff'});return;}
  target.health-=dmg;
  if(target.health<=0)killPlayer(target,'Canavar tarafından öldürüldün!');
}

// ── OYUN TICK ────────────────────────────────────────────────
setInterval(()=>{
  if(gamePhase!=='playing')return;
  const room=rooms[currentRoom];if(!room)return;
  tick++;

  // Rush
  if(rushActive&&rushX>-99999){
    rushX+=rushSpeed;
    for(const[id,p]of Object.entries(players)){
      if(!p.alive||p.inWardrobe)continue;
      if(Math.abs(p.x-rushX)<44)killPlayer(p,'Rush tarafından yutuldun!');
    }
    if(rushX>room.w+400){rushActive=false;rushPersist=false;io.emit('rushEnd');}
  }

  const aliveP=Object.values(players).filter(p=>p.alive&&!p.inWardrobe);

  // Canavarlar
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
        m.alertTimer--;
        if(m.alertTimer<=0&&dist>280)m.alerted=false;
        m.angle=Math.atan2(dy,dx);
        const spd=4.5+(m.alertTimer>120?1.5:0);
        moveEnt(m,Math.cos(m.angle)*spd,Math.sin(m.angle)*spd,room);
        if(dist<m.radius+target.radius+5)damagePlayer(target,2.5);
      }else{
        m.pAngle+=0.015;
        moveEnt(m,Math.cos(m.pAngle)*2,Math.sin(m.pAngle)*2,room);
        m.angle=m.pAngle;
        if(dist<180)m.alerted=true;
      }
    }

    else if(m.type==='screech'){
      if(!m.triggered){
        if(dist<250){
          if(!m.warned){m.warned=true;io.emit('monsterWarning',{type:'screech',x:m.x,y:m.y});}
          m.warnTimer++;
          if(m.warnTimer>35){m.triggered=true;io.emit('monsterAlert',{type:'screech',x:m.x,y:m.y});}
        }
      }
      if(m.triggered){
        m.timer++;
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*5.5,Math.sin(m.angle)*5.5,room);
        if(dist<m.radius+target.radius+4)killPlayer(target,'Screech tarafından yakalandın!');
        // KALICI — kaybolmaz, sadece oyuncu ölünce durur
      }
    }

    else if(m.type==='seek'){
      const anyLight=aliveP.some(p=>p.lanternOn);
      if(!anyLight){
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*m.speed,Math.sin(m.angle)*m.speed,room);
        if(dist<m.radius+target.radius+4)damagePlayer(target,2);
      }else{
        // Işık varken yavaş kaçar
        const awayX=m.x-target.x,awayY=m.y-target.y;
        const len=Math.sqrt(awayX*awayX+awayY*awayY)+0.01;
        moveEnt(m,(awayX/len)*1.5,(awayY/len)*1.5,room);
      }
    }

    else if(m.type==='ambush'){
      if(!m.triggered){
        m.pAngle+=0.01;
        moveEnt(m,Math.cos(m.pAngle)*0.8,Math.sin(m.pAngle)*0.8,room);
        if(dist<230&&!m.warned1){m.warned1=true;io.emit('monsterWarning',{type:'ambush',level:1,x:m.x,y:m.y});}
        if(dist<160&&!m.warned2){m.warned2=true;io.emit('monsterWarning',{type:'ambush',level:2,x:m.x,y:m.y});}
        if(dist<100&&!m.warned3){m.warned3=true;io.emit('monsterWarning',{type:'ambush',level:3,x:m.x,y:m.y});}
        if(dist<85){m.triggered=true;m.triggerTimer=0;io.emit('monsterAlert',{type:'ambush',x:m.x,y:m.y});}
      }else{
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*6,Math.sin(m.angle)*6,room);
        if(dist<m.radius+target.radius+4)killPlayer(target,'Ambush tarafından yakalandın!');
        m.triggerTimer++;
        // Oyuncu kaçarsa yeniden gizlenir — KAYBOLMAZ, saldırmaya devam eder
        if(dist>350&&m.triggerTimer>120){
          m.triggered=false;m.triggerTimer=0;
          m.warned1=false;m.warned2=false;m.warned3=false;
          io.emit('monsterHide',{id:m.id});
        }
      }
    }

    else if(m.type==='shadow'){
      // Shadow: görünmez dolaşır, yakına gelince görünür ve saldırır
      m.pAngle+=0.012;
      if(!m.visible){
        moveEnt(m,Math.cos(m.pAngle)*2,Math.sin(m.pAngle)*2,room);
        if(dist<120){m.visible=true;m.visibleTimer=0;io.emit('monsterAlert',{type:'shadow',x:m.x,y:m.y});}
      }else{
        m.visibleTimer++;
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*4.5,Math.sin(m.angle)*4.5,room);
        if(dist<m.radius+target.radius+4)damagePlayer(target,3);
        if(m.visibleTimer>300){m.visible=false;m.visibleTimer=0;} // tekrar kaybolur
      }
    }

    else if(m.type==='mimic'){
      // Mimic: item gibi görünür, yaklaşınca saldırır
      if(!m.triggered){
        if(dist<80){
          m.triggered=true;m.disguised=false;
          io.emit('monsterAlert',{type:'mimic',x:m.x,y:m.y});
        }
      }else{
        m.angle=Math.atan2(dy,dx);
        moveEnt(m,Math.cos(m.angle)*5,Math.sin(m.angle)*5,room);
        if(dist<m.radius+target.radius+4)killPlayer(target,'Mimic tarafından yakalandın!');
      }
    }

    return true; // CANAVARLAR KAYBOLMAZ
  });

  // Tüm oyuncular öldü?
  const alive=Object.values(players).filter(p=>p.alive);
  if(Object.keys(players).length>0&&alive.length===0){gamePhase='gameover';io.emit('gameOver',{doorCount});}

  // State broadcast (her 2 tickte bir items gönder)
  const broadcastItems=tick%2===0?items:undefined;
  io.emit('gameState',{
    players:Object.fromEntries(Object.entries(players).map(([id,p])=>[id,{
      x:Math.round(p.x),y:Math.round(p.y),angle:+p.angle.toFixed(2),
      health:Math.round(p.health),maxHealth:p.maxHealth,
      radius:p.radius,color:p.color,name:p.name,alive:p.alive,
      inWardrobe:p.inWardrobe,lanternOn:p.lanternOn,score:p.score,shielded:p.shielded
    }])),
    monsters:monsters.map(m=>({
      id:m.id,type:m.type,x:Math.round(m.x),y:Math.round(m.y),
      angle:+m.angle.toFixed(2),alerted:m.alerted,triggered:m.triggered,
      warned1:m.warned1,warned:m.warned,alive:m.alive,
      visible:m.visible,disguised:m.disguised
    })),
    items:broadcastItems?items.map(i=>({id:i.id,type:i.type,x:Math.round(i.x),y:Math.round(i.y),label:i.label})):undefined,
    rushActive,rushX:Math.round(rushX),doorCount,currentRoom,phase:gamePhase
  });

  // Stats
  for(const[id,p]of Object.entries(players)){
    if(!p.alive)continue;
    if(p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+0.04);
    if(p.lanternOn){p.lanternFuel=Math.max(0,p.lanternFuel-0.006);if(p.lanternFuel<=0)p.lanternOn=false;}
    io.to(id).emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory,shielded:p.shielded});
  }
},50);

// ── ODA GEÇİŞİ ──────────────────────────────────────────────
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
  const ey=rooms[currentRoom].ey;
  alive.forEach((p,i)=>{p.x=TILE*2+TILE/2;p.y=ey*TILE+TILE/2+(i-Math.floor(alive.length/2))*30;});
  if(!rushPersist&&doorCount===nextRushAt&&rooms[currentRoom].hasWardrobe){
    rushActive=true;rushX=-800;rushSpeed=3.5+Math.random()*1.5;rushPersist=true;
    nextRushAt=doorCount+5+Math.floor(Math.random()*10);
    io.emit('rushStart');
  }else if(rushPersist){rushX=-800;}else{rushActive=false;}
  io.emit('roomChanged',{room:ser(rooms[currentRoom]),items,doorCount,currentRoom,rushActive,rushX});
}

function ser(r){return{g:r.g,ey:r.ey,type:r.type,n:r.n,w:r.w,h:r.h,hasFigure:r.hasFigure};}

// ── SOCKET ───────────────────────────────────────────────────
io.on('connection',socket=>{
  console.log('Bağlandı:',socket.id);
  const COLORS=['#1ab8ff','#3af0c0','#ffdd44','#ff8844','#aa44ff','#ff4499','#44ff99','#ff6644'];
  if(rooms.length===0)initWorld();
  const color=COLORS[Object.keys(players).length%COLORS.length];
  const ey=rooms[currentRoom].ey;
  const si=Object.keys(players).length;
  players[socket.id]={
    x:TILE*2+TILE/2,y:ey*TILE+TILE/2+(si%3-1)*30,
    radius:12,angle:0,health:100,maxHealth:100,speed:2.8,
    color,name:'Oyuncu',alive:true,score:0,inventory:[],
    lanternFuel:100,lanternOn:true,inWardrobe:false,readyForNext:false,shielded:false
  };
  socket.emit('init',{id:socket.id,room:ser(rooms[currentRoom]),items,monsters:monsters.map(m=>({id:m.id,type:m.type,x:m.x,y:m.y,radius:m.radius,alive:m.alive,disguised:m.disguised})),doorCount,currentRoom,rushActive,rushX,phase:gamePhase});
  socket.broadcast.emit('playerJoined',{name:'Oyuncu',color});

  socket.on('setName',name=>{if(players[socket.id])players[socket.id].name=String(name).slice(0,16)||'Oyuncu';});

  socket.on('input',data=>{
    const p=players[socket.id];if(!p||!p.alive||p.inWardrobe)return;
    const room=rooms[currentRoom];if(!room)return;
    const spd=data.sprint?p.speed*1.7:p.speed;
    const diag=data.dx!==0&&data.dy!==0?0.707:1;
    moveEnt(p,data.dx*spd*diag,data.dy*spd*diag,room);
    p.angle=data.angle;
    if(data.sprint){const fig=monsters.find(m=>m.type==='figure');if(fig&&!fig.alerted&&Math.sqrt(dist2(p,fig))<380){fig.alerted=true;fig.alertTimer=250;}}
  });

  socket.on('interact',data=>{
    const p=players[socket.id];if(!p||!p.alive)return;
    const room=rooms[currentRoom];if(!room)return;

    if(data.type==='door'){
      const dt=room.g[room.ey][RW-1];
      if(dt===TD||dt===TE){p.readyForNext=true;socket.emit('waitingForOthers');tryAdvance();}
      else if(dt===TL){
        const ki=p.inventory.findIndex(i=>i.type==='key');
        if(ki>=0){p.inventory.splice(ki,1);room.g[room.ey][RW-1]=TD;io.emit('doorUnlocked');io.emit('floatText',{x:room.ey*TILE,y:room.ey*TILE-30,text:'KİLİT AÇILDI!',color:'#ffd700'});socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory,shielded:p.shielded});}
        else socket.emit('msg',{text:'Anahtar lazım!',color:'#ff4444'});
      }
    }
    if(data.type==='wardrobe'){p.inWardrobe=!p.inWardrobe;socket.emit('wardrobeState',{inWardrobe:p.inWardrobe});}
    if(data.type==='item'){
      const idx=items.findIndex(i=>i.id===data.itemId);if(idx<0)return;
      const item=items.splice(idx,1)[0];
      if(item.type==='bandage'){p.health=Math.min(p.maxHealth,p.health+40);io.emit('floatText',{x:p.x,y:p.y-30,text:'+40 CAN',color:'#ff6688'});}
      else if(item.type==='oil'){p.lanternFuel=Math.min(100,p.lanternFuel+50);p.lanternOn=true;io.emit('floatText',{x:p.x,y:p.y-30,text:'+YAKIT',color:'#ffaa44'});}
      else if(item.type==='shield'){p.shielded=true;io.emit('floatText',{x:p.x,y:p.y-30,text:'KALKAN AKTİF',color:'#44aaff'});}
      else if(p.inventory.length<3)p.inventory.push(item);
      else{const d=p.inventory.shift();d.x=p.x+(Math.random()-0.5)*60;d.y=p.y+(Math.random()-0.5)*60;d.id=uid();items.push(d);io.emit('itemDropped',{item:d});p.inventory.push(item);}
      io.emit('itemPickedUp',{itemId:item.id,playerId:socket.id});
      socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory,shielded:p.shielded});
    }
    if(data.type==='dropItem'){
      const ki=p.inventory.findIndex(i=>i.type===data.itemType);
      if(ki>=0){const d=p.inventory.splice(ki,1)[0];d.x=p.x+(Math.random()-0.5)*60;d.y=p.y+(Math.random()-0.5)*60;d.id=uid();items.push(d);io.emit('itemDropped',{item:d});socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory,shielded:p.shielded});}
    }
    if(data.type==='lantern'){p.lanternOn=!p.lanternOn;socket.emit('myStats',{health:p.health,maxHealth:p.maxHealth,lanternFuel:p.lanternFuel,lanternOn:p.lanternOn,score:p.score,inventory:p.inventory,shielded:p.shielded});}
    if(data.type==='puzzleSolve'){
      const fig=monsters.find(m=>m.type==='figure');
      if(fig){fig.alive=false;fig.solved=true;p.score+=500;io.emit('figureDefeated');io.emit('floatText',{x:fig.x,y:fig.y,text:'BULMACA ÇÖZÜLDÜ!',color:'#44ff88'});}
    }
  });

  socket.on('ping_c',()=>socket.emit('pong_c'));
  socket.on('disconnect',()=>{
    const name=players[socket.id]?.name||'?';
    delete players[socket.id];
    io.emit('playerLeft',{id:socket.id,name});
    if(Object.keys(players).length===0){rooms=[];gamePhase='lobby';monsters=[];items=[];doorCount=0;currentRoom=0;rushActive=false;console.log('Sıfırlandı');}
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('DOORS: http://localhost:'+PORT));
