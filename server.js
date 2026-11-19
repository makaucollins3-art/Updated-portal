// InvestHub backend: Node.js built-ins only, no npm install needed.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
require('./lib/env');const store=require('./lib/store'),sb=require('./lib/supabase'),mailer=require('./lib/mailer');
const PORT=3000,DIR=__dirname,PUB=path.join(DIR,'public');
const FINE=200,START='2024-01',DEFAULT_RATES=[{from:'2024-01',to:'2024-06',monthly:1000,agm:0,welfare:0},{from:'2024-07',to:'2024-12',monthly:1500,agm:0,welfare:0},{from:'2025-01',to:'2025-06',monthly:2000,agm:0,welfare:0},{from:'2025-07',to:'2025-12',monthly:2500,agm:0,welfare:0},{from:'2026-01',to:'2026-06',monthly:3000,agm:0,welfare:0},{from:'2026-07',to:'2026-12',monthly:3500,agm:0,welfare:0}],NAMES=['David Mackenzie','Annastacia Kinyingi','Samuel Kavoi','Alex Mutinda','Mercy Mwende','Collins Mwendwa','Emily Mumbua','Benjamin Keli','Brian Matuva','Daniel Mutua','David Kyalo','Gift Mwendwa','Stanley Mutisya','Sylvia Nzuki','Felix Kyalo','Eunice Kimunu'];
const ROLES={'David Mackenzie':'chair','Annastacia Kinyingi':'vice','Samuel Kavoi':'treasurer','Collins Mwendwa':'coordinator','Alex Mutinda':'secretary','Mercy Mwende':'vicesec','Emily Mumbua':'board'},ROLE_LIST=['chair','vice','treasurer','secretary','vicesec','coordinator','board','member'];
const nowEAT=()=>new Date(Date.now()+3*3600e3),curYM=()=>{const e=nowEAT();return e.getUTCFullYear()+'-'+String(e.getUTCMonth()+1).padStart(2,'0')},ymOk=x=>/^\d{4}-(0[1-9]|1[0-2])$/.test(x||'')&&x>=START&&x<=curYM();
const log=(u,a,d)=>{(db.audit=db.audit||[]).push({at:new Date().toISOString(),by:u.id,action:a,detail:d})};
const hash=(pin,salt)=>crypto.scryptSync(String(pin),salt,32).toString('hex');
function seed(){const members=NAMES.map((name,i)=>{const salt=crypto.randomBytes(8).toString('hex');
 return{id:'INV-'+String(i+1).padStart(3,'0'),name,role:ROLES[name]||'member',salt,pw:null,mustChange:false,
  since:START}});
 return{secret:crypto.randomBytes(32).toString('hex'),members,rates:DEFAULT_RATES.map(r=>({...r})),payments:[],v:2,minutes:[],records:[],notices:[{id:'N1',title:'Welcome to the IFT portal',body:'IFT stands for Investment For Tomorrow. Check your contributions and statement here, and read notices from the coordinator.',audience:'all',pinned:true,important:false,by:(members.find(m=>m.role==='coordinator')||members[0]).id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reads:[]}]}}
let db;
function prevYM(ym){let y=+ym.slice(0,4),m=+ym.slice(5)-1;if(m<1){m=12;y--}return y+'-'+String(m).padStart(2,'0')}
function upgrade(){
db.rates=db.rates&&db.rates.length?db.rates:DEFAULT_RATES.map(r=>({...r}));db.payments=db.payments||[];
db.rates.sort((x,y)=>x.from<y.from?-1:1).forEach((r,i,a)=>{if(r.to===undefined)r.to=a[i+1]?prevYM(a[i+1].from):null});
if((db.v||1)<2){const had=db.payments.length;
 db.members.forEach(m=>{if(m.role!=='admin'){const f=Array.isArray(m.s)?m.s.findIndex(x=>x!=='n'):0;m.since=f>0?'2026-'+String(f+1).padStart(2,'0'):START}delete m.s;delete m.refs;delete m.credit});
 db.payments=db.payments.filter(p=>p.source!=='sample');
 db.payments.forEach(p=>{if(Array.isArray(p.months)&&p.months.length)p.start='2026-'+String(p.months[0]+1).padStart(2,'0');delete p.months});
 log({id:'ADM-001'},'ledger-upgrade','Multi-year ledger from '+START+'. '+(had-db.payments.length)+' sample opening records removed.');db.v=2}
db.members.forEach(m=>{if(m.role!=='admin'&&!m.since)m.since=START});
db.members.forEach(m=>{if('pin' in m){if(m.mustChange){m.pw=null;m.mustChange=false}else{m.pw=m.pin;m.mustChange=true}delete m.pin}if(m.pw===undefined)m.pw=null});
db.requests=db.requests||[];db.files=db.files||[];if(!db.members.some(m=>m.role==='admin'))db.members.push({id:'ADM-001',name:'System Administrator',role:'admin',salt:crypto.randomBytes(8).toString('hex'),pw:null,mustChange:false});db.minutes=db.minutes||[];db.records=db.records||[];db.notices=db.notices||[];
if(!db.webhookSecret)db.webhookSecret=crypto.randomBytes(16).toString('hex');
db.signups=db.signups||[];
}

const eatDay=iso=>new Date(Date.parse(iso)+3*3600e3).toISOString().slice(0,10),
 monthsFrom=(a,z)=>{const o=[];let[y,m]=a.split('-').map(Number);const[y2,m2]=z.split('-').map(Number);while(y<y2||(y===y2&&m<=m2)){o.push(y+'-'+String(m).padStart(2,'0'));if(++m>12){m=1;y++}}return o},
 rateFor=ym=>db.rates.find(x=>x.from<=ym&&(!x.to||ym<=x.to))||null;
// A member's position is calculated from their payments and the rate table, so reversing, moving or back-dating a payment always stays consistent.
// Each payment fills the oldest unpaid months first (or the month the treasurer chose), and within a month: monthly, then AGM, then welfare.
function ledger(m){const cur=curYM(),end=cur.slice(0,4)+'-12',since=m.since&&m.since>START?m.since:START,
 M=(since>end?[]:monthsFrom(since,end)).map(ym=>{const r=rateFor(ym);return{ym,due:r?[r.monthly,r.agm,r.welfare]:[0,0,0],norate:!r,paid:[0,0,0],late:false,refs:[]}}),idx={};M.forEach((x,i)=>idx[x.ym]=i);
 const alloc={};let credit=0;
 for(const p of db.payments.filter(p=>p.memberId===m.id&&p.status==='matched').sort((a,b)=>byTime(a,b)||(a.id<b.id?-1:1))){
  let rem=p.amount;const a={t:[0,0,0],months:[],credit:0},order=[],day=eatDay(p.receivedAt);
  if(p.start&&idx[p.start]!=null)order.push(p.start);M.forEach(x=>{if(x.ym<=cur&&!x.norate&&!order.includes(x.ym))order.push(x.ym)});
  for(const ym of order){if(rem<=0)break;const x=M[idx[ym]];let used=false;
   for(let k=0;k<3&&rem>0;k++){const need=x.due[k]-x.paid[k];if(need>0){const t=Math.min(rem,need);x.paid[k]+=t;a.t[k]+=t;rem-=t;used=true}}
   if(used){if(day>ym+'-10')x.late=true;x.refs.push(p.ref);a.months.push(ym)}}
  a.credit=rem;credit+=rem;alloc[p.id]=a}
 let fines=0,arrears=0,due=0;const paid=[0,0,0];
 M.forEach(x=>{if(x.norate){x.s='n';return}const D=x.due[0]+x.due[1]+x.due[2],P=x.paid[0]+x.paid[1]+x.paid[2];x.paid.forEach((v,k)=>paid[k]+=v);
  x.s=x.ym>cur?(P>=D?'p':'f'):P>=D?(x.late?'l':'p'):x.ym===cur?'d':'m';
  if(x.s==='l')fines+=FINE;if(x.s==='m')arrears+=D-P;if(x.s==='d')due+=D-P});
 return{since,months:M,alloc,credit,fines,arrears,paid,due}}
const save=()=>store.save(db);
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const sign=s=>crypto.createHmac('sha256',db.secret).update(s).digest('base64url');
const issue=(id,by)=>{const p=b64({id,v:(db.members.find(m=>m.id===id)||{}).tv||0,exp:Date.now()+(by?4:12)*3600e3,...(by?{as:by.id,av:by.tv||0}:{})});return p+'.'+sign(p)};
function auth(req){const t=(req.headers.authorization||'').replace('Bearer ','');const[p,s]=t.split('.');
 if(!p||!s||s!==sign(p))return null;try{const{id,exp,v,as,av}=JSON.parse(Buffer.from(p,'base64url'));if(exp<Date.now())return null;const m=db.members.find(x=>x.id===id);if(!(m&&!m.disabled&&(m.tv||0)===(v||0)))return null;if(as){const a=db.members.find(x=>x.id===as);if(!(a&&a.role==='admin'&&!a.disabled&&(a.tv||0)===(av||0)))return null}req.viaAdmin=as||'';return m}catch{return null}}
const pub=m=>{if(m.role==='admin')return{id:m.id,name:m.name,role:m.role};const L=ledger(m);return{id:m.id,name:m.name,role:m.role,since:L.since,led:{months:L.months.map(x=>({ym:x.ym,s:x.s,d:x.due,p:x.paid,r:x.refs})),credit:L.credit,fines:L.fines,arrears:L.arrears,paid:L.paid,due:L.due}}};
const PHONE_ERR='Enter a valid Kenyan phone number, for example 0712 345 678.';
function normPhone(x){let d=String(x||'').replace(/\D/g,'');if(!d)return'';if(d.length===10&&d[0]==='0')d='254'+d.slice(1);else if(d.length===9&&/^[17]/.test(d))d='254'+d;return/^254[17]\d{8}$/.test(d)?d:''}
const cleanName=x=>String(x==null?'':x).replace(/[<>&"`]/g,'').trim().slice(0,60),isAdmin=u=>u.role==='admin',nextId=p=>p+'-'+String(Math.max(0,...db.members.filter(m=>m.id.startsWith(p+'-')).map(m=>+m.id.slice(4)))+1).padStart(3,'0'),isSec=u=>u.role==='secretary'||u.role==='vicesec',isCoord=u=>u.role==='coordinator',isOff=u=>u.role!=='member',uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const EXT={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',csv:'text/csv'};
function fileOk(ext,buf){const h=buf.subarray(0,8);if(ext==='pdf')return buf.subarray(0,5).toString()==='%PDF-';if(ext==='png')return h[0]===0x89&&h[1]===0x50;if(ext==='jpg'||ext==='jpeg')return h[0]===0xFF&&h[1]===0xD8;if(['docx','xlsx','pptx'].includes(ext))return h[0]===0x50&&h[1]===0x4B;return!buf.includes(0)}
const fileOut=f=>({id:f.id,name:f.name,size:f.size});
async function dropFiles(pid){const gone=db.files.filter(f=>f.parentId===pid);for(const f of gone)await store.delFile(f.id).catch(()=>{});db.files=db.files.filter(f=>f.parentId!==pid)}
const clean=x=>String(x==null?'':x).replace(/[<>&"'`]/g,'');
const byTime=(a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt);
const canEdit=u=>u.role==='treasurer',seesAll=u=>['treasurer','chair','vice','board'].includes(u.role),isChair=u=>u.role==='chair'||u.role==='vice';
const tries={};
function limited(ip){const n=Date.now(),a=(tries[ip]||[]).filter(t=>n-t<9e5);tries[ip]=a;return a.length>=10}
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(o))};
const sha=x=>crypto.createHash('sha256').update(String(x)).digest('hex'),safeEq=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const ipOf=req=>process.env.TRUST_PROXY?String(req.headers['x-forwarded-for']||'').split(',').pop().trim()||req.socket.remoteAddress:req.socket.remoteAddress;
const baseUrl=req=>process.env.PUBLIC_URL||((process.env.TRUST_PROXY&&req.headers['x-forwarded-proto'])||'http')+'://'+req.headers.host;
const COMMON=['password','12345678','123456789','1234567890','qwertyui','qwerty123','iloveyou','11111111','00000000','abcd1234','password1','password123','kenya123','nairobi123','welcome1','welcome123'];
function pwError(p,id){p=String(p||'');if(p.length<8)return'Use at least 8 characters.';if(p.length>100)return'That password is too long.';
 if(COMMON.includes(p.toLowerCase())||p.toLowerCase()===String(id).toLowerCase()||new Set(p).size<3)return'That password is too easy to guess. Choose another.';return''}
const invOk=(m,t)=>!!(m&&m.invite&&m.invite.exp>Date.now()&&safeEq(sha(t||''),m.invite.h));
const body=(req,max=1e6)=>new Promise((ok,no)=>{let d='';req.on('data',c=>{d+=c;if(d.length>max){no();req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(d||'{}'))}catch{no()}})});

// ---- Deposits: any Kenyan bank, M-Pesa or Pesalink -> NCBA account -> matched to a member by the account ID in the reference
function toIso(s){s=String(s||'').trim();let m;
 if(m=s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/))return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`;
 if(m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/))return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T${(m[4]||'12').padStart(2,'0')}:${m[5]||'00'}:00+03:00`;
 if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s))return s.replace(' ','T')+(s.length<=16?':00':'')+'+03:00';
 const t=Date.parse(s);return isNaN(t)?new Date().toISOString():new Date(t).toISOString()}
function applyPay(m,p,start){p.memberId=m.id;p.status='matched';if(start)p.start=start;else delete p.start}
function unapply(p){if(p.status==='matched')p.status='unmatched';delete p.start}
const pick=(b,k)=>{for(const x of k)if(b[x]!=null&&b[x]!=='')return b[x]};
// NCBA has not published its notification format publicly, so common field names are accepted. Add yours here once NCBA gives you the spec.
function ingest(b,source,forced,start,by){
 const amount=Number(String(pick(b,['amount','Amount','transAmount','TransAmount','creditAmount','credit'])||0).replace(/,/g,'')),
 ref=clean(pick(b,['transactionReference','transactionId','TransID','reference','referenceNumber','id','ref'])).trim().slice(0,40);
 if(!(amount>0)||!ref)return{error:'Amount and reference are required.'};
 if(db.payments.some(p=>p.ref===ref&&p.status!=='voided'))return{duplicate:true};
 const narr=clean(pick(b,['narration','Narration','description','billRefNumber','BillRefNumber','accountNumber','remarks','particulars'])).slice(0,120),
 mm=narr.match(/INV-\d{3}/i),m=forced||(mm&&db.members.find(x=>x.id===mm[0].toUpperCase()&&x.role!=='admin'));
 const p={id:'P'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),amount,ref,narration:narr,payer:clean(pick(b,['customerName','payerName','senderName','FirstName','name'])).slice(0,60),
  channel:clean(pick(b,['channel','paymentMode','bank','senderBank','transactionType'])||source).slice(0,30),receivedAt:toIso(pick(b,['transactionDate','transTime','TransTime','timestamp','valueDate','date','postedAt'])),
  source,months:[],memberId:null,status:'unmatched'};if(by)p.recordedBy=by;
 db.payments.push(p);if(m)applyPay(m,p,start);return{payment:p}}
function parseCsv(t){const rows=[];let r=[],c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];if(q){if(ch==='"'&&t[i+1]==='"'){c+='"';i++}else if(ch==='"')q=false;else c+=ch}else if(ch==='"')q=true;else if(ch===','){r.push(c);c=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;r.push(c);c='';if(r.some(x=>x.trim()))rows.push(r);r=[]}else c+=ch}r.push(c);if(r.some(x=>x.trim()))rows.push(r);return rows}

// ---- Self-service accounts (Supabase Auth): sign up, sign in with email, forgot password
const cleanEmail=x=>String(x||'').trim().toLowerCase().slice(0,254),isEmail=x=>/^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,190}\.[A-Za-z]{2,}$/.test(x);
const WAIT_MSG='Your email is confirmed, but the system administrator has not approved your account yet. Try again after they approve it.';
const randPw=()=>crypto.randomBytes(24).toString('base64url');
const confirmed=u=>!!(u&&(u.email_confirmed_at||u.confirmed_at));
// ---- Emails sent by the portal itself (lib/mailer.js). Supabase only creates the one-time token.
const first=n=>String(n||'').split(' ')[0]||'there',tail='\n\nIFT - Investment For Tomorrow';
const mailConfirm=(req,email,name,th)=>mailer.send({to:email,subject:'Confirm your email for the IFT portal',
 text:'Hello '+first(name)+',\n\nPlease confirm your email address to finish creating your IFT portal account:\n\n'+baseUrl(req)+'/#verify/'+encodeURIComponent(th)+'\n\nAfter that, the system administrator approves your account and you can sign in with your email and password.\n\nIf you did not ask for this, you can ignore this message.'+tail});
const mailReset=(req,email,name,th)=>mailer.send({to:email,subject:'Reset your IFT portal password',
 text:'Hello '+first(name)+',\n\nUse this link to choose a new password for your IFT portal account:\n\n'+baseUrl(req)+'/#reset/'+encodeURIComponent(th)+'\n\nThe link works once and expires soon. If you did not ask for this, you can ignore this message and your password stays as it is.'+tail});
async function sendReset(req,m){const r=await sb.auth.generateLink('recovery',m.email);if(!r||!r.hashed_token)throw new Error('Supabase did not return a reset token');await mailReset(req,m.email,m.name,r.hashed_token)}
// Sign-up picks a name that already exists in the system. The browser only sees an opaque key, never the account ID.
const pickKey=id=>crypto.createHmac('sha256',db.secret).update('pick:'+id).digest('hex').slice(0,16);
const claimable=()=>db.members.filter(m=>m.role!=='admin'&&!m.authId&&!m.disabled&&!db.signups.some(s=>s.status==='new'&&s.confirmedAt&&s.memberId===m.id));
function limitedN(k,n){const t=Date.now(),a=(tries[k]||[]).filter(x=>t-x<9e5);tries[k]=a;return a.length>=n}
async function dropUnconfirmed(memberId,email){ // an unconfirmed sign-up proves nothing, so a retry replaces it
 for(const x of db.signups.filter(y=>y.status==='new'&&(y.memberId===memberId||y.email===email))){
  let ok=!!x.confirmedAt;if(!ok){try{ok=confirmed(await sb.auth.adminGet(x.authId))}catch{ok=true}}
  if(ok)continue;try{await sb.auth.adminDelete(x.authId)}catch(e){if(e.status!==404)throw e}db.signups=db.signups.filter(y=>y!==x)}}
async function emailLogin(req,res,b){
  if(!sb.enabled())return send(res,503,{error:'Email sign-in is not switched on. Use your account ID instead.'});
  const email=cleanEmail(b.id),ik='ip:'+ipOf(req),ak='em:'+email;
  if(limited(ik)||limited(ak))return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
  let r;
  try{r=await sb.auth.signIn(email,String(b.password||''))}
  catch(x){
    if(x.status===400||x.status===401||x.status===422){tries[ik].push(Date.now());tries[ak].push(Date.now());
      if(/not[ _]confirmed/i.test(x.code+' '+x.message))return send(res,401,{error:'Please confirm your email first. Open the link in the message we sent you, then sign in.'});
      return send(res,401,{error:'Email or password is wrong. If you have not created an account yet, tap Create account.'})}
    console.error('login:',x.message);return send(res,502,{error:'Sign-in is unavailable right now. Please try again shortly.'})}
  const m=db.members.find(x=>x.authId&&r.user&&x.authId===r.user.id);
  if(!m)return send(res,403,{pending:true,error:WAIT_MSG});
  if(m.disabled)return send(res,401,{error:'Email or password is wrong. If you have not created an account yet, tap Create account.'});
  return send(res,200,{token:issue(m.id),me:{...pub(m),mustChange:false,email:m.email||''}})}

async function api(req,res,url){

 const q=new URL(req.url,'http://x').searchParams;
 if(url==='/api/desk/files'&&!auth(req))return send(res,401,{error:'Please sign in.'});
 let b={};if(req.method==='POST'){try{b=await body(req,url==='/api/desk/files'?8e6:1e6)}catch{return send(res,400,{error:'Invalid request.'})}}
 if(url==='/api/login'&&req.method==='POST'&&String(b.id||'').includes('@'))return emailLogin(req,res,b);
 if(url==='/api/login'&&req.method==='POST'){const id=String(b.id||'').toUpperCase().slice(0,12),ik='ip:'+ipOf(req),ak='id:'+id;
  if(limited(ik)||limited(ak))return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
  const m=db.members.find(x=>x.id===id);
  if(!(m&&m.pw&&!m.disabled&&safeEq(hash(b.password||'',m.salt),m.pw))){tries[ik].push(Date.now());tries[ak].push(Date.now());return send(res,401,{error:'Account ID or password is wrong. If you have not set a password yet, use the personal link you were sent.'})}
  if(m.mustChange&&m.tempExp&&m.tempExp<Date.now())return send(res,401,{error:'This temporary password has expired. Ask the system administrator for a new one.'});
  return send(res,200,{token:issue(m.id),me:{...pub(m),mustChange:!!m.mustChange}})}
 if((url==='/api/activate/info'||url==='/api/activate')&&req.method==='POST'){const ik='ip:'+ipOf(req);if(limited(ik))return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
  const m=db.members.find(x=>x.id===String(b.id||'').toUpperCase());
  if(!invOk(m,b.token)){tries[ik].push(Date.now());return send(res,400,{error:'This link is invalid, already used, or has expired. Ask the treasurer or secretary for a new one.'})}
  if(url==='/api/activate/info')return send(res,200,{name:m.name,kind:(m.invite&&m.invite.kind)||'new'});
  const e=pwError(b.password,m.id);if(e)return send(res,400,{error:e});
  m.pw=hash(b.password,m.salt);m.invite=null;m.tempExp=null;m.mustChange=false;m.tv=(m.tv||0)+1;log(m,'password-set',m.id);await save();
  return send(res,200,{token:issue(m.id),me:{...pub(m),mustChange:false}})}
 if(url==='/api/signup/names'&&req.method==='GET'){ // names already in the system that have no login yet
  if(!sb.enabled())return send(res,503,{error:'Online sign-up is not switched on for this portal.'});
  const ik='sn:'+ipOf(req);if(limitedN(ik,40))return send(res,429,{error:'Too many attempts. Please try again later.'});tries[ik].push(Date.now());
  return send(res,200,claimable().map(m=>({k:pickKey(m.id),name:m.name})).sort((x,y)=>x.name.localeCompare(y.name)))}
 if(url==='/api/signup'&&req.method==='POST'){
  if(!sb.enabled())return send(res,503,{error:'Online sign-up is not switched on for this portal.'});
  if(!mailer.enabled()&&!mailer.devMode())return send(res,503,{error:'Sign-up is paused: the portal cannot send emails yet. Please ask the system administrator to finish the email (SMTP) setup.'});
  const ik='su:'+ipOf(req);if(limitedN(ik,20))return send(res,429,{error:'Too many attempts. Please try again later.'});tries[ik].push(Date.now());
  const m=claimable().find(x=>pickKey(x.id)===String(b.pick||'')),email=cleanEmail(b.email),ph=normPhone(b.phone);
  if(!m)return send(res,400,{error:'Choose your name from the list. If your name is not there, ask the system administrator to add you first.'});
  if(!isEmail(email))return send(res,400,{error:'Enter a valid email address.'});
  if(!ph)return send(res,400,{error:PHONE_ERR});
  const pe=pwError(b.password,'');if(pe)return send(res,400,{error:pe});
  if(db.members.some(x=>x.email===email))return send(res,200,{ok:true});
  try{await dropUnconfirmed(m.id,email)}catch(x){console.error('signup cleanup:',x.message);return send(res,502,{error:'Could not create the account right now. Please try again later.'})}
  if(db.signups.some(x=>x.email===email))return send(res,200,{ok:true});
  if(db.signups.some(x=>x.status==='new'&&x.memberId===m.id))return send(res,409,{error:'An account request for this name is already waiting for approval. If it was not you, tell the system administrator.'});
  let r;try{r=await sb.auth.generateLink('signup',email,{password:String(b.password),data:{name:m.name}})}
  catch(x){if(x.status===429||/rate/i.test(x.code))return send(res,429,{error:'Too many sign-ups right now. Please try again in a little while.'});
   if(x.status===422&&/exist|registered/i.test(x.code+' '+x.message))return send(res,200,{ok:true});
   if(x.status===400||x.status===422)return send(res,400,{error:String(x.message||'Could not create the account.').slice(0,200)});
   console.error('signup:',x.message);return send(res,502,{error:'Could not create the account right now. Please try again later.'})}
  const authId=r&&(r.id||(r.user&&r.user.id)),th=r&&r.hashed_token;
  if(!authId||!th){if(authId)await sb.auth.adminDelete(authId).catch(()=>{});console.error('signup: Supabase returned no confirmation token');return send(res,502,{error:'Could not create the account right now. Please try again later.'})}
  const row={id:uid(),authId,email,name:m.name,memberId:m.id,phone:ph,phoneMatch:m.phone?m.phone===ph:null,at:new Date().toISOString(),status:'new'};
  db.signups.push(row);await save();
  try{await mailConfirm(req,email,m.name,th)}
  catch(x){console.error('signup email failed:',x.message);db.signups=db.signups.filter(y=>y!==row);await save().catch(()=>{});await sb.auth.adminDelete(authId).catch(()=>{});
   return send(res,502,{error:'We could not send the confirmation email, so the account was not created. Please try again later or tell the system administrator.'})}
  return send(res,200,{ok:true})}
 if(url==='/api/verify'&&req.method==='POST'){ // the member opened the confirmation link from the email
  if(!sb.enabled())return send(res,503,{error:'Email confirmation is not switched on.'});
  const ik='vf:'+ipOf(req);if(limited(ik))return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});tries[ik].push(Date.now());
  const token=String(b.token||'').slice(0,300);if(!token)return send(res,400,{error:'This confirmation link is incomplete.'});
  let v;try{v=await sb.auth.verify('signup',token)}catch(x){if(x.status&&x.status<500)return send(res,400,{error:'This confirmation link is invalid or was already used. If you already confirmed, wait for the system administrator to approve your account. Otherwise create the account again.'});console.error('verify:',x.message);return send(res,502,{error:'Could not confirm your email right now. Please try the link again in a minute.'})}
  const aid=v&&v.user&&v.user.id,x=aid&&db.signups.find(y=>y.authId===aid);if(x&&!x.confirmedAt){x.confirmedAt=new Date().toISOString();await save()}
  return send(res,200,{ok:true})}
 if(url==='/api/forgot'&&req.method==='POST'){const ik='fg:'+ipOf(req);if(limited(ik))return send(res,429,{error:'Too many requests. Try again in 15 minutes.'});tries[ik].push(Date.now());
  const raw=String(b.id||b.email||'').trim(),mail=raw.includes('@')?cleanEmail(raw):'';
  const m=mail?db.members.find(x=>x.email===mail):db.members.find(x=>x.id===raw.toUpperCase().slice(0,12));
  const to=mail||(m&&m.authId&&m.email)||'';
  if(to&&sb.enabled()){ // email accounts: the portal emails a reset link to the address on file
   const mm=db.members.find(x=>x.authId&&x.email===to&&!x.disabled),ek='fe:'+to;
   if(mm&&!limited(ek)){tries[ek].push(Date.now());try{await sendReset(req,mm)}catch(x){console.error('reset email:',x.message)}}
   return send(res,200,{ok:true,emailed:true})}
  if(m){const ph=normPhone(b.phone),match=!!(ph&&m.phone&&ph===m.phone),at=new Date().toISOString(),r=db.requests.find(x=>x.memberId===m.id&&x.status==='open');
   if(r){r.at=at;r.phoneMatch=r.phoneMatch||match}else db.requests.push({id:uid(),memberId:m.id,at,phoneMatch:match,status:'open'});await save()}
  return send(res,200,{ok:true})}
 if(url==='/api/reset'&&req.method==='POST'){ // finishes the email reset: the browser sends the one-time token from the link
  if(!sb.enabled())return send(res,503,{error:'Email reset is not switched on.'});
  const ik='rs:'+ipOf(req);if(limited(ik))return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});tries[ik].push(Date.now());
  const pe=pwError(b.password,'');if(pe)return send(res,400,{error:pe});
  const token=String(b.token||'').slice(0,4000),BAD='This reset link is invalid or has expired. Ask for a new one.';let aid;
  if(/^eyJ/.test(token)){ // a link from an older Supabase-sent email
   try{aid=(await sb.auth.userFromToken(token)).id}catch{return send(res,400,{error:BAD})}
   try{await sb.auth.setPassword(token,String(b.password))}catch(x){return send(res,400,{error:String(x.message||'Could not set the new password.').slice(0,200)})}}
  else{let v;try{v=await sb.auth.verify('recovery',token)}catch(x){if(x.status&&x.status<500)return send(res,400,{error:BAD});console.error('reset:',x.message);return send(res,502,{error:'Could not check the link right now. Please try again in a minute.'})}
   aid=v&&v.user&&v.user.id;if(!aid)return send(res,400,{error:BAD});
   const mm=db.members.find(x=>x.authId===aid);if(mm&&mm.disabled)return send(res,400,{error:'This account is disabled. Contact the system administrator.'});
   try{await sb.auth.adminSetPassword(aid,String(b.password))}catch(x){return send(res,400,{error:String(x.message||'Could not set the new password.').slice(0,200)})}}
  const m=db.members.find(x=>x.authId&&x.authId===aid);if(m){m.tv=(m.tv||0)+1;log(m,'password-reset-by-email',m.id);await save()}
  return send(res,200,{ok:true})}
 if(url==='/api/webhooks/ncba'&&req.method==='POST'){const k=String(req.headers['x-webhook-secret']||q.get('key')||''),w=process.env.NCBA_WEBHOOK_SECRET||db.webhookSecret;
  if(k.length!==w.length||!crypto.timingSafeEqual(Buffer.from(k),Buffer.from(w)))return send(res,401,{error:'Unauthorized'});
  const r=(Array.isArray(b)?b:[b]).map(x=>ingest(x||{},'ncba-ipn'));await save();return send(res,200,{ok:true,received:r.filter(x=>x.payment).length,duplicates:r.filter(x=>x.duplicate).length})}
 const u=auth(req);if(!u)return send(res,401,{error:'Please sign in.'});
 if(url==='/api/switch/back'&&req.method==='POST'){const a=req.viaAdmin&&db.members.find(x=>x.id===req.viaAdmin);if(!a)return send(res,400,{error:'You have not opened this account as the administrator.'});
  log(a,'admin-closed-account',u.id);await save();return send(res,200,{token:issue(a.id),me:{...pub(a),mustChange:false}})}
 const ADM_ONLY=['/api/signups','/api/signups/approve','/api/signups/reject','/api/invite','/api/reset-password','/api/switch','/api/invite-all','/api/requests','/api/requests/dismiss','/api/members/disable','/api/admins','/api/audit','/api/backup'],ADM_OK=[...ADM_ONLY,'/api/me','/api/config','/api/password','/api/password/email','/api/members','/api/members/update'];
 if(isAdmin(u)&&!ADM_OK.includes(url))return send(res,403,{error:'The system administrator account manages accounts and sign-ins only. It cannot see contributions, minutes or notices.'});
 if(!isAdmin(u)&&(ADM_ONLY.includes(url)||(url==='/api/members'&&req.method==='POST')))return send(res,403,{error:'Only the system administrator can do this.'});
 if(url==='/api/signups'&&req.method==='GET'){
  const list=await Promise.all(db.signups.filter(x=>x.status==='new').map(async x=>{let ok=null;try{ok=confirmed(await sb.auth.adminGet(x.authId))}catch{}
   const nm=String(x.name).toLowerCase().replace(/\s+/g,' '),hit=db.members.find(m=>m.role!=='admin'&&!m.authId&&(String(m.name).toLowerCase().replace(/\s+/g,' ')===nm||(m.phone&&m.phone===x.phone)));
   if(ok===null&&x.confirmedAt)ok=true;return{id:x.id,name:x.name,email:x.email,phone:x.phone,at:x.at,confirmed:ok,suggest:x.memberId||(hit?hit.id:''),picked:!!x.memberId,phoneMatch:x.memberId&&x.phoneMatch!=null?x.phoneMatch:null}}));
  return send(res,200,list.sort((a,b)=>b.at.localeCompare(a.at)))}
 if(url==='/api/signups/approve'&&req.method==='POST'){
  const x=db.signups.find(y=>y.id===b.id&&y.status==='new');if(!x)return send(res,404,{error:'Sign-up not found.'});
  let ok;try{ok=confirmed(await sb.auth.adminGet(x.authId))}catch{return send(res,502,{error:'Could not check this sign-up right now. Try again.'})}
  if(!ok)return send(res,400,{error:x.name+' has not confirmed their email yet. Ask them to open the link we emailed them.'});
  let m;
  const want=b.memberId||x.memberId;
  if(want){m=db.members.find(y=>y.id===want&&y.role!=='admin');if(!m)return send(res,404,{error:'Member not found.'});if(m.authId)return send(res,400,{error:'That member already has a linked login.'})}
  else{if(b.since&&!ymOk(b.since))return send(res,400,{error:'Choose a start month from January 2024 up to this month.'});
   m={id:nextId('INV'),name:x.name,phone:x.phone,role:'member',salt:crypto.randomBytes(8).toString('hex'),pw:null,mustChange:false,since:b.since||curYM()};db.members.push(m)}
  m.authId=x.authId;m.email=x.email;if(!m.phone)m.phone=x.phone;m.tv=(m.tv||0)+1;
  x.status='approved';x.memberId=m.id;x.by=u.id;x.decidedAt=new Date().toISOString();
  log(u,'signup-approved',x.email+' as '+m.id);await save();return send(res,200,{id:m.id,name:m.name,phone:m.phone||'',email:m.email})}
 if(url==='/api/signups/reject'&&req.method==='POST'){
  const x=db.signups.find(y=>y.id===b.id&&y.status==='new');if(!x)return send(res,404,{error:'Sign-up not found.'});
  try{await sb.auth.adminDelete(x.authId)}catch(e){if(e.status!==404)return send(res,502,{error:'Could not remove the sign-up right now. Try again.'})}
  db.signups=db.signups.filter(y=>y!==x);log(u,'signup-rejected',x.email);await save();return send(res,200,{ok:true})}
 if(url==='/api/switch'&&req.method==='POST'){if(req.viaAdmin)return send(res,403,{error:'Go back to the administrator account first.'});const t=db.members.find(x=>x.id===b.id);
  if(!t)return send(res,404,{error:'Account not found.'});if(t.id===u.id)return send(res,400,{error:'This is your own account.'});if(t.disabled)return send(res,400,{error:'This account is disabled. Enable it first.'});
  log(u,'admin-opened-account',t.id);await save();return send(res,200,{token:issue(t.id,u),me:{...pub(t),mustChange:false,viaAdmin:u.id}})}
 if(url==='/api/me')return send(res,200,{...pub(u),mustChange:req.viaAdmin?false:u.mustChange,viaAdmin:req.viaAdmin||'',email:u.authId?u.email||'':''});
 if(url==='/api/members'&&req.method==='GET')return send(res,200,isAdmin(u)?db.members.map(m=>({id:m.id,name:m.name,role:m.role,active:!!(m.pw||m.authId),email:m.email||'',linked:!!m.authId,phone:m.phone||'',disabled:!!m.disabled,since:m.since||''})):(seesAll(u)?db.members.filter(m=>m.role!=='admin'):[u]).map(pub));
 if(url==='/api/password/email'&&req.method==='POST'){ // signed in: email myself a reset link
  if(req.viaAdmin)return send(res,403,{error:'You opened this account as the system administrator. The account holder’s password cannot be changed from here.'});
  if(!(u.authId&&u.email&&sb.enabled()))return send(res,400,{error:'Your account has no email address. Use your current password, or ask the system administrator to send you a reset link.'});
  const k='pe:'+u.id;if(limited(k))return send(res,429,{error:'Too many requests. Try again in 15 minutes.'});tries[k].push(Date.now());
  try{await sendReset(req,u)}catch(x){console.error('reset email:',x.message);return send(res,502,{error:'We could not send the email right now. Please try again shortly.'})}
  return send(res,200,{ok:true,email:u.email})}
 if(url==='/api/password'&&req.method==='POST'){if(req.viaAdmin)return send(res,403,{error:'You opened this account as the system administrator. The account holder’s password cannot be changed from here.'});const k='pw:'+u.id;if(limited(k))return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
  if(u.authId&&sb.enabled()){
   try{await sb.auth.signIn(u.email,String(b.current||''))}catch(x){if(x.status===400||x.status===401||x.status===422){tries[k].push(Date.now());return send(res,400,{error:'Your current password is not correct.'})}return send(res,502,{error:'Could not check your password right now. Try again shortly.'})}
   const e=pwError(b.password,u.id);if(e)return send(res,400,{error:e});
   try{await sb.auth.adminSetPassword(u.authId,String(b.password))}catch(x){return send(res,400,{error:String(x.message||'Could not change the password.').slice(0,200)})}
   u.tv=(u.tv||0)+1;log(u,'password-changed',u.id);await save();return send(res,200,{ok:true,token:issue(u.id)})}
  if(!u.mustChange&&!(u.pw&&safeEq(hash(b.current||'',u.salt),u.pw))){tries[k].push(Date.now());return send(res,400,{error:'Your current password is not correct.'})}
  const e=pwError(b.password,u.id);if(e)return send(res,400,{error:e});
  u.pw=hash(b.password,u.salt);u.mustChange=false;u.tempExp=null;u.tv=(u.tv||0)+1;await save();return send(res,200,{ok:true,token:issue(u.id)})}

 // ---- Secretary's desk, coordinator's notices, member names and roles
 const T=(x,n)=>String(x==null?'':x).trim().slice(0,n),isDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||''),now=new Date().toISOString();
 if(url==='/api/desk'&&req.method==='GET')return send(res,200,{minutes:db.minutes.filter(m=>isSec(u)||isChair(u)||m.status==='approved').sort((a,b)=>b.date.localeCompare(a.date)).map(m=>({...m,files:db.files.filter(f=>f.parentId===m.id).map(fileOut)})),records:db.records.filter(r=>isOff(u)||r.visibility==='all').sort((a,b)=>a.category.localeCompare(b.category)||a.title.localeCompare(b.title)).map(r=>({...r,files:db.files.filter(f=>f.parentId===r.id).map(fileOut)}))});
 if(url.startsWith('/api/desk/')&&req.method==='POST'){
  if(!isSec(u))return send(res,403,{error:'Only the secretary can do this.'});
  const[,,,kind,act]=url.split('/');
  if(kind==='minutes'&&!act){const t=T(b.title,120);if(!t||!isDate(b.date))return send(res,400,{error:'Give the meeting a title and a date.'});
   const ids=new Set(db.members.map(x=>x.id)),f={title:t,date:b.date,venue:T(b.venue,80),agenda:T(b.agenda,4000),notes:T(b.notes,12000),resolutions:T(b.resolutions,4000),attendees:(Array.isArray(b.attendees)?b.attendees:[]).filter(x=>ids.has(x)),status:b.status==='approved'?'approved':'draft'};
   let m=b.id&&db.minutes.find(x=>x.id===b.id);
   if(m){Object.assign(m,f,{updatedAt:now,updatedBy:u.id});log(u,'minutes-edit',t)}else{m={id:uid(),...f,createdAt:now,createdBy:u.id,updatedAt:now};db.minutes.push(m);log(u,'minutes-new',t)}
   await save();return send(res,200,m)}
  if(kind==='minutes'&&act==='delete'){const i=db.minutes.findIndex(x=>x.id===b.id);if(i<0)return send(res,404,{error:'Not found.'});
   if(db.minutes[i].status==='approved')return send(res,400,{error:'Approved minutes cannot be deleted.'});log(u,'minutes-delete',db.minutes[i].title);await dropFiles(db.minutes[i].id);db.minutes.splice(i,1);await save();return send(res,200,{ok:true})}
  if(kind==='records'&&!act){const t=T(b.title,120),body=T(b.body,12000);if(!t||!body)return send(res,400,{error:'Give the record a title and some content.'});
   const f={title:t,body,category:T(b.category,40)||'General',visibility:b.visibility==='officers'?'officers':'all'};let r=b.id&&db.records.find(x=>x.id===b.id);
   if(r){Object.assign(r,f,{updatedAt:now,updatedBy:u.id});log(u,'record-edit',t)}else{r={id:uid(),...f,createdAt:now,createdBy:u.id,updatedAt:now};db.records.push(r);log(u,'record-new',t)}
   await save();return send(res,200,r)}
  if(kind==='records'&&act==='delete'){const i=db.records.findIndex(x=>x.id===b.id);if(i<0)return send(res,404,{error:'Not found.'});log(u,'record-delete',db.records[i].title);await dropFiles(db.records[i].id);db.records.splice(i,1);await save();return send(res,200,{ok:true})}
  if(kind==='files'&&!act){const parent=(b.kind==='records'?db.records:b.kind==='minutes'?db.minutes:[]).find(x=>x.id===b.parentId);if(!parent)return send(res,404,{error:'Save the item first, then attach files.'});
   const name=String(b.name||'file').replace(/[\\\/\x00-\x1f<>:"|?*]/g,'_').slice(-100),ext=(name.split('.').pop()||'').toLowerCase();
   if(!EXT[ext])return send(res,400,{error:'This file type is not allowed. Use PDF, Word, Excel, PowerPoint, JPG, PNG, TXT or CSV.'});
   if(db.files.filter(f=>f.parentId===parent.id).length>=10)return send(res,400,{error:'At most 10 files can be attached to one item.'});
   const buf=Buffer.from(String(b.data||''),'base64');if(!buf.length||buf.length>5e6)return send(res,400,{error:'Files must be between 1 byte and 5 MB.'});
   if(!fileOk(ext,buf))return send(res,400,{error:'The file content does not match its type.'});
   const f={id:crypto.randomBytes(12).toString('hex'),name,size:buf.length,mime:EXT[ext],parentId:parent.id,kind:b.kind,by:u.id,at:new Date().toISOString()};
   await store.putFile(f.id,buf,f.mime);db.files.push(f);log(u,'file-added',name);await save();return send(res,200,fileOut(f))}
  if(kind==='files'&&act==='delete'){const i=db.files.findIndex(x=>x.id===b.id);if(i<0)return send(res,404,{error:'Not found.'});await store.delFile(db.files[i].id);log(u,'file-removed',db.files[i].name);db.files.splice(i,1);await save();return send(res,200,{ok:true})}
  return send(res,404,{error:'Not found.'})}
 const vis=n=>isOff(u)||n.audience==='all';
 if(url==='/api/notices'&&req.method==='GET')return send(res,200,db.notices.filter(vis).sort((a,b)=>(!!b.pinned-!!a.pinned)||b.createdAt.localeCompare(a.createdAt)).map(n=>({id:n.id,title:n.title,body:n.body,audience:n.audience,pinned:!!n.pinned,important:!!n.important,by:(db.members.find(x=>x.id===n.by)||{}).name||'',createdAt:n.createdAt,updatedAt:n.updatedAt,unread:!(n.reads||[]).includes(u.id),...(isCoord(u)?{readCount:(n.reads||[]).length,audienceSize:n.audience==='all'?db.members.filter(x=>x.role!=='admin').length:db.members.filter(x=>x.role!=='member'&&x.role!=='admin').length}:{})})));
 if(url==='/api/notices/seen'&&req.method==='POST'){let ch=false;db.notices.filter(vis).forEach(n=>{n.reads=n.reads||[];if(!n.reads.includes(u.id)){n.reads.push(u.id);ch=true}});if(ch)await save();return send(res,200,{ok:true})}
 if(url.startsWith('/api/notices')&&req.method==='POST'){
  if(!isCoord(u))return send(res,403,{error:'Only the coordinator can post notices.'});
  if(url==='/api/notices/delete'){const i=db.notices.findIndex(x=>x.id===b.id);if(i<0)return send(res,404,{error:'Not found.'});log(u,'notice-delete',db.notices[i].title);db.notices.splice(i,1);await save();return send(res,200,{ok:true})}
  const t=T(b.title,120),body=T(b.body,4000);if(!t||!body)return send(res,400,{error:'Give the notice a title and a message.'});
  const f={title:t,body,audience:b.audience==='officers'?'officers':'all',pinned:!!b.pinned,important:!!b.important};let n=b.id&&db.notices.find(x=>x.id===b.id);
  if(n){Object.assign(n,f,{updatedAt:now});log(u,'notice-edit',t)}else{n={id:uid(),...f,by:u.id,createdAt:now,updatedAt:now,reads:[u.id]};db.notices.push(n);log(u,'notice-new',t)}
  await save();return send(res,200,{id:n.id})}
 if(url==='/api/members/update'&&req.method==='POST'){
  if(!isSec(u)&&!isAdmin(u))return send(res,403,{error:'Only the secretary or system administrator can edit member details.'});
  const t=db.members.find(x=>x.id===b.id);if(!t)return send(res,404,{error:'Member not found.'});
  if(t.role==='admin'&&!isAdmin(u))return send(res,403,{error:'Only the system administrator can edit an administrator account.'});
  const name=cleanName(b.name);if(!name)return send(res,400,{error:'Enter the member’s full name.'});
  const ph=b.phone===undefined?undefined:normPhone(b.phone);if(b.phone&&!ph)return send(res,400,{error:PHONE_ERR});
  if(!isAdmin(u)&&((ph!==undefined&&ph!==(t.phone||''))||(b.role&&b.role!==t.role)||(b.since&&b.since!==t.since)))return send(res,403,{error:'Only the system administrator can change phone numbers, roles and start months.'});
  if(b.role&&b.role!==t.role){if(t.role==='admin'||!ROLE_LIST.includes(b.role))return send(res,400,{error:'Unknown role.'});
   if(t.role==='chair'&&!db.members.some(x=>x!==t&&x.role==='chair'))return send(res,400,{error:'There must be at least one chairperson. Make someone else chairperson first.'});
   log(u,'role',t.id+': '+t.role+' to '+b.role);t.role=b.role}
  if(ph!==undefined)t.phone=ph;
  if(b.since&&t.role!=='admin'&&b.since!==t.since){if(!ymOk(b.since))return send(res,400,{error:'Choose a start month from January 2024 up to this month.'});log(u,'start-month',t.id+': '+(t.since||'')+' to '+b.since);t.since=b.since}
  if(name!==t.name){log(u,'rename',t.id+': '+t.name+' to '+name);t.name=name}
  await save();return send(res,200,{id:t.id,name:t.name,role:t.role})}
 if(url==='/api/roster'&&req.method==='GET'){if(u.role==='member')return send(res,403,{error:'Not allowed.'});return send(res,200,db.members.filter(m=>m.role!=='admin').map(m=>({id:m.id,name:m.name,role:m.role})))}
 if(url.startsWith('/api/files/')&&req.method==='GET'){const f=db.files.find(x=>x.id===url.slice(11));if(!f)return send(res,404,{error:'Not found.'});
  const par=(f.kind==='records'?db.records:db.minutes).find(x=>x.id===f.parentId);
  if(!(par&&(f.kind==='records'?(isOff(u)||par.visibility==='all'):(isSec(u)||isChair(u)||par.status==='approved'))))return send(res,403,{error:'You do not have access to this file.'});
  let buf;try{buf=await store.getFile(f.id)}catch{return send(res,404,{error:'File missing.'})}
  res.writeHead(200,{'Content-Type':f.mime,'Content-Disposition':'attachment; filename="'+encodeURIComponent(f.name)+'"','Content-Length':buf.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.end(buf)}
 if(url==='/api/config')return send(res,200,{ym:curYM(),start:START,rates:db.rates,instructions:process.env.PAY_INSTRUCTIONS||('Pay from any Kenyan bank, M-Pesa or Pesalink into the group’s NCBA account'+(process.env.NCBA_ACCOUNT_NO?' ('+process.env.NCBA_ACCOUNT_NO+')':'')+'. Put '+u.id+' as the reference so the payment is matched to you automatically.')});
 if(url==='/api/statement'){const id=seesAll(u)?String(q.get('id')||u.id):u.id,m=db.members.find(x=>x.id===id);if(!m)return send(res,404,{error:'Member not found.'});
  const L=ledger(m),ps=db.payments.filter(p=>p.memberId===id).sort(byTime).map(p=>({...p,alloc:L.alloc[p.id]||null}));
  return send(res,200,{member:pub(m),payments:ps,totals:{received:ps.filter(p=>p.status!=='voided').reduce((a,p)=>a+p.amount,0),fines:L.fines,arrears:L.arrears,credit:L.credit,paid:L.paid,due:L.due}})}
 if(!canEdit(u)&&!isAdmin(u))return send(res,403,{error:'Only the treasurer can do this.'});
 if(url==='/api/rates'&&req.method==='POST'){const okYM=x=>/^\d{4}-(0[1-9]|1[0-2])$/.test(x||'')&&x>=START,f=String(b.from||''),t=b.to?String(b.to):null,orig=b.orig?String(b.orig):null,n=k=>Number(b[k]),ok=x=>Number.isInteger(x)&&x>=0&&x<=1e6;
  if(!okYM(f))return send(res,400,{error:'Choose the month this rate starts, January 2024 or later.'});
  if(t&&(!okYM(t)||t<f))return send(res,400,{error:'The end month must be the same as, or later than, the start month.'});
  if(!ok(n('monthly'))||n('monthly')<1||!ok(n('agm'))||!ok(n('welfare')))return send(res,400,{error:'Enter whole amounts in KES. Monthly must be more than 0; AGM and welfare can be 0.'});
  const r={from:f,to:t,monthly:n('monthly'),agm:n('agm'),welfare:n('welfare')},ei=orig?db.rates.findIndex(x=>x.from===orig):-1;
  if(orig&&ei<0)return send(res,404,{error:'Rate not found.'});
  const hi=x=>x.to||'9999-12',lab=x=>x.from+' to '+(x.to||'no end date'),clash=db.rates.filter((x,i)=>i!==ei&&x.from<=hi(r)&&f<=hi(x)),
   closing=t?[]:clash.filter(x=>!x.to&&x.from<f),bad=clash.filter(x=>!closing.includes(x));
  if(bad.length)return send(res,400,{error:'These dates overlap the rate for '+lab(bad[0])+'. Change that rate’s dates first, or choose different dates.'});
  closing.forEach(x=>{log(u,'rate-ended',x.from+' now ends '+prevYM(f));x.to=prevYM(f)});
  const was=ei>=0?db.rates[ei]:null;
  log(u,was?'rate-changed':'rate-added',lab(r)+': monthly '+r.monthly+', AGM '+r.agm+', welfare '+r.welfare+(was?' (was '+lab(was)+': '+was.monthly+' / '+was.agm+' / '+was.welfare+')':''));
  if(was)db.rates[ei]=r;else db.rates.push(r);db.rates.sort((x,y)=>x.from<y.from?-1:1);await save();return send(res,200,{rates:db.rates})}
 if(url==='/api/rates/delete'&&req.method==='POST'){const f=String(b.from||''),i=db.rates.findIndex(x=>x.from===f);
  if(i<0)return send(res,404,{error:'Rate not found.'});if(db.rates.length<2)return send(res,400,{error:'The last rate cannot be removed. Change it instead.'});
  const x=db.rates[i];log(u,'rate-removed',x.from+' to '+(x.to||'no end date')+': monthly '+x.monthly+', AGM '+x.agm+', welfare '+x.welfare);db.rates.splice(i,1);await save();return send(res,200,{rates:db.rates})}
 if(url==='/api/payments'&&req.method==='POST'){const m=db.members.find(x=>x.id===b.id&&x.role!=='admin'),ym=String(b.month||''),row=m&&ledger(m).months.find(x=>x.ym===ym);
  if(!m||!row)return send(res,400,{error:'Choose a member and a month that falls within their contribution period.'});
  if(row.norate)return send(res,400,{error:'No rate is set for that month. Set a rate first on the Rates tab.'});
  const r=ingest({amount:b.amount||(row.due[0]+row.due[1]+row.due[2]),reference:b.ref,date:String(b.date||'')+' '+String(b.time||'12:00'),channel:'Manual entry'},'manual',m,ym,u.id);
  if(r.error)return send(res,400,r);if(r.duplicate)return send(res,409,{error:'That reference is already recorded.'});await save();return send(res,200,pub(m))}
 if(url==='/api/requests'&&req.method==='GET')return send(res,200,db.requests.filter(r=>r.status==='open').map(r=>{const m=db.members.find(x=>x.id===r.memberId)||{};return{id:r.id,memberId:r.memberId,name:m.name,phone:m.phone||'',active:!!(m.pw||m.authId),email:m.email||'',linked:!!m.authId,at:r.at,phoneMatch:r.phoneMatch}}).sort((a,b)=>b.at.localeCompare(a.at)));
 if(url==='/api/requests/dismiss'&&req.method==='POST'){const r=db.requests.find(x=>x.id===b.id);if(!r)return send(res,404,{error:'Not found.'});r.status='dismissed';r.by=u.id;log(u,'request-dismissed',r.memberId);await save();return send(res,200,{ok:true})}
 if(url==='/api/invite-all'&&req.method==='POST'){const base=baseUrl(req),out=[];
  db.members.filter(m=>!m.pw&&!m.authId&&m.role!=='admin'&&!m.disabled).forEach(t=>{const tok=crypto.randomBytes(24).toString('base64url');t.invite={h:sha(tok),exp:Date.now()+7*864e5,kind:'new'};out.push({id:t.id,name:t.name,phone:t.phone||'',link:base+'/#activate/'+t.id+'/'+tok})});
  db.requests.forEach(r=>{if(r.status==='open'&&out.some(o=>o.id===r.memberId)){r.status='done';r.by=u.id}});log(u,'invite-all',out.length+' members');await save();
  return send(res,200,{expires:new Date(Date.now()+7*864e5).toISOString(),list:out})}
 if(url==='/api/members/disable'&&req.method==='POST'){const t=db.members.find(x=>x.id===b.id);if(!t)return send(res,404,{error:'Member not found.'});
  if(t.id===u.id)return send(res,400,{error:'You cannot disable your own account.'});
  t.disabled=!!b.disabled;t.tv=(t.tv||0)+1;log(u,t.disabled?'account-disabled':'account-enabled',t.id);await save();return send(res,200,{ok:true})}
 if(url==='/api/admins'&&req.method==='POST'){const name=cleanName(b.name);if(!name)return send(res,400,{error:'Enter the administrator’s full name.'});if(b.phone&&!normPhone(b.phone))return send(res,400,{error:PHONE_ERR});
  const m={id:nextId('ADM'),name,phone:normPhone(b.phone),role:'admin',salt:crypto.randomBytes(8).toString('hex'),pw:null,mustChange:false};
  db.members.push(m);log(u,'admin-added',m.id);await save();return send(res,200,{id:m.id})}
 if(url==='/api/audit'&&req.method==='GET')return send(res,200,(db.audit||[]).slice(-200).reverse().map(e=>({...e,byName:(db.members.find(x=>x.id===e.by)||{}).name||e.by})));
 if(url==='/api/backup'&&req.method==='GET'){log(u,'backup','downloaded');await save();res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="ift-backup-'+new Date().toISOString().slice(0,10)+'.json"','Cache-Control':'no-store'});return res.end(JSON.stringify(db,null,1))}
 if(url==='/api/reset-password'&&req.method==='POST'){const t=db.members.find(x=>x.id===b.id);if(!t)return send(res,404,{error:'Member not found.'});
  if(t.id===u.id)return send(res,400,{error:'Use the Password button to change your own password.'});
  if(t.authId&&sb.enabled()&&(b.reset||url==='/api/reset-password')){ // email account: kill the old password, then Supabase emails a reset link
   try{await sb.auth.adminSetPassword(t.authId,randPw());await sendReset(req,t)}catch(x){console.error('admin reset:',x.message);return send(res,502,{error:'Could not send the reset email, so press Reset again in a moment. (The old password already stopped working.)'})}
   t.tv=(t.tv||0)+1;db.requests.forEach(r=>{if(r.memberId===t.id&&r.status==='open'){r.status='done';r.by=u.id}});log(u,'reset-email-sent',t.id);await save();
   return send(res,200,{emailed:true,email:t.email,name:t.name})}
  const al='abcdefghjkmnpqrstuvwxyz23456789';let tmp='';for(let i=0;i<10;i++)tmp+=al[crypto.randomInt(al.length)];
  t.pw=hash(tmp,t.salt);t.mustChange=true;t.tempExp=Date.now()+2*864e5;t.invite=null;t.tv=(t.tv||0)+1;
  db.requests.forEach(r=>{if(r.memberId===t.id&&r.status==='open'){r.status='done';r.by=u.id}});log(u,'temporary-password',t.id);await save();
  return send(res,200,{id:t.id,name:t.name,phone:t.phone||'',password:tmp,expires:new Date(t.tempExp).toISOString()})}
 if(url==='/api/invite'&&req.method==='POST'){const t=db.members.find(x=>x.id===b.id);if(!t)return send(res,404,{error:'Member not found.'});
  if(t.id===u.id)return send(res,400,{error:'Use the Password button to change your own password.'});
  if(t.authId&&sb.enabled()&&(b.reset||url==='/api/reset-password')){ // email account: kill the old password, then Supabase emails a reset link
   try{await sb.auth.adminSetPassword(t.authId,randPw());await sendReset(req,t)}catch(x){console.error('admin reset:',x.message);return send(res,502,{error:'Could not send the reset email, so press Reset again in a moment. (The old password already stopped working.)'})}
   t.tv=(t.tv||0)+1;db.requests.forEach(r=>{if(r.memberId===t.id&&r.status==='open'){r.status='done';r.by=u.id}});log(u,'reset-email-sent',t.id);await save();
   return send(res,200,{emailed:true,email:t.email,name:t.name})}
  const tok=crypto.randomBytes(24).toString('base64url');t.invite={h:sha(tok),exp:Date.now()+7*864e5,kind:b.reset?'reset':'new'};db.requests.forEach(r=>{if(r.memberId===t.id&&r.status==='open'){r.status='done';r.by=u.id}});
  if(b.reset){t.pw=null;t.mustChange=false;t.tempExp=null;t.tv=(t.tv||0)+1}log(u,b.reset?'password-reset':'invite',t.id);await save();
  return send(res,200,{name:t.name,phone:t.phone||'',link:baseUrl(req)+'/#activate/'+t.id+'/'+tok,expires:new Date(t.invite.exp).toISOString()})}
 if(url==='/api/payments/void'&&req.method==='POST'){const p=db.payments.find(x=>x.id===b.paymentId&&x.status!=='voided'),why=clean(b.reason).trim().slice(0,100);
  if(!p)return send(res,404,{error:'Payment not found.'});if(!why)return send(res,400,{error:'Give a reason for the reversal.'});
  unapply(p);p.status='voided';p.voidedBy=u.id;p.voidedAt=new Date().toISOString();p.voidReason=why;log(u,'void',p.ref+': '+why);await save();return send(res,200,{ok:true})}
 if(url==='/api/payments/move'&&req.method==='POST'){const p=db.payments.find(x=>x.id===b.paymentId&&x.status==='matched'),m=db.members.find(x=>x.id===b.memberId&&x.role!=='admin');
  if(!p||!m)return send(res,400,{error:'Choose a payment and a member.'});if(p.memberId===m.id)return send(res,400,{error:'That payment already belongs to this member.'});
  const from=p.memberId;unapply(p);applyPay(m,p);log(u,'move',p.ref+' '+from+' to '+m.id);await save();return send(res,200,{ok:true})}
 if(url==='/api/deposits'&&req.method==='GET')return send(res,200,{unmatched:db.payments.filter(p=>p.status==='unmatched'),recent:db.payments.filter(p=>p.source!=='sample').sort(byTime).slice(-12).reverse(),webhook:'/api/webhooks/ncba'});
 if(url==='/api/assign'&&req.method==='POST'){const p=db.payments.find(x=>x.id===b.paymentId&&x.status==='unmatched'),m=db.members.find(x=>x.id===b.memberId&&x.role!=='admin');
  if(!p||!m)return send(res,400,{error:'Choose a deposit and a member.'});applyPay(m,p);p.assignedBy=u.id;await save();return send(res,200,{ok:true})}
 if(url==='/api/import'&&req.method==='POST'){const rows=parseCsv(String(b.csv||''));if(rows.length<2)return send(res,400,{error:'The file has no rows.'});
  const h=rows[0].map(x=>x.toLowerCase()),col=re=>h.findIndex(x=>re.test(x)),cr=col(/credit|paid in|deposit/),
  ci={date:col(/date|time/),ref:col(/ref|receipt|trans.*id|code/),narr:col(/narr|descr|detail|particular|remark/),amt:cr<0?col(/amount/):cr};
  if(ci.ref<0||ci.amt<0)return send(res,400,{error:'Could not find the reference and credit columns. Check the header row.'});
  const out={added:0,matched:0,unmatched:0,duplicates:0};
  for(const r of rows.slice(1)){const a=Number(String(r[ci.amt]||'').replace(/[^\d.]/g,''));if(!(a>0))continue;
   const x=ingest({amount:a,reference:r[ci.ref],narration:ci.narr>=0?r[ci.narr]:'',date:ci.date>=0?r[ci.date]:''},'csv-import',null,null,u.id);
   if(x.duplicate)out.duplicates++;else if(x.payment){out.added++;x.payment.memberId?out.matched++:out.unmatched++}}
  await save();return send(res,200,out)}
 if(url==='/api/members'&&req.method==='POST'){const name=cleanName(b.name);if(!name)return send(res,400,{error:'Enter the member’s full name.'});
  if(b.phone&&!normPhone(b.phone))return send(res,400,{error:PHONE_ERR});if(b.since&&!ymOk(b.since))return send(res,400,{error:'Choose a start month from January 2024 up to this month.'});const salt=crypto.randomBytes(8).toString('hex'),m={phone:normPhone(b.phone),id:nextId('INV'),name,role:'member',salt,pw:null,mustChange:false,since:b.since||curYM()};
  db.members.push(m);await save();return send(res,200,pub(m))}
 send(res,404,{error:'Not found.'})}
const TYPES={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
const server=http.createServer((req,res)=>{const url=req.url.split('?')[0];
 if(url.startsWith('/api/'))return api(req,res,url).catch(e=>{console.error('API error:',url,e&&e.message);if(!res.headersSent)send(res,500,{error:'Could not complete that. If you were saving something, please try again.'})});
 const f=path.join(PUB,path.normalize(url==='/'?'/index.html':url));
 if(!f.startsWith(PUB))return send(res,403,{error:'Forbidden'});
 fs.readFile(f,(e,d)=>{if(e)return send(res,404,{error:'Not found.'});res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',...(/^https/.test(process.env.PUBLIC_URL||'')?{'Strict-Transport-Security':'max-age=31536000'}:{})});res.end(d)})
});
async function boot(){
  db=await store.load();let fromLocal=false;
  if(!db){const local=store.mode()==='supabase'?store.readLocal():null;if(local){db=local;fromLocal=true}else db=seed()}
  upgrade();await save();
  if(fromLocal){const n=await store.importLocalFiles(db);console.log('Imported your existing data/db.json into Supabase ('+db.members.length+' accounts, '+db.payments.length+' payments, '+n+' documents).')}
}
server.on('error',e=>{if(e.code==='EADDRINUSE'){console.error('\nPort '+PORT+' is already in use. Another copy of the portal (or another program) is running on it.\nStop it first (Linux/Mac: lsof -i :'+PORT+' ; Windows: netstat -ano | findstr :'+PORT+') and start again.');process.exit(1)}throw e});
boot().then(()=>server.listen(PORT,()=>{console.log('IFT portal running at http://localhost:'+PORT+'  ·  data: '+(store.mode()==='supabase'?'Supabase ('+sb.env().url+')':'local file data/db.json'));
 const ch=db.members.find(m=>m.role==='admin'&&!m.pw);if(ch){const tok=crypto.randomBytes(24).toString('base64url');ch.invite={h:sha(tok),exp:Date.now()+7*864e5};save().catch(e=>console.error('save:',e.message));console.log('\nFIRST-TIME SETUP\nOpen this link to set the system administrator password:\n'+(process.env.PUBLIC_URL||'http://localhost:'+PORT)+'/#activate/'+ch.id+'/'+tok+'\n')}
 console.log('NCBA webhook: POST /api/webhooks/ncba  secret: '+(process.env.NCBA_WEBHOOK_SECRET||db.webhookSecret));console.log('Email: '+mailer.describe());if(mailer.enabled())mailer.verify().then(()=>console.log('Email: SMTP login works.'),e=>console.error('Email: SMTP CHECK FAILED: '+e.message+'\n       Sign-up and reset emails will not arrive until this is fixed (see .env).'))})).catch(e=>{console.error('\nCould not start: '+e.message+'\nCheck SUPABASE_URL and SUPABASE_SERVICE_KEY, and that supabase/schema.sql has been run.');process.exit(1)});
