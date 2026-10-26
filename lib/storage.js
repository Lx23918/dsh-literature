// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';

const normalized=p=>path.resolve(p).toLowerCase();
const contains=(parent,child)=>{const r=path.relative(normalized(parent),normalized(child));return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function atomicJSON(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(value,null,2),{flag:'wx'});await fs.rename(tmp,file);}catch(e){await fs.unlink(tmp).catch(()=>{});throw e;}}
export async function storageConfiguration(ctx,config={}){
 const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),profile=ctx.get?.('profileContext');
 const profileDir=await fs.realpath(profile?.dir??path.join(home,'profiles',profile?.name??'desktop'));
 const pointer=config.storagePointer??path.join(profileDir,'.dsh-literature','storage.json');
 let chosen;try{chosen=JSON.parse(await fs.readFile(pointer,'utf8'));if(chosen.version!==1||!path.isAbsolute(chosen.path))throw new Error('文库目录配置无效，请检查 '+pointer);}catch(e){if(e.code!=='ENOENT')throw e;}
 const root=path.resolve(chosen?.path??config.root??path.join(home,'literature-library'));
 if(!chosen)await atomicJSON(pointer,{version:1,path:root});
 return {root,pointer,profileDir};
}
async function digest(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
function counts(db){const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));return Object.fromEntries(['papers','attachments','collections','journal_labels','journal_metrics','notes','sessions','research_tasks','metadata_history','pages','pages_fts','page_geometry','pdf_indexes','citations','citation_keys','auto_exports'].filter(t=>present.has(t)).map(t=>[t,Number(db.prepare('SELECT count(*) AS n FROM '+t).get().n)]));}

/** Copy, checksum, switch atomically; the previous directory is retained as a recovery copy. */
export class StorageMigration{
 constructor(store,{pointer,onSwitch}={}){this.store=store;this.pointer=pointer;this.onSwitch=onSwitch;this.status={running:false,phase:'idle',done:0,total:0};}
 migrate(requested){
  if(this.operation||this.store.migrating)return Promise.reject(new Error('文库正在迁移，请稍候'));
  if(this.store.indexing.size||this.store.tasks.size)return Promise.reject(new Error('请等待 PDF 索引、导入或阅读任务完成后再迁移'));
  const db=this.store.db;this.store.migrating=true;this.status={running:true,phase:'validating',done:0,total:0};
  this.operation=Promise.resolve().then(()=>this.perform(requested,db)).catch(e=>{this.status={...this.status,running:false,phase:'failed',error:e.message};throw e;}).finally(()=>{this.store.migrating=false;this.operation=null;});
  return this.operation;
 }
 async perform(requested,db){
  if(typeof requested!=='string'||!path.isAbsolute(requested.trim()))throw new Error('请填写完整的绝对目录路径');
  const source=await fs.realpath(this.store.root);let target=path.resolve(requested.trim());
  if(normalized(target)===normalized(path.parse(target).root))throw new Error('不能直接使用磁盘根目录作为文库');
  if(contains(source,target)||contains(target,source))throw new Error('新旧文库目录不能相同，也不能互相包含');
  await fs.mkdir(target,{recursive:true});target=await fs.realpath(target);
  if(contains(source,target)||contains(target,source))throw new Error('目标实际路径与原文库重叠');
  for(const name of ['package.json','cordis.yml','.git'])if(await exists(path.join(target,name)))throw new Error('目标是程序或项目目录，请选择独立的文库目录');
  const names=(await fs.readdir(source)).filter(n=>!['library.sqlite','library.sqlite-wal','library.sqlite-shm','.dsh-relocated.json'].includes(n)&&!n.startsWith('.dsh-migrate-'));
  const reserved=[...new Set([...names,'library.sqlite','.dsh-library.json'])];
  for(const name of reserved)if(await exists(path.join(target,name)))throw new Error('目标目录已存在 '+name+'，为避免覆盖，请选择另一个目录');
  if(this.store.indexing.size)throw new Error('请等待 PDF 索引完成后再迁移');
  const expected=counts(db),attachments=db.prepare('SELECT id,path,sha FROM attachments ORDER BY id').all();
  const stage=await fs.mkdtemp(path.join(target,'.dsh-migrate-'));const published=[];let oldClosed=false,switched=false;
  this.status={running:true,phase:'copying',done:0,total:attachments.length,source,target};this.store.migrating=true;
  try{
   await backup(db,path.join(stage,'library.sqlite'));
   for(const name of names){const info=await fs.lstat(path.join(source,name));if(info.isSymbolicLink())throw new Error('文库顶层含软链接 '+name+'，请先使用实际目录后再迁移');await fs.cp(path.join(source,name),path.join(stage,name),{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});}
   await fs.mkdir(path.join(stage,'pdfs'),{recursive:true});
   const snapshot=new DatabaseSync(path.join(stage,'library.sqlite'));
   try{
    snapshot.exec('BEGIN IMMEDIATE');
    for(const a of attachments){
     if(!/^[A-Za-z0-9_-]{1,100}$/.test(a.id))throw new Error('附件标识无效，已停止迁移');
     const destination=path.join(stage,'pdfs',a.id+'.pdf'),newPath=path.join(target,'pdfs',a.id+'.pdf'),sourceHash=await digest(a.path);
     if(await exists(destination)){const info=await fs.lstat(destination);if(info.isSymbolicLink())await fs.unlink(destination);else if(!info.isFile())throw new Error('临时附件路径发生冲突：'+a.id);}
     await fs.copyFile(a.path,destination);
     if(await digest(destination)!==sourceHash)throw new Error('PDF 校验失败：'+a.id);
     snapshot.prepare('UPDATE attachments SET path=? WHERE id=?').run(newPath,a.id);this.status.done++;
    }
    snapshot.exec('COMMIT');
    if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('迁移数据库完整性校验失败');
    if(JSON.stringify(counts(snapshot))!==JSON.stringify(expected))throw new Error('迁移前后数据数量不一致');
    snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE)');
   }catch(e){try{snapshot.exec('ROLLBACK');}catch{}throw e;}finally{snapshot.close();}
   await fs.writeFile(path.join(stage,'.dsh-library.json'),JSON.stringify({format:1,migratedFrom:source,completedAt:new Date().toISOString(),counts:expected},null,2));
   this.status.phase='switching';
   for(const name of await fs.readdir(stage)){
    if(await exists(path.join(target,name)))throw new Error('目标内容发生变化，已停止迁移：'+name);
    await fs.rename(path.join(stage,name),path.join(target,name));published.push(name);
   }
   this.store.close();oldClosed=true;this.store.root=target;await this.store.open();
   await atomicJSON(this.pointer,{version:1,path:target,previousPath:source,migratedAt:new Date().toISOString()});switched=true;
   await this.onSwitch?.(target);
   this.status={...this.status,running:false,phase:'completed',counts:expected,oldDataRetained:true};
   return {...this.status};
  }catch(e){
   if(!switched){if(oldClosed){this.store.close();this.store.root=source;await this.store.open();}for(const name of published.reverse())await fs.rename(path.join(target,name),path.join(stage,name)).catch(()=>{});}
   this.status={...this.status,running:false,phase:'failed',error:e.message};throw e;
  }finally{
   this.store.migrating=false;
   // Only this newly-created staging directory may be removed; never remove user directories.
   const relative=path.relative(target,stage);if(relative.startsWith('.dsh-migrate-')&&!relative.includes(path.sep))await fs.rm(stage,{recursive:true,force:true}).catch(()=>{});
  }
 }
}
