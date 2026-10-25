// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import {load} from 'js-yaml';
import {entryListSchema} from '@deepseek-ai/cordis-plugin-include';

export const name='literature-preset';
export const inject=['agentPresets','loader'];

export async function literatureDefinition(registry,config={}) {
 const baseId=config.basePreset??(registry.defaultId==='literature'?'standard':registry.defaultId);
 if(!baseId||baseId==='literature')throw new Error('Choose an ordinary DSH preset as the literature base.');
 const document=await registry.readDocument(baseId);
 const plugins=load(document.content,{schema:entryListSchema});
 if(!Array.isArray(plugins)||!plugins.length)throw new Error('The base DSH preset has no plugin composition.');
 return {
  id:'literature',name:'文献研究',order:95,
  description:'完整 DSH 会话能力，并提供所选论文检索、稿件引用核对和原文定位',
  plugins:[...plugins,{name:'dsh-literature/research'}]
 };
}

export const apply=(ctx,config={})=>{
 // The declaring row must finish before waiting for the host Loader: native
 // presets are sibling rows and can register later during parallel startup.
 ctx.effect(()=>{
  let stopped=false,unregister;
  const controller=new AbortController();
  const cancelled=new Promise(resolve=>controller.signal.addEventListener('abort',()=>resolve(false),{once:true}));
  const ready=(async()=>{
   if(!await Promise.race([ctx.loader.await().then(()=>true),cancelled])||stopped)return;
   const definition=await literatureDefinition(ctx.agentPresets,config);
   if(!stopped)unregister=await ctx.agentPresets.register(definition);
  })();
  ready.catch(error=>{if(!stopped)ctx.logger.error('Literature preset could not load: '+error.message);});
  ctx.provide('literaturePresetStatus',{ready});
  return async()=>{stopped=true;controller.abort();await ready.catch(()=>{});await unregister?.();};
 },'literature: inherited DSH preset');
};
