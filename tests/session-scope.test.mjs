// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {LibraryStore} from '../lib/store.js';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'literature-inherited-scope-'));const store=await new LibraryStore(root).open();t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});return store;}

test('forks and delegated children inherit a snapshot of the selected-paper scope',async t=>{
 const store=await fixture(t),paper=store.save({title:'Selected fixture'}),other=store.save({title:'Outside fixture'});
 store.bind('parent',[paper.id]);
 assert.equal(store.inheritScope({id:'child',header:{parentSession:'parent'}}),true);
 assert.equal(store.inheritScope({id:'grandchild',header:{parentSession:'child'}}),true);
 assert.deepEqual(store.scope('child'),[paper.id]);assert.deepEqual(store.scope('grandchild'),[paper.id]);
 assert.throws(()=>store.scopedPaper('child',other.id),/范围/);
 store.db.prepare('DELETE FROM sessions WHERE session_id=?').run('parent');
 assert.deepEqual(store.scope('child'),[paper.id]);
});

test('ordinary sessions cannot gain a scope from an unbound parent or overwrite an existing binding',async t=>{
 const store=await fixture(t),paper=store.save({title:'Selected fixture'}),other=store.save({title:'Other selection'});
 assert.equal(store.inheritScope({id:'ordinary',header:{}}),false);
 assert.equal(store.inheritScope({id:'unknown-child',header:{parentSession:'ordinary'}}),false);
 store.bind('parent',[paper.id]);store.bind('existing',[other.id]);
 assert.equal(store.inheritScope({id:'existing',header:{parentSession:'parent'}}),false);
 assert.deepEqual(store.scope('existing'),[other.id]);
});

test('inheritance skips unavailable papers and pauses while storage migrates or shuts down',async t=>{
 const store=await fixture(t),paper=store.save({title:'Retained fixture'}),trash=store.save({title:'Trashed fixture'});
 store.bind('parent',[paper.id,trash.id]);store.trash(trash.id);
 store.migrating=true;assert.equal(store.inheritScope({id:'child',header:{parentSession:'parent'}}),false);
 store.migrating=false;assert.equal(store.inheritScope({id:'child',header:{parentSession:'parent'}}),true);
 assert.deepEqual(store.scope('child'),[paper.id]);
 store.trash(paper.id);assert.equal(store.inheritScope({id:'empty-child',header:{parentSession:'parent'}}),false);
 store.stopWork();assert.equal(store.inheritScope({id:'stopped-child',header:{parentSession:'parent'}}),false);
});
