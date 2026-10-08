(()=>{'use strict';
const URL_BASE='https://krlrvoofuvvyydjxmkhz.supabase.co';
const KEY='sb_publishable_5OLit2dHZVKptDflPPVd-Q_BAk5Q6j_';
const TOKEN_KEY='hyrox-cloud-session-v1';
let session=null, busy=false, pending=false, ready=false, timer=null;
const el=id=>document.getElementById(id);
const status=(msg,err='')=>{el('cloudStatus').textContent=msg;el('cloudError').textContent=err;};
const headers=(prefer)=>({'apikey':KEY,'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json',...(prefer?{'Prefer':prefer}:{})});
async function auth(path,body){const r=await fetch(URL_BASE+'/auth/v1/'+path,{method:'POST',headers:{'apikey':KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});const x=await r.json().catch(()=>({}));if(!r.ok)throw Error(x.msg||x.error_description||x.message||'Autenticazione fallita');return x}
async function refreshSession(){if(!session?.refresh_token)throw Error('Sessione scaduta: accedi nuovamente');const x=await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});session=x;sessionStorage.setItem(TOKEN_KEY,JSON.stringify(session));}
async function query(table,method='GET',path='',body=null,prefer=''){let req=()=>fetch(URL_BASE+'/rest/v1/'+table+path,{method,headers:headers(prefer),...(body!==null?{body:JSON.stringify(body)}:{})});let r=await req();if(r.status===401){await refreshSession();r=await req()}if(!r.ok){let t=await r.text();throw Error(table+': '+t.slice(0,260))}return r.status===204?null:await r.text().then(t=>t?JSON.parse(t):null)}
const user=()=>session?.user?.id;
function payloadDays(){return Object.entries(db.days).map(([date,a])=>({user_id:user(),log_date:date,calorie_target:db.settings.calories,free_meal:!!a.cheat,notes:JSON.stringify(a)}))}
function payloadWeights(){return db.weights.map(a=>({user_id:user(),measured_on:a.date,weight_kg:a.kg}))}
function profilePayload(){return {user_id:user(),height_cm:db.settings.height,initial_weight_kg:db.settings.startWeight,calorie_target:db.settings.calories,estimated_tdee:3100,workouts_per_week:db.settings.goalSessions}}
const userFilter=()=>'?user_id=eq.'+encodeURIComponent(user());
async function push(){
 await query('profiles','POST','?on_conflict=user_id',profilePayload(),'resolution=merge-duplicates,return=minimal');
 const days=payloadDays(),weights=payloadWeights();
 // Upsert updated records and remove entries deleted by the user.
 const oldDays=await query('daily_logs','GET',userFilter()+'&select=log_date');
 const oldWeights=await query('weight_entries','GET',userFilter()+'&select=measured_on');
 for(const d of oldDays||[])if(!days.some(x=>x.log_date===d.log_date))await query('daily_logs','DELETE',userFilter()+'&log_date=eq.'+d.log_date);
 for(const w of oldWeights||[])if(!weights.some(x=>x.measured_on===w.measured_on))await query('weight_entries','DELETE',userFilter()+'&measured_on=eq.'+w.measured_on);
 if(days.length)await query('daily_logs','POST','?on_conflict=user_id,log_date',days,'resolution=merge-duplicates,return=minimal');
 if(weights.length)await query('weight_entries','POST','?on_conflict=user_id,measured_on',weights,'resolution=merge-duplicates,return=minimal');
}
async function pull(){
 const [profiles,days,weights]=await Promise.all([
 query('profiles','GET',userFilter()+'&select=*'),
 query('daily_logs','GET',userFilter()+'&select=*'),
 query('weight_entries','GET',userFilter()+'&select=measured_on,weight_kg')]);
 const profile=profiles?.[0];
 const settings={...defaults.settings};
 if(profile){if(profile.height_cm)settings.height=Number(profile.height_cm);if(profile.initial_weight_kg)settings.startWeight=Number(profile.initial_weight_kg);if(profile.calorie_target)settings.calories=Number(profile.calorie_target);if(profile.workouts_per_week!==null)settings.goalSessions=profile.workouts_per_week}
 // Preserve remaining personal preferences cached on this device.
 Object.assign(settings,{age:db.settings.age,targetWeight:db.settings.targetWeight,notify:db.settings.notify});
 const entries={};for(const row of days||[]){try{entries[row.log_date]=JSON.parse(row.notes||'{}')}catch{entries[row.log_date]={type:'none',cheat:!!row.free_meal,extraKcal:null,notes:''}}}
 db={settings,days:entries,weights:(weights||[]).map(w=>({date:w.measured_on,kg:Number(w.weight_kg)}))};
 localStorage.setItem('hyrox-progress-v1',JSON.stringify(db));refreshSettings();loadDay();refresh();
}
async function synchronise(pushFirst=false){if(!session||busy){pending=true;return}busy=true;try{
 status('Sincronizzazione…');
 if(pushFirst)await push();else await pull();
 ready=true;status('Cloud sincronizzato');
 }catch(e){status('Da sincronizzare',e.message+' — i dati locali restano disponibili.');}
 finally{busy=false;if(pending){pending=false;setTimeout(()=>window.hyroxCloud.queueSave(),200)}}}
async function runPush(){if(!session||!ready)return;if(busy){pending=true;return}busy=true;try{status('Salvataggio cloud…');await push();status('Cloud sincronizzato')}catch(e){status('Salvataggio in sospeso',e.message+' — riprova con Sincronizza adesso.')}finally{busy=false;if(pending){pending=false;window.hyroxCloud.queueSave()}}}
window.hyroxCloud={queueSave(){if(!session||!ready)return;clearTimeout(timer);timer=setTimeout(runPush,650)}};
function loggedUI(){el('cloudLogin').classList.toggle('hide',!!session);el('cloudLogged').classList.toggle('hide',!session);el('cloudUser').textContent=session?'Accesso: '+(session.user?.email||'utente autorizzato'):''}
el('cloudSignIn').onclick=async()=>{const email=el('cloudEmail').value.trim(),password=el('cloudPass').value;if(!email||!password){status('Non collegato','Inserisci email e password.');return}try{status('Accesso…');session=await auth('token?grant_type=password',{email,password});sessionStorage.setItem(TOKEN_KEY,JSON.stringify(session));el('cloudPass').value='';loggedUI();const permitted=await fetch(URL_BASE+'/rest/v1/rpc/is_hyrox_owner',{method:'POST',headers:headers(),body:'{}'});if(!permitted.ok||await permitted.json()!==true)throw Error('Utente non autorizzato: verifica la tabella app_owner nello SQL Editor.');const count=(await query('daily_logs','GET',userFilter()+'&select=log_date&limit=1')).length+(await query('weight_entries','GET',userFilter()+'&select=measured_on&limit=1')).length;const hasLocal=Object.keys(db.days).length>0||db.weights.length>0;
 if(count===0&&hasLocal){if(confirm('Il cloud è vuoto, ma hai registrazioni locali. Vuoi caricarle ora?')){await synchronise(true);return}}
 await synchronise(false)
 }catch(e){status('Accesso fallito',e.message);session=null;sessionStorage.removeItem(TOKEN_KEY);loggedUI()}};
el('cloudSync').onclick=()=>runPush();
el('cloudSignOut').onclick=()=>{session=null;ready=false;sessionStorage.removeItem(TOKEN_KEY);loggedUI();status('Non collegato')};
try{session=JSON.parse(sessionStorage.getItem(TOKEN_KEY)||'null')}catch{}
if(session){loggedUI();synchronise(false)}else loggedUI();
window.addEventListener('online',()=>{if(session&&ready)runPush()});
})();