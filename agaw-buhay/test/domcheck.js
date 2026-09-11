const fs=require('fs');
const main=fs.readFileSync('client/main.js','utf8');
const html=fs.readFileSync('client/index.html','utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const used=new Set();
for(const m of main.matchAll(/\$\('([^']+)'\)/g)) used.add(m[1]);
for(const m of main.matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);
for(const m of main.matchAll(/querySelector\('#([\w-]+)'\)/g)) used.add(m[1]);
// ids created at runtime by main.js (element injection / innerHTML strings)
const dyn=new Set([...main.matchAll(/\.id\s*=\s*'([^']+)'/g)].map(m=>m[1]));
for(const m of main.matchAll(/id="([^"]+)"/g)) dyn.add(m[1]);
const missing=[...used].filter(u=>!ids.has(u)&&!dyn.has(u));
if(dyn.size) console.log('runtime-injected ids:', [...dyn].join(', '));
console.log('ids in index.html :', ids.size);
console.log('ids used in main.js:', used.size);
if(missing.length){ console.log('MISSING IDS ('+missing.length+'):'); missing.forEach(m=>console.log('   #'+m)); process.exit(1); }
console.log('all referenced ids exist');
// also check click()/listener targets
const listeners=new Set([...main.matchAll(/(?:click|on)\('([^']+)'/g)].map(m=>m[1]));
const missingL=[...listeners].filter(u=>!ids.has(u));
if(missingL.length) console.log('NOTE listener targets missing:', missingL.join(', '));
// screens
const screens=[...html.matchAll(/id="(sc-[\w-]+)"/g)].map(m=>m[1]);
console.log('screens:', screens.join(', '));
