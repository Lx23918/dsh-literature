// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors

export async function pruneSessionScopes(store,{sessions,persistence,signal}) {
 const db=store._db;
 const active=()=>!signal?.aborted&&!store.stopping&&!store.migrating&&store._db===db&&db?.isOpen;
 if(!active())return;
 const bindings=db.prepare('SELECT session_id,scope,created FROM sessions').all();
 let failures=0;
 for(const row of bindings){
  if(!active())return;
  if(sessions.get(row.session_id))continue;
  // A disposed or archived Session can still have durable history. Never use
  // the visible sidebar list as proof that it has been deleted.
  let persisted;
  try{persisted=await persistence.stat(row.session_id,{signal});}
  catch{if(!active())return;failures++;continue;}
  if(!active())return;
  if(persisted!==undefined||sessions.get(row.session_id))continue;
  db.prepare('DELETE FROM sessions WHERE session_id=? AND scope=? AND created=?').run(row.session_id,row.scope,row.created);
 }
 if(failures)throw new Error('Some session existence checks failed.');
}

export function installSessionCleanup(ctx,store,{intervalMs=60000}={}) {
 ctx.inject(['sessions','sessionPersistence'],child=>{
  child.effect(()=>{
   const controller=new AbortController();
   let stopped=false,pending;
   const sweep=()=>{
    if(stopped||store.stopping||store.migrating||!store._db?.isOpen)return;
    if(pending)return pending;
    pending=pruneSessionScopes(store,{sessions:child.sessions,persistence:child.sessionPersistence,signal:controller.signal})
     .catch(()=>{if(!stopped&&!store.stopping)child.logger.warn('Literature session cleanup could not finish; it will retry later.');})
     .finally(()=>{pending=undefined;});
    return pending;
   };
   const off=child.on('session/disposed',()=>{void sweep();});
   const timer=setInterval(sweep,intervalMs);timer.unref?.();
   void sweep();
   return async()=>{stopped=true;clearInterval(timer);off();controller.abort();await pending;};
  },'literature: session binding cleanup');
 });
}
