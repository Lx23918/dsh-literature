// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import path from 'node:path';
import {focus,integer} from './retrieval.js';

const uncomment=text=>text.replace(/(?<!\\)%[^\n]*/g,m=>' '.repeat(m.length));
const plain=text=>String(text??'').normalize('NFKC').replace(/\\[a-zA-Z]+/g,'').replace(/[{}]/g,'').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
export function citationKeys(text){return [...new Set([...uncomment(text).matchAll(/\\(?:cite\w*|[a-z]*cite\w*)\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]+)\}/g)].flatMap(m=>m[1].split(',').map(k=>k.trim()).filter(k=>k&&k!=='*')))];}

export function bibliographyEntries(text){
 const entries=new Map();
 for(const found of text.matchAll(/@(?!comment\b|string\b|preamble\b)[a-z]+\s*\{\s*([^,\s]+)\s*,/gi)){
  let at=found.index+found[0].length,depth=1,end=at,quoted=false;
  for(;end<text.length&&depth;end++){const c=text[end];if(c==='\\'){end++;continue;}if(c==='"'&&depth===1)quoted=!quoted;if(!quoted){if(c==='{')depth++;if(c==='}')depth--;}}
  const body=text.slice(at,end-1),fields={};
  for(let i=0;i<body.length;){const match=/^\s*,?\s*([\w-]+)\s*=\s*/.exec(body.slice(i));if(!match){i++;continue;}i+=match[0].length;const key=match[1].toLowerCase();let value='';
   if(body[i]==='{'){let n=1;i++;const start=i;for(;i<body.length&&n;i++){if(body[i]==='\\'){i++;continue;}if(body[i]==='{')n++;if(body[i]==='}')n--;}value=body.slice(start,i-1);}
   else if(body[i]==='"'){i++;const start=i;while(i<body.length&&body[i]!=='"'){if(body[i]==='\\')i++;i++;}value=body.slice(start,i++);}
   else{const start=i;while(i<body.length&&body[i]!==',')i++;value=body.slice(start,i).trim();}
   fields[key]=value;
  }
  entries.set(found[1],fields);
 }
 return entries;
}

export function matchCitations(keys,bib,papers){
 return keys.map(key=>{
  const entry=bib.get(key),doi=(entry?.doi??'').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();
  let candidates=doi?papers.filter(p=>p.doi.toLowerCase()===doi):[],method='doi';
  const compatible=p=>!doi||!p.doi||p.doi.toLowerCase()===doi;
  if(!candidates.length&&entry?.title){const title=plain(entry.title);if(title)candidates=papers.filter(p=>compatible(p)&&plain(p.title)===title);method='title';}
  if(!candidates.length){candidates=papers.filter(p=>compatible(p)&&p.citationKey===key&&(!entry?.title||plain(p.title)===plain(entry.title)));method='citation-key';}
  return candidates.length===1?{key,paperId:candidates[0].id,title:candidates[0].title.slice(0,400),method,...!entry?{bibEntryMissing:true}:{}}:{key,title:(entry?.title??'').slice(0,400),status:candidates.length?'ambiguous':entry?'unmatched':'missing-bib-entry',...candidates.length?{candidateCount:candidates.length,candidates:candidates.slice(0,5).map(p=>({paperId:p.id,title:p.title.slice(0,300),year:p.year}))}:{}};
 });
}

export async function prepareReview(ctx,store,sid,args,exec){
 if(typeof args.filePath!=='string'||!args.filePath.trim())throw new Error('请提供 LaTeX 稿件路径');
 if(path.extname(args.filePath).toLowerCase()!=='.tex')throw new Error('章节规划需要 .tex 源文件；其他格式使用宿主解析工具');
 const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal),warnings=[],files=new Map();let total=0;
 async function read(file,cwd,base){
  exec.signal?.throwIfAborted();const target=await ctx.fs.resolve(file,{cwd,signal:exec.signal}),canonical=ctx.fs.processPath(target);
  if(base){const rel=path.relative(base,canonical);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)){warnings.push('未自动读取项目外的包含文件：'+file);return null;}}
  const stat=await ctx.fs.stat(target,exec.signal);if(!stat||stat.type!=='file')throw new Error('稿件文件不存在或不是普通文件：'+file);
  if(stat.size>2*1024*1024)throw new Error('单个文本源文件不超过2 MiB');
  const text=await ctx.fs.readText(target,exec.signal);total+=text.length;if(total>2*1024*1024)throw new Error('本次源文件总量超过2 MiB');
  ctx.emit('fs/observed',target,{kind:'present',version:stat.version},exec);return {file:canonical,text};
 }
 const entry=await read(args.filePath,cwd),base=path.dirname(entry.file),lines=[];
 async function expand(source,depth=0){
  if(files.has(source.file))return;if(depth>8||files.size>=20)throw new Error('包含文件超过20个或嵌套超过8层');files.set(source.file,source.text);
  for(const [i,line]of uncomment(source.text).split('\n').entries()){
   lines.push({file:source.file,line:i+1,text:line});
   for(const match of line.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)){
    const name=match[1].trim();if(/[\\#$]/.test(name)){warnings.push('未展开动态包含路径');continue;}
    let child;try{child=await read(path.extname(name)?name:name+'.tex',path.dirname(source.file),base);}catch(error){if(error.code==='ENOENT'||/不存在/.test(error.message)){warnings.push('包含文件缺失：'+name);continue;}throw error;}if(child)await expand(child,depth+1);
   }
  }
 }
 await expand(entry);
 const section=args.section??'introduction',aliases=section==='introduction'?['introduction','引言','绪论']:section==='related_work'?['relatedwork','相关工作']: [plain(section)];
 const headings=[];for(let i=0;i<lines.length;i++){const m=/\\section\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/.exec(lines[i].text);if(m)headings.push({index:i,title:m[1]});}
 let selected;
 if(section==='all')selected=lines;
 else{const index=headings.findIndex(h=>aliases.includes(plain(h.title)));if(index<0)return {status:'section-not-found',sections:headings.map(h=>h.title),notice:'未返回整篇稿件；请指定正确章节标题或显式 section=all。'};selected=lines.slice(headings[index].index,headings[index+1]?.index??lines.length);}
 const keys=citationKeys(selected.map(l=>l.text).join('\n'));if(keys.length>200)throw new Error('该节引用超过200条，请缩小章节范围');
 const bibPaths=args.bibliographies??[];if(!Array.isArray(bibPaths)||bibPaths.length>8||bibPaths.some(p=>typeof p!=='string'))throw new Error('bibliographies 应为不超过8个路径的数组');
 const bib=new Map();
 if(bibPaths.length){for(const file of bibPaths){const source=await read(file,base);for(const [key,value]of bibliographyEntries(source.text))bib.set(key,value);}}
 else for(const [file,text]of files){for(const m of uncomment(text).matchAll(/\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g))for(const name of m[1].split(',')){const source=await read(path.extname(name.trim())?name.trim():name.trim()+'.bib',path.dirname(file),base);if(source)for(const [key,value]of bibliographyEntries(source.text))bib.set(key,value);}}
 const papers=store.scope(sid).map(id=>store.scopedPaper(sid,id)),matches=matchCitations(keys,bib,papers),ids=[...new Set(matches.flatMap(m=>m.paperId?[m.paperId]:(m.candidates??[]).map(c=>c.paperId)))];
 focus(store,sid,{paperIds:ids,label:section});
 const offset=integer(args.offset,0,0,10000),limit=integer(args.limit,30,1,50),budget=integer(args.maxChars,12000,3000,24000),visible=matches.slice(offset,offset+limit);
 const result={status:'ready',section,source:entry.file,filesScanned:files.size,citationCount:keys.length,matches:visible,nextOffset:offset+visible.length<matches.length?offset+visible.length:null,focus:{papers:ids.length,allowedPapers:papers.length},lines:[],textTruncated:false,warnings:warnings.slice(0,8),notice:'引用键/DOI/完整标题精确映射；未匹配/歧义需确认。未执行TeX宏。lines截断时用原生read按file/line继续。'};
 while(JSON.stringify(result).length>budget&&result.matches.length>1){result.matches.pop();result.nextOffset=offset+result.matches.length;}
 if(JSON.stringify(result).length>budget)throw new Error('规划元数据超出预算，请提高 maxChars');
 if(offset===0)for(const row of selected){if(!row.text.trim())continue;const item={...row,text:row.text.trim()};result.lines.push(item);if(JSON.stringify(result).length>budget-300){result.lines.pop();result.textTruncated=true;result.continueAt={file:row.file,line:row.line};break;}}
 return result;
}
