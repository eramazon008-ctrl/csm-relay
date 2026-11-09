// CSM relay: internetdagi xona serveri. Ishga tushirish: node relay.js
// Koyeb/Render uchun: Start command = node relay.js   (PORT muhit oʻzgaruvchisidan olinadi)
const http=require('http'),crypto=require('crypto');
const PORT=process.env.PORT||8080;
const LIM=30;
const rooms=new Map();
let gid=1;
const newId=()=>{let id;do{id=String(100000+Math.floor(Math.random()*900000))}while(rooms.has(id));return id};
const fmt=id=>id.slice(0,3)+'.'+id.slice(3);
const valid=(a,b)=>Number.isInteger(a)&&Number.isInteger(b)&&a>=1&&a<=5&&b>=1&&b<=5;
const cnt=(r,t)=>{let n=0;for(const x of r.players.values())if(x.team===t)n++;return n};
const cap=(r,t)=>t?r.cfg.b:r.cfg.a;
const cfgOut=r=>({a:r.cfg.a,b:r.cfg.b,lim:LIM});

function enc(s){const b=Buffer.from(s),n=b.length;let h;if(n<126)h=Buffer.from([0x81,n]);else if(n<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(n,2)}else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(n),2)}return Buffer.concat([h,b])}
function parse(c){const out=[];while(c.buf.length>=2){const b=c.buf,op=b[0]&15;let n=b[1]&127,o=2;
 if(n==126){if(b.length<4)break;n=b.readUInt16BE(2);o=4}else if(n==127){if(b.length<10)break;n=Number(b.readBigUInt64BE(2));o=10}
 const m=(b[1]&128)?4:0;if(b.length<o+m+n)break;const k=b.slice(o,o+m),d=Buffer.from(b.slice(o+m,o+m+n));if(m)for(let i=0;i<n;i++)d[i]^=k[i&3];c.buf=b.slice(o+m+n);out.push([op,d])}return out}
const sendTo=(c,o)=>{if(!c.sock.destroyed)c.sock.write(enc(JSON.stringify(o)))};
const all=(r,o,ex)=>{for(const c of r.players.values())if(c!==ex)sendTo(c,o)};
const allIn=(r,o)=>{for(const c of r.players.values())sendTo(c,o)};
const bad=(c,why)=>{sendTo(c,{t:'x',why});c.sock.end()};

function handleJoin(c,m){
 const name=String(m.name||'Oyinchi').slice(0,14);
 let r;
 if(m.create){
  r={id:newId(),cfg:{a:1,b:1},sc:[0,0],players:new Map(),owner:null};
  const a=+m.a,b=+m.b;if(valid(a,b))r.cfg={a,b};
  rooms.set(r.id,r);console.log('YANGI XONA ID: '+fmt(r.id));
 }else{
  r=rooms.get(String(m.rid||'').replace(/\D/g,''));
  if(!r)return bad(c,'bad');
 }
 const want=(m.team===0||m.team===1)?m.team:-1;
 if(want>=0&&cnt(r,want)>=cap(r,want))return bad(c,'full');
 const free=[0,1].filter(x=>cnt(r,x)<cap(r,x)).sort((x,y)=>cnt(r,x)/cap(r,x)-cnt(r,y)/cap(r,y));
 const team=want>=0?want:(free.length?free[0]:-1);
 if(team<0)return bad(c,'full');
 if(m.create)r.owner=c;
 c.room=r;c.team=team;c.id=gid++;c.name=name;c.dead=false;r.players.set(c.id,c);
 sendTo(c,{t:'w',id:c.id,team,map:'jj',sc:r.sc,rid:r.id,cfg:cfgOut(r),ps:[...r.players.values()].filter(x=>x!==c).map(x=>({id:x.id,name:x.name,team:x.team}))});
 all(r,{t:'j',id:c.id,name:c.name,team},c);
 console.log(name+' qoshildi ('+fmt(r.id)+', '+(team?'Qizil':'Koʻk')+'). Oyinchilar: '+r.players.size);
}

function onMsg(c,m){
 if(m.t==='p')return;
 if(!c.room){if(m.t==='join')handleJoin(c,m);return}
 const r=c.room;
 if(m.t==='s'){if(!m.d)c.dead=false;m.id=c.id;all(r,m,c)}
 else if(m.t==='f'){m.id=c.id;all(r,m,c)}
 else if(m.t==='n'){c.name=String(m.name||'Oyinchi').slice(0,14);all(r,{t:'n',id:c.id,name:c.name},c)}
 else if(m.t==='h'){const to=r.players.get(m.to);if(to&&to.team!=c.team&&!c.dead&&!to.dead)sendTo(to,{t:'d',from:c.id,dm:Math.min(+m.dm||0,300),wn:String(m.wn||'')})}
 else if(m.t==='k'){
  if(c.dead)return;c.dead=true;const by=r.players.get(m.by);
  if(by&&by.team!=c.team)r.sc[by.team]++;
  allIn(r,{t:'k',by:by?by.id:0,v:c.id,wn:String(m.wn||''),sc:r.sc});
  if(r.sc[0]>=LIM||r.sc[1]>=LIM){const win=r.sc[0]>=LIM?0:1;allIn(r,{t:'e',win});r.sc=[0,0];for(const x of r.players.values())x.dead=false;allIn(r,{t:'rs'})}
 }
 else if(m.t==='team'){
  const t=m.team?1:0;if(t==c.team)return;
  if(cnt(r,t)>=cap(r,t)){sendTo(c,{t:'tr'});return}
  c.team=t;c.dead=false;allIn(r,{t:'tm',id:c.id,team:t,sc:r.sc});
 }
 else if(m.t==='rs'){r.sc=[0,0];for(const x of r.players.values())x.dead=false;allIn(r,{t:'rs'})}
 else if(m.t==='cfg'){
  if(c!==r.owner)return;
  const a=+m.a,b=+m.b;
  if(!valid(a,b)||cnt(r,0)>a||cnt(r,1)>b){sendTo(c,{t:'x',why:'small'});return}
  r.cfg={a,b};r.sc=[0,0];for(const x of r.players.values())x.dead=false;
  allIn(r,{t:'cfg',cfg:cfgOut(r)});allIn(r,{t:'rs'});
 }
}

function upgrade(q,sock){
 if(q.url.split('?')[0]!=='/ws'||!q.headers['sec-websocket-key']){sock.destroy();return}
 sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
 const c={sock,buf:Buffer.alloc(0),room:null,team:0,id:0,name:'',dead:false};
 sock.setNoDelay&&sock.setNoDelay(true);
 sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);for(const[op,p]of parse(c)){
  if(op==8){sock.end();return}
  if(op==9){sock.write(Buffer.concat([Buffer.from([0x8a,p.length]),p]));continue}
  if(op==1){try{onMsg(c,JSON.parse(p.toString()))}catch(e){}}}});
 const bye=()=>{if(c.room){const r=c.room;c.room=null;r.players.delete(c.id);allIn(r,{t:'l',id:c.id});console.log(c.name+' chiqdi. Oyinchilar: '+r.players.size);if(r.players.size===0){rooms.delete(r.id);console.log('Xona yopildi: '+fmt(r.id))}}};
 sock.on('close',bye);sock.on('error',bye);
}

const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});r.end('CSM relay ishlayapti. Xonalar: '+rooms.size)});
srv.on('upgrade',upgrade);
srv.on('error',e=>console.log('Xato: '+e.message));
srv.listen(PORT,'0.0.0.0',()=>console.log('CSM relay ishga tushdi. Port: '+PORT));
