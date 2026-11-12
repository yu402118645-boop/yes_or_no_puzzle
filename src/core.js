export const ANSWERS = ['是','否','是也不是','不重要'];
export function progress(r) { return r.facts.length ? Math.floor(100*r.facts.filter(f=>f.found).length/r.facts.length) : 0; }
export function snapshot(r) {
 return {puzzle:r.puzzle,players:r.players.map(p=>({name:p.name,id:p.id})),messages:r.messages,progress:progress(r),ended:r.ended,...(r.ended?{solution:r.solution}:{})};
}
export function text(x,max) { if(typeof x!=='string'||!x.trim()||x.length>max) throw Error('输入为空或过长'); return x.trim(); }
export async function body(req,max=3000000) {
 const reader=req.body?.getReader(); if(!reader) throw Error('缺少内容');
 let size=0; const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('内容过大');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export function image(value) {
 if(!value)return null;
 if(typeof value!=='string'||value.length>2800000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))throw Error('请使用不超过 2 MB 的 PNG、JPEG 或 WebP 原图');
 const [head,data]=value.split(','); const bytes=Uint8Array.from(atob(data),x=>x.charCodeAt(0));
 const valid=head.includes('png')?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:head.includes('jpeg')?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
 if(!valid||bytes.length>2097152)throw Error('图片格式或大小不符合要求');return {type:head.slice(5,head.indexOf(';')),bytes};
}
export function applyJudgment(r,result,question) {
 if(!ANSWERS.includes(result.answer)||!Array.isArray(result.covered))throw Error('AI 响应无效');
 // Coverage is accepted only when the model supplies an exact quote from this question.
 for(const c of result.covered){if(c&&Number.isInteger(c.id)&&typeof c.evidence==='string'&&c.evidence.length>=2&&question.includes(c.evidence)&&r.facts[c.id])r.facts[c.id].found=true;}
 return result.answer;
}
