import {Bilibili,ExtractError,parseTime,videoURL} from './bilibili.js';
import {rangeSpec,indexSegments,selectSegments,normalizeFragment,concat,base64} from './mp4.js';
import {body} from './core.js';
// Retain the old namespace and class for non-destructive migrations. No game route is exposed.
export {Room} from './worker.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const friendly=error=>error instanceof ExtractError?{code:error.code,error:error.message}:{code:'UNAVAILABLE',error:'暂时无法完成提取，请稍后重试；没有生成或猜测汤底。'};
export default {async fetch(req,env){const u=new URL(req.url);try{
 if(u.pathname.startsWith('/api/')){
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==u.origin)return json({error:'请求来源无效'},403);
 if(u.pathname==='/api/extract'&&req.method==='POST'){
 const input=await body(req,4000);videoURL(input.url);const start=parseTime(input.start),end=parseTime(input.end,true);if(end!==null&&end<=start)throw new ExtractError('BAD_INPUT','结束时间必须晚于开始时间');
 const gate=env.EXTRACTIONS.get(env.EXTRACTIONS.idFromName('quota'));const rate=await gate.fetch(new Request('https://internal/rate',{method:'POST',body:req.headers.get('CF-Connecting-IP')||'unknown'}));if(!rate.ok)return rate;
 const id=crypto.randomUUID(),secret=crypto.randomUUID()+crypto.randomUUID();const result=await env.EXTRACTIONS.get(env.EXTRACTIONS.idFromName(id)).fetch(new Request('https://internal/start',{method:'POST',body:JSON.stringify({url:input.url,start,end,secret})}));if(!result.ok)return result;return json({id,token:secret},202);
 }
 const match=u.pathname.match(/^\/api\/extract\/([a-f0-9-]{36})$/);if(match&&req.method==='GET'){const headers=new Headers();headers.set('Authorization',req.headers.get('Authorization')||'');return env.EXTRACTIONS.get(env.EXTRACTIONS.idFromName(match[1])).fetch(new Request('https://internal/status',{headers}));}
 return json({error:'接口不存在'},404);
 }
 const response=await env.ASSETS.fetch(req),headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});
 }catch(e){return json(friendly(e),400);}}};
export class Extraction {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.job=null;ctx.blockConcurrencyWhile(async()=>{const count=await ctx.storage.get('job-count');if(count){const keys=Array.from({length:count},(_,i)=>'job:'+i),chunks=await ctx.storage.get(keys);this.job=JSON.parse(keys.map(k=>chunks.get(k)).join(''));}});}
 async fetch(req){const u=new URL(req.url);try{
 if(u.pathname==='/rate')return this.ctx.blockConcurrencyWhile(async()=>{const now=Date.now(),ip=await req.text(),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)).then(b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join(''));const key='ip:'+hash,old=await this.ctx.storage.get(key)||{at:now,n:0};if(now-old.at>3600000){old.at=now;old.n=0;}if(old.n>=5)return json({error:'每小时最多提取 5 次，请稍后再试'},429);old.n++;await this.ctx.storage.put(key,old);await this.ctx.storage.setAlarm(now+3600000);return json({ok:true});});
 if(u.pathname==='/reserve')return this.ctx.blockConcurrencyWhile(async()=>{const {seconds}=await req.json();if(!Number.isFinite(seconds)||seconds<=0||seconds>1830)throw Error();const day=Math.floor(Date.now()/86400000);const quota=await this.ctx.storage.get('quota')||{day,seconds:0};if(quota.day!==day){quota.day=day;quota.seconds=0;}if(quota.seconds+seconds>5400)return json({error:'今日免费音频处理限额已用完，请明天重试'},429);quota.seconds+=seconds;await this.ctx.storage.put('quota',quota);return json({ok:true});});
 if(u.pathname==='/start'&&req.method==='POST')return this.ctx.blockConcurrencyWhile(async()=>{if(this.job)return json({error:'任务已存在'},409);const input=await req.json();this.job={...input,status:'pending',stage:'正在读取视频信息',created:Date.now(),expires:Date.now()+3600000};await this.save();await this.ctx.storage.setAlarm(Date.now()+100);return json({ok:true},202);});
 if(u.pathname==='/status'){if(!this.job||this.job.expires<Date.now())return json({error:'任务不存在或已过期'},404);if(req.headers.get('Authorization')!=='Bearer '+this.job.secret)return json({error:'没有访问权限'},401);const {status,stage,result,error,code}=this.job;return json({status,stage,...(result?{result}:{}),...(error?{error,code}:{})});}
 return json({error:'未找到'},404);
 }catch(e){return json(friendly(e),400);}}
 async save(){const value=JSON.stringify(this.job),entries={};let count=0;for(let i=0;i<value.length;i+=20000)entries['job:'+count++]=value.slice(i,i+20000);entries['job-count']=count;await this.ctx.storage.transaction(async tx=>{await tx.put(entries);});}
 async update(fields){Object.assign(this.job,fields);await this.save();}
 async alarm(){
 if(!this.job){const entries=await this.ctx.storage.list({prefix:'ip:'});const expired=[...entries].filter(([,v])=>Date.now()-v.at>=3600000).map(([k])=>k);if(expired.length)await this.ctx.storage.delete(expired);if(entries.size>expired.length)await this.ctx.storage.setAlarm(Date.now()+3600000);return;}
 if(this.job.expires<Date.now()){await this.ctx.storage.deleteAll();this.job=null;return;}
 if(['done','failed'].includes(this.job.status)){await this.ctx.storage.setAlarm(this.job.expires);return;}
 // Never retry an interrupted transcription automatically, to avoid duplicate quota use.
 if(this.job.status==='processing'){await this.update({status:'failed',stage:'处理已中断',error:'处理被中断，请重新提交；不会自动重复消耗转写额度。'});await this.ctx.storage.setAlarm(this.job.expires);return;}
 try{
 await this.update({status:'processing'});const api=new Bilibili();const info=await api.info(this.job.url);const end=this.job.end??info.duration;
 if(this.job.start>=end||end>info.duration+0.1)throw new ExtractError('BAD_RANGE',`视频分 P 时长为 ${Math.floor(info.duration/60)}:${String(info.duration%60).padStart(2,'0')}，请检查起止时间`);
 if(end-this.job.start>1800)throw new ExtractError('RANGE_TOO_LONG','单次最多提取 30 分钟，请填写结束时间分段提取');
 await this.update({stage:'正在检查时间段内的公开字幕',info,start:this.job.start,end});
 let captions;try{captions=await api.subtitles(info,this.job.start,end);}catch(e){if(e.code==='SOURCE_UNAVAILABLE')throw e;captions=null;}
 if(captions){await this.complete(info,end,captions.segments,'subtitle','已按时间筛选视频字幕。边界处保留整句；文字不经过 AI 改写，可能含视频原有口误。');return;}
 if(!this.env.AI)throw new ExtractError('NO_TRANSCRIPTION','没有可读取的字幕，且云端语音转写尚未启用');
 await this.update({stage:'没有公开字幕，正在读取所选音频片段'});
 const audio=await api.audio(info),url=audio.baseUrl||audio.base_url,segment=audio.SegmentBase||audio.segment_base;
 const initRange=rangeSpec(segment?.Initialization||segment?.initialization),idxRange=rangeSpec(segment?.indexRange||segment?.index_range);
 const index=indexSegments(await api.range(url,...idxRange),idxRange[0]),selected=selectSegments(index,this.job.start,end);
 const reservation=await this.env.EXTRACTIONS.get(this.env.EXTRACTIONS.idFromName('quota')).fetch(new Request('https://internal/reserve',{method:'POST',body:JSON.stringify({seconds:selected.at(-1).end-selected[0].start})}));if(!reservation.ok)throw new ExtractError('DAILY_LIMIT','今日免费音频处理限额已用完，请明天重试');
 const init=await api.range(url,...initRange);const segments=[];let group=[],seconds=0;
 const groups=[];for(const s of selected){if(group.length&&seconds+s.end-s.start>240){groups.push(group);group=[];seconds=0;}group.push(s);seconds+=s.end-s.start;}if(group.length)groups.push(group);
 for(let i=0;i<groups.length;i++){
 const g=groups[i];await this.update({stage:`正在转写第 ${i+1} / ${groups.length} 段音频`});
 const media=await api.range(url,g[0].byteStart,g.at(-1).byteEnd),data=concat([init,normalizeFragment(media,g[0].tick)]);
 const output=await this.env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:base64(data),language:'zh',task:'transcribe',condition_on_previous_text:false});
 if(!Array.isArray(output.segments)||!output.segments.length)throw new ExtractError('NO_SPEECH','没有获得带时间标记的有效语音，未采用无法定位的转写结果');
 for(const s of output.segments){if(typeof s.text!=='string'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start||s.start<0||s.end>g.at(-1).end-g[0].start+5||s.no_speech_prob>0.8||s.avg_logprob < -1.2)continue;const start=g[0].start+s.start,stop=g[0].start+s.end;if(start<end&&stop>this.job.start)segments.push({start,end:stop,text:s.text.trim().slice(0,4000)});}
 }
 if(!segments.length)throw new ExtractError('NO_SPEECH','所选片段未识别到足够可信的语音');
 await this.complete(info,end,segments,'audio','根据所选音轨进行语音转写，可能有错字或漏字。边界处保留整句，结果是片段原文，不保证包含完整汤底。');
 }catch(e){await this.update({status:'failed',stage:'未能完成提取',...friendly(e)});}
 await this.ctx.storage.setAlarm(this.job.expires);
 }
 async complete(info,end,segments,source,note){const text=segments.map(s=>s.text).join('\n');if(text.length>50000)throw new ExtractError('TOO_LARGE','提取文字过长，请缩短时间段');await this.update({status:'done',stage:'提取完成',result:{title:info.title,part:info.part,url:info.url,start:this.job.start,end,source,text,segments,note}});await this.ctx.storage.setAlarm(this.job.expires);}
}
