// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import path from 'node:path';
import {createHash} from 'node:crypto';
export async function importFolderFile(store,{relativePath,base64,parentId=null}){
 if(typeof relativePath!=='string'||relativePath.length>1500||relativePath.includes('\\')||relativePath.includes('\0'))throw new Error('文件夹相对路径无效');
 const parts=relativePath.split('/');if(parts.length<2||parts.length>32||parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*]/.test(p)||p.length>200)||!parts.at(-1).toLowerCase().endsWith('.pdf'))throw new Error('仅接受文件夹内的 PDF，相对路径不能越界');
 if(parentId&&!store.db.prepare('SELECT 1 FROM collections WHERE id=?').get(parentId))throw new Error('目标分类不存在');
 if(typeof base64!=='string'||base64.length>70*1024*1024)throw new Error('PDF 超过 50 MiB');const bytes=Buffer.from(base64,'base64');if(bytes.length>50*1024*1024||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('PDF 文件无效或过大');
 let parent=parentId;for(const name of parts.slice(0,-1)){const hit=store.db.prepare('SELECT id FROM collections WHERE name=? AND parent_id IS ?').get(name,parent);parent=hit?.id??store.collection({name,parentId:parent}).id;}
 const sha=createHash('sha256').update(bytes).digest('hex'),duplicate=store.db.prepare('SELECT a.paper_id FROM attachments a JOIN papers p ON p.id=a.paper_id WHERE a.sha=? AND p.trashed=0 LIMIT 1').get(sha);
 if(duplicate){const p=store.paper(duplicate.paper_id);if(!p.collectionIds.includes(parent))store.save({...p,collectionIds:[...p.collectionIds,parent]});return {paperId:p.id,duplicate:true,collectionId:parent};}
 const paper=store.save({title:path.basename(parts.at(-1),path.extname(parts.at(-1))),collectionIds:[parent]});
 try{const attachment=await store.attach({paperId:paper.id,name:parts.at(-1),base64});return {paperId:paper.id,attachmentId:attachment.attachmentId,duplicate:false,collectionId:parent};}catch(e){store.db.prepare('DELETE FROM citation_keys WHERE paper_id=?').run(paper.id);store.db.prepare('DELETE FROM papers WHERE id=?').run(paper.id);throw e;}
}
