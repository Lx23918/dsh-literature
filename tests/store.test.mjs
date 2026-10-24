// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {LibraryStore} from '../lib/store.js';
const python=process.env.DSH_LITERATURE_PYTHON||(process.platform==='win32'?'python':'python3');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-literature-test-'));
const store=await new LibraryStore(root,{python}).open();
let paper,attachment;
test('nested collections reject cycles and retain journal labels across papers',()=>{
 const a=store.collection({name:'Methods'}),b=store.collection({name:'Decoding',parentId:a.id});
 assert.throws(()=>store.collection({id:a.id,name:'Methods',parentId:b.id}),/循环/);
 paper=store.save({title:'Test research',year:'2025',journal:'Test Journal',tags:['method'],collectionIds:[b.id]});
 store.labels('Test Journal',['待核验','核心']);assert.equal(store.snapshot({collectionId:a.id}).papers.length,1);assert.deepEqual(store.snapshot().papers[0].journalLabels,['待核验','核心']);
});
test('CSL imports are transactional and DOI duplicates are detected',()=>{
 const before=store.all().length;assert.throws(()=>store.importCSL([{title:'valid'},{title:''}]));assert.equal(store.all().length,before);
 assert.deepEqual(store.importCSL([{title:'Paper one',DOI:'10.1234/example'},{title:'Duplicate',DOI:'10.1234/EXAMPLE'}]),{imported:1,duplicates:1});
});
test('imported PDF is locally copied, deduplicated and indexed with physical pages',async()=>{
 const file=path.join(root,'fixture.pdf');const made=spawnSync(python,['-c','import fitz,sys;d=fitz.open();p=d.new_page();p.insert_text((72,72),"Training uses participants A and B.");p=d.new_page();p.insert_text((72,72),"Participant C was held out. Accuracy 0.75.");d.save(sys.argv[1])',file]);assert.equal(made.status,0);
 const base64=(await fs.readFile(file)).toString('base64');const a=await store.attach({paperId:paper.id,name:'fixture.pdf',base64});attachment=a.attachmentId;
 assert.equal((await store.attach({paperId:paper.id,name:'again.pdf',base64})).duplicate,true);const indexed=await store.index(attachment);assert.equal(indexed.pages,2);
 store.bind('research-session',[paper.id]);const result=await store.read('research-session',{paperId:paper.id,start:2,end:2});assert.match(result.pages[0].text,/0.75/);assert.match(result.pages[0].citation,/page=2/);
 assert.equal(store.searchText('Participant C',[paper.id])[0].page,2);
});
test('ordinary sessions and outside papers cannot access research scope',async()=>{
 assert.throws(()=>store.listScope('ordinary-session'),/普通对话/);
 const outside=store.save({title:'Outside'});await assert.rejects(()=>store.read('research-session',{paperId:outside.id,start:1,end:1}),/范围/);
 assert.equal(store.searchText('Accuracy',[outside.id]).length,0);
});
test('trash preserves PDF and can restore; notes retain source text',()=>{
 const note=store.addNote(paper.id,'See [source](dsh-literature://sample?page=2)');assert.ok(note.id);
 store.trash(paper.id,true);assert.equal(store.snapshot({trash:true}).papers.length,1);assert.throws(()=>store.scopedPaper('research-session',paper.id),/回收站/);
 store.trash(paper.id,false);assert.equal(store.paper(paper.id).attachments.length,1);assert.ok(store.exportCSL().some(p=>p.title==='Test research'));
});
test('recognition history preserves manual values and translations reject stale titles',()=>{
 const p=store.save({title:'Human corrected title',authors:'Manual Author'});store.applyMetadata(p.id,{title:'Remote candidate',authors:'Other Author',year:'2024'},{source:'Crossref',status:'matched',originalTitle:p.title});const after=store.paper(p.id);assert.equal(after.title,p.title);assert.equal(after.authors,'Manual Author');assert.equal(after.year,'2024');assert.throws(()=>store.saveTranslation(p.id,'译名','stale title'),/变化/);store.saveTranslation(p.id,'人工校正标题',p.title);assert.equal(store.paper(p.id).titleTranslated,'人工校正标题');assert.equal(store.db.prepare('SELECT count(*) AS n FROM metadata_history WHERE paper_id=?').get(p.id).n,1);
});
test.after(()=>store.close());
