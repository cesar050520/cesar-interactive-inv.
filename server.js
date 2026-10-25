'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const IS_HOSTED = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_HOSTED ? '' : '2468');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_HOSTED ? '' : 'development-only-session-secret-change-me');
const DATABASE_URL = process.env.DATABASE_URL || '';
if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('Set ADMIN_PASSWORD and SESSION_SECRET in Render environment variables.');
  process.exit(1);
}
if (IS_HOSTED && !DATABASE_URL) {
  console.error('Set DATABASE_URL in Render environment variables so invitation submissions survive restarts.');
  process.exit(1);
}

const DEFAULT_CONFIG = {
  eventTitle:'TARA, PARTY NA!', subtitle:'Isang gabing puno ng tawanan, kwentuhan at masayang bonding. Kasama ka ba?',
  declineMessage:'Awww, hindi ka makakapunta? 🥹', declineSub:'Sayang naman! Sana sa susunod makasama ka na.',
  declineNext:'Sige, next time na lang!', endYesText:'YEHEY! KITA-KITS! 🥳', endNoText:'OKAY LANG! MISS KA NAMIN! 💜',
  venueName:'ANG ATING PARTY VENUE', venueAddress:'I-type dito ang address ng venue sa Admin Panel.',
  venueInfo:'Huwag kalimutan ang iyong dadalhin. See you!', musicOn:true,
  buttons:{homeLeft:{label:'Hindi ako makakapunta',emoji:'🥺',color:'#5c55a0'},homeRight:{label:'SASAMA AKO!',emoji:'🎉',color:'#f23e92'},food:{label:'PAGKAIN',emoji:'🍕',color:'#f09a30'},drink:{label:'INUMIN',emoji:'🍹',color:'#497ce6'},bebot:{label:'BEBOT',emoji:'😏',color:'#a857dd'},own:{label:'AKO NA BAHALA',emoji:'😎',color:'#1dba9b'}},
  food:[{label:'Pasta',emoji:'🍝',color:'#9d5ce1'},{label:'Pinoy ulam',emoji:'🍲',color:'#ef7940'},{label:'Pizza',emoji:'🍕',color:'#ec4f81'},{label:'Prutas',emoji:'🍉',color:'#349c79'},{label:'Ako na ang bahala',emoji:'✨',color:'#6a65e6'}],
  drink:[{label:'Alak',emoji:'🍻',color:'#9950d9'},{label:'0% na alak',emoji:'🍺',color:'#e08e38'},{label:'Pop',emoji:'🥤',color:'#e95780'},{label:'Juice',emoji:'🧃',color:'#32998f'},{label:'Ako na ang bahala',emoji:'✨',color:'#6369db'}]
};
const MEDIA_KEYS = new Set(['cover','homeLeft','homeRight','food','drink','bebot','own','bebotPhoto','endingYes','endingNo','music',...Array.from({length:5},(_,i)=>`food-${i}`),...Array.from({length:5},(_,i)=>`drink-${i}`)]);
const LIMIT_MEDIA = 18 * 1024 * 1024;
const LIMIT_TOTAL_MEDIA = 100 * 1024 * 1024;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname,'data','local-data.json');
let pool = null;
let local = {config:structuredClone(DEFAULT_CONFIG), media:{}, submissions:[]};
let stateVersion = Date.now();
const attempts = new Map();

async function initStore(){
  if (DATABASE_URL) {
    const {Pool} = require('pg');
    pool = new Pool({connectionString:DATABASE_URL, max:4, ssl:process.env.DB_SSL === 'true' ? {rejectUnauthorized:false} : undefined});
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS ci_invite_settings (id SMALLINT PRIMARY KEY, config JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS ci_invite_media (key TEXT PRIMARY KEY, type TEXT NOT NULL, content BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS ci_invite_responses (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), guest_name TEXT NOT NULL, category TEXT NOT NULL, answer TEXT NOT NULL);`);
    await pool.query('INSERT INTO ci_invite_settings (id,config) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING',[JSON.stringify(DEFAULT_CONFIG)]);
    console.log('PostgreSQL connected; submissions and uploads are persistent.');
  } else {
    try {const d = JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); if (d && d.config && d.media && Array.isArray(d.submissions)) local = d;} catch {}
    console.log('Local-file mode (testing only). Render hosting requires DATABASE_URL.');
  }
}
async function persistLocal(){fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true}); const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(local));fs.renameSync(tmp,DATA_FILE)}
async function getConfig(){if(pool){const r=await pool.query('SELECT config FROM ci_invite_settings WHERE id=1');return r.rows[0]?.config||structuredClone(DEFAULT_CONFIG)}return local.config}
async function setConfig(obj){if(pool)await pool.query('UPDATE ci_invite_settings SET config=$1::jsonb WHERE id=1',[JSON.stringify(obj)]);else {local.config=obj;await persistLocal()} stateVersion=Date.now()}
async function mediaList(){if(pool){const r=await pool.query('SELECT key,type,updated_at FROM ci_invite_media');return Object.fromEntries(r.rows.map(x=>[x.key,{type:x.type,url:`/api/media/${encodeURIComponent(x.key)}?v=${new Date(x.updated_at).getTime()}`}]))}return Object.fromEntries(Object.entries(local.media).map(([k,v])=>[k,{type:v.type,url:`/api/media/${encodeURIComponent(k)}?v=${v.updated}`}]))}
async function getMedia(key){if(pool){const r=await pool.query('SELECT type,content FROM ci_invite_media WHERE key=$1',[key]);return r.rows[0]||null}const x=local.media[key];return x?{type:x.type,content:Buffer.from(x.base64,'base64')}:null}
async function setMedia(key,type,bytes){
  if(pool){const total=await pool.query('SELECT COALESCE(SUM(OCTET_LENGTH(content)),0) AS total FROM ci_invite_media WHERE key<>$1',[key]);if(Number(total.rows[0].total)+bytes.length>LIMIT_TOTAL_MEDIA)throw Object.assign(new Error('Napuno ang media storage (100MB limit).'),{status:413});await pool.query('INSERT INTO ci_invite_media(key,type,content,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(key) DO UPDATE SET type=$2,content=$3,updated_at=NOW()',[key,type,bytes]);}
  else {const size=Object.entries(local.media).reduce((n,[k,v])=>n+(k===key?0:Buffer.from(v.base64,'base64').length),0);if(size+bytes.length>LIMIT_TOTAL_MEDIA)throw Object.assign(new Error('Napuno ang media storage (100MB limit).'),{status:413});local.media[key]={type,base64:bytes.toString('base64'),updated:Date.now()};await persistLocal()}
  stateVersion=Date.now();
}
async function dropMedia(key){if(pool)await pool.query('DELETE FROM ci_invite_media WHERE key=$1',[key]);else {delete local.media[key];await persistLocal()}stateVersion=Date.now()}
async function addSubmission(x){if(pool){await pool.query('INSERT INTO ci_invite_responses(id,guest_name,category,answer) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[x.id,x.name,x.group,x.answer]);return}if(!local.submissions.some(y=>y.id===x.id)){local.submissions.unshift({...x,when:new Date().toISOString()});await persistLocal()}}
async function getSubmissions(){if(pool){const r=await pool.query('SELECT id,created_at AS "when",guest_name AS name,category AS "group",answer FROM ci_invite_responses ORDER BY created_at DESC LIMIT 2000');return r.rows}return local.submissions.slice(0,2000)}
async function clearSubmissions(){if(pool)await pool.query('TRUNCATE ci_invite_responses');else {local.submissions=[];await persistLocal()}}

function json(res,code,obj){const data=Buffer.from(JSON.stringify(obj));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)}
function failure(res,e){console.error(e);json(res,e.status||500,{error:e.status?e.message:'May problema sa server. Subukan muli.'})}
function readJson(req,max=250000){return new Promise((resolve,reject)=>{let buf='',size=0;req.on('data',c=>{size+=c.length;if(size>max){reject(Object.assign(new Error('Sobrang laki ng ipinadala.'),{status:413}));req.destroy();return}buf+=c});req.on('end',()=>{try{resolve(JSON.parse(buf||'{}'))}catch{reject(Object.assign(new Error('Invalid data'),{status:400}))}});req.on('error',reject)})}
function constantEqual(a,b){const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
function signature(payload){return crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url')}
function cookieSession(){const exp=Date.now()+12*3600*1000,nonce=crypto.randomBytes(12).toString('hex');const value=`${exp}.${nonce}`;return `${value}.${signature(value)}`}
function isAdmin(req){let raw='';for(const bit of String(req.headers.cookie||'').split(';')){const [name,...parts]=bit.trim().split('=');if(name==='ci_admin')raw=parts.join('=')}if(!raw)return false;const m=raw.match(/^(\d+)\.([a-f0-9]{24})\.([\w-]+)$/);if(!m||Date.now()>Number(m[1]))return false;return constantEqual(signature(`${m[1]}.${m[2]}`),m[3])}
function requireAdmin(req){if(!isAdmin(req))throw Object.assign(new Error('Admin login required.'),{status:401})}
function sameOrigin(req){const orig=req.headers.origin;if(!orig)return true;try{const u=new URL(orig);const host=req.headers['x-forwarded-host']||req.headers.host;return u.host===host&&['https:','http:'].includes(u.protocol)}catch{return false}}
function rateLimit(req,route,count,ms){const id=route+':'+String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'anon').split(',')[0];const now=Date.now(),a=(attempts.get(id)||[]).filter(v=>v>now-ms);if(a.length>=count)throw Object.assign(new Error('Masyadong maraming attempts. Pakisubukan mamaya.'),{status:429});a.push(now);attempts.set(id,a);if(attempts.size>5000){for(const [k,v] of attempts){if(v[v.length-1]<now-ms)attempts.delete(k)}}}
function cleanConfig(b){
  if(!b||typeof b!=='object'||Array.isArray(b))throw Object.assign(new Error('Invalid configuration.'),{status:400});
  const v=structuredClone(DEFAULT_CONFIG);
  for(const k of ['eventTitle','subtitle','declineMessage','declineSub','declineNext','endYesText','endNoText','venueName','venueAddress','venueInfo'])if(typeof b[k]==='string')v[k]=b[k].slice(0,k==='venueAddress'?600:350);
  for(const k of Object.keys(v.buttons))v.buttons[k]=cleanBtn(b.buttons?.[k],v.buttons[k]);
  for(const type of ['food','drink']){if(Array.isArray(b[type]))for(let i=0;i<5;i++)v[type][i]=cleanBtn(b[type][i],v[type][i])}
  return v;
}
function cleanBtn(x,d){if(!x||typeof x!=='object')return d;return {label:typeof x.label==='string'?x.label.slice(0,120):d.label,emoji:typeof x.emoji==='string'?x.emoji.slice(0,20):d.emoji,color:typeof x.color==='string'&&/^#[\da-fA-F]{6}$/.test(x.color)?x.color:d.color}}
function validateMedia(key,type,size){if(!MEDIA_KEYS.has(key))throw Object.assign(new Error('Invalid media key'),{status:400});const good = key==='music'?type.startsWith('audio/') : ['endingYes','endingNo'].includes(key)?(type.startsWith('video/')||type.startsWith('image/')):type.startsWith('image/');if(!good||!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|x-m4a|wav|ogg|webm))$/.test(type))throw Object.assign(new Error('Hindi suportadong file type.'),{status:400});if(size>LIMIT_MEDIA)throw Object.assign(new Error('Maximum upload: 18MB.'),{status:413})}
function mediaContent(res,record){if(!record){res.writeHead(404);return res.end('Not found')}const data=Buffer.isBuffer(record.content)?record.content:Buffer.from(record.content);res.writeHead(200,{'Content-Type':record.type,'Content-Length':data.length,'Cache-Control':'public,max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(data)}
async function handle(req,res){
  try{
    const u=new URL(req.url,'http://localhost');const endpoint=u.pathname;
    if(req.method==='GET'&&(endpoint==='/'||endpoint==='/index.html')){
      const data=fs.readFileSync(path.join(__dirname,'public','index.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});return res.end(data)
    }
    if(req.method==='GET'&&endpoint==='/health')return json(res,200,{ok:true,persistent:!!pool});
    if(req.method==='GET'&&endpoint==='/api/state')return json(res,200,{config:await getConfig(),media:await mediaList(),version:stateVersion});
    if(req.method==='GET'&&endpoint.startsWith('/api/media/')){
      const key=decodeURIComponent(endpoint.slice('/api/media/'.length));if(!MEDIA_KEYS.has(key))return json(res,404,{error:'Media not found'});
      return mediaContent(res,await getMedia(key));
    }
    if(!sameOrigin(req))return json(res,403,{error:'Cross-origin request blocked.'});
    if(req.method==='POST'&&endpoint==='/api/submit'){
      rateLimit(req,'submit',120,60000);const d=await readJson(req,6000);
      if(!/^[a-f\d-]{36}$/i.test(d.id||''))throw Object.assign(new Error('Missing submission ID.'),{status:400});
      const name=String(d.name||'Hindi naglagay ng pangalan').trim().slice(0,90);
      const group=String(d.group||'').trim().slice(0,80),answer=String(d.answer||'').trim().slice(0,300);
      if(!group||!answer)throw Object.assign(new Error('Kulang ang sagot.'),{status:400});
      await addSubmission({id:d.id,name,group,answer});return json(res,201,{ok:true});
    }
    if(req.method==='POST'&&endpoint==='/api/admin/login'){
      rateLimit(req,'login',8,10*60000);const d=await readJson(req,1000);
      if(!constantEqual(d.password||'',ADMIN_PASSWORD))return json(res,401,{error:'Maling admin password.'});
      res.setHeader('Set-Cookie',`ci_admin=${cookieSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${IS_HOSTED?'; Secure':''}`);
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&endpoint==='/api/admin/logout'){
      res.setHeader('Set-Cookie',`ci_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_HOSTED?'; Secure':''}`);return json(res,200,{ok:true});
    }
    if(endpoint.startsWith('/api/admin/'))requireAdmin(req);
    if(req.method==='GET'&&endpoint==='/api/admin/submissions')return json(res,200,{submissions:await getSubmissions()});
    if(req.method==='POST'&&endpoint==='/api/admin/settings'){const b=await readJson(req,50000);await setConfig(cleanConfig(b.config));return json(res,200,{ok:true,config:await getConfig()})}
    if(req.method==='POST'&&endpoint==='/api/admin/media'){
      const b=await readJson(req,25*1024*1024);const key=String(b.key||''),type=String(b.type||'');
      if(typeof b.data!=='string'||b.data.length>25*1024*1024)throw Object.assign(new Error('Invalid file.'),{status:413});
      const data=Buffer.from(b.data,'base64');validateMedia(key,type,data.length);
      if(!data.length)throw Object.assign(new Error('Walang file.'),{status:400});
      await setMedia(key,type,data);return json(res,200,{ok:true,media:await mediaList()});
    }
    if(req.method==='DELETE'&&endpoint.startsWith('/api/admin/media/')){
      const key=decodeURIComponent(endpoint.slice('/api/admin/media/'.length));if(!MEDIA_KEYS.has(key))throw Object.assign(new Error('Invalid media key'),{status:400});await dropMedia(key);return json(res,200,{ok:true,media:await mediaList()});
    }
    if(req.method==='POST'&&endpoint==='/api/admin/clear-submissions'){await clearSubmissions();return json(res,200,{ok:true})}
    return json(res,404,{error:'Not found'});
  }catch(e){if(!res.headersSent)failure(res,e)}
}
initStore().then(()=>http.createServer(handle).listen(PORT,'0.0.0.0',()=>console.log(`Invitation server on http://localhost:${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
