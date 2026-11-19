// Lets you set a NEW system administrator password (for example if you forgot it).
// Usage:  1) stop the portal   2) node reset-admin.js   3) node server.js
// It clears the old admin password, signs the admin out everywhere, and saves a backup first.
// When the portal starts it prints a one-time link: open it and choose the new password.
// Works in Supabase mode and in local mode (data/db.json). Members' passwords and all records are untouched.
const fs=require('fs'),path=require('path');
require('./lib/env');const store=require('./lib/store');
(async()=>{
 const db=await store.load();
 if(!db){console.log('No portal data found yet. Just start the server: it prints the first-time setup link for the administrator.');process.exit(0)}
 const a=db.members.find(m=>m.role==='admin');
 if(!a){console.log('No administrator account exists. Start the server and it will create one (ADM-001).');process.exit(0)}
 fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
 const bk=path.join(__dirname,'data','db.backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 fs.writeFileSync(bk,JSON.stringify(db,null,1));
 a.pw=null;a.mustChange=false;a.tempExp=null;a.invite=null;a.tv=(a.tv||0)+1;
 (db.audit=db.audit||[]).push({at:new Date().toISOString(),by:a.id,action:'admin-password-reset',detail:'by reset-admin.js'});
 await store.save(db);
 console.log('Administrator '+a.id+' password cleared ('+store.mode()+'). Backup: data/'+path.basename(bk));
 console.log('Now start the portal (node server.js). It prints a link starting with');
 console.log('  http://localhost:3000/#activate/'+a.id+'/...');
 console.log('Open that link and choose the new password.');
})().catch(e=>{console.error('Failed:',e.message);process.exit(1)});
