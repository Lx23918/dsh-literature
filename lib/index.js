// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import path from 'node:path';
import os from 'node:os';
import { LibraryStore } from './store.js';
import fs from 'node:fs/promises';
import {MetadataManager} from './metadata.js';
import {createPublicLookup} from './public-metadata.js';
import {JournalService} from './journals.js';
import {storageConfiguration,StorageMigration} from './storage.js';
import {AutoBibliography} from './bibliography.js';
import {importFolderFile} from './folder-import.js';
import {installSessionCleanup} from './session-cleanup.js';

export const name='literature-library';
export const inject=['sessionController','workspaceRegistry','credentials'];
export async function apply(ctx,config={}) {
 const location=await storageConfiguration(ctx,config),root=location.root;
 const store=await new LibraryStore(root,{python:config.python}).open();
 ctx.inject(['webServer'],child=>{const origin=()=>child.webServer.getOrigin();store.citationOrigin=origin;child.effect(()=>()=>{if(store.citationOrigin===origin)store.citationOrigin=undefined;},'literature: optional web origin');});
 let metadataAbort,metadata,migration,journals,autoExport,folderTail=Promise.resolve();
 ctx.effect(()=>async()=>{metadataAbort?.abort();metadata?.stop();journals?.stop();store.stopWork();if(migration?.operation)await migration.operation.catch(()=>{});while(metadata?.running)await new Promise(r=>setTimeout(r,100));await Promise.allSettled([...store.indexing.values(),...store.tasks,...journals?.pending?.values()??[]]);await autoExport?.stop();store.close();},'literature: database and background lifetime');
 installSessionCleanup(ctx,store);
 let settingsPath=path.join(root,'integrations.json');let settings={autoRecognize:true,publicMetadataEnabled:false,easyScholarEnabled:false};try{settings={...settings,...JSON.parse(await fs.readFile(settingsPath,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
 journals=new JournalService(store,{credentials:ctx.get('credentials')});
 metadataAbort=new AbortController();const lookup=createPublicLookup({signal:metadataAbort.signal});metadata=new MetadataManager(store,{lookup:(paper,hint)=>settings.publicMetadataEnabled?lookup(paper,hint):null,onRecognized:async paper=>{if(settings.easyScholarEnabled&&paper.journal&&paper.journal!=='arXiv')await journals.lookup(paper.journal);}});
 let workspaceReady;
 autoExport=new AutoBibliography(store);
 migration=new StorageMigration(store,{pointer:location.pointer,onSwitch:target=>{settingsPath=path.join(target,'integrations.json');workspaceReady=null;autoExport.schedule();}});
 const service={store,async dispatch(serialized){const request=JSON.parse(serialized);let value;const p=request.payload??{};if(store.migrating&&!['migrationStatus','settings','metadataStatus'].includes(request.action))throw new Error('文库正在迁移，请稍后再操作');
  switch(request.action){
   case 'snapshot':value=store.snapshot(p);break;
   case 'save':value=store.transaction(()=>{let saved=store.save(p.metadata?.source?{...p,metadata:{...p.metadata,status:'manual'}}:p);if(p.citationKey)saved=store.setCitationKey(saved.id,p.citationKey,{pinned:true});return saved;});break;
   case 'trash':value=store.trash(p.id,p.value);break;
   case 'collection':value=store.collection(p);break;
   case 'labels':value=store.labels(p.journal,p.labels);break;
   case 'attach':value=await store.attach(p);if(settings.autoRecognize)metadata.enqueue([p.paperId]);break;
   case 'importFolderFile':{const job=folderTail.then(()=>importFolderFile(store,p));folderTail=job.catch(()=>{});value=await store.track(job);if(settings.autoRecognize&&!value.duplicate)metadata.enqueue([value.paperId]);break;}
   case 'recognize':value=metadata.enqueue(p.ids);break;
   case 'metadataStatus':value={...metadata.status};break;
   case 'journalRank':value=await journals.lookup(p.journal,{force:!!p.force});break;
   case 'journalRanks':{const result=[];for(const name of [...new Set(p.ids.map(id=>store.paper(id).journal).filter(Boolean))]){try{result.push(await journals.lookup(name));}catch(e){result.push({journal:name,status:'error',message:e.message});}}value=result;break;}
   case 'settings':value={...settings,keyConfigured:await journals.configured(),storageMode:'copy',storagePath:store.root,migration:{...migration.status}};break;
   case 'migrationStatus':value={...migration.status};break;
   case 'migrateStorage':{if(metadata.running||store.indexing.size||store.tasks.size||journals.pending.size||autoExport.pending)throw new Error('请等待文献识别、索引、导入或导出完成后再迁移');value=await migration.migrate(p.path);break;}
   case 'saveSettings':{if(p.apiKey?.trim())await journals.setKey(p.apiKey);settings={autoRecognize:!!p.autoRecognize,publicMetadataEnabled:!!p.publicMetadataEnabled,easyScholarEnabled:!!p.easyScholarEnabled};await fs.writeFile(settingsPath,JSON.stringify(settings,null,2));value={...settings,keyConfigured:await journals.configured()};break;}
   case 'index':value=await store.index(p.id);break;
   case 'searchText':value=store.searchText(p.query,store.snapshot({...p.filter,query:''}).papers.map(p=>p.id));break;
   case 'note':value=store.addNote(p.paperId,p.body);break;
   case 'importCSL':value=store.importCSL(p.data);break;
   case 'exportCSL':value=store.exportCSL();break;
   case 'exportBibliography':value=store.exportBibliography(p);break;
   case 'citationKey':value=store.setCitationKey(p.id,p.key,p);break;
   case 'copyCitation':{const result=store.exportBibliography({ids:p.ids,format:'biblatex'}),papers=store.all().filter(x=>p.ids.includes(x.id));value={latex:'\\cite{'+papers.map(x=>x.citationKey).join(',')+'}',pandoc:papers.map(x=>'@'+x.citationKey).join('; '),count:result.count};break;}
   case 'autoExports':value=autoExport.list();break;
   case 'addAutoExport':value=await store.track(autoExport.add(p));break;
   case 'removeAutoExport':value=autoExport.remove(p.id);break;
   case 'refreshAutoExports':await autoExport.flush();value=autoExport.list();break;
   case 'verifyQuote':value=await store.verifyQuote(p.sessionId,p);break;
   case 'resolveCitation':value=await store.resolveEvidence(p.sessionId,p);break;
   case 'renderPage':value=await store.renderPage(p.sessionId,p);break;
   case 'sessionInfo':{try{const ids=store.scope(p.sessionId);value={bound:true,papers:ids.map(id=>store.paper(id))};}catch{value={bound:false,papers:[]};}break;}
   case 'newSession':{
    const ids=[...new Set(p.ids??[])];if(!ids.length||ids.length>10000)throw new Error('请选择 1–10000 篇文献');for(const id of ids)if(store.paper(id).trashed)throw new Error('文献已在回收站');
    const workspace=await (workspaceReady??=(async()=>await ctx.workspaceRegistry.resolveByPath(store.root)??await ctx.workspaceRegistry.create(store.root))()).catch(e=>{workspaceReady=null;throw e;});
    const result=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:'literature'});
    store.bind(result.sessionId,ids);value={sessionId:result.sessionId};break;
   }
   default:throw new Error('未知文献操作');
  }return JSON.stringify(value);
 }};
 Object.defineProperty(service,'typertRemote',{value:{service,serviceKey:'literature',namespace:'literature'}});
 ctx.provide('literature',service);
}
