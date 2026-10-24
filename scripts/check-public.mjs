// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const excluded=new Set(['.git','node_modules','dist','runtime','dev','evidence','coverage','tmp','.cache','.venv','venv','__pycache__']);
const roots=new Set(['.gitignore','.gitattributes','package.json','package-lock.json','README.md','LICENSE','NOTICE','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md','requirements.txt','cordis.patch.yml']);
const directories=['lib/','assets/','tests/','scripts/','docs/','.github/'];
export function scanText(text){
 const patterns=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider-key',/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|ya29\.[A-Za-z0-9_-]{25,})\b/],
  ['opaque-32-hex-secret',/\b[0-9a-fA-F]{32}\b/],
  ['private-machine-path',/(?:[A-Za-z]:[\\/](?:Users|AgentData|Software|Program Files|文献)[\\/]|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/)/],
  ['personal-email',/\b[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|qq|163|126)\.(?:com|net)\b/i],
  ['embedded-url-password',/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
  ['literal-credential',/\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*["'][A-Za-z0-9_+./=-]{20,}["']/i]
 ];
 return patterns.filter(([,pattern])=>pattern.test(text)).map(([rule])=>rule);
}
export function allowedFile(file){return roots.has(file)||directories.some(prefix=>file.startsWith(prefix));}
export function privateFile(file){return /(?:^|\/)(?:STATE\.md|\.env(?:\..*)?|\.credentials[^/]*|auth\.json|proxy\.json|integrations\.json|storage\.json)$/.test(file)||/\.(?:sqlite(?:-wal|-shm)?|db|pdf|log|bak|backup)$/i.test(file)||file.split('/').some(p=>['runtime','dev','evidence','node_modules','__pycache__'].includes(p));}
async function walk(dir,prefix=''){let files=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const rel=prefix+entry.name;if(entry.isSymbolicLink())throw new Error('Public source must not contain symlinks: '+rel);if(entry.isDirectory()){if(!excluded.has(entry.name))files.push(...await walk(path.join(dir,entry.name),rel+'/'));}else files.push(rel);}return files;}
export async function audit({staged=false}={}){
 let files;if(staged){const r=spawnSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'});if(r.status)throw new Error('Cannot read the Git index');files=r.stdout.split('\0').filter(Boolean);}else{files=await walk(root);const tracked=spawnSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'});if(tracked.status===0)files=[...new Set([...files,...tracked.stdout.split('\0').filter(Boolean)])];}
 const read=async file=>{if(!staged)return fs.readFile(path.join(root,file));const r=spawnSync('git',['show',':'+file],{cwd:root,maxBuffer:10*1024*1024});if(r.status)throw new Error('Cannot read staged blob: '+file);return r.stdout;};
 let approved=[];try{approved=JSON.parse((await read('docs/public-assets.json')).toString('utf8'));}catch{}
 const findings=[];for(const file of files){if(!allowedFile(file)||privateFile(file)){findings.push({file,rule:'unapproved-or-private-file'});continue;}const bytes=await read(file);if(/\.(?:png|jpe?g|webp)$/i.test(file)){const sha=createHash('sha256').update(bytes).digest('hex');if(!approved.some(a=>a.path===file&&a.sha256===sha))findings.push({file,rule:'binary-asset-needs-manual-review'});continue;}if(bytes.includes(0)){findings.push({file,rule:'unexpected-binary'});continue;}for(const rule of scanText(bytes.toString('utf8')))findings.push({file,rule});}
 return {ok:findings.length===0,files:files.length,mode:staged?'git-index':'working-tree',findings};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const result=await audit({staged:process.argv.includes('--staged')});console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}
