// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import test from 'node:test';
import assert from 'node:assert/strict';
import {similarity} from '../lib/metadata.js';
import {createPublicLookup,parseArxiv,crossrefPaper} from '../lib/public-metadata.js';
import {normalizeRank,JournalService} from '../lib/journals.js';
test('metadata matching distinguishes exact titles from unrelated DOI records',()=>{assert.equal(similarity('A neural model: EEG decoding','A Neural Model — EEG Decoding'),1);assert.ok(similarity('Natural image EEG decoding','Molecular dynamics of proteins')<.3);});
test('Crossref chooses publication year and returns bibliographic authors',()=>{const p=crossrefPaper({title:['Real Study'],author:[{given:'A',family:'Reader'}],'published-print':{'date-parts':[[2024]]},published:{'date-parts':[[2023]]},'container-title':['Journal'],DOI:'10.1/real'});assert.equal(p.year,'2024');assert.equal(p.authors,'A Reader');});
test('arXiv Atom is parsed without treating XML as executable content',()=>{const p=parseArxiv('<feed><entry><id>http://arxiv.org/abs/2103.00020v2</id><title>Learning a visual model</title><published>2021-03-01</published><author><name>A &amp; B</name></author><summary>Example</summary></entry></feed>');assert.equal(p.arxivId,'2103.00020');assert.equal(p.year,'2021');assert.equal(p.authors,'A & B');});
test('authorized lookup sends only identifier/title and accepts matching metadata',async()=>{
 const calls=[];
 const fixture={message:{title:['Accurate neural decoding from EEG'],author:[{given:'A',family:'Author'}],DOI:'10.1234/example',issued:{'date-parts':[[2025]]}}};
 const lookup=createPublicLookup({fetchImpl:async u=>{calls.push(u);return {ok:true,json:async()=>fixture};}});
 const r=await lookup({doi:'10.1234/example'},{title:'Accurate neural decoding from EEG',dois:[],arxivIds:[],frontText:'PRIVATE PDF FULLTEXT MUST NOT BE SENT'});
 assert.equal(r.evidence.source,'Crossref DOI');assert.equal(calls.length,1);assert.ok(!calls[0].includes('PRIVATE'));
});
test('easyScholar badges never invent missing metric years',()=>{const v=normalizeRank({code:200,data:{officialRank:{all:{sciif:'4.5',sci:'Q1',sciUp:'医学2区'}}}},'Journal');assert.equal(v.impactFactor,'4.5');assert.equal(v.jcrQuartile,'Q1');assert.equal(v.year,'');assert.throws(()=>normalizeRank({code:40002,msg:'Invalid key'},'Journal'),/easyScholar/);});
test('journal requests deduplicate concurrent lookups and cache results',async()=>{let count=0,cached;const store={db:{prepare:()=>({get:()=>cached?{data:JSON.stringify(cached),updated:new Date().toISOString()}:null})},journalMetrics:(_n,r)=>cached=r};const service=new JournalService(store,{credentials:{resolve:async()=>({value:'test-only-key'}),describe:async()=>({configured:true})},fetchImpl:async()=>{count++;await new Promise(r=>setTimeout(r,5));return {ok:true,json:async()=>({code:200,data:{officialRank:{all:{sciif:'3.7'}}}})};}});const [a,b]=await Promise.all([service.lookup('Journal'),service.lookup('Journal')]);assert.equal(count,1);assert.equal(a.impactFactor,b.impactFactor);await service.lookup('Journal');assert.equal(count,1);});
test('unload cancels current and queued journal requests before database closure',async()=>{let fetches=0,writes=0;const store={db:{prepare:()=>({get:()=>null})},journalMetrics:()=>writes++};const service=new JournalService(store,{credentials:{resolve:async()=>({value:'test-only-key'})},fetchImpl:async(_url,{signal})=>{fetches++;return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});const first=service.lookup('First'),second=service.lookup('Second');await new Promise(r=>setTimeout(r,5));service.stop();const results=await Promise.allSettled([first,second]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(fetches,1);assert.equal(writes,0);assert.equal(service.pending.size,0);});
