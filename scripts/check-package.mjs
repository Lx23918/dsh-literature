// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';import {scanText,privateFile,root} from './check-public.mjs';
if(!process.env.npm_execpath)throw new Error('Run this check with npm run check:package');
await fs.mkdir(path.join(root,'dist'),{recursive:true});
const r=spawnSync(process.execPath,[process.env.npm_execpath,'pack','--ignore-scripts','--pack-destination','dist','--json'],{cwd:root,encoding:'utf8'});if(r.status)throw new Error(r.stderr);
const pack=JSON.parse(r.stdout)[0],findings=[];for(const {path:file}of pack.files){if(privateFile(file)||!(/^(lib|assets)\//.test(file)||['package.json','cordis.patch.yml','README.md','LICENSE','NOTICE','requirements.txt'].includes(file))){findings.push({file,rule:'unexpected-package-file'});continue;}const text=await fs.readFile(path.join(root,file),'utf8');for(const rule of scanText(text))findings.push({file,rule});}
for(const needed of ['LICENSE','NOTICE','requirements.txt','cordis.patch.yml','lib/index.js','lib/client.js','lib/typert.js'])if(!pack.files.some(x=>x.path===needed))findings.push({file:needed,rule:'missing-package-file'});
const result={ok:findings.length===0,filename:pack.filename,files:pack.files.length,findings};console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
