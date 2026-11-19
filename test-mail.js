'use strict';
// Checks your email (SMTP) settings from .env and, if you give an address, sends a test message to it.
//   node test-mail.js                   -> only checks the connection and login
//   node test-mail.js you@example.com   -> also sends a short test email
require('./lib/env');const mailer=require('./lib/mailer');
(async()=>{
  console.log('Settings: '+mailer.describe());
  if(!mailer.enabled()){console.log('\nSMTP_HOST is empty. Fill in the SMTP lines in .env first (see .env.example).');process.exit(1)}
  try{await mailer.verify();console.log('Connection and login: OK')}
  catch(e){console.log('\nFAILED: '+e.message+'\n'+hint(e.message));process.exit(1)}
  const to=process.argv[2];
  if(!to){console.log('\nTip: run  node test-mail.js you@example.com  to send a real test message.');return}
  try{await mailer.send({to,subject:'IFT portal test email',text:'If you can read this, the IFT portal can send emails (sign-up confirmation and password reset).'});console.log('Test email sent to '+to+'. Check the inbox and the spam folder.')}
  catch(e){console.log('\nFAILED to send: '+e.message+'\n'+hint(e.message));process.exit(1)}
})();
function hint(m){
  if(/535|auth/i.test(m))return 'Hint: the user name or password is wrong. Gmail needs an "app password" (not your normal password); Brevo uses its SMTP key.';
  if(/ECONNREFUSED|timed out|ENOTFOUND|EAI_AGAIN/i.test(m))return 'Hint: check SMTP_HOST and SMTP_PORT (587 or 465), and that the server allows outgoing connections on that port.';
  if(/encrypted|TLS|SSL|certificate/i.test(m))return 'Hint: use port 587 (STARTTLS) or port 465 with SMTP_SECURE=1.';
  if(/55\d|relay|sender|from/i.test(m))return 'Hint: MAIL_FROM must be an address your provider allows you to send from (usually a verified sender or domain).';
  return '';}
