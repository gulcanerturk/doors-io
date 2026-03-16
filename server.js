const express=require('express'),http=require('http'),{Server}=require('socket.io'),path=require('path');
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:'*'}});
app.use(express.static(path.join(__dirname,'public')));

const TILE=48,RW=15,RH=11,MAX_DOORS=50;
const TF=0,TW=1,TD=2,TL=3,TE=6,TT=7,TWD=8,TSW=9;
let rooms=[],dc=0,rushActive=false,rushX=0,rushSpd=0,rushPersist=false,nextRush=5+ri(8);
let monsters=[],curRoom=0,items=[],phase='lobby',players={},tick=0,shopList=[],gameOverTimer=null;

function ri(n){return Math.floor(Math.random()*n);}
function uid(){return Math.random().toString(36).slice(2,8);}
function dist(a,b){return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);}

// ─── ODA ─────────────────────────────────────────────────────
const RTYPES=['normal','library','dungeon','church','forest','cave','lab','mansion'];
function genRoom(n){
  const type=n===0?'normal':RTYPES[ri(RTYPES.length)];
  const g=[];
  for(let y=0;y<RH;y++){g[y]=[];for(let x=0;x<RW;x++)g[y][x]=(x===0||x===RW-1||y===0||y===RH-1)?TW:TF;}
  const ey=Math.floor(RH/2);
  g[ey][0]=TF;
  const isLast=n>=MAX_DOORS;
  const rnd=Math.random();
  const switchLock=!isLast&&n>4&&rnd<0.22;
  const locked=!isLast&&n>2&&rnd>=0.22&&rnd<0.45;
  g[ey][RW-1]=isLast?TE:((switchLock||locked)?TL:TD);
  const pl=(tx,ty,t)=>{if(ty>=1&&ty<RH-1&&tx>=1&&tx<RW-1&&g[ty][tx]===TF)g[ty][tx]=t;};
  if(type==='library'){for(let x=2;x<RW-2;x+=2)pl(x,1,TW);for(let i=0;i<4;i++)pl(3+ri(RW-6),3+ri(RH-6),TT);}
  else if(type==='dungeon'){[[4,2],[RW-5,2],[4,RH-3],[RW-5,RH-3]].forEach(([x,y])=>pl(x,y,TW));for(let y=3;y<RH-3;y+=3)for(let x=5;x<RW-5;x+=4)pl(x,y,TW);}
  else if(type==='church'){for(let x=3;x<RW-3;x++){pl(x,3,TT);pl(x,RH-4,TT);}pl(Math.floor(RW/2),2,TW);pl(Math.floor(RW/2),RH-3,TW);}
  else if(type==='forest'){for(let i=0;i<9;i++)pl(2+ri(RW-4),2+ri(RH-4),TW);}
  else if(type==='cave'){[[2,2],[RW-3,2],[2,RH-3],[RW-3,RH-3]].forEach(([x,y])=>pl(x,y,TW));for(let i=0;i<5;i++)pl(2+ri(RW-4),2+ri(RH-4),TW);for(let x=2;x<RW-2;x+=3)pl(x,1,TW);}
  else if(type==='lab'){for(let x=2;x<6;x++){pl(x,2,TT);pl(x,RH-3,TT);}for(let x=RW-6;x<RW-2;x++){pl(x,2,TT);pl(x,RH-3,TT);}pl(Math.floor(RW/2),Math.floor(RH/2),TT);}
  else if(type==='mansion'){for(let y=2;y<RH-2;y+=3){pl(2,y,TWD);pl(RW-3,y,TWD);}[-1,0,1].forEach(dy=>pl(Math.floor(RW/2),Math.floor(RH/2)+dy,TT));}
  else{for(let i=0;i<4;i++){const r=Math.random();pl(2+ri(RW-4),2+ri(RH-4),r<0.4?TW:r<0.7?TT:TWD);}}
  // Garanti dolap
  let wd=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)wd=true;
  if(!wd)for(let t=0;t<60;t++){const tx=2+ri(RW-4),ty=2+ri(RH-4);if(g[ty][tx]===TF&&Math.abs(ty-ey)>1){g[ty][tx]=TWD;break;}}
  // Şalter
  let swPos=null;
  if(switchLock){for(let t=0;t<60;t++){const tx=2+ri(RW-4),ty=2+ri(RH-4);if(g[ty][tx]===TF&&Math.abs(ty-ey)>1){g[ty][tx]=TSW;swPos={x:tx,y:ty};break;}}}
  // Geçit temizle
  for(let x=1;x<RW-1;x++)if([TW,TT,TWD,TSW].includes(g[ey][x]))g[ey][x]=TF;
  [-1,0,1].forEach(dy=>{const yy=ey+dy;if(yy>=1&&yy<RH-1){if(g[yy][1]!==TF)g[yy][1]=TF;const e=g[yy][RW-2];if(![TD,TL,TE,TF].includes(e))g[yy][RW-2]=TF;}});
  // Items (çakışmasız)
  const occ=new Set();
  function rp(){for(let t=0;t<200;t++){const x=2+ri(RW-4),y=2+ri(RH-4),k=x+','+y;if(g[y][x]===TF&&Math.abs(y-ey)>0&&!occ.has(k)){occ.add(k);return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};}}return{x:3*TILE+TILE/2,y:ey*TILE+TILE/2};}
  const ri2=[];
  if(locked){const p=rp();ri2.push({id:uid(),type:'key',x:p.x,y:p.y,label:'Anahtar'});}
  if(Math.random()<0.55){const p=rp();ri2.push({id:uid(),type:'bandage',x:p.x,y:p.y,label:'Sargı'});}
  if(Math.random()<0.4){const p=rp();ri2.push({id:uid(),type:'oil',x:p.x,y:p.y,label:'Fener Yağı'});}
  if(Math.random()<0.3){const p=rp();ri2.push({id:uid(),type:'gold',x:p.x,y:p.y,label:'Altın (+10💰)'});}
  if(Math.random()<0.06&&n>5){const p=rp();ri2.push({id:uid(),type:'shield',x:p.x,y:p.y,label:'Kalkan (tek kullanım)'});}
  if(Math.random()<0.18&&n>3){const p=rp();ri2.push({id:uid(),type:'boots',x:p.x,y:p.y,label:'Çizme (Hız)'});}
  // Canavar
  let monster=null;
  if(n>0&&n<MAX_DOORS){
    if(n===25)monster='seek';
    else if(n===15||n===35)monster='mimic';
    else{const r=Math.random();if(r<0.28&&n>=8)monster='screech';else if(r<0.52&&n>=3)monster='ambush';else if(r<0.7&&n>=20)monster='shadow';else if(r<0.84&&n>=15)monster='mimic';}
  }
  let hasWD2=false;for(let y=0;y<RH;y++)for(let x=0;x<RW;x++)if(g[y][x]===TWD)hasWD2=true;
  // Şalter labirenti (basit)
  const maze=switchLock?genMaze():null;
  return{g,ey,items:ri2,monster,hasWD:hasWD2,hasFig:n===MAX_DOORS,type,n,w:RW*TILE,h:RH*TILE,switchLock,swPos,swSolved:false,locked,maze};
}

function genMaze(){
  // 7x5 basit labirent, önceden tanımlı, 2 varyant
  const v1=[[1,0,1,0,1,1,1],[1,1,1,1,1,0,1],[0,0,0,1,0,0,1],[1,1,1,1,1,1,1],[1,0,0,0,1,0,1]];
  const v2=[[1,1,1,0,1,0,1],[1,0,1,1,1,1,1],[1,1,0,0,0,1,1],[0,1,1,1,1,0,1],[1,1,0,1,1,1,1]];
  return Math.random()<0.5?v1:v2;
}

function initWorld(){
  rooms=[];for(let i=0;i<=MAX_DOORS;i++)rooms.push(genRoom(i));
  curRoom=0;dc=0;items=rooms[0].items.map(i=>({...i}));monsters=spawnM(rooms[0]);
  rushActive=false;rushPersist=false;nextRush=5+ri(8);phase='playing';
  shopList=[
    {id:'s1',type:'bandage',label:'Sargı',price:15,desc:'+40 Can'},
    {id:'s2',type:'oil',label:'Fener Yağı',price:10,desc:'+50 Yakıt'},
    {id:'s3',type:'shield',label:'Kalkan',price:25,desc:'3 vuruş engeller'},
    {id:'s4',type:'boots',label:'Çizme',price:20,desc:'18sn hız x1.9'},
    {id:'s5',type:'key',label:'Anahtar',price:30,desc:'Kilitli kapı açar'},
  ];
}

function safePos(room,side='any'){
  for(let t=0;t<200;t++){
    const x=side==='right'?Math.floor(RW*0.55)+ri(Math.floor(RW*0.38)):2+ri(RW-4);
    const y=2+ri(RH-4);
    if(x>=1&&x<RW-1&&y>=1&&y<RH-1&&room.g[y][x]===TF&&Math.abs(y-room.ey)>0)
      return{x:x*TILE+TILE/2,y:y*TILE+TILE/2};
  }
  return{x:(RW-4)*TILE+TILE/2,y:room.ey*TILE+TILE/2};
}

function spawnM(room){
  const ms=[];
  if(room.hasFig){const p=safePos(room);ms.push({id:'fig',type:'figure',x:p.x,y:p.y,r:20,alive:true,alerted:false,aTimer:0,pA:0,angle:0,solved:false});}
  if(room.monster==='screech'){const p=safePos(room);ms.push({id:'sc'+uid(),type:'screech',x:p.x,y:p.y,r:12,alive:true,triggered:false,wTimer:0,warned:false,angle:0});}
  if(room.monster==='seek'){const p=safePos(room);ms.push({id:'sk'+uid(),type:'seek',x:p.x,y:p.y,r:16,alive:true,spd:2.5,angle:0,pA:0});}
  if(room.monster==='ambush'){const p=safePos(room,'right');ms.push({id:'ab'+uid(),type:'ambush',x:p.x,y:p.y,r:18,alive:true,triggered:false,tTimer:0,w1:false,w2:false,w3:false,angle:0,pA:ri(628)/100});}
  if(room.monster==='shadow'){const p=safePos(room);ms.push({id:'sh'+uid(),type:'shadow',x:p.x,y:p.y,r:14,alive:true,spd:3,angle:0,pA:0,vis:false,vTimer:0});}
  if(room.monster==='mimic'){const p=safePos(room);ms.push({id:'mi'+uid(),type:'mimic',x:p.x,y:p.y,r:12,alive:true,triggered:false,angle:0,disguised:true});}
  return ms;
}

function solid(rx,ry,room){
  const tx=Math.floor(rx/TILE),ty=Math.floor(ry/TILE);
  if(tx<0||tx>=RW||ty<0||ty>=RH)return true;
  const t=room.g[ty][tx];
  return t===TW||t===TL||t===TT||t===TWD||t===TSW;
}
function moveE(e,dx,dy,room){
  const r=Math.max(3,(e.r||12)-5);
  const nx=e.x+dx;
  if(![[-r,-r],[r,-r],[-r,r],[r,r]].some(([ox,oy])=>solid(nx+ox,e.y+oy,room)))e.x=nx;
  const ny=e.y+dy;
  if(![[-r,-r],[r,-r],[-r,r],[r,r]].some(([ox,oy])=>solid(e.x+ox,ny+oy,room)))e.y=ny;
  e.x=Math.max(TILE,Math.min(room.w-TILE,e.x));
  e.y=Math.max(TILE,Math.min(room.h-TILE,e.y));
}

function fid(t){return Object.keys(players).find(k=>players[k]===t);}

// ─── KALKAN — TEK KULLANIMLIK ────────────────────────────────
function shieldBlock(p){
  if(!p.shielded||p.shieldHits<=0){p.shielded=false;return false;}
  // Kalkan tam kırıldı — tek kullanım
  p.shielded=false;p.shieldHits=0;
  const tid=fid(p);
  if(tid){
    io.to(tid).emit('shieldBroke');
    io.emit('floatText',{x:p.x,y:p.y-30,text:'🛡 KALKAN KIRIDI!',color:'#44aaff'});
  }
  return true;
}

function kill(p,msg){
  if(!p||!p.alive)return;
  // Kalkan saldırıyı tamamen durdurur — ama sonra kırılır
  if(shieldBlock(p)){
    const tid=fid(p);if(tid)sendStats(p,tid);
    return; // bu seferlik korundu, kalkan yok artık
  }
  p.alive=false;p.health=0;
  const tid=fid(p);if(tid)io.to(tid).emit('youDied',{msg});
  io.emit('playerDied',{id:tid,name:p.name});
}

function dmg(p,d){
  if(!p||!p.alive)return;
  if(shieldBlock(p)){
    const tid=fid(p);if(tid)sendStats(p,tid);
    return; // kalkan hasarı da bloklar
  }
  p.health-=d;
  if(p.health<=0)kill(p,'Canavar tarafından öldürüldün!');
}

function sendStats(p,id){
  io.to(id).emit('myStats',{
    health:+p.health.toFixed(1),maxHealth:p.maxHealth,
    lanternFuel:+p.lanternFuel.toFixed(1),lanternOn:p.lanternOn,
    score:p.score,gold:p.gold,inventory:p.inventory,
    shielded:p.shielded,shieldHits:p.shieldHits,
    bootsActive:p.bootsTimer>0
  });
}

function mspd(base){return base*Math.min(1+dc*0.018,2.8);}

// ─── TICK ─────────────────────────────────────────────────────
setInterval(()=>{
  if(phase!=='playing')return;
  const room=rooms[curRoom];if(!room)return;
  tick++;

  if(rushActive&&rushX>-999999){
    rushX+=rushSpd;
    Object.entries(players).forEach(([id,p])=>{
      if(!p.alive||p.inWD)return;
      if(Math.abs(p.x-rushX)<46)kill(p,'Rush tarafından yutuldun!');
    });
    if(rushX>room.w+400){rushActive=false;rushPersist=false;io.emit('rushEnd');}
  }

  const alive=Object.values(players).filter(p=>p.alive&&!p.inWD);
  monsters.forEach(m=>{
    if(!m.alive)return;
    if(!alive.length)return;
    let tgt=alive[0],minD=99999;
    alive.forEach(p=>{const d=dist(m,p);if(d<minD){minD=d;tgt=p;}});
    const dx=tgt.x-m.x,dy=tgt.y-m.y,d=minD;
    const ang=Math.atan2(dy,dx);

    if(m.type==='figure'){
      if(m.solved)return;
      if(m.alerted){
        m.aTimer--;if(m.aTimer<=0&&d>300)m.alerted=false;
        m.angle=ang;const s=mspd(4.5)+(m.aTimer>120?1.5:0);
        moveE(m,Math.cos(ang)*s,Math.sin(ang)*s,room);
        if(d<m.r+tgt.r+6)dmg(tgt,3);
      }else{
        m.pA+=0.015;moveE(m,Math.cos(m.pA)*1.8,Math.sin(m.pA)*1.8,room);m.angle=m.pA;
        if(d<190||(tgt.sprinting&&d<420)){m.alerted=true;m.aTimer=260;}
      }
    }
    else if(m.type==='screech'){
      // Screech: periyodik olarak oyuncunun yanında belirir, "pişt" sesi çıkarır
      m.timer=(m.timer||0)+1;
      if(!m.triggered){
        // Her 180-260 tickte bir (9-13sn) oyuncunun yanında belirir
        if(m.timer>m.nextAppear){
          m.timer=0;
          m.nextAppear=180+Math.floor(Math.random()*80);
          // Oyuncunun tam yanına teleport et (1-2 tile uzakta)
          const angle=Math.random()*Math.PI*2;
          const dist2=TILE*1.5+Math.random()*TILE;
          let nx=tgt.x+Math.cos(angle)*dist2;
          let ny=tgt.y+Math.sin(angle)*dist2;
          // Duvardan kaçın
          nx=Math.max(TILE*2,Math.min(room.w-TILE*2,nx));
          ny=Math.max(TILE*2,Math.min(room.h-TILE*2,ny));
          m.x=nx;m.y=ny;
          m.triggered=true;m.attackTimer=0;
          // Yön bilgisini de gönder (oyuncuya göre hangi yönde)
          const dir=Math.atan2(ny-tgt.y,nx-tgt.x);
          io.emit('screechAppear',{x:nx,y:ny,targetId:fid(tgt),angle:dir});
          SFX_emit('screech');
        }
      } else {
        m.attackTimer=(m.attackTimer||0)+1;
        m.angle=ang;
        const s=mspd(9);
        moveE(m,Math.cos(ang)*s,Math.sin(ang)*s,room);
        if(d<m.r+tgt.r+4)kill(tgt,'Screech tarafından yakalandın!');
        // 4 saniye sonra kaybolur
        if(m.attackTimer>80){m.triggered=false;m.attackTimer=0;m.timer=0;m.nextAppear=180+Math.floor(Math.random()*80);}
      }
    }
    else if(m.type==='seek'){
      const anyLight=alive.some(p=>p.lanternOn);
      if(!anyLight){m.angle=ang;const s=mspd(m.spd);moveE(m,Math.cos(ang)*s,Math.sin(ang)*s,room);if(d<m.r+tgt.r+4)dmg(tgt,2.5);}
      else{m.pA+=0.025;moveE(m,Math.cos(m.pA)*0.8,Math.sin(m.pA)*0.8,room);}
    }
    else if(m.type==='ambush'){
      if(!m.triggered){
        m.pA+=0.012;moveE(m,Math.cos(m.pA)*0.9,Math.sin(m.pA)*0.9,room);
        if(d<240&&!m.w1){m.w1=true;io.emit('monsterWarning',{type:'ambush',level:1,x:m.x,y:m.y});}
        if(d<160&&!m.w2){m.w2=true;io.emit('monsterWarning',{type:'ambush',level:2,x:m.x,y:m.y});}
        if(d<110&&!m.w3){m.w3=true;io.emit('monsterWarning',{type:'ambush',level:3,x:m.x,y:m.y});}
        if(d<90){m.triggered=true;m.tTimer=0;io.emit('monsterAlert',{type:'ambush',x:m.x,y:m.y});SFX_emit('ambush');}
      }else{
        m.angle=ang;const s=mspd(7.5);moveE(m,Math.cos(ang)*s,Math.sin(ang)*s,room);
        if(d<m.r+tgt.r+4)kill(tgt,'Ambush tarafından yakalandın!');
        m.tTimer++;if(d>420&&m.tTimer>100){m.triggered=false;m.tTimer=0;m.w1=false;m.w2=false;m.w3=false;}
      }
    }
    else if(m.type==='shadow'){
      m.pA+=0.015;
      if(!m.vis){moveE(m,Math.cos(m.pA)*2.5,Math.sin(m.pA)*2.5,room);if(d<140){m.vis=true;m.vTimer=0;io.emit('monsterAlert',{type:'shadow',x:m.x,y:m.y});SFX_emit('shadow');}}
      else{m.vTimer++;m.angle=ang;const s=mspd(6.5);moveE(m,Math.cos(ang)*s,Math.sin(ang)*s,room);if(d<m.r+tgt.r+4)dmg(tgt,4);if(m.vTimer>260){m.vis=false;m.vTimer=0;}}
    }
    else if(m.type==='mimic'){
      if(!m.triggered){if(d<95){m.triggered=true;m.disguised=false;io.emit('monsterAlert',{type:'mimic',x:m.x,y:m.y});SFX_emit('mimic');}}
      else{m.angle=ang;const s=mspd(7);moveE(m,Math.cos(ang)*s,Math.sin(ang)*s,room);if(d<m.r+tgt.r+4)kill(tgt,'Mimic tarafından yakalandın!');}
    }
  });

  const aliveAll=Object.values(players).filter(p=>p.alive);
  const totalPlayers=Object.keys(players).length;
  if(totalPlayers>0&&aliveAll.length===0){
    // 3 saniye bekle, belki biri reconnect eder
    if(!gameOverTimer){
      gameOverTimer=setTimeout(()=>{
        gameOverTimer=null;
        const stillAlive=Object.values(players).filter(p=>p.alive);
        if(stillAlive.length===0&&Object.keys(players).length>0){
          phase='gameover';
          io.emit('gameOver',{dc});
        }
      },3000);
    }
  } else if(gameOverTimer&&aliveAll.length>0){
    clearTimeout(gameOverTimer);
    gameOverTimer=null;
  }

  if(tick%2===0){
    io.emit('gameState',{
      players:Object.fromEntries(Object.entries(players).map(([id,p])=>[id,{
        x:Math.round(p.x),y:Math.round(p.y),angle:+(p.angle||0).toFixed(1),
        health:Math.round(p.health),maxHealth:p.maxHealth,r:p.r,color:p.color,
        name:p.name,alive:p.alive,inWD:p.inWD,lanternOn:p.lanternOn,
        shielded:p.shielded
      }])),
      monsters:monsters.map(m=>({id:m.id,type:m.type,
        x:Math.round(m.x),y:Math.round(m.y),angle:+(m.angle||0).toFixed(1),
        alerted:m.alerted,triggered:m.triggered,w1:m.w1,warned:m.warned,
        alive:m.alive,vis:m.vis,disguised:m.disguised})),
      items:tick%6===0?items.map(i=>({id:i.id,type:i.type,x:Math.round(i.x),y:Math.round(i.y),label:i.label})):undefined,
      rushActive,rushX:rushActive?Math.round(rushX):undefined,
      dc,curRoom,swSolved:room.swSolved
    });
  }

  Object.entries(players).forEach(([id,p])=>{
    if(!p.alive)return;
    if(p.health<p.maxHealth)p.health=Math.min(p.maxHealth,p.health+0.04);
    if(p.lanternOn){p.lanternFuel=Math.max(0,p.lanternFuel-0.006);if(p.lanternFuel<=0)p.lanternOn=false;}
    if(p.bootsTimer>0){p.bootsTimer--;if(p.bootsTimer===0){p.spd=p.baseSpd;io.emit('floatText',{x:p.x,y:p.y-30,text:'HIZ BİTTİ',color:'#888'});}}
    if(tick%20===0)sendStats(p,id);
  });
},50);

function SFX_emit(type){io.emit('monsterSFX',{type});}

function advance(){
  const alive=Object.values(players).filter(p=>p.alive);
  if(!alive.length||!alive.every(p=>p.readyNext))return;
  alive.forEach(p=>p.readyNext=false);
  dc++;if(dc>=MAX_DOORS){phase='win';io.emit('gameWin',{dc});return;}
  curRoom++;
  items=rooms[curRoom].items.map(i=>({...i}));monsters=spawnM(rooms[curRoom]);
  const ey=rooms[curRoom].ey;
  alive.forEach((p,i)=>{p.x=TILE*2+TILE/2;p.y=ey*TILE+TILE/2+(i-Math.floor(alive.length/2))*30;});
  if(!rushPersist&&dc===nextRush&&rooms[curRoom].hasWD){
    rushActive=true;rushX=-1200;rushSpd=7+Math.random()*2;rushPersist=true;
    nextRush=dc+5+ri(10);io.emit('rushStart',{spd:rushSpd});
  }else if(rushPersist){rushX=-1200;}else{rushActive=false;}
  alive.forEach(p=>{if(p.visitedRooms)p.visitedRooms.add(curRoom);});
  io.emit('roomChanged',{room:serRoom(rooms[curRoom]),items,dc,curRoom,rushActive,rushX});
}

function serRoom(r){return{g:r.g,ey:r.ey,type:r.type,n:r.n,w:r.w,h:r.h,hasFig:r.hasFig,switchLock:r.switchLock,swSolved:r.swSolved,maze:r.maze,swPos:r.swPos};}

io.on('connection',socket=>{
  // Dünya yoksa veya gameover/win durumundaysa sıfırla
  if(rooms.length===0||phase==='gameover'||phase==='win'){
    initWorld();
  }

  const COLORS=['#1ab8ff','#3af0c0','#ffdd44','#ff8844','#aa44ff','#ff4499','#44ff99','#ff6644'];
  const color=COLORS[Object.keys(players).length%COLORS.length];
  const ey=rooms[curRoom].ey;
  const si=Object.keys(players).length;

  // Yeni oyuncuyu odanın başlangıcına yerleştir
  const spawnY=ey*TILE+TILE/2+(si%4-1)*28;
  players[socket.id]={
    x:TILE*2+TILE/2, y:spawnY,
    r:12,angle:0,health:100,maxHealth:100,spd:3.8,baseSpd:3.8,
    color,name:'Oyuncu',alive:true,score:0,gold:0,inventory:[],
    lanternFuel:100,lanternOn:true,inWD:false,readyNext:false,
    shielded:false,shieldHits:0,bootsTimer:0,sprinting:false,
    visitedRooms:new Set([curRoom])
  };

  // Eğer phase gameover idi ve sıfırladık, phase=playing yaptık
  // Yeni oyuncuya güncel durumu gönder
  socket.emit('init',{
    id:socket.id,
    room:serRoom(rooms[curRoom]),
    items,
    monsters:monsters.map(m=>({id:m.id,type:m.type,x:m.x,y:m.y,r:m.r,alive:m.alive,disguised:m.disguised})),
    dc,curRoom,rushActive,rushX,phase,shopList
  });
  socket.broadcast.emit('playerJoined',{name:'Oyuncu',color});

  socket.on('setName',name=>{
    const p=players[socket.id];
    if(p) p.name=String(name).slice(0,16)||'Oyuncu';
  });

  // Respawn: öldükten sonra başa dön
  socket.on('respawn',()=>{
    const p=players[socket.id];
    if(!p) return;

    // Dünyayı sıfırla — baştan başla
    initWorld();

    // TÜM oyuncuları sıfırla
    Object.values(players).forEach((pp,i)=>{
      pp.alive=true; pp.health=100; pp.inventory=[];
      pp.shielded=false; pp.shieldHits=0; pp.bootsTimer=0;
      pp.spd=pp.baseSpd; pp.lanternFuel=100; pp.lanternOn=true;
      pp.inWD=false; pp.readyNext=false;
      pp.x=TILE*2+TILE/2;
      pp.y=rooms[0].ey*TILE+TILE/2+(i%4-1)*28;
    });

    // Herkese yeni oyun bildir
    io.emit('gameReset',{
      room:serRoom(rooms[0]),
      items,
      monsters:monsters.map(m=>({id:m.id,type:m.type,x:m.x,y:m.y,r:m.r,alive:m.alive,disguised:m.disguised})),
      dc:0,curRoom:0
    });

    // Bu oyuncuya özel respawn ok
    sendStats(p,socket.id);
    socket.emit('respawnOk',{x:p.x,y:p.y});
  });

  socket.on('input',data=>{
    const p=players[socket.id];if(!p||!p.alive||p.inWD)return;
    const room=rooms[curRoom];if(!room)return;
    const s=data.sprint?p.spd*1.7:p.spd;
    const diag=data.dx!==0&&data.dy!==0?0.707:1;
    moveE(p,data.dx*s*diag,data.dy*s*diag,room);
    p.angle=data.angle;p.sprinting=!!data.sprint;
    if(data.sprint){const fig=monsters.find(m=>m.type==='figure');if(fig&&!fig.alerted&&dist(p,fig)<420){fig.alerted=true;fig.aTimer=260;}}
  });

  socket.on('interact',data=>{
    const p=players[socket.id];if(!p||!p.alive)return;
    const room=rooms[curRoom];if(!room)return;

    if(data.type==='door'){
      const dt=room.g[room.ey][RW-1];
      if(dt===TD||dt===TE){p.readyNext=true;socket.emit('waitForOthers');advance();}
      else if(dt===TL){
        if(room.switchLock&&!room.swSolved){socket.emit('msg',{text:'Önce şalteri bul!',color:'#ffaa44'});return;}
        const ki=p.inventory.findIndex(i=>i.type==='key');
        if(ki>=0){p.inventory.splice(ki,1);room.g[room.ey][RW-1]=TD;io.emit('doorUnlocked');io.emit('floatText',{x:(RW-1)*TILE,y:room.ey*TILE-30,text:'KİLİT AÇILDI!',color:'#ffd700'});sendStats(p,socket.id);}
        else socket.emit('msg',{text:'Anahtar lazım!',color:'#ff4444'});
      }
    }
    if(data.type==='switch'){
      if(!room.swSolved){room.swSolved=true;room.g[room.ey][RW-1]=TD;io.emit('switchSolved');io.emit('doorUnlocked');io.emit('floatText',{x:room.swPos?room.swPos.x*TILE+24:360,y:120,text:'ŞALTER AKTİF — KAPI AÇILDI!',color:'#44ff88'});}
    }
    if(data.type==='wardrobe'){p.inWD=!p.inWD;socket.emit('wardrobeState',{inWD:p.inWD});}
    if(data.type==='item'){
      const idx=items.findIndex(i=>i.id===data.itemId);if(idx<0)return;
      const item=items.splice(idx,1)[0];
      if(item.type==='bandage'){p.health=Math.min(p.maxHealth,p.health+40);io.emit('floatText',{x:p.x,y:p.y-30,text:'+40 CAN',color:'#ff6688'});}
      else if(item.type==='oil'){p.lanternFuel=Math.min(100,p.lanternFuel+50);p.lanternOn=true;io.emit('floatText',{x:p.x,y:p.y-30,text:'+YAKIT',color:'#ffaa44'});}
      else if(item.type==='shield'){p.shielded=true;p.shieldHits=1;io.emit('floatText',{x:p.x,y:p.y-30,text:'🛡 KALKAN AKTİF (tek kullanım)',color:'#44aaff'});}
      else if(item.type==='boots'){p.spd=p.baseSpd*1.9;p.bootsTimer=360;io.emit('floatText',{x:p.x,y:p.y-30,text:'👟 HIZ AKTIF (18sn)',color:'#44ff88'});}
      else if(item.type==='gold'){p.gold+=10;p.score+=5;io.emit('floatText',{x:p.x,y:p.y-30,text:'+10 💰',color:'#ffd700'});}
      else if(p.inventory.length<3)p.inventory.push(item);
      else{const d=p.inventory.shift();d.x=p.x+(Math.random()-0.5)*60;d.y=p.y+(Math.random()-0.5)*60;d.id=uid();items.push(d);io.emit('itemDropped',{item:d});p.inventory.push(item);}
      io.emit('itemPickedUp',{itemId:item.id,playerId:socket.id});sendStats(p,socket.id);
    }
    if(data.type==='dropItem'){const ki=p.inventory.findIndex(i=>i.type===data.itemType);if(ki>=0){const d=p.inventory.splice(ki,1)[0];d.x=p.x+(Math.random()-0.5)*60;d.y=p.y+(Math.random()-0.5)*60;d.id=uid();items.push(d);io.emit('itemDropped',{item:d});sendStats(p,socket.id);}}
    if(data.type==='lantern'){p.lanternOn=!p.lanternOn;sendStats(p,socket.id);}
    if(data.type==='puzzleSolve'){const fig=monsters.find(m=>m.type==='figure');if(fig){fig.alive=false;fig.solved=true;p.score+=500;io.emit('figureDefeated');io.emit('floatText',{x:fig.x,y:fig.y,text:'BULMACA ÇÖZÜLDÜ!',color:'#44ff88'});}}
    if(data.type==='shop'){
      const si=shopList.find(i=>i.id===data.itemId);if(!si)return;
      if(p.gold<si.price){socket.emit('msg',{text:'Yeterli altın yok! ('+p.gold+'/'+si.price+'💰)',color:'#ff4444'});return;}
      p.gold-=si.price;
      if(si.type==='bandage')p.health=Math.min(p.maxHealth,p.health+40);
      else if(si.type==='oil'){p.lanternFuel=Math.min(100,p.lanternFuel+50);p.lanternOn=true;}
      else if(si.type==='shield'){p.shielded=true;p.shieldHits=1;}
      else if(si.type==='boots'){p.spd=p.baseSpd*1.9;p.bootsTimer=360;}
      else if(si.type==='key'&&p.inventory.length<3)p.inventory.push({id:uid(),type:'key',label:'Anahtar'});
      io.emit('floatText',{x:p.x,y:p.y-30,text:'SATIN ALINDI: '+si.label,color:'#ffd700'});sendStats(p,socket.id);
    }
    if(data.type==='goBack'){
      if(curRoom>0&&dc>0){
        curRoom--;dc--;
        items=rooms[curRoom].items.map(i=>({...i}));monsters=spawnM(rooms[curRoom]);
        const ey2=rooms[curRoom].ey;
        Object.values(players).filter(p2=>p2.alive).forEach(p2=>{p2.x=(RW-3)*TILE;p2.y=ey2*TILE+TILE/2;});
        rushActive=false;
        io.emit('roomChanged',{room:serRoom(rooms[curRoom]),items,dc,curRoom,rushActive,rushX:0,wentBack:true});
      }else socket.emit('msg',{text:'Daha öteye gidemezsin!',color:'#ff4444'});
    }
  });

  socket.on('ping_c',()=>socket.emit('pong_c'));
  socket.on('disconnect',()=>{
    delete players[socket.id];
    if(!Object.keys(players).length){rooms=[];phase='lobby';monsters=[];items=[];dc=0;curRoom=0;rushActive=false;}
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('DOORS: http://localhost:'+PORT));
