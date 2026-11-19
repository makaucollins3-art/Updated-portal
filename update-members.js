// Adds the members below to the EXISTING portal data (Supabase, or data/db.json in local mode) without losing payments, minutes, notices or passwords.
// Usage:  stop the server, then run:  node update-members.js            (preview only, changes nothing)
//                                     node update-members.js --apply    (makes the changes, after saving a backup)
// Options: --since=2024-01   start month for NEW members (default 2024-01, same as the founding members)
//          --disable-others  also disable accounts that are not in the list below (records are kept)
const fs=require('fs'),path=require('path'),crypto=require('crypto');
require('./lib/env');const store=require('./lib/store');
const LIST=[ // [name, role]
['David Mackenzie','chair'],['Annastacia Kinyingi','vice'],['Samuel Kavoi','treasurer'],['Alex Mutinda','secretary'],
['Mercy Mwende','vicesec'],['Collins Mwendwa','coordinator'],['Emily Mumbua','board'],['Benjamin Keli','member'],
['Brian Matuva','member'],['Daniel Mutua','member'],['David Kyalo','member'],['Gift Mwendwa','member'],
['Stanley Mutisya','member'],['Sylvia Nzuki','member'],['Felix Kyalo','member'],['Eunice Kimunu','member']];
const apply=process.argv.includes('--apply'),dis=process.argv.includes('--disable-others');
const since=(process.argv.find(a=>a.startsWith('--since='))||'--since=2024-01').split('=')[1];
(async()=>{
const db=await store.load();
if(!db){console.log('No portal data found yet. Nothing to update: just start the server and the list is created automatically.');process.exit(0)}
const before=JSON.stringify(db,null,1),norm=s=>String(s).trim().toLowerCase().replace(/\s+/g,' ');
const nextId=()=>'INV-'+String(Math.max(0,...db.members.filter(m=>m.id.startsWith('INV-')).map(m=>+m.id.slice(4)))+1).padStart(3,'0');
const say=[];
for(const[name,role]of LIST){
 const m=db.members.find(x=>x.role!=='admin'&&norm(x.name)===norm(name));
 if(m){if(m.role!==role){say.push(`ROLE  ${m.id} ${m.name}: ${m.role} -> ${role}`);m.role=role}
  if(m.disabled){say.push(`ENABLE ${m.id} ${m.name}`);m.disabled=false;m.tv=(m.tv||0)+1}}
 else{const n={id:nextId(),name,role,salt:crypto.randomBytes(8).toString('hex'),pw:null,mustChange:false,since,phone:''};db.members.push(n);say.push(`ADD   ${n.id} ${name} (${role}), contributing from ${since}`)}}
const inList=new Set(LIST.map(x=>norm(x[0])));
const others=db.members.filter(m=>m.role!=='admin'&&!inList.has(norm(m.name)));
for(const m of others){if(dis){if(!m.disabled){m.disabled=true;m.tv=(m.tv||0)+1;say.push(`DISABLE ${m.id} ${m.name}`)}}else say.push(`NOTE  ${m.id} ${m.name} is not in the list (left as is; use --disable-others to disable)`)}
for(const r of['chair','treasurer'])if(!db.members.some(m=>m.role===r&&!m.disabled))say.push(`WARNING: nobody is ${r}`);
console.log(say.join('\n')||'Already up to date.');
if(!apply){console.log('\nPreview only. Nothing was changed. Run again with --apply to make these changes.');process.exit(0)}
fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});const bk=path.join(__dirname,'data','db.backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');fs.writeFileSync(bk,before);
(db.audit=db.audit||[]).push({at:new Date().toISOString(),by:'ADM-001',action:'member-list-updated',detail:say.length+' changes by update-members.js'});
await store.save(db);
console.log('\nDone ('+store.mode()+'). Backup saved as data/'+path.basename(bk)+'. Start the server again.');
})().catch(e=>{console.error('Failed:',e.message);process.exit(1)});
