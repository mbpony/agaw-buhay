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

// --- boot-check globals must really exist ---------------------------------
// index.html's belt-and-braces banner names one global per module and shouts if
// it is missing. A wrong name makes it cry wolf on EVERY page load even when the
// game boots fine -- it once checked window.DATA, which nothing in the project
// ever defines (the real global is ABAW_DATA). Cross-reference the table against
// what each file actually publishes.
const path=require('path');
console.log('');
console.log('== Boot-check module table ==');
const modBlock=html.match(/var MODULES = \[([\s\S]*?)\];/);
if(!modBlock){ console.log('  \u2717 MODULES table not found in index.html'); process.exit(1); }
const mods=[...modBlock[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map(m=>({file:m[1],global:m[2]}));
if(!mods.length){ console.log('  \u2717 MODULES table parsed to zero entries'); process.exit(1); }
// script srcs are relative to /client/, so ../core/x.js -> core/x.js
const srcs=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1].replace(/^\.\.\//,''));
const resolve=f=>path.join(process.cwd(), f.startsWith('core/')||f.startsWith('server/')?f:path.join('client',f));
let bad=0;
for(const m of mods){
  const p=resolve(m.file);
  const exists=fs.existsSync(p);
  const body=exists?fs.readFileSync(p,'utf8'):'';
  const assigned=m.file.startsWith('vendor/')?true:new RegExp('(root|window|self|globalThis)\\.'+m.global+'\\s*=').test(body);   // vendored libs assign via UMD global param
  const inPage=srcs.indexOf(m.file)!==-1;
  const good=exists&&assigned&&inPage;
  if(!good) bad++;
  console.log('  '+(good?'\u2713':'\u2717')+' '+m.file.padEnd(16)+' -> '+m.global.padEnd(12)+
    '  file='+exists+'  assigns-global='+assigned+'  loaded-by-page='+inPage);
}
for(const sc of srcs){
  if(!mods.some(m=>m.file===sc)){ console.log('  \u2717 '+sc+' is loaded by the page but missing from the boot check'); bad++; }
}
if(bad){ console.log('BOOT-CHECK FAILURES: '+bad); process.exit(1); }
console.log('boot check covers all '+srcs.length+' scripts; every named global is real');
