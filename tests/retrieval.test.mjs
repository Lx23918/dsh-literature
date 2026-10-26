// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {LibraryStore} from '../lib/store.js';import {StorageMigration} from '../lib/storage.js';
import {catalog,focus,focusedIds,search,readWindow,verifyBatch,savedEvidence} from '../lib/retrieval.js';import {viewPage,pageContent} from '../lib/vision.js';
const python=process.env.DSH_LITERATURE_PYTHON||(process.platform==='win32'?'python':'python3');
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'literature-bounded-'))),store=await new LibraryStore(path.join(root,'library'),{python}).open();t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});return {root,store};}
async function pdfFixture(t){const f=await fixture(t),file=path.join(f.root,'fixture.pdf');const made=spawnSync(python,['-c',`import fitz,sys\nd=fitz.open();p=d.new_page(width=400,height=600);p.insert_text((40,60),'Held-out concepts never enter training. Accuracy 0.75.');p=d.new_page(width=400,height=600);p.insert_text((40,60),'Figure axis: earlier layers versus later layers.');p.set_rotation(90);d.save(sys.argv[1])`,file]);assert.equal(made.status,0,made.stderr?.toString());const p=f.store.save({title:'Selected fixture',doi:'10.1234/fixture'}),a=await f.store.attach({paperId:p.id,name:'fixture.pdf',base64:(await fs.readFile(file)).toString('base64')});f.store.bind('research',[p.id]);await f.store.index(a.attachmentId);return {...f,p,a};}

test('catalog is paginated, compact and explicitly expandable without widening permission',async t=>{
 const {store}=await fixture(t),ids=[];for(let i=0;i<42;i++)ids.push(store.save({title:'Fixture '+i,abstract:'Large abstract '.repeat(1500)}).id);store.bind('research',ids);
 const before=JSON.stringify(store.listScope('research')).length,first=catalog(store,'research');assert.equal(first.papers.length,20);assert.equal(first.nextOffset,20);assert.ok(JSON.stringify(first).length<10000);assert.ok(JSON.stringify(first).length<before/10);assert.equal(first.papers[0].abstract,undefined);
 assert.equal(catalog(store,'research',{offset:40}).papers.length,2);assert.ok(catalog(store,'research',{paperIds:[ids[0]],details:true}).papers[0].abstractTruncated);
 const outside=store.save({title:'Outside'});assert.throws(()=>catalog(store,'research',{paperIds:[outside.id]}),/范围/);
});
test('task focus survives inheritance and migration and cascades with a deleted session',async t=>{
 const {root,store}=await fixture(t),a=store.save({title:'Focus A'}),b=store.save({title:'Focus B'});store.bind('parent',[a.id,b.id]);focus(store,'parent',{paperIds:[b.id]});
 assert.deepEqual(focusedIds(store,'parent'),[b.id]);store.inheritScope({id:'child',header:{parentSession:'parent'}});assert.deepEqual(focusedIds(store,'child'),[b.id]);
 await new StorageMigration(store,{pointer:path.join(root,'profile/storage.json')}).migrate(path.join(root,'moved'));assert.deepEqual(focusedIds(store,'parent'),[b.id]);
 store.db.prepare('DELETE FROM sessions WHERE session_id=?').run('child');assert.equal(store.db.prepare('SELECT count(*) AS n FROM research_tasks WHERE session_id=?').get('child').n,0);
 focus(store,'parent',{reset:true});assert.deepEqual(focusedIds(store,'parent'),[a.id,b.id]);
});
test('keyword search is scoped, ranked, bounded and supports explicit term operators',async t=>{
 const {store}=await fixture(t),ids=[];for(let i=0;i<12;i++){const p=store.save({title:'Search '+i});ids.push(p.id);const a=await store.attach({paperId:p.id,name:'fake.pdf',base64:Buffer.from('%PDF-1.7 synthetic').toString('base64')});store.db.prepare('INSERT INTO pages VALUES(?,?,?)').run(a.attachmentId,1,'prefix '.repeat(500)+'zero-shot pooling evidence');store.db.prepare('INSERT INTO pages_fts(attachment_id,page,text) VALUES(?,?,?)').run(a.attachmentId,1,'prefix '.repeat(500)+'zero-shot pooling evidence');}
 store.bind('research',ids);const result=search(store,'research',{query:'zero-shot'});assert.equal(result.hits.length,6);assert.ok(result.truncated);assert.ok(result.hits.every(h=>h.offset>0&&h.text.includes('zero-shot')));assert.ok(JSON.stringify(result).length<7000);
 focus(store,'research',{paperIds:[ids[1]]});assert.equal(search(store,'research',{terms:['zero-shot','absent'],mode:'any'}).hits.length,1);assert.equal(search(store,'research',{terms:['zero-shot','absent'],mode:'all'}).hits.length,0);
 assert.equal(search(store,'research',{query:'zero-shot OR pooling'}).hits.length,0);assert.equal(search(store,'research',{query:'zero-shot',all:true}).hits.length,6);
});
test('PDF text windows expose accurate continuation offsets and never silently omit text',async t=>{
 const {store,p}=await pdfFixture(t);const first=await readWindow(store,'research',{paperId:p.id,maxChars:500});assert.equal(first.pages.length,1);assert.equal(first.next,null);
 const full=await store.read('research',{paperId:p.id,start:1,end:1});store.db.prepare('UPDATE pages SET text=? WHERE attachment_id=? AND page=1').run('x'.repeat(1300),full.attachmentId);
 const a=await readWindow(store,'research',{paperId:p.id,maxChars:500});const b=await readWindow(store,'research',{paperId:p.id,start:a.next.start,offset:a.next.offset,maxChars:500});const c=await readWindow(store,'research',{paperId:p.id,start:b.next.start,offset:b.next.offset,maxChars:500});assert.equal(a.pages[0].text+b.pages[0].text+c.pages[0].text,'x'.repeat(1300));assert.equal(c.next,null);
});
test('batch verification preserves individual failures and reuses live evidence without granting outside access',async t=>{
 const {store,p}=await pdfFixture(t),quote='Held-out concepts never enter training.';
 const result=await verifyBatch(store,'research',{quotes:[{paperId:p.id,page:1,quote},{paperId:p.id,page:1,quote:'Accuracy 0.99.'}]});assert.equal(result.results[0].verified,true);assert.equal(result.results[1].verified,false);
 assert.equal((await savedEvidence(store,'research',{query:'Held-out'})).citations[0].citationId,result.results[0].citationId);
 const outside=store.save({title:'Outside'}),before=store.db.prepare('SELECT count(*) AS n FROM citations').get().n;await assert.rejects(()=>verifyBatch(store,'research',{quotes:[{paperId:p.id,page:1,quote},{paperId:outside.id,page:1,quote}]}),/范围/);assert.equal(store.db.prepare('SELECT count(*) AS n FROM citations').get().n,before);
 await fs.appendFile(store.paper(p.id).attachments[0].path,'\n% revision\n');const stale=await savedEvidence(store,'research');assert.equal(stale.citations.length,0);assert.equal(stale.stale,1);
});
test('actual PDF images use native image attachments and preserve scope and rotated crops',async t=>{
 const {store,p}=await pdfFixture(t);let saved;
 const ctx={get:name=>name==='llm'?{resolveModelInfo:async()=>({inputModalities:['text','image']})}:name==='attachments'?{imageLimits:{mediaTypes:['image/png']},saveImage:async input=>{saved=input;return {attachmentId:'fixture-image',mediaType:'image/png',bytes:input.data.length,width:700,height:934,name:input.name};}}:undefined};
 const exec={agent:{options:{provider:'fixture',model:'vision'},session:{requestHeader:()=>undefined}},signal:new AbortController().signal};
 const r=await viewPage(ctx,store,'research',{paperId:p.id,page:1,clip:[0,0,.5,1]},exec);assert.equal(saved.data.subarray(1,4).toString(),'PNG');assert.deepEqual(pageContent({},r).map(b=>b.type),['text','image']);assert.ok(!JSON.stringify(r).includes('base64'));
 const full=await store.renderPage('research',{paperId:p.id,page:2}),crop=await store.renderPage('research',{paperId:p.id,page:2,clip:[0,0,.5,1]});assert.ok(Math.abs(crop.width-full.width/2)<3);assert.equal(crop.height,full.height);
 await assert.rejects(()=>viewPage(ctx,store,'ordinary',{paperId:p.id,page:1},exec),/普通对话/);
});
