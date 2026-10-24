// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const style=await fs.readFile(path.join(root,'assets/library.css'),'utf8');let client=await fs.readFile(path.join(root,'lib/client.js'),'utf8');
const start=client.indexOf(' const CSS='),end=client.indexOf(' return {inject,apply};',start);if(start<0||end<0)throw new Error('Client CSS marker is missing');
client=client.slice(0,start)+' const CSS='+JSON.stringify(style)+';\n'+client.slice(end);
client=client.replace(/\/\* FEATURES_START \*\/[\s\S]*?\/\* FEATURES_END \*\//,'/* FEATURES_START */\n'+await fs.readFile(path.join(root,'assets/client-features.js'),'utf8')+'\n/* FEATURES_END */');
await fs.writeFile(path.join(root,'lib/client.js'),client);
for(const file of (await fs.readdir(path.join(root,'lib'))).filter(n=>n.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join(root,'lib',file)],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);}
console.log('Built the native DSH client bundle; JavaScript syntax checks passed.');
