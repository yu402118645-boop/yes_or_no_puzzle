import { createHash } from 'node:crypto';
export class ExtractError extends Error { constructor(code,message){super(message);this.code=code;} }
const denied=()=>new ExtractError('SOURCE_UNAVAILABLE','B 站未允许云端读取该视频。请检查视频是否公开；登录、地区或平台访问限制不会被绕过。');
const mix=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function parseTime(value,optional=false){
 if(optional&&(value===undefined||value===null||value===''))return null;
 if(typeof value==='number'){if(Number.isFinite(value)&&value>=0&&value<=86400)return value;throw new ExtractError('BAD_INPUT','时间不正确');}
 if(typeof value!=='string')throw new ExtractError('BAD_INPUT','请填写起始时间');
 const s=value.trim().replace(/^(\d+)\.(\d{2})$/,'$1:$2');
 if(/^\d+$/.test(s)&&Number(s)<=86400)return Number(s);
 if(!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(s))throw new ExtractError('BAD_INPUT','时间请填写 21:54、01:21:54 或秒数');
 const a=s.split(':').map(Number);if(a.slice(1).some(x=>x>=60))throw new ExtractError('BAD_INPUT','分和秒必须小于 60');
 const result=a.reduce((sum,n)=>sum*60+n,0);if(result>86400)throw new ExtractError('BAD_INPUT','时间过长');return result;
}
export function videoURL(input){
 if(typeof input!=='string'||input.length>2000)throw new ExtractError('BAD_INPUT','请输入 B 站视频链接');
 let u;try{u=new URL(input.trim());}catch{throw new ExtractError('BAD_INPUT','请输入完整的 https 视频链接');}
 if(u.protocol!=='https:'||u.username||u.password||u.port)throw new ExtractError('BAD_INPUT','仅支持 B 站 https 视频链接');
 if(u.hostname==='b23.tv'&&/^\/[A-Za-z0-9]{4,20}\/?$/.test(u.pathname))return {short:u.href};
 if(!['www.bilibili.com','bilibili.com','m.bilibili.com'].includes(u.hostname))throw new ExtractError('BAD_INPUT','仅支持 bilibili.com 或 b23.tv');
 const id=u.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av\d{1,15})\/?$/)?.[1];
 const page=Number(u.searchParams.get('p')||1);if(!id||!Number.isInteger(page)||page<1||page>1000)throw new ExtractError('BAD_INPUT','视频链接或分 P 不正确');
 return {id,page,url:`https://www.bilibili.com/video/${id}/?p=${page}`};
}
export function allowedAsset(url){let u;try{u=new URL(url.startsWith('//')?'https:'+url:url);}catch{throw denied();}if(u.protocol!=='https:'||u.username||u.password||u.port||!['hdslb.com','bilibili.com','bilivideo.com','bilivideo.cn'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw denied();return u.href;}
export async function bytes(res,max){if(!res.ok||!res.body)throw denied();const reader=res.body.getReader(),chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new ExtractError('TOO_LARGE','片段数据过大，请缩短时间段');}chunks.push(value);}const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}return data;}
export class Bilibili {
 constructor(fetcher=(...args)=>fetch(...args)){this.fetcher=fetcher;}
 async fetch(url,options={}){return this.fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Referer:'https://www.bilibili.com/',...options.headers},...options});}
 async json(url,max=2000000){const r=await this.fetch(url);try{return JSON.parse(new TextDecoder().decode(await bytes(r,max)));}catch(e){if(e instanceof ExtractError)throw e;throw denied();}}
 async api(path,params={},signed=false){if(signed){if(!this.key){const nav=await this.json('https://api.bilibili.com/x/web-interface/nav');const w=nav.data?.wbi_img;const lookup=[w?.img_url,w?.sub_url].map(x=>typeof x==='string'?x.split('/').pop().split('.')[0]:'').join('');if(lookup.length!==64)throw denied();this.key=mix.map(i=>lookup[i]).join('').slice(0,32);}
 params={...params,wts:Math.floor(Date.now()/1000)};const q=new URLSearchParams(Object.keys(params).sort().map(k=>[k,String(params[k]).replace(/[!'()*]/g,'')]));q.set('w_rid',createHash('md5').update(q.toString()+this.key).digest('hex'));params=q;}
 const data=await this.json('https://api.bilibili.com'+path+'?'+new URLSearchParams(params));if(data.code!==0)throw denied();return data.data;}
 async info(input){let parsed=videoURL(input);if(parsed.short){const r=await this.fetch(parsed.short);if(![301,302,303,307,308].includes(r.status))throw denied();parsed=videoURL(r.headers.get('Location'));if(parsed.short)throw denied();}
 const params=parsed.id.startsWith('BV')?{bvid:parsed.id}:{aid:parsed.id.slice(2)};
 const data=await this.api('/x/web-interface/view',params);const part=data.pages?.find(p=>p.page===parsed.page);if(!part||!Number.isFinite(part.duration)||data.bvid?.length!==12)throw denied();
 return {bvid:data.bvid,aid:data.aid,cid:part.cid,title:data.title,part:part.part,page:parsed.page,duration:part.duration,url:`https://www.bilibili.com/video/${data.bvid}/?p=${parsed.page}`};}
 async subtitles(info,start,end){
 const player=await this.api('/x/player/wbi/v2',{bvid:info.bvid,cid:info.cid},true);
 if(Number(player.cid)!==Number(info.cid)||Number(player.aid)!==Number(info.aid))throw denied();
 const tracks=(player.subtitle?.subtitles||[]).filter(s=>s.subtitle_url&&/zh|cn/i.test(s.lan||'')).sort((a,b)=>Number(a.lan?.startsWith('ai-'))-Number(b.lan?.startsWith('ai-')));
 for(const track of tracks.slice(0,2)){const data=await this.json(allowedAsset(track.subtitle_url),4000000);const segments=sliceCaptions(data.body,start,end);if(segments.length)return {segments,source:'subtitle',track:track.lan};}
 return null;
 }
 async audio(info){const data=await this.api('/x/player/wbi/playurl',{bvid:info.bvid,cid:info.cid,qn:16,fnval:16,fnver:0,fourk:0},true);const audio=data.dash?.audio?.filter(x=>x.mimeType==='audio/mp4'||x.mime_type==='audio/mp4').sort((a,b)=>a.bandwidth-b.bandwidth)[0];if(!audio)throw new ExtractError('NO_AUDIO','没有可读取的公开音轨；暂不支持这个视频的音频格式');return audio;}
 async range(url,start,end){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>10000000)throw denied();const r=await this.fetch(allowedAsset(url),{headers:{Referer:'https://www.bilibili.com/',Range:`bytes=${start}-${end}`}});if(r.status!==206||!r.headers.get('Content-Range')?.startsWith(`bytes ${start}-${end}/`))throw new ExtractError('NO_RANGE','音轨服务器不支持安全截取，已停止，不会下载整个视频');const result=await bytes(r,end-start+1);if(result.length!==end-start+1)throw denied();return result;}
}
export function sliceCaptions(rows,start,end){if(!Array.isArray(rows))return [];return rows.filter(x=>Number.isFinite(x.from)&&Number.isFinite(x.to)&&x.to>x.from&&x.from>=0&&x.from<end&&x.to>start&&typeof x.content==='string'&&x.content.trim()).map(x=>({start:x.from,end:x.to,text:x.content.trim().slice(0,4000)})).slice(0,3000);}
