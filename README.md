# IFT – Investment For Tomorrow: member portal

Frontend (`public/`) and backend (`server.js`). The backend uses only Node.js built-ins, so there is nothing to install (`npm install` is not needed).

## Database and accounts with Supabase (version 2)
Everything the portal stores now lives in your **Supabase** project: members, payments, rates, minutes, records, notices, bank deposits, the audit log, sign-up requests and uploaded documents. Members can **create their own account, sign in, and reset a forgotten password by email**. Without Supabase keys the portal still runs in the old local mode (`data/db.json`), which is fine for trying it out.

### One-time setup (about 10 minutes)
1. Create a project at supabase.com. Choose a region near Kenya (for example Frankfurt or London) and keep the database password somewhere safe.
2. **Database:** Dashboard > SQL Editor > New query. Paste all of `supabase/schema.sql` and press Run. This creates the tables, locks them so the public key cannot read them, and creates the private `ift-files` bucket for documents.
3. **Keys:** Project Settings > API. Copy the Project URL, the `anon` (or publishable) key and the `service_role` (or secret) key.
4. **Settings:** copy `.env.example` to `.env` and fill it in (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `PUBLIC_URL`). The service key gives full access to your data: keep `.env` private, never put it in the web page or in Git.
5. **Email (SMTP):** the portal now sends the confirmation and reset emails **itself**, through your own email provider, so Supabase's email limits and settings no longer matter. In `.env` fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (see `.env.example`; Brevo, Resend, Mailgun, Gmail with an app password or your hosting company's mail server all work). Use `MAIL_FROM` with an address your provider has verified. Then run `node test-mail.js you@example.com`: it checks the connection and login and sends you a real test message. Nothing needs installing. **Until email is set up, online sign-up is paused** and the portal says so, instead of creating accounts nobody can confirm. On start-up the portal prints `Email: SMTP login works.` or the reason it does not.
6. **Public address:** set `PUBLIC_URL` to the address members open (for example `https://portal.yourgroup.co.ke`). The links in the emails point there. You do not need to change Supabase's *URL Configuration* or its email templates.
7. **Passwords:** Authentication > Sign In / Providers > Email: keep **Confirm email** switched on, and set the minimum password length to 8.
8. Start the portal: `node server.js`. It prints where it is storing data. If you already had a `data/db.json`, it is copied into Supabase automatically the first time (uploaded documents in `data/files` are copied too).

### How members use it
- **Create an account:** on the sign-in screen tap *Create an account* and **choose your name from the list**. The list holds the names already in the system (the Accounts tab) that do not have a login yet. Then enter email, Kenyan phone number and a password. A confirmation email arrives from the portal; opening its link confirms the address. A name that is not on the list must be added by the system administrator first (Accounts tab > Add member). If someone mistypes their email, they can simply sign up again: an unconfirmed request is replaced. Once a request is confirmed, that name leaves the list until the administrator approves or rejects it.
- **Approval:** a new account cannot see anything until the system administrator approves it. On the Overview and Accounts tabs the administrator sees *New sign-ups*: the name the person chose, whether the email is confirmed, and whether the phone number matches the one saved for that member. **Approve** links the login to that member record, so payments and statement carry over (account ID such as INV-0xx). **Reject** deletes the sign-up and puts the name back on the list. Only the administrator can approve, so choosing someone else's name gets an impostor nothing.
- **Sign in:** with their email and password. Account ID plus password (and personal links) still work for accounts that have no email.
- **Forgot password:** on the sign-in screen tap *Forgot password?* and enter the email (or account ID). The portal emails a one-time link; the member chooses a new password and every old session is signed out. The link works once. Members without an email still use the old request to the administrator.
- **Reset password once signed in:** every signed-in person sees a **Reset password** button in the header. They enter their current password and a new one. If they have forgotten the current one, **Email me a reset link** sends a link to the address on their account. Other devices are signed out.
- **Administrator tools:** *Reset password* on an email account kills the old password and emails the member a reset link. Disabling an account signs the member out at once. Opening an account, roles, audit log and backup work as before.

### What is stored where
| Data | Supabase table |
|---|---|
| Members, roles, linked email | `members` |
| Payments and bank deposits | `payments` |
| Contribution rates | `rates` |
| Minutes, records, notices | `minutes`, `records`, `notices` |
| Uploaded files | `documents` (details) and the `ift-files` bucket (the files) |
| Audit log, password requests, sign-ups | `audit_log`, `reset_requests`, `signups` |
| Session key, webhook secret | `settings` |
| Emails and password hashes of email accounts | Supabase Auth (Authentication > Users) |
Each table has `id`, the whole record as JSON in `data`, and a few searchable columns. You can browse and export them in the Table Editor. The portal calculates balances from the payments and rates, as before. Only the portal server can read or write these tables. Do not add policies that open them to `anon`.

### Good to know
- Run **one** copy of the portal. Two copies would each keep their own in-memory view.
- If Supabase is unreachable the portal shows a "try again" message. Anything changed during the outage is saved by the next successful save, but do not restart the portal in between.
- The portal refuses to start if it cannot reach Supabase, so it never starts with an empty database by mistake.
- Backups: turn on Supabase's daily backups (paid plans) or use **Download backup** on the administrator account regularly (it does not include uploaded documents; download those from the `ift-files` bucket).
- `node update-members.js` works on Supabase too. Stop the portal first.
- Run the checks with `npm test` (uses built-in stand-ins for Supabase and for the email server, no internet needed, and never touches your real `data` folder or `.env`). It was **not** run against a real Supabase project, so do the quick test below after setup.

### Quick test after setup
1. Start the portal and open the administrator link it prints. Set the administrator password.
2. In a private window, tap *Create an account*, choose a name from the list and use your own email. Open the confirmation email link.
3. Sign in as administrator, approve the sign-up, then sign in with the email and password.
4. Sign out, tap *Forgot password?*, open the emailed link and choose a new password.
5. In Supabase > Table Editor, check that `members` and `signups` show your account.

## Run it
1. Install Node.js 18 or newer.
2. In this folder run: `node server.js` (or `npm start`)
3. Open http://localhost:3000

The portal always runs on port 3000. Settings can go in a `.env` file (see `.env.example`).

## Setting up passwords (every member chooses their own)
There are **no shared or default passwords**. Each member sets their own, from wherever they are, once the portal is hosted.
1. **First run:** when the server starts it prints a one-time link for the **system administrator** (account ADM-001). Open it and choose a password.
2. **Invite members:** on the **Accounts** tab, the system administrator clicks **Invite everyone** to create a personal link for every member who has not set a password yet, or **Send invite** next to one member. Each link is clickable, and each row has **WhatsApp**, **SMS** and **Copy link** buttons. Save each member's phone number (Add member or Edit on the Accounts tab) and WhatsApp opens straight in that member's own chat. Creating new links replaces any sent earlier to the same member.
3. **The member opens their link** on their own phone or computer, anywhere, and chooses their password (at least 8 characters, typed twice). The link works once and expires after 7 days.
4. After that they sign in with their **account ID and password**. **Password** in the header lets them change it whenever they like.
5. **Forgotten password:** on the sign-in screen the member taps **Forgot password?**, enters their account ID (and, optionally, their phone number) and sends the request. The system administrator sees it on the Overview and Accounts tabs, marked "Phone matches" when the number agrees with the one saved. They tap **Reset and send link**. The old password stops working at once, every open session is signed out, and a one-time **Reset your password** page link goes to the member by WhatsApp or SMS.
   The administrator can reset **any** account (members, officers and other administrators; not their own) and chooses how:
   - **Send a reset link** (recommended): the member opens it and chooses their own password straight away.
   - **Set a temporary password**: a random 10-character password is shown once, with WhatsApp, SMS and Copy buttons. It works for 2 days, and the member must choose their own password the first time they sign in with it.
   Either way the old password stops working immediately and the member is signed out everywhere.
6. **Changing your own password:** every signed-in person (members, officers and administrators) can use the **Password** button in the header at any time. They enter their current password and a new one (at least 8 characters). Other devices signed in with the old password are signed out.
Phone numbers are visible to the system administrator only. The portal itself does not send messages; an officer taps the WhatsApp or SMS button.
Passwords are stored hashed (scrypt), so even the administrator cannot read them. Sign-in is limited to 10 failed tries per 15 minutes, per account and per device address.

The sign-in screen and Home page greet each person with good morning, good afternoon or good evening, using the clock on their own device, so it is right wherever they are.

Sample roles:

| Account | Role | Can do |
|---|---|---|
| ADM-001 | System administrator | Accounts only: invitations, password resets, forgot-password requests, adding members, phone numbers, roles, disabling accounts, audit log, backup. **Cannot** see contributions, statements, minutes or notices |
| INV-001 | Chairperson | Oversight: can view everything (all contributions and statements, all minutes including drafts, records, notices) but does not edit finances, minutes or notices. Cannot manage accounts |
| INV-002 | Vice chairperson | Same oversight as the chairperson: can view everything, edits nothing. Deputises for the chairperson |
| INV-003 | Treasurer | **Financial matters:** record, reverse and move payments, bank deposits and NCBA statement import, fines and arrears, all statements |
| INV-004 | Secretary | **Minutes, documents and records:** writes and approves minutes, stores documents and files, corrects member names |
| INV-005 | Vice secretary | Same powers as the secretary: minutes, documents, records and member name corrections |
| INV-006 | Coordinator | **Notices:** posts notices to members and sees who has read them |
| INV-007 | Board member | Read-only view of everyone's contributions |
| all other accounts | Member | See their own record, approved minutes, shared records and notices |

One role, one job. The secretary and coordinator are also members of the group, so they see only their **own** contributions. They can see the list of member names (for attendance and name corrections) but not anyone else's money. Only the treasurer, chairperson, vice chairperson and board see everyone's contributions.

The system administrator changes roles from the Accounts tab when the group elects new office bearers, so the sample names can be matched to your real ones. The administrator account is separate from the 16 members and is not counted in any group totals.

## System administrator
The administrator looks after the system, so that the chairperson, treasurer, secretary and board do not have to.
- **Overview:** how many accounts have a password, who is still waiting, and open forgot-password requests.
- **Accounts:** add members, add more administrators, edit names, phone numbers and roles, send invitations or reset passwords (by link or temporary password), and **disable** an account when a member leaves. A disabled member is signed out at once and cannot sign in, but their records are kept. Enable it again at any time.
- **Audit log:** the last 200 changes, who made them and when.
- **Download backup:** a copy of all records (JSON). It contains hashed passwords, so keep it private. It does **not** include uploaded documents; those are in `data/files`, so back up the whole `data` folder too.
- **Open any account:** on the Accounts tab, **Open account** next to any other account switches the administrator straight into it, with no password needed. You see and can do exactly what that person can (a treasurer's tabs for the treasurer, and so on). A yellow bar shows who you are acting as, and **Back to administrator** returns you. The account owner's password is not changed and they are not signed out. The Password button is hidden and password changes are refused while inside someone else's account. An opened account lasts at most 4 hours, and changing your own administrator password or being disabled ends it at once. Opening and closing an account are written to the audit log (`admin-opened-account`, `admin-closed-account`); everything you then do is recorded under that account's name. Disabled accounts cannot be opened.
- Administrators cannot disable or reset their own account (use the Password button). With their own administrator account they cannot see any group finances, minutes or notices; **opening an account is the one way around that**, so use it only when needed and tell the account owner.
- Keep at least two people who can act as administrator, so the group is never locked out. Add a second one from the Accounts tab.

## How it works
- **Contributions run from January 2024** and continue every month. Each month a member owes three amounts: the **monthly contribution**, the **AGM contribution** and the **welfare contribution** (AGM and welfare are fixed monthly amounts charged on top of the monthly one). The amounts come from the **Rates** tab. Starting rates, each with a start and end month: 2024 Jan–Jun KES 1,000, Jul–Dec 1,500; 2025 Jan–Jun 2,000, Jul–Dec 2,500; 2026 Jan–Jun 3,000, Jul–Dec 3,500. **AGM and welfare start at KES 0 in every period: the treasurer enters the real amounts on the Rates tab.** A payment recorded after the 10th of the month it pays for adds a KES 200 fine (change `FINE` in `server.js` and `public/index.html`). A missed month counts as arrears.
- Members only ever receive their own record from the server. Access is enforced in the backend, not the browser.
- Data is saved in Supabase (see above), or in `data/db.json` in local mode. In local mode, delete that file to reset to the sample data. Back up before real use.

## Secretary's desk (Secretary)
- **Minutes of meetings:** title, date, venue, agenda, discussion, resolutions and action points, and who was present (tick the members, or Select all). Save as **Draft** (only the secretary and the chairperson see it) or **Approved** (members can read it). Approved minutes cannot be deleted, only edited, and edits are written to the audit log.
- **Records and documents:** store anything the group needs to keep: the constitution, resolutions, assets and property, contacts, signed minutes, scanned letters. Write the information, choose a category, choose whether all members or officers only can read it, and **attach documents** (PDF, Word, Excel, PowerPoint, JPG, PNG, TXT or CSV, up to 5 MB each, 10 per item). Documents can also be attached to minutes. Members download them from the Records tab. A document is only available to people who may read the item it is attached to.
- **Member names:** on the Members tab the secretary can edit a member's name. Phone numbers, roles and new accounts are handled by the system administrator. The account ID never changes, so payments and statements stay linked.

## Coordinator's desk (Coordinator)
- Post a notice with a title and message, to all members or officers only. Mark it important or pin it to the top.
- Members see the newest notice on their Home page and a count of new notices on the Notices tab. The coordinator sees "Read by X of 16" on each notice.
- Notices live in the portal only. SMS or WhatsApp delivery is not included.

## Statements and bank deposits
- **Statement** tab: every member can see their own statement with the exact date and time each deposit reached the account (East Africa Time), the channel, the bank or M-Pesa reference, which months it paid for, and the total. Download it as CSV or print it to PDF. Officers and board can pick any member.
- **Bank deposits** tab (treasurer): deposits waiting to be matched, an NCBA statement CSV import, and the latest deposits.
- **Matching:** members pay into the group's NCBA account from any Kenyan bank, M-Pesa or Pesalink and put their account ID (for example `INV-004`) as the reference. The system finds the ID in the narration and credits the member automatically. If no ID is found, the deposit waits in the unmatched list for the treasurer to assign.
- **Allocation:** each payment clears the oldest unpaid month first (or the month the treasurer chose when recording it). Within a month it pays the monthly contribution, then AGM, then welfare. Part payments are allowed. Anything paid after the 10th of the month it clears is marked late (KES 200 fine). Extra money beyond all dues is kept as credit and used automatically when the next month falls due.
- Duplicate references are ignored, so re-importing a statement is safe.

### Connecting to NCBA
NCBA's public pages describe three routes: M-Pesa Paybill 880100 settling into an NCBA account, Pesalink transfers from other banks, and Instant Payment Notifications (IPNs) plus statement APIs for reconciliation. These need to be set up with your NCBA relationship manager. NCBA has not published its notification format, so I could not test against the real service.
1. **Fastest, no approval needed:** download the NCBA statement as CSV from internet banking and import it on the Bank deposits tab (columns needed: reference and credit; date and narration are used when present).
2. **Live feed:** ask NCBA for IPN access. Give them `https://YOUR-DOMAIN/api/webhooks/ncba` and the secret printed when the server starts (or set `NCBA_WEBHOOK_SECRET`), sent in an `x-webhook-secret` header or `?key=`. The server accepts common field names (amount, transactionReference, narration, transactionDate and similar). When NCBA sends you the real spec, adjust the field lists in `ingest()` in `server.js`.
3. Optional settings: `NCBA_ACCOUNT_NO` (shown in members' payment instructions) and `PAY_INSTRUCTIONS` (replaces the whole instruction text).

## Corrections and password resets
- **Reverse a payment** (Statement tab, treasurer): a reason is required. The month goes back to unpaid, the payment stays on the statement struck through with the reason, and it is left out of the totals. Nothing is deleted, so there is a full record. A reversed bank reference can be recorded again if needed.
- **Move a payment**: if money was credited to the wrong member, move it to the right one. The original date, time and reference are kept.
- **Dismiss** (Bank deposits tab): removes a deposit that is not a contribution, for example a bank refund.
- **Reset a password**: done by the system administrator on the Accounts tab (see "Setting up passwords" above).
- Reversals, moves and password resets are written to an audit log inside `data/db.json`.

## The year
Contributions and statements show every month from a member's start month (January 2024 for founding members; set when adding a member or edited by the administrator) to December of the current year. The Contributions tab has a year selector and Monthly, AGM, Welfare and Total columns for the year shown. A member's position is **calculated from their payments and the rate table**, so reversing or moving a payment, entering old history later, or changing a rate always gives consistent figures. The current month is taken from the calendar (East Africa Time): a month that ends unpaid becomes arrears and the next month falls due.
**Rates, start and end dates, and 2027:** the treasurer manages rates on the **Rates** tab (other officers can view them). Every rate has a **start month** and an optional **end month**, and both months are included (July to December covers six months). Rates cannot overlap. Leave the end month empty for a rate with no end date yet; adding a later open-ended rate then ends it automatically the month before. **A month that no rate covers is not charged**, so 2027 shows "No rate set" and nothing is owed until the treasurer adds the agreed amount (the Rates tab warns about this up to two months ahead). Adding, editing or removing a rate also corrects the months it covers, including past months; payments already recorded are kept and re-applied. A payment cannot be recorded for a month with no rate. Databases from the earlier version are upgraded automatically: each rate's end month is taken from the month before the next rate starts, and the last rate stays open-ended, so nothing changes for them until you set end dates.

**Starting with 2024 and 2025 unpaid:** the founding members start as unpaid from January 2024. The treasurer records the real history with **Record a payment**: choose the member and the month it paid for, and enter the date it was really paid (the 10th rule uses that date). Bank statement imports and webhook deposits are allocated oldest month first.

## Hosting it so members can reach it from anywhere
You need a small server (a VPS of about 1 GB is enough) with Node.js 18+ and a domain name. Example files are in the `deploy` folder.
1. Copy this folder to `/opt/ift-portal` on the server.
2. Edit `deploy/ift-portal.service` (set `PUBLIC_URL` to your real address) and install it with systemd so it starts on boot and restarts if it stops.
3. Install Caddy, put your domain in `deploy/Caddyfile`, and start it. Caddy provides the HTTPS certificate automatically.
4. Check the server log (`journalctl -u ift-portal`) for the first-time system administrator link.
5. Put the settings in `/opt/ift-portal/.env` (the service file reads it). With Supabase there is nothing to back up on the server; use Supabase backups and the administrator's **Download backup**. In local mode, back up the whole `data` folder every day.
Settings (environment variables): `PUBLIC_URL` (used in invitation links), `TRUST_PROXY=1` (when behind Caddy or Nginx, so the login limit counts each member's own address), `NCBA_ACCOUNT_NO`, `NCBA_WEBHOOK_SECRET`, `PAY_INSTRUCTIONS`.
Password recovery needs an officer to approve the request and send the link, so a member who cannot reach any officer cannot reset alone. This is deliberate, because anyone can type another member's account ID. Automatic SMS sending needs an SMS provider and is not included.

## Updating the member list on a portal already in use
If the portal already holds real payments, **do not delete `data/db.json`**. Stop the server and run `node update-members.js` to preview the changes, then `node update-members.js --apply` to make them. It adds missing members, sets roles, enables anyone who was disabled, keeps every payment, minute, notice and password, and saves a backup first. Members who are not in its list are left alone unless you add `--disable-others`. Edit the list at the top of `update-members.js` for future changes.

## Before using real data
- The sample accounts are placeholders. Replace the sample members in `server.js` (the `NAMES` list and `ROLES`) with your real members, then delete `data/db.json`. A database from the earlier single-year version is upgraded automatically on first start: your recorded payments are kept, the fabricated "Opening record" sample payments are removed, and every member starts contributing from January 2024 (or from their original start month if they joined mid-2026).
- Host it behind HTTPS (see Hosting below). Personal links and passwords must never travel over plain HTTP.

## API
`POST /api/signup` · `POST /api/reset` · `POST /api/login` · `POST /api/forgot` · `POST /api/activate/info` · `POST /api/activate` · `POST /api/password` · `GET /api/me` · `GET /api/config` · `GET /api/members` · `GET /api/statement?id=` · `POST /api/pin` · `GET /api/desk` · `GET /api/files/:id` · `GET /api/roster` · `GET /api/notices` · `POST /api/notices/seen`
Secretary: `POST /api/desk/minutes` · `POST /api/desk/minutes/delete` · `POST /api/desk/records` · `POST /api/desk/files` (base64 upload) · `POST /api/desk/files/delete` · `POST /api/desk/records/delete` · `POST /api/members/update`
Coordinator: `POST /api/notices` · `POST /api/notices/delete`
Administrator: `GET /api/signups` · `POST /api/signups/approve` · `POST /api/signups/reject`
Treasurer: `POST /api/payments` · `POST /api/members` · `POST /api/invite` · `POST /api/reset-password` · `POST /api/rates` · `POST /api/rates/delete` · `POST /api/switch` · `POST /api/switch/back` · `POST /api/members/disable` · `POST /api/admins` · `GET /api/audit` · `GET /api/backup` · `POST /api/invite-all` · `GET /api/requests` · `POST /api/requests/dismiss` · `GET /api/deposits` · `POST /api/assign` · `POST /api/import`
Bank: `POST /api/webhooks/ncba` (secret required)
