// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {LibraryStore} from '../lib/store.js';import {prepareReview,citationKeys,bibliographyEntries,matchCitations} from '../lib/manuscript.js';import {focusedIds} from '../lib/retrieval.js';
test('citation and bibliography parsing retain nested titles and ignore commented or wildcard cites',()=>{
 assert.deepEqual(citationKeys('% \\cite{ignored}\nText \\citep[see][p.2]{one,two} and \\textcite{one}. \\nocite{*}'),['one','two']);
 const bib=bibliographyEntries('@article{one,title={An {EEG} study},doi="10.1234/one",year=2024}\n@comment{not a paper}');assert.equal(bib.size,1);assert.equal(bib.get('one').title,'An {EEG} study');assert.equal(bib.get('one').year,'2024');
});
test('mapping never silently resolves ambiguous titles or conflicting identifiers',()=>{
 const papers=[{id:'a',citationKey:'key',title:'An EEG study',doi:'10.1234/a'},{id:'b',citationKey:'other',title:'An EEG study',doi:'10.1234/b'}];
 const m=matchCitations(['key','exact','ambiguous'],new Map([['key',{title:'Different work',doi:'10.1234/not-selected'}],['exact',{title:'An EEG study',doi:'10.1234/a'}],['ambiguous',{title:'An EEG study'}]]),papers);
 assert.equal(m[0].status,'unmatched');assert.equal(m[1].paperId,'a');assert.equal(m[2].status,'ambiguous');assert.deepEqual(m[2].candidates.map(p=>p.paperId),['a','b']);
});
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'literature-manuscript-'))),project=path.join(root,'project'),store=await new LibraryStore(path.join(root,'library')).open();await fs.mkdir(path.join(project,'sec'),{recursive:true});
 const a=store.save({title:'An EEG study',doi:'10.1234/a'}),b=store.save({title:'Another study',doi:'10.1234/b'}),outside=store.save({title:'Outside paper',doi:'10.1234/outside'});store.bind('research',[a.id,b.id]);
 await fs.writeFile(path.join(project,'main.tex'),'\\documentclass{article}\n\\input{sec/introduction}\n\\section{Methods}\nDo not include this section \\cite{methodOnly}.\n\\bibliography{main}\n');
 await fs.writeFile(path.join(project,'sec/introduction.tex'),'\\section{Introduction}\nA statement \\cite{alpha}.\nAnother claim \\cite{outside,missing}.\n% \\cite{commented}\n');
 await fs.writeFile(path.join(project,'main.bib'),'@article{alpha,title={An {EEG} study},doi={10.1234/a}}\n@article{outside,title={Outside paper},doi={10.1234/outside}}\n@article{methodOnly,title={Another study},doi={10.1234/b}}');
 const accessed=[];const ctx={workingDirectory:{ensure:async()=>store.root},fs:{resolve:async(file,{cwd})=>({displayPath:await fs.realpath(path.resolve(cwd,file))}),processPath:t=>t.displayPath,stat:async t=>{const s=await fs.stat(t.displayPath);return {type:s.isFile()?'file':'directory',size:s.size,version:'fixture'};},readText:async t=>{accessed.push(t.displayPath);return fs.readFile(t.displayPath,'utf8');}},emit(){}};
 t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});return {root,project,store,a,b,outside,ctx,accessed,exec:{agent:{},signal:new AbortController().signal}};
}
test('local section planning reads an external project but only returns introduction citations and text',async t=>{
 const f=await fixture(t),result=await prepareReview(f.ctx,f.store,'research',{filePath:path.join(f.project,'main.tex')},f.exec);
 assert.equal(result.citationCount,3);assert.deepEqual(result.matches.map(m=>m.key),['alpha','outside','missing']);assert.equal(result.matches[0].paperId,f.a.id);assert.equal(result.matches[1].status,'unmatched');assert.equal(result.matches[2].status,'missing-bib-entry');assert.deepEqual(focusedIds(f.store,'research'),[f.a.id]);
 assert.ok(!result.lines.some(l=>l.text.includes('Do not include')));assert.ok(result.lines.some(l=>l.file.endsWith('introduction.tex')&&l.line===2));assert.ok(JSON.stringify(result).length<=12000);
});
test('automatic includes cannot escape the requested project through paths or directory aliases',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'private.tex'),'DO NOT READ');await fs.writeFile(path.join(f.project,'main.tex'),'\\input{../private}\n\\section{Introduction}\nText \\cite{alpha}.\n\\bibliography{main}\n');
 const r=await prepareReview(f.ctx,f.store,'research',{filePath:path.join(f.project,'main.tex')},f.exec);assert.ok(r.warnings.length);assert.ok(!f.accessed.includes(path.join(f.root,'private.tex')));
 const alias=path.join(f.project,'alias');await fs.symlink(f.root,alias,'junction');await fs.writeFile(path.join(f.project,'main.tex'),'\\input{alias/private}\n\\section{Introduction}\nText \\cite{alpha}.\n\\bibliography{main}\n');
 await prepareReview(f.ctx,f.store,'research',{filePath:path.join(f.project,'main.tex')},f.exec);assert.ok(!f.accessed.includes(path.join(f.root,'private.tex')));
});
test('a missing heading does not return the entire draft and planning respects its output budget',async t=>{
 const f=await fixture(t),notFound=await prepareReview(f.ctx,f.store,'research',{filePath:path.join(f.project,'main.tex'),section:'Unknown'},f.exec);assert.equal(notFound.status,'section-not-found');assert.equal(notFound.lines,undefined);
 await fs.writeFile(path.join(f.project,'sec/introduction.tex'),'\\section{Introduction}\n'+('A long paragraph. '.repeat(20)+' \\cite{alpha}.\n').repeat(100));
 const result=await prepareReview(f.ctx,f.store,'research',{filePath:path.join(f.project,'main.tex'),maxChars:3000},f.exec);assert.ok(result.textTruncated);assert.ok(result.continueAt);assert.ok(JSON.stringify(result).length<=3000);
});
