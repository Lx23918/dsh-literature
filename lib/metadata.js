// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../assets/pdf_metadata.py',import.meta.url));
const tidy=s=>String(s??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export const titleKey=s=>tidy(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function similarity(a,b){const aa=titleKey(a),bb=titleKey(b);if(aa===bb&&aa)return 1;const at=new Set(aa.split(' ').filter(Boolean)),bt=new Set(bb.split(' ').filter(Boolean));if(!at.size||!bt.size)return 0;return 2*[...at].filter(t=>bt.has(t)).length/(at.size+bt.size);}
export function probePDF(python,file){return new Promise((resolve,reject)=>{const p=spawn(python,[script,file],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='',settled=false;const done=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(v);};const timer=setTimeout(()=>{p.kill();done(new Error('PDF 首页识别超时'));},30000);p.stdout.setEncoding('utf8');p.stdout.on('data',s=>{out+=s;if(out.length>300000){p.kill();done(new Error('首页内容超出限制'));}});p.stderr.on('data',s=>err=(err+s).slice(-1000));p.on('error',e=>done(e));p.on('exit',code=>{if(code)return done(new Error(err||'PDF 无法解析'));try{done(null,JSON.parse(out));}catch(e){done(e);}});});}
export class MetadataManager {
 constructor(store,{lookup,onRecognized}={}){this.store=store;this.lookup=lookup;this.onRecognized=onRecognized;this.queue=[];this.queued=new Set();this.running=false;this.closed=false;this.status={total:0,done:0,matched:0,review:0,failed:0,current:'',running:false};}
 stop(){this.closed=true;}
 enqueue(ids){if(this.closed)throw new Error('识别服务已停止');if(!Array.isArray(ids)||ids.length>10000)throw new Error('文献范围无效');if(!this.running&&!this.queue.length)this.status={total:0,done:0,matched:0,review:0,failed:0,current:'',running:false};for(const id of ids){const p=this.store.paper(id);if(p.trashed||this.queued.has(id))continue;this.queued.add(id);this.queue.push(id);this.status.total++;}if(!this.running)this.run().catch(()=>{});return {...this.status};}
 async run(){this.running=true;this.status.running=true;while(this.queue.length&&!this.closed){const id=this.queue.shift();try{const p=this.store.paper(id);this.status.current=p.title;const r=await this.recognize(id);this.status[r.status==='matched'?'matched':r.status==='review'?'review':'failed']++;if(this.onRecognized)try{await this.onRecognized(this.store.paper(id));}catch{}}catch(e){this.status.failed++;try{this.store.recordMetadataFailure(id,e.message);}catch{}}finally{this.status.done++;this.queued.delete(id);}}this.running=false;this.status.running=false;this.status.current='';}
 async recognize(id){
  const original=this.store.paper(id);if(!original.attachments.length){this.store.recordMetadataFailure(id,'没有本地 PDF');return {status:'failed'};}
  const hash=this.store.attachment(original.attachments[0].id).sha;const duplicate=this.store.db.prepare('SELECT paper_id FROM attachments WHERE sha=? AND paper_id<>?').all(hash,id).map(r=>this.store.paper(r.paper_id)).find(p=>!p.trashed&&p.metadata?.status==='matched');
  if(duplicate){this.store.applyMetadata(id,duplicate,{...duplicate.metadata,source:duplicate.metadata.source+'（相同 PDF）',identifiedAt:new Date().toISOString(),originalTitle:original.title,attachmentId:original.attachments[0].id});return {status:'matched'};}
  const hint=await probePDF(this.store.python,original.attachments[0].path);
  const match=this.lookup?await this.lookup(original,hint):null;
  if(match){this.store.applyMetadata(id,match.paper,{...match.evidence,status:'matched',identifiedAt:new Date().toISOString(),originalTitle:original.title,attachmentId:original.attachments[0].id});return {status:'matched'};}
  if(hint.title){this.store.applyMetadata(id,{title:hint.title,authors:hint.authors,year:hint.year,journal:hint.journal,arxivId:hint.arxivIds[0]??''},{status:'review',source:hint.titleOrigin==='pdf-metadata'?'PDF metadata':'PDF front matter',confidence:hint.titleOrigin==='pdf-metadata'?.8:.55,identifiedAt:new Date().toISOString(),originalTitle:original.title,attachmentId:original.attachments[0].id,message:'已从本地 PDF 提取信息；尚未通过公开数据库核验。'});return {status:'review'};}
  this.store.recordMetadataFailure(id,'未找到可靠的 PDF 标题；可手动编辑或开启已授权的元数据源。');return {status:'failed'};
 }
}
