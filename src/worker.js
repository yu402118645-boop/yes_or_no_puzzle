import {snapshot,progress,text,body,image,applyJudgment} from './core.js';
import {facts,judge,hint} from './ai.js';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>json({error:message},status);
const token=()=>crypto.randomUUID()+crypto.randomUUID();
export default {async fetch(req,env){
 const u=new URL(req.url);
 try{
 if(u.pathname.startsWith('/api/')&&req.headers.get('Origin')&&req.headers.get('Origin')!==u.origin)return fail('来源无效',403);
 if(u.pathname==='/api/rooms'&&req.method==='POST'){
 if(env.ALLOW_CREATE!=='true')return fail('创建房间暂未开放',503);
 // A single DO holds a small per-IP creation counter; never receives puzzle/solution.
 const limit=env.ROOMS.get(env.ROOMS.idFromName('creation-limit'));
 const gate=await limit.fetch(new Request('https://internal/limit',{method:'POST',body:req.headers.get('CF-Connecting-IP')||'local'}));if(!gate.ok)return fail('创建过于频繁，请稍后重试',429);
 const id=crypto.randomUUID();
 const result=await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request('https://internal/create',{method:'POST',headers:req.headers,body:req.body,duplex:'half'}));
 if(!result.ok)return result;return json({id});
 }
 const match=u.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})(\/join|\/ws|\/image)?$/);
 if(match){const headers=new Headers(req.headers);headers.set('X-Room-ID',match[1]);return await env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(new Request(req,{headers}));}
 if(u.pathname.startsWith('/api/'))return fail('未找到',404);
 const response=await env.ASSETS.fetch(req);const headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});
 }catch{return fail('请求失败，请检查输入或稍后重试');}
}};
export class Room {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.r=null;this.queue=Promise.resolve();ctx.blockConcurrencyWhile(async()=>{const count=await ctx.storage.get('state-count');if(count){const keys=Array.from({length:count},(_,i)=>'state:'+i);const values=await ctx.storage.get(keys);this.r=JSON.parse(keys.map(k=>values.get(k)).join(''));}});}
 async serial(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
 async save(){const data=JSON.stringify(this.r);const entries={};let count=0;for(let at=0;at<data.length;at+=20000)entries['state:'+count++]=data.slice(at,at+20000);entries['state-count']=count;await this.ctx.storage.transaction(async tx=>{await tx.put(entries);});}
 async fetch(req){return this.serial(async()=>{try{return await this.route(req);}catch{return fail('操作失败，请检查输入或稍后重试');}});}
 async route(req){
 const u=new URL(req.url);
 if(u.pathname==='/limit'){
 const ip=await req.text();const key='rate:'+await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)).then(x=>Array.from(new Uint8Array(x),v=>v.toString(16).padStart(2,'0')).join(''));
 const now=Date.now();const day=Math.floor(now/86400000);const total=await this.ctx.storage.get('daily')||{day,count:0};if(total.day!==day){total.day=day;total.count=0;}if(total.count>=Number(this.env.MAX_ROOMS_PER_DAY||10))return fail('每日限额',429);const rates=await this.ctx.storage.get(key)||[];const current=rates.filter(x=>now-x<3600000);if(current.length>=5)return fail('限流',429);total.count++;await this.ctx.storage.put('daily',total);current.push(now);await this.ctx.storage.put(key,current);await this.ctx.storage.setAlarm(now+3600000);return json({ok:true});
 }
 if(u.pathname==='/create'){
 if(this.r)return fail('房间已存在',409);
 const data=await body(req);const puzzle=typeof data.puzzle==='string'?data.puzzle.trim():'';if(puzzle.length>8000)throw Error();
 const pic=image(data.image);if(!puzzle&&!pic)throw Error();const solution=text(data.solution,16000);
 const list=await facts(this.env,solution);
 this.r={puzzle,solution,facts:list,players:[],messages:[],ended:false,aiCalls:1,lastAI:0,lastHint:0,created:Date.now(),expires:Date.now()+7*86400000};
 if(pic){const entries={};for(let at=0;at<pic.bytes.length;at+=64000)entries['img:'+at/64000]=pic.bytes.slice(at,at+64000);await this.ctx.storage.put(entries);this.r.imageType=pic.type;this.r.imageChunks=Math.ceil(pic.bytes.length/64000);}
 await this.save();await this.ctx.storage.setAlarm(this.r.expires);return json({ok:true});
 }
 if(!this.r)return fail('房间不存在或已过期',404);
 if(Date.now()>this.r.expires)return fail('房间已过期',410);
 const tail=u.pathname.split('/').pop();
 if(tail==='join'&&req.method==='POST'){
 const data=await body(req,1000);let p=this.r.players.find(p=>p.token===data.token);
 if(!p){
 if(this.r.players.length>=4)return fail('房间已有 4 位玩家；请使用原浏览器重连',409);
 p={id:crypto.randomUUID(),token:token(),name:`玩家 ${this.r.players.length+1}`,last:0,seen:[]};this.r.players.push(p);await this.save();}
 this.broadcast();return json({token:p.token,id:p.id,name:p.name});
 }
 // Credentials go in headers for HTTP and Sec-WebSocket-Protocol for upgrades, never URLs.
 const credential=req.headers.get('Authorization')?.replace(/^Bearer /,'')||req.headers.get('Sec-WebSocket-Protocol')?.split(',').map(x=>x.trim()).find(x=>x.startsWith('auth.'))?.slice(5);
 const p=this.r.players.find(p=>p.token===credential);if(!p)return fail('请先加入房间',401);
 if(tail==='image'&&req.method==='GET'){
 if(!this.r.imageChunks)return fail('没有图片',404);const keys=Array.from({length:this.r.imageChunks},(_,i)=>'img:'+i);const chunks=await this.ctx.storage.get(keys);return new Response(new Blob(keys.map(k=>chunks.get(k)),{type:this.r.imageType}),{headers:{'Content-Type':this.r.imageType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(tail==='ws'&&req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
 const existing=this.ctx.getWebSockets(p.id);for(const s of existing)s.close(1000,'已在另一页面连接');
 const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1],[p.id]);pair[1].serializeAttachment({id:p.id});pair[1].send(JSON.stringify(this.public()));return new Response(null,{status:101,webSocket:pair[0],headers:{'Sec-WebSocket-Protocol':'soup'}});
 }
 if(req.method==='GET')return json(this.public());return fail('未找到',404);
 }
 async originalImage(){if(!this.r.imageChunks)return null;const keys=Array.from({length:this.r.imageChunks},(_,i)=>'img:'+i);const chunks=await this.ctx.storage.get(keys);let binary='';for(const key of keys)for(const b of chunks.get(key))binary+=String.fromCharCode(b);return `data:${this.r.imageType};base64,${btoa(binary)}`;}
 public(){return {type:'state',...snapshot(this.r),hasImage:!!this.r.imageChunks};}
 broadcast(){const data=JSON.stringify(this.public());for(const s of this.ctx.getWebSockets())try{s.send(data);}catch{}}
 message(kind,name,value){this.r.messages.push({id:crypto.randomUUID(),kind,name,text:value,time:Date.now()});this.r.messages=this.r.messages.slice(-200);}
 async webSocketMessage(ws,raw){return this.serial(async()=>{
 let requestId;try{
 if(typeof raw!=='string'||raw.length>5000)throw Error();const m=JSON.parse(raw);requestId=m.id;const id=ws.deserializeAttachment()?.id;const p=this.r.players.find(x=>x.id===id);if(!p)throw Error();
 if(typeof m.id!=='string'||! /^[\w-]{1,80}$/.test(m.id))throw Error();
 if(p.seen.includes(m.id)){ws.send(JSON.stringify({type:'ack',id:m.id}));return;}
 if(Date.now()-p.last<700)throw Error();p.last=Date.now();
 const allowed=['chat','question','hint','progress','reveal_request','reveal_confirm'];if(!allowed.includes(m.type))throw Error();
 if(this.r.ended&&m.type!=='progress')throw Error();if(Date.now()>this.r.expires)throw Error();
 if(m.type==='chat'){this.message('chat',p.name,text(m.text,1500));}
 if(m.type==='question'){
 const question=text(m.text,1500);if(Date.now()-this.r.lastAI<4000||this.r.aiCalls>=Number(this.env.MAX_AI_CALLS||80))throw Error();
 this.r.aiCalls++;this.r.lastAI=Date.now();p.seen.push(m.id);await this.save();
 const result=await judge(this.env,this.r,question,await this.originalImage());const answer=applyJudgment(this.r,result,question);this.message('question',p.name,question);this.message('answer','AI 汤主',answer);
 }
 if(m.type==='hint'){
 if(Date.now()-this.r.lastHint<60000||Date.now()-this.r.lastAI<4000||this.r.aiCalls>=Number(this.env.MAX_AI_CALLS||80))throw Error();this.r.lastHint=Date.now();this.r.lastAI=Date.now();this.r.aiCalls++;p.seen.push(m.id);await this.save();
 // The model sees public data only and chooses an enum. No free-form generated hint reaches players.
 const selected=await hint(this.env,this.public());const hints={cause:'试着把已经得到的判断连成因果关系，再检查其中仍不确定的一步。',split:'可以把一个大猜想拆成几个单独的判断，逐一向汤主确认。',revisit:'回看汤面中最反常的地方，想想哪些已有判断能解释它。'};
 if(!Object.hasOwn(hints,selected.strategy))throw Error();this.message('hint','AI 汤主',hints[selected.strategy]+` 当前估计还原 ${progress(this.r)}%。`);
 }
 if(m.type==='reveal_request'){
 if(progress(this.r)<90)throw Error();p.reveal={token:token(),expires:Date.now()+30000};await this.save();ws.send(JSON.stringify({type:'confirm_reveal',nonce:p.reveal.token}));
 }
 if(m.type==='reveal_confirm'){
 if(progress(this.r)<90||!p.reveal||p.reveal.expires<Date.now()||p.reveal.token!==m.nonce)throw Error();this.r.ended=true;for(const player of this.r.players)delete player.reveal;
 }
 if(!p.seen.includes(m.id))p.seen.push(m.id);p.seen=p.seen.slice(-100);await this.save();this.broadcast();ws.send(JSON.stringify({type:'ack',id:m.id}));
 }catch{try{ws.send(JSON.stringify({type:'error',id:typeof requestId==='string'?requestId:undefined,message:'操作未完成：请检查输入、连接或稍后重试。提示间隔 60 秒，AI 提问间隔 4 秒。'}));}catch{}}
 });}
 async webSocketClose(ws,code){try{ws.close(code);}catch{}}
 async webSocketError(ws){try{ws.close(1011,'连接异常');}catch{}}
 async alarm(){return this.serial(async()=>{if(!this.r){const entries=await this.ctx.storage.list({prefix:'rate:'});await this.ctx.storage.delete([...entries.keys()]);return;}if(Date.now()>=this.r.expires){for(const s of this.ctx.getWebSockets())s.close(1000,'房间过期');await this.ctx.storage.deleteAll();this.r=null;}});}
}
