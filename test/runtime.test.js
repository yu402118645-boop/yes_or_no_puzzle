import test from 'node:test';import assert from 'node:assert/strict';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';import {build} from 'esbuild';
test('real workerd: create, join four, upgrade hibernating WS, broadcast, reconnect and image',async()=>{
 const bundled=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022'});
 const calls=[];const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"test",modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-11-12',durableObjects:{ROOMS:{className:'Room',useSQLite:true}},bindings:{ALLOW_CREATE:'true',OPENAI_API_KEY:'mock',AI_MODEL:'gpt-6.1-sol',MAX_AI_CALLS:'80'},outboundService:async req=>{const input=await req.json();calls.push(input);const value=input.text.format.schema.properties.facts?{facts:['秘密1','秘密2','秘密3','秘密4','秘密5']}:{answer:'是',covered:Array.from({length:5},(_,id)=>({id,evidence:'判断'+id}))};return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}));}}]}));
 const sockets=[];try{
 const pic='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const created=await mf.dispatchFetch('https://test/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({puzzle:'测试谜题',image:pic,solution:'PRIVATE_TEST_STORY'})});assert.equal(created.status,200);const {id}=await created.json();assert(id);
 const path=`https://test/api/rooms/${id}`;const players=[];for(let i=0;i<4;i++){const r=await mf.dispatchFetch(path+'/join',{method:'POST',body:'{}'});assert.equal(r.status,200);players.push(await r.json());}assert.equal((await mf.dispatchFetch(path+'/join',{method:'POST',body:'{}'})).status,409);
 const a=await mf.dispatchFetch(path+'/ws',{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':'soup, auth.'+players[0].token}});assert.equal(a.status,101);const ws=a.webSocket;ws.accept();sockets.push(ws);
 const b=await mf.dispatchFetch(path+'/ws',{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':'soup, auth.'+players[1].token}});assert.equal(b.status,101);const ws2=b.webSocket;ws2.accept();sockets.push(ws2);
 const observed=[];ws2.addEventListener('message',e=>observed.push(JSON.parse(e.data)));
 const update=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Broadcast timed out')),5000);ws2.addEventListener('message',e=>{const s=JSON.parse(e.data);if(s.messages?.some(m=>m.text==='大家好')){clearTimeout(timer);resolve(s);}});});
 ws.send(JSON.stringify({id:'runtime-message',type:'chat',text:'大家好'}));const state=await update;assert.equal(state.messages[0].text,'大家好');assert(!JSON.stringify(state).includes('PRIVATE_TEST_STORY'));assert(!JSON.stringify(state).includes('秘密'));
 const img=await mf.dispatchFetch(path+'/image',{headers:{Authorization:'Bearer '+players[0].token}});assert.equal(img.status,200);assert.equal(Buffer.from(await img.arrayBuffer()).toString('base64'),pic.split(',')[1]);
 const back=await mf.dispatchFetch(path+'/join',{method:'POST',body:JSON.stringify({token:players[0].token})});assert.equal((await back.json()).id,players[0].id);assert.equal(calls.length,1);
 await new Promise(resolve=>setTimeout(resolve,750));
 const answered=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('AI answer timed out')),5000);ws.addEventListener('message',e=>{const s=JSON.parse(e.data);if(s.type==='state'&&s.progress===100){clearTimeout(timer);resolve(s);}});});ws.send(JSON.stringify({id:'ask',type:'question',text:'判断0判断1判断2判断3判断4'}));const answer=await answered;assert.equal(answer.messages.at(-1).text,'是');assert(!JSON.stringify(answer).includes('PRIVATE_TEST_STORY'));assert.equal(calls.length,2);
 assert.equal((await mf.dispatchFetch(path)).status,401);
 }finally{for(const ws of sockets)ws.close();await mf.dispose();}
});
