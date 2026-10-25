// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import test from 'node:test';
import assert from 'node:assert/strict';
import {dump} from 'js-yaml';
import {Context} from '@deepseek-ai/cordis';
import {entryListSchema} from '@deepseek-ai/cordis-plugin-include';
import * as preset from '../lib/preset.js';

const document=plugins=>({content:dump(plugins,{schema:entryListSchema,noRefs:true})});
test('the full configured native composition is retained with nested groups and deferred expressions',async()=>{
 const plugins=[{id:'native-group',name:'group:capabilities',group:true,isolate:{nativeService:true},config:[
  {name:'example-native-edit',config:{enabled:{__jsExpr:'process.platform === "win32"'},limit:31}},
  {name:'example-native-workflow',disabled:false},
  {name:'example-native-extension',config:{custom:'kept'}}
 ]}];
 const before=structuredClone(plugins),reads=[];
 const result=await preset.literatureDefinition({defaultId:'custom-default',readDocument:async id=>{reads.push(id);return document(plugins);}});
 assert.deepEqual(reads,['custom-default']);
 assert.deepEqual(result.plugins.slice(0,-1),before);
 assert.deepEqual(plugins,before);
 assert.deepEqual(result.plugins.at(-1),{name:'dsh-literature/research'});
 assert.equal(result.id,'literature');
});

test('an explicit base is honored and choosing literature as the default does not recurse',async()=>{
 const reads=[],registry={defaultId:'literature',readDocument:async id=>{reads.push(id);return document([{name:'example-native-tool'}]);}};
 await preset.literatureDefinition(registry);
 await preset.literatureDefinition(registry,{basePreset:'another-native-preset'});
 assert.deepEqual(reads,['standard','another-native-preset']);
 await assert.rejects(()=>preset.literatureDefinition(registry,{basePreset:'literature'}),/ordinary/);
});

test('an unavailable or malformed base fails rather than silently dropping native capabilities',async()=>{
 await assert.rejects(()=>preset.literatureDefinition({defaultId:'missing',readDocument:async()=>{throw new Error('Missing native preset');}}),/Missing native/);
 for(const content of ['[]','{}','not: [valid'])await assert.rejects(()=>preset.literatureDefinition({defaultId:'standard',readDocument:async()=>({content})}));
});

test('native-preset registration is owned and awaited across hot disable and re-enable',async()=>{
 const ctx=new Context(),active=new Set();let registrations=0,disposals=0;
 ctx.provide('loader',{await:async()=>{}});
 ctx.provide('agentPresets',{
  defaultId:'standard',readDocument:async()=>document([{name:'example-native-tool'}]),
  register:async definition=>{
   await Promise.resolve();assert.equal(active.has(definition.id),false);active.add(definition.id);registrations++;
   return async()=>{await Promise.resolve();active.delete(definition.id);disposals++;};
  }
 });
 for(let i=0;i<3;i++){
  const fiber=ctx.plugin(preset);await fiber.await();await ctx.get('literaturePresetStatus').ready;assert.equal(active.has('literature'),true);
  await fiber.dispose();await fiber.await();assert.equal(active.size,0);
 }
 assert.equal(registrations,3);assert.equal(disposals,3);
});

test('unload cancels a pending host startup without registering an orphan preset',async()=>{
 const ctx=new Context();let release,registered=false;
 ctx.provide('loader',{await:()=>new Promise(resolve=>{release=resolve;})});
 ctx.provide('agentPresets',{defaultId:'standard',readDocument:async()=>document([{name:'example-native-tool'}]),register:async()=>{registered=true;}});
 const fiber=ctx.plugin(preset);await fiber.await();
 await fiber.dispose();await fiber.await();release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(registered,false);assert.equal(ctx.get('literaturePresetStatus'),undefined);
});
