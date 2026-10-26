// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
export const INDEX_VERSION=2;
export async function fileHash(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

/** Exact matching after typographic/whitespace normalization, with offsets into source text. */
export function normalizedText(source){
 const chars=[],starts=[],ends=[];let space=false;
 const skipped=new Set();for(const m of source.matchAll(/(?<=[A-Za-z])-\s*\n\s*(?=[A-Za-z])/g))for(let i=m.index;i<m.index+m[0].length;i++)skipped.add(i);
 for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(source)){
  if(skipped.has(part.index))continue;
  for(const c of part.segment.normalize('NFKC').replace(/[\u00ad\u200b\ufeff]/g,'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'")){
   const white=/\s/u.test(c);if(white&&(!chars.length||space))continue;const out=white?' ':c;
   for(let j=0;j<out.length;j++){chars.push(out[j]);starts.push(part.index);ends.push(part.index+part.segment.length);}space=white;
  }
 }
 if(chars.at(-1)===' '){chars.pop();starts.pop();ends.pop();}return {text:chars.join(''),starts,ends};
}
export async function ensureEvidenceIndex(store,id){if(store.stopping)throw new Error('文献服务已停止');const a=store.attachment(id),sha=await fileHash(a.path),index=store.db.prepare('SELECT sha,version FROM pdf_indexes WHERE attachment_id=?').get(id);if(index?.sha!==sha||index?.version!==INDEX_VERSION)await store.index(id);return store.db.prepare('SELECT sha FROM pdf_indexes WHERE attachment_id=?').get(id).sha;}
function scopedAttachment(store,sessionId,{paperId,attachmentId}){const p=store.scopedPaper(sessionId,paperId),a=attachmentId?p.attachments.find(a=>a.id===attachmentId):p.attachments[0];if(!a)throw new Error('此文献没有该本地附件');return {p,a};}
export async function verifyQuote(store,sessionId,args){
 const {p,a}=scopedAttachment(store,sessionId,args),page=args.page;if(!Number.isInteger(page)||page<1)throw new Error('需要 PDF 的物理页码');if(typeof args.quote!=='string'||args.quote.length>4000||args.quote.replace(/\s/g,'').length<8)throw new Error('摘句需包含 8–4000 个字符');
 const sha=await ensureEvidenceIndex(store,a.id),row=store.db.prepare('SELECT text FROM pages WHERE attachment_id=? AND page=?').get(a.id,page),geometry=store.db.prepare('SELECT words_json FROM page_geometry WHERE attachment_id=? AND page=?').get(a.id,page);if(!row||!geometry)throw new Error('页码不存在或该页尚无文字坐标');
 const hay=normalizedText(row.text),needle=normalizedText(args.quote).text,matches=[];if(needle.replace(/\s/g,'').length<8)throw new Error('摘句有效文字过短');let at=hay.text.indexOf(needle);while(at>=0&&matches.length<101){matches.push(at);at=hay.text.indexOf(needle,at+1);}
 if(!matches.length)return {verified:false,reason:'not_found',message:'摘句未在该 PDF 页中找到，请读取原文后重新引用。'};
 if(matches.length>1&&args.occurrence===undefined)return {verified:false,reason:'ambiguous',occurrences:matches.length,candidates:matches.slice(0,10).map((n,i)=>({occurrence:i+1,context:row.text.slice(Math.max(0,hay.starts[n]-60),hay.ends[n+needle.length-1]+60)}))};
 const occurrence=args.occurrence??1;if(!Number.isInteger(occurrence)||occurrence<1||occurrence>matches.length)throw new Error('摘句出现序号无效');const n=matches[occurrence-1],start=hay.starts[n],end=hay.ends[n+needle.length-1],words=JSON.parse(geometry.words_json),rects=words.filter(w=>w[0]<end&&w[1]>start).map(w=>w.slice(2));if(!rects.length)return {verified:false,reason:'no_coordinates',message:'此页没有可用文字坐标，不能生成高亮引用。'};
 const quote=row.text.slice(start,end);let id=store.db.prepare('SELECT id FROM citations WHERE attachment_id=? AND page=? AND start=? AND end=? AND pdf_sha=?').get(a.id,page,start,end,sha)?.id;if(!id){id=randomUUID();store.db.prepare('INSERT INTO citations VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,p.id,a.id,page,start,end,quote,JSON.stringify(rects),sha,new Date().toISOString());}
 const origin=store.citationOrigin?.(),address=origin?origin+'/#dsh-literature-citation-'+id:'dsh-resource://literature/citation/'+id;
 return {verified:true,citationId:id,paperId:p.id,title:p.title,authors:p.authors,year:p.year,citationKey:p.citationKey,attachmentId:a.id,page,quote,occurrence,citation:`[${p.citationKey} · PDF 第 ${page} 页](${address})`};
}
export async function resolveEvidence(store,sessionId,args){
 if(args.citationId){const c=store.db.prepare('SELECT * FROM citations WHERE id=?').get(args.citationId);if(!c)throw new Error('未找到已核验引用');const {p,a}=scopedAttachment(store,sessionId,{paperId:c.paper_id,attachmentId:c.attachment_id});if(await fileHash(a.path)!==c.pdf_sha)throw new Error('PDF 内容已变化，该摘句引用需要重新核验');return {paperId:p.id,title:p.title,attachment:a,page:c.page,quote:c.quote,rects:JSON.parse(c.rects_json),citationId:c.id,pdfSha:c.pdf_sha,verified:true};}
 const {p,a}=scopedAttachment(store,sessionId,args);await ensureEvidenceIndex(store,a.id);if(!Number.isInteger(args.page)||args.page<1||!store.db.prepare('SELECT 1 FROM pages WHERE attachment_id=? AND page=?').get(a.id,args.page))throw new Error('引用页码不存在');return {paperId:p.id,title:p.title,attachment:a,page:args.page,rects:[],verified:false};
}
export async function renderEvidencePage(store,sessionId,args){
 const target=await resolveEvidence(store,sessionId,args),a=target.attachment,sha=await fileHash(a.path);if(target.pdfSha&&target.pdfSha!==sha)throw new Error('PDF 内容已变化，请重新核验');
 const clip=args.clip;if(clip!==undefined&&(!Array.isArray(clip)||clip.length!==4||clip.some(n=>typeof n!=='number'||!Number.isFinite(n))||clip[0]<0||clip[1]<0||clip[2]<=0||clip[3]<=0||clip[0]+clip[2]>1||clip[1]+clip[3]>1))throw new Error('clip 应为页内归一化 [x,y,width,height]');
 const page=await store.runPDF('pdf_page.py',[a.path,String(target.page),'1400',clip?JSON.stringify(clip):'null'],20*1024*1024);if(await fileHash(a.path)!==sha)throw new Error('PDF 在渲染时发生变化，请重新打开');return {...target,attachment:{id:a.id,name:a.name},...page};
}
