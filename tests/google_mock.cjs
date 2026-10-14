// Adattatore di test. Esegue Code.gs invariato; non è un backend di produzione.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
const CODE=fs.readFileSync(path.join(__dirname,'../apps_script/Code.gs'),'utf8');
const HEADERS=['Evento_ID','Prenotazione_ID','Tipo','Data','Ora','Inizio_UTC','Fine_UTC','Stato','Nome','Cognome','Telefono','Pagato','Prezzo','Token_hash','Richiesta_hash','Payload_hash','Creato_UTC','Aggiornato_UTC'];
function initial(){return {Prenotazioni:[HEADERS],Impostazioni:[['Chiave','Valore'],['name','Prenota Calcetto'],['timezone','Europe/Rome'],['open_hour',15],['close_hour',22],['duration_minutes',60],['price',60],['cancellation_hours',6]]};}
function mock(options={}){
  let memory=options.data||initial(),held=false;
  const stats={locks:0,releases:0,flushes:0,writes:0};
  const props={SPREADSHEET_ID:'test-sheet',API_SECRET:options.apiSecret||'test-api-secret-'.repeat(4),ADMIN_SECRET:options.adminSecret||'test-admin-secret-'.repeat(4),OWNER_EMAIL:options.ownerEmail||'owner@example.test'};
  const clock={now:options.now??Date.now()};
  const load=()=>options.file?JSON.parse(fs.readFileSync(options.file,'utf8')):structuredClone(memory);
  const save=d=>{if(!held)throw Error('WRITE_WITHOUT_LOCK');if(options.failBeforeWrite)throw Error('WRITE_FAILED');if(options.file)fs.writeFileSync(options.file,JSON.stringify(d));else memory=d;stats.writes++;};
  const sheet=name=>({getDataRange:()=>({getValues:()=>load()[name].map((row,i)=>{
    if(name==='Prenotazioni'&&i>0&&options.coerceDates&&typeof row[3]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row[3])) {
      const converted=[...row];converted[3]=new Date(row[3]+'T00:00:00Z');return converted;
    }
    return row;
  })}),getLastRow:()=>load()[name].length,
    getRange:(r,c,h,w)=>({setNumberFormats:formats=>{stats.lastFormats=formats;},setValues:values=>{const d=load();while(d[name].length<r+h-1)d[name].push([]);values.forEach((row,i)=>row.forEach((v,j)=>d[name][r-1+i][c-1+j]=v));save(d);}})});
  const lock={tryLock(ms){stats.locks++;if(options.lockBusy)return false;if(options.lockArray){const deadline=Date.now()+ms;while(Atomics.compareExchange(options.lockArray,0,0,1)!==0){if(Date.now()>=deadline)return false;Atomics.wait(options.lockArray,0,1,Math.max(1,deadline-Date.now()));}}held=true;return true;},releaseLock(){if(!held)throw Error('NOT_HELD');held=false;stats.releases++;if(options.lockArray){Atomics.store(options.lockArray,0,0);Atomics.notify(options.lockArray,0);}}};
  const RealDate=Date;class MockDate extends RealDate{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
  const context=vm.createContext({Date:MockDate,console:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null})},LockService:{getScriptLock:()=>lock},
    SpreadsheetApp:{openById:()=>({getSheetByName:name=>sheet(name),getSpreadsheetTimeZone:()=>options.sheetTimezone||'Europe/Rome'}),flush(){if(!held)throw Error('FLUSH_WITHOUT_LOCK');stats.flushes++;if(options.failAfterWrite){options.failAfterWrite=false;throw Error('RESPONSE_LOST');}}},Utilities:{
      DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algo,s)=>Array.from(crypto.createHash('sha256').update(s).digest()),
      computeHmacSha256Signature:(s,key)=>Array.from(crypto.createHmac('sha256',key).update(s).digest()),getUuid:()=>crypto.randomUUID(),
      formatDate:(dt,tz,pattern)=>{const f=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});const p=Object.fromEntries(f.formatToParts(dt).map(x=>[x.type,x.value]));const d=`${p.year}-${p.month}-${p.day}`;return pattern==='yyyy-MM-dd'?d:`${d}T${p.hour}:${p.minute}:${p.second}`;}
    }});
  vm.runInContext(CODE,context,{filename:'Code.gs'});
  function envelope(p,admin=false){const payload_json=JSON.stringify(p),timestamp=Math.floor(clock.now/1000),nonce=crypto.randomBytes(24).toString('base64url'),message=`${timestamp}\n${nonce}\n${payload_json}`;
    const e={payload_json,timestamp,nonce,signature:crypto.createHmac('sha256',props.API_SECRET).update(message).digest('hex')};if(admin)e.admin_signature=crypto.createHmac('sha256',props.ADMIN_SECRET).update(message).digest('hex');return e;}
  return {handle:e=>JSON.parse(JSON.stringify(context.handleEnvelope_(e))),call:(p,admin=false)=>JSON.parse(JSON.stringify(context.handleEnvelope_(envelope(p,admin)))),envelope,clock,stats,data:load,props};
}
module.exports={mock,initial};
