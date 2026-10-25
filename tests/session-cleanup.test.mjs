// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {LibraryStore} from '../lib/store.js';
import {installSessionCleanup,pruneSessionScopes} from '../lib/session-cleanup.js';

async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'literature-scope-test-')));
 const store=await new LibraryStore(root).open(),paper=store.save({title:'Synthetic scope fixture'});
 t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
 return {store,paper};
}
const live=new Map(),sessions={get:id=>live.get(id)};
const drain=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('only missing scopes are removed; live, cold and archived sessions share their library data',async t=>{
 const {store,paper}=await fixture(t),data=Buffer.from('%PDF-1.7\nsynthetic scope fixture');
 const {attachmentId}=await store.attach({paperId:paper.id,name:'fixture.pdf',base64:data.toString('base64')});
 store.addNote(paper.id,'Keep the shared reading note.');
 store.db.prepare('INSERT INTO pages VALUES(?,?,?)').run(attachmentId,1,'Keep the shared original text.');
 store.db.prepare('INSERT INTO pages_fts(attachment_id,page,text) VALUES(?,?,?)').run(attachmentId,1,'Keep the shared original text.');
 store.db.prepare('INSERT INTO citations VALUES(?,?,?,?,?,?,?,?,?,?)').run('shared-proof',paper.id,attachmentId,1,0,4,'Keep','[]','fixture-sha','fixture-time');
 for(const id of ['attached','cold','archived','deleted'])store.bind(id,[paper.id]);
 const checked=[];
 await pruneSessionScopes(store,{sessions:{get:id=>id==='attached'?{}:undefined},persistence:{stat:async id=>{checked.push(id);return id==='deleted'?undefined:{header:{id}};}}});
 assert.deepEqual(checked,['cold','archived','deleted']);
 assert.throws(()=>store.scope('deleted'),/未绑定/);
 for(const id of ['attached','cold','archived'])assert.deepEqual(store.scope(id),[paper.id]);
 assert.equal(store.paper(paper.id).notesList.length,1);
 assert.equal(store.searchText('shared',[paper.id]).length,1);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM citations').get().n,1);
 assert.deepEqual(await fs.readFile(store.attachment(attachmentId).path),data);
});

test('storage errors preserve the affected scope and do not block other deletions',async t=>{
 const {store,paper}=await fixture(t);
 for(const id of ['unreadable','deleted'])store.bind(id,[paper.id]);
 await assert.rejects(pruneSessionScopes(store,{sessions,persistence:{stat:async id=>{if(id==='unreadable')throw new Error('Backend unavailable');}}}),/checks failed/);
 assert.deepEqual(store.scope('unreadable'),[paper.id]);
 assert.throws(()=>store.scope('deleted'),/未绑定/);
});

test('a session attached during the persistence check is retained',async t=>{
 const {store,paper}=await fixture(t),wait=deferred(),attached=new Map();
 store.bind('racing',[paper.id]);
 const task=pruneSessionScopes(store,{sessions:{get:id=>attached.get(id)},persistence:{stat:()=>wait.promise}});
 attached.set('racing',{});wait.resolve();await task;
 assert.deepEqual(store.scope('racing'),[paper.id]);
});

test('a replaced binding is not removed by an older existence check',async t=>{
 const {store,paper}=await fixture(t),other=store.save({title:'Another synthetic paper'}),wait=deferred();
 store.bind('racing',[paper.id]);
 const task=pruneSessionScopes(store,{sessions,persistence:{stat:()=>wait.promise}});
 store.db.prepare('UPDATE sessions SET scope=? WHERE session_id=?').run(JSON.stringify([other.id]),'racing');
 wait.resolve();await task;
 assert.deepEqual(store.scope('racing'),[other.id]);
});

test('shutdown, cancellation and migration suspend pending or new cleanup work',async t=>{
 for(const reason of ['shutdown','abort','migration','database']){
  const {store,paper}=await fixture(t),wait=deferred(),controller=new AbortController();
  store.bind(reason,[paper.id]);
  const task=pruneSessionScopes(store,{sessions,persistence:{stat:()=>wait.promise},signal:controller.signal});
  if(reason==='shutdown')store.stopWork();
  else if(reason==='abort')controller.abort();
  else if(reason==='migration')store.migrating=true;
  else{store.close();await store.open();}
  wait.resolve();await task;store.migrating=false;
  assert.deepEqual(store.scope(reason),[paper.id]);
 }
 const {store,paper}=await fixture(t);store.bind('busy',[paper.id]);store.migrating=true;
 let calls=0;await pruneSessionScopes(store,{sessions,persistence:{stat:async()=>{calls++;}}});
 store.migrating=false;assert.equal(calls,0);assert.deepEqual(store.scope('busy'),[paper.id]);
});

test('startup, disposal notification and periodic sweeps clean scopes with owned hot-reload lifetimes',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const {store,paper}=await fixture(t),ctx=new Context(),persisted=new Set(['cold','released']);
 const attached=new Map([['released',{}]]);let calls=0;
 ctx.provide('sessions',{get:id=>attached.get(id)});
 ctx.provide('sessionPersistence',{stat:async id=>{calls++;return persisted.has(id)?{header:{id}}:undefined;}});
 for(const id of ['cold','released','old-deleted'])store.bind(id,[paper.id]);
 const start=async()=>{const fiber=ctx.plugin(child=>installSessionCleanup(child,store));await fiber.await();await drain();return fiber;};
 let fiber=await start();
 t.after(async()=>{await fiber.dispose();await fiber.await();});
 assert.throws(()=>store.scope('old-deleted'),/未绑定/);
 attached.delete('released');ctx.emit('session/disposed',{id:'released'});await drain();
 assert.deepEqual(store.scope('released'),[paper.id]);
 persisted.delete('released');t.mock.timers.tick(60000);await drain();
 assert.throws(()=>store.scope('released'),/未绑定/);
 await fiber.dispose();await fiber.await();const afterStop=calls;
 store.bind('deleted-while-disabled',[paper.id]);ctx.emit('session/disposed',{id:'deleted-while-disabled'});
 t.mock.timers.tick(180000);await drain();assert.equal(calls,afterStop);
 assert.deepEqual(store.scope('deleted-while-disabled'),[paper.id]);
 fiber=await start();assert.throws(()=>store.scope('deleted-while-disabled'),/未绑定/);
 assert.deepEqual(store.scope('cold'),[paper.id]);
});

test('a missing persistence service never becomes proof of deletion',async t=>{
 const {store,paper}=await fixture(t),ctx=new Context();
 ctx.provide('sessions',sessions);store.bind('offline',[paper.id]);
 const fiber=ctx.plugin(child=>installSessionCleanup(child,store));await fiber.await();await drain();
 assert.deepEqual(store.scope('offline'),[paper.id]);
 await fiber.dispose();await fiber.await();
});
