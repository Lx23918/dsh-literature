// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import {fileHash} from './evidence.js';

export function integer(value,fallback,min,max){value??=fallback;if(!Number.isInteger(value)||value<min||value>max)throw new Error(`参数应为 ${min}–${max} 的整数`);return value;}
const cut=(value,size)=>String(value??'').slice(0,size);
export function focusedIds(store,sid,{paperIds,all=false}={}){
 const allowed=store.scope(sid);
 let ids=paperIds;
 if(ids!==undefined&&(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string')))throw new Error('paperIds 应为文献编号数组');
 if(ids===undefined){const task=!all&&store.db.prepare('SELECT data FROM research_tasks WHERE session_id=?').get(sid);ids=task?JSON.parse(task.data).ids:allowed;}
 ids=[...new Set(ids)];for(const id of ids)if(!allowed.includes(id))throw new Error('文献不在此会话的范围内');
 return ids.filter(id=>!store.paper(id).trashed);
}
export function focus(store,sid,{paperIds,reset=false,label='本次任务'}={}){
 if(!reset&&paperIds===undefined)throw new Error('请提供 paperIds 或 reset=true');
 const ids=focusedIds(store,sid,reset?{all:true}:{paperIds:paperIds??[]});
 if(reset)store.db.prepare('DELETE FROM research_tasks WHERE session_id=?').run(sid);
 else store.db.prepare('INSERT INTO research_tasks VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(sid,JSON.stringify({ids,label:cut(label,160)}),new Date().toISOString());
 return {focused:!reset,papers:ids.length,allowedPapers:store.scope(sid).length};
}
export function catalog(store,sid,args={}){
 const ids=focusedIds(store,sid,args),q=cut(args.query,300).toLowerCase(),limit=integer(args.limit,20,1,50),offset=integer(args.offset,0,0,10000),budget=integer(args.maxChars,10000,2000,24000);
 const papers=ids.map(id=>store.paper(id)).filter(p=>!q||[p.title,p.titleTranslated,p.authors,p.doi,p.citationKey].join(' ').toLowerCase().includes(q)),out=[];
 for(const p of papers.slice(offset,offset+limit)){
  const row={id:p.id,title:cut(p.title,500),authors:cut(p.authors,300),year:p.year,doi:p.doi,citationKey:p.citationKey,attachments:p.attachments.length};
  if(args.details){row.abstract=cut(p.abstract,3000);row.abstractTruncated=p.abstract.length>3000;row.files=p.attachments.map(a=>({id:a.id,name:a.name}));}
  if(JSON.stringify([...out,row]).length>budget){if(!out.length)throw new Error('单条目录详情超出预算，请提高 maxChars 或关闭 details');break;}out.push(row);
 }
 return {papers:out,total:papers.length,nextOffset:offset+out.length<papers.length?offset+out.length:null,allowedPapers:store.scope(sid).length,focusedPapers:ids.length};
}
export async function readWindow(store,sid,args){
 const start=args.start??1,end=args.end??start,offset=integer(args.offset,0,0,1000000),maxChars=integer(args.maxChars,6000,500,20000);
 const value=await store.read(sid,{...args,start,end});let left=maxChars;const pages=[];let next=null;
 for(const row of value.pages){
  const from=row.page===start?offset:0;if(from>row.text.length)throw new Error('文字偏移超出该页长度');
  if(left<=0){next={start:row.page,offset:0};break;}
  const text=row.text.slice(from,from+left);left-=text.length;
  pages.push({...row,text,offset:from,totalChars:row.text.length,truncated:from+text.length<row.text.length});
  if(from+text.length<row.text.length){next={start:row.page,offset:from+text.length};break;}
 }
 return {...value,pages,next,notice:'仅返回请求窗口；需要更多上下文时按 next 继续。'};
}
export function search(store,sid,args){
 const ids=focusedIds(store,sid,args),limit=integer(args.limit,6,1,20),budget=integer(args.maxChars,6000,1000,16000),snippet=integer(args.snippetChars,700,200,1600);
 const terms=args.terms??[args.query];if(!Array.isArray(terms)||!terms.length||terms.length>8||terms.some(t=>typeof t!=='string'||!t.trim()||t.length>200))throw new Error('请输入1–8个检索词，每词不超过200字符');
 const mode=args.mode??'phrase';if(!['phrase','any','all'].includes(mode))throw new Error('mode 应为 phrase、any 或 all');
 if(mode==='phrase'&&terms.length!==1)throw new Error('phrase 模式只接受一个完整短语');
 const totalAttachments=ids.length?store.db.prepare(`SELECT count(*) AS total,sum(EXISTS(SELECT 1 FROM pages WHERE attachment_id=a.id)) AS indexed FROM attachments a WHERE paper_id IN (${ids.map(()=>'?').join(',')})`).get(...ids):{total:0,indexed:0};
 const coverage={papers:ids.length,indexedAttachments:Number(totalAttachments.indexed??0),totalAttachments:totalAttachments.total};
 if(!ids.length)return {hits:[],coverage,mode};
 const useFts=terms.every(t=>t.length>=3),join=mode==='any'?' OR ':' AND ',escaped=terms.map(t=>'"'+t.replaceAll('"','""')+'"');
 const condition=useFts?'pages_fts MATCH ?':terms.map(()=>"instr(lower(f.text),lower(?))>0").join(join),values=useFts?[escaped.join(join)]:terms;
 const rows=store.db.prepare(`SELECT f.attachment_id,f.page,f.text,a.paper_id FROM ${useFts?'pages_fts':'pages'} f JOIN attachments a ON a.id=f.attachment_id JOIN papers p ON p.id=a.paper_id WHERE (${condition}) AND p.trashed=0 AND a.paper_id IN (${ids.map(()=>'?').join(',')}) ORDER BY ${useFts?'bm25(pages_fts),':''}a.paper_id,f.page LIMIT ?`).all(...values,...ids,limit+1);
 const hits=[];let size=0;
 for(const r of rows.slice(0,limit)){
  const positions=terms.map(t=>r.text.toLowerCase().indexOf(t.toLowerCase())).filter(n=>n>=0),at=positions.length?Math.min(...positions):0,offset=Math.max(0,at-160),paper=store.paper(r.paper_id);
  const hit={paperId:r.paper_id,attachmentId:r.attachment_id,page:Number(r.page),title:cut(paper.title,500),offset,text:r.text.slice(offset,offset+snippet)};
  const n=JSON.stringify(hit).length;if(size+n>budget)break;hits.push(hit);size+=n;
 }
 return {hits,coverage,mode,truncated:hits.length<rows.length,notice:'关键词检索；结果只是候选证据，需检查论断支持程度。'};
}
export const compactProof=p=>p.verified?{verified:true,citationId:p.citationId,paperId:p.paperId,page:p.page,quote:p.quote,citation:p.citation}:p;
export async function verifyBatch(store,sid,{quotes}){
 if(!Array.isArray(quotes)||!quotes.length||quotes.length>12)throw new Error('每批需要1–12条摘句');
 if(quotes.reduce((n,q)=>n+String(q.quote??'').length,0)>12000)throw new Error('每批摘句总长不超过12000字符');
 for(const q of quotes){const p=store.scopedPaper(sid,q.paperId);if(q.attachmentId&&!p.attachments.some(a=>a.id===q.attachmentId))throw new Error('附件不在所选文献内');}
 const results=[];for(const [index,q]of quotes.entries()){try{results.push({index,...compactProof(await store.verifyQuote(sid,q))});}catch(error){results.push({index,verified:false,reason:'invalid',message:error.message});}}
 return {results};
}
export async function savedEvidence(store,sid,args={}){
 const ids=focusedIds(store,sid,args),limit=integer(args.limit,6,1,12),offset=integer(args.offset,0,0,100000),q=cut(args.query,200),budget=integer(args.maxChars,8000,2000,20000);
 if(!ids.length)return {citations:[],nextOffset:null};
 const rows=store.db.prepare(`SELECT * FROM citations WHERE paper_id IN (${ids.map(()=>'?').join(',')}) AND instr(lower(quote),lower(?))>0 ORDER BY created DESC,id LIMIT ? OFFSET ?`).all(...ids,q,limit+1,offset);
 const hashes=new Map(),citations=[];let stale=0,scanned=0,size=0;
 for(const c of rows.slice(0,limit)){
  if(!hashes.has(c.attachment_id)){const a=store.attachment(c.attachment_id);try{hashes.set(c.attachment_id,await fileHash(a.path));}catch{hashes.set(c.attachment_id,null);}}
  if(hashes.get(c.attachment_id)!==c.pdf_sha){stale++;scanned++;continue;}
  const proof={verified:true,citationId:c.id,paperId:c.paper_id,page:c.page,quote:c.quote,citation:`[${store.paper(c.paper_id).citationKey} · PDF 第 ${c.page} 页](${store.citationOrigin?.()?store.citationOrigin()+'/#dsh-literature-citation-':'dsh-resource://literature/citation/'}${c.id})`};
  const n=JSON.stringify(proof).length;if(size+n>budget){if(!scanned)throw new Error('单条证据超出预算，请提高 maxChars');break;}size+=n;scanned++;citations.push(proof);
 }
 return {citations,stale,nextOffset:scanned<rows.length?offset+scanned:null,notice:'核验仅证明原句存在；支持性判断仍须结合上下文。'};
}
