/** Prenota Calcetto. Tutte le scritture attraversano lo stesso ScriptLock.
 * Non duplicare questo progetto Apps Script per lo stesso archivio.
 */
const HEADERS = ['Evento_ID','Prenotazione_ID','Tipo','Data','Ora','Inizio_UTC','Fine_UTC',
  'Stato','Nome','Cognome','Telefono','Pagato','Prezzo','Token_hash','Richiesta_hash',
  'Payload_hash','Creato_UTC','Aggiornato_UTC'];
const ADMIN_ACTIONS = ['admin_list','admin_book','admin_cancel','admin_paid','admin_block','admin_unblock'];
const WRITE_ACTIONS = ['book','cancel','admin_book','admin_cancel','admin_paid','admin_block','admin_unblock'];

function fail_(code, message) { const e = new Error(message); e.bookingCode = code; throw e; }
function hex_(bytes) { return bytes.map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function mac_(s, secret) { return hex_(Utilities.computeHmacSha256Signature(s, secret, Utilities.Charset.UTF_8)); }
function equal_(a,b) {
  if (typeof a!=='string'||typeof b!=='string') return false;
  let delta=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++) delta|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return delta===0;
}
function text_(value, length) { return typeof value==='string' ? value.trim().slice(0,length+1) : ''; }
function readConfig_(spreadsheet) {
  const sheet=spreadsheet.getSheetByName('Impostazioni');
  if (!sheet) fail_('CONFIGURATION','Archivio da configurare.');
  const c=Object.fromEntries(sheet.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>[String(r[0]),r[1]]));
  const result={name:String(c.name||'Prenota Calcetto'),timezone:String(c.timezone||'Europe/Rome'),
    open_hour:Number(c.open_hour),close_hour:Number(c.close_hour),duration_minutes:Number(c.duration_minutes),
    price:Number(c.price),cancellation_hours:Number(c.cancellation_hours)};
  if(result.open_hour!==15||result.close_hour!==22||result.duration_minutes!==60||result.price!==60||result.cancellation_hours!==6)
    fail_('CONFIGURATION','Impostazioni non coerenti con questa versione del campo.');
  try { Utilities.formatDate(new Date(),result.timezone,'yyyy-MM-dd'); } catch(e) { fail_('CONFIGURATION','Fuso orario non valido.'); }
  return result;
}
function date_(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail_('VALIDATION','Scegli una data valida.');
  const [y,m,d]=value.split('-').map(Number), dt=new Date(Date.UTC(y,m-1,d));
  if(y<2000||y>9999||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)
    fail_('VALIDATION','Scegli una data valida.');
  return [y,m,d];
}
function slot_(day,hour,c) {
  const [y,m,d]=date_(day);
  if(!Number.isInteger(hour)||hour<c.open_hour||hour>=c.close_hour) fail_('VALIDATION','Il turno è fuori dall’orario di apertura.');
  const desired=Date.UTC(y,m-1,d,hour), expected=day+'T'+String(hour).padStart(2,'0')+':00:00';
  let guess=desired;
  for(let i=0;i<4;i++) {
    const parts=Utilities.formatDate(new Date(guess),c.timezone,"yyyy-MM-dd'T'HH:mm:ss");
    const represented=Date.parse(parts+'Z');
    guess+=desired-represented;
  }
  if(Utilities.formatDate(new Date(guess),c.timezone,"yyyy-MM-dd'T'HH:mm:ss")!==expected)
    fail_('VALIDATION','Il turno non esiste nel fuso scelto.');
  return {date:day,hour,start:guess,end:guess+c.duration_minutes*60000};
}
function ledger_(sheet,timezone) {
  const grid=sheet.getDataRange().getValues();
  if(JSON.stringify(grid[0])!==JSON.stringify(HEADERS)) fail_('ARCHIVE_INVALID','Intestazioni dell’archivio non valide.');
  const events=grid.slice(1).filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>Object.fromEntries(HEADERS.map((h,i)=>[h,r[i]])));
  const states={};
  for(const row of events) {
    // Sheets può convertire automaticamente YYYY-MM-DD in una cella data.
    // Il confronto fra turni deve usare sempre la data civile canonica.
    if(Object.prototype.toString.call(row.Data)==='[object Date]')
      row.Data=Utilities.formatDate(row.Data,timezone,'yyyy-MM-dd');
    else if(typeof row.Data==='number')
      row.Data=new Date(Math.round((row.Data-25569)*86400000)).toISOString().slice(0,10);
    date_(row.Data);
    row.Pagato=row.Pagato===true||String(row.Pagato).toLowerCase()==='true';
    if(!row.Prenotazione_ID||!['BOOKING','BLOCK'].includes(row.Tipo)||!['CONFIRMED','CANCELLED','BLOCKED','UNBLOCKED'].includes(row.Stato))
      fail_('ARCHIVE_INVALID','Archivio non valido. Contatta il proprietario.');
    states[row.Prenotazione_ID]=row;
  }
  return {events,states};
}
function active_(row) { return row.Stato==='CONFIRMED'||row.Stato==='BLOCKED'; }
function occupied_(state,day,hour) { return Object.values(state).find(r=>r.Data===day&&Number(r.Ora)===hour&&active_(r)); }
function publicBooking_(row,c,now) {
  const cutoff=Date.parse(row.Inizio_UTC)-c.cancellation_hours*3600000;
  return {booking_id:row.Prenotazione_ID,date:row.Data,hour:Number(row.Ora),start:row.Inizio_UTC,end:row.Fine_UTC,
    status:row.Stato,price:Number(row.Prezzo),cancel_before:new Date(cutoff).toISOString(),
    cancellable:row.Stato==='CONFIRMED'&&now<=cutoff,timezone:c.timezone};
}
function customer_(p) {
  const first=text_(p.first_name,80), last=text_(p.last_name,80);
  const phone=text_(p.phone,40).replace(/[\s()\-]/g,'');
  const namePattern=/^[\p{L}\p{M}][\p{L}\p{M} .’'\-]{0,79}$/u;
  if(!namePattern.test(first)||!namePattern.test(last)) fail_('VALIDATION','Nome e cognome sono obbligatori e devono essere validi.');
  if(!/^\+?[0-9]{8,15}$/.test(phone)) fail_('VALIDATION','Inserisci un numero di telefono valido, con prefisso se necessario.');
  return {first,last,phone};
}
function token_(value) {
  if(typeof value!=='string'||!(/^[A-Za-z0-9_-]{43,100}$/).test(value)) fail_('NOT_FOUND','Codice di gestione non valido.');
  return sha_(value);
}
function append_(sheet,row) {
  const safe=HEADERS.map(h=>{
    const v=row[h]===undefined?'':row[h];
    return typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v;
  });
  // Stato, hash del token e richiesta sono scritti in un solo record.
  const range=sheet.getRange(sheet.getLastRow()+1,1,1,HEADERS.length);
  range.setNumberFormats([HEADERS.map(h=>h==='Pagato'?'General':h==='Ora'||h==='Prezzo'?'0':'@')]);
  // Stringhe ISO e telefoni restano testo; pagamenti restano booleani.
  range.setValues([safe]);
  SpreadsheetApp.flush(); // La scrittura viene completata prima di rilasciare il lock.
}
function handleEnvelope_(envelope) {
  let lock,held=false;
  try {
    const props=PropertiesService.getScriptProperties();
    const secret=props.getProperty('API_SECRET'), adminSecret=props.getProperty('ADMIN_SECRET'),
      owner=props.getProperty('OWNER_EMAIL'), spreadsheetId=props.getProperty('SPREADSHEET_ID');
    if(!secret||secret.length<32||!adminSecret||adminSecret.length<32||!owner||!spreadsheetId)
      fail_('CONFIGURATION','Servizio non ancora configurato.');
    if(!envelope||typeof envelope.payload_json!=='string'||envelope.payload_json.length>6000||
       !Number.isInteger(envelope.timestamp)||typeof envelope.nonce!=='string'||!/^[-_A-Za-z0-9]{20,100}$/.test(envelope.nonce))
      fail_('UNAUTHORIZED','Richiesta non autorizzata.');
    const message=envelope.timestamp+'\n'+envelope.nonce+'\n'+envelope.payload_json;
    if(Math.abs(Date.now()/1000-envelope.timestamp)>300||!equal_(envelope.signature,mac_(message,secret)))
      fail_('UNAUTHORIZED','Richiesta non autorizzata.');
    const p=JSON.parse(envelope.payload_json);
    if(!p||typeof p!=='object'||Array.isArray(p)) fail_('VALIDATION','Richiesta non valida.');
    const action=p.action,admin=ADMIN_ACTIONS.includes(action);
    if(admin&&(!equal_(String(p.owner_email||'').toLowerCase(),owner.toLowerCase())||!equal_(envelope.admin_signature,mac_(message,adminSecret))))
      fail_('FORBIDDEN','Accesso riservato al proprietario.');
    if(!['configuration','availability','book','manage','cancel',...ADMIN_ACTIONS].includes(action)) fail_('VALIDATION','Operazione non disponibile.');
    lock=LockService.getScriptLock();
    if(!lock.tryLock(10000)) fail_('BUSY','Il campo sta ricevendo altre richieste. Riprova tra poco.');
    held=true;
    const now=Date.now(), book=SpreadsheetApp.openById(spreadsheetId), c=readConfig_(book), sheet=book.getSheetByName('Prenotazioni');
    if(!sheet) fail_('CONFIGURATION','Archivio da configurare.');
    const {events,states}=ledger_(sheet,book.getSpreadsheetTimeZone());
    let requestHash='',fingerprint='';
    if(WRITE_ACTIONS.includes(action)) {
      if(typeof p.request_id!=='string'||!/^[-_A-Za-z0-9]{20,100}$/.test(p.request_id)) fail_('VALIDATION','Identificativo della richiesta mancante.');
      requestHash=sha_(p.request_id); fingerprint=sha_(envelope.payload_json);
      const previous=events.find(r=>r.Richiesta_hash===requestHash);
      if(previous) {
        if(!equal_(previous.Payload_hash,fingerprint)) fail_('IDEMPOTENCY_CONFLICT','Questo invio è già stato usato per dati diversi.');
        return {ok:true,result:{...publicBooking_(states[previous.Prenotazione_ID],c,now),replayed:true}};
      }
    }
    if(action==='configuration') return {ok:true,result:{name:c.name,timezone:c.timezone,price:c.price,
      today:Utilities.formatDate(new Date(now),c.timezone,'yyyy-MM-dd'),server_now:new Date(now).toISOString()}};
    if(action==='availability') {
      date_(p.date);
      const today=Utilities.formatDate(new Date(now),c.timezone,'yyyy-MM-dd');
      const slots=[];
      for(let hour=c.open_hour;hour<c.close_hour;hour++) {
        const s=slot_(p.date,hour,c);
        slots.push({hour,start:new Date(s.start).toISOString(),end:new Date(s.end).toISOString(),
          status:s.start<=now?'past':occupied_(states,p.date,hour)?'occupied':'free'});
      }
      return {ok:true,result:{date:p.date,today,server_now:new Date(now).toISOString(),name:c.name,timezone:c.timezone,
        price:c.price,duration_minutes:c.duration_minutes,cancellation_hours:c.cancellation_hours,slots}};
    }
    if(action==='admin_list') {
      const bookings=Object.values(states).filter(r=>r.Tipo==='BOOKING').map(r=>({...publicBooking_(r,c,now),first_name:r.Nome,last_name:r.Cognome,
        phone:String(r.Telefono).replace(/^'/,''),paid:r.Pagato===true||r.Pagato==='TRUE'}));
      return {ok:true,result:{bookings,blocks:Object.values(states).filter(r=>r.Tipo==='BLOCK'&&active_(r)).map(r=>publicBooking_(r,c,now))}};
    }
    let row;
    if(action==='book'||action==='admin_book'||action==='admin_block') {
      const s=slot_(p.date,p.hour,c);
      if(s.start<=now) fail_('PAST','Questo turno è già iniziato.');
      if(occupied_(states,p.date,p.hour)) fail_('OCCUPIED','Il turno è stato appena occupato. Scegline un altro.');
      const details=action==='admin_block'?null:customer_(p), isBlock=action==='admin_block';
      const tokenHash=isBlock?'':token_(p.management_token);
      if(tokenHash&&Object.values(states).some(r=>r.Token_hash===tokenHash)) fail_('VALIDATION','Genera un nuovo codice di gestione.');
      row={Prenotazione_ID:Utilities.getUuid(),Tipo:isBlock?'BLOCK':'BOOKING',Data:p.date,Ora:p.hour,
        Inizio_UTC:new Date(s.start).toISOString(),Fine_UTC:new Date(s.end).toISOString(),Stato:isBlock?'BLOCKED':'CONFIRMED',
        Nome:details?.first||'',Cognome:details?.last||'',Telefono:details?.phone||'',Pagato:false,Prezzo:c.price,
        Token_hash:tokenHash,Creato_UTC:new Date(now).toISOString()};
    } else {
      if(action==='manage'||action==='cancel') {
        const hash=token_(p.management_token);
        row=Object.values(states).find(r=>r.Tipo==='BOOKING'&&equal_(r.Token_hash,hash));
        if(!row) fail_('NOT_FOUND','Codice di gestione non valido.');
      } else if(action==='admin_unblock') {
        slot_(p.date,p.hour,c);
        row=Object.values(states).find(r=>r.Tipo==='BLOCK'&&r.Stato==='BLOCKED'&&r.Data===p.date&&Number(r.Ora)===p.hour);
        if(!row) fail_('NOT_FOUND','Il turno non è bloccato.');
      } else {
        row=states[p.booking_id];
        if(!row||row.Tipo!=='BOOKING') fail_('NOT_FOUND','Prenotazione non trovata.');
      }
      row={...row};
      if(action==='manage') return {ok:true,result:publicBooking_(row,c,now)};
      if(action==='cancel'||action==='admin_cancel') {
        if(row.Stato==='CANCELLED') return {ok:true,result:publicBooking_(row,c,now)};
        if(action==='cancel'&&now>Date.parse(row.Inizio_UTC)-c.cancellation_hours*3600000)
          fail_('TOO_LATE','Puoi cancellare soltanto fino a 6 ore prima dell’inizio.');
        row.Stato='CANCELLED';
      } else if(action==='admin_paid') {
        if(typeof p.paid!=='boolean'||row.Stato!=='CONFIRMED') fail_('VALIDATION','Seleziona una prenotazione attiva e uno stato di pagamento valido.');
        row.Pagato=p.paid;
      } else if(action==='admin_unblock') row.Stato='UNBLOCKED';
    }
    row.Evento_ID=Utilities.getUuid();row.Richiesta_hash=requestHash;row.Payload_hash=fingerprint;row.Aggiornato_UTC=new Date(now).toISOString();
    append_(sheet,row);
    return {ok:true,result:publicBooking_(row,c,now)};
  } catch(error) {
    return {ok:false,error:{code:error.bookingCode||'UNAVAILABLE',message:error.bookingCode?error.message:'Servizio temporaneamente non disponibile. Riprova senza cambiare i dati dell’invio.'}};
  } finally { if(held) lock.releaseLock(); }
}
function doPost(e) {
  let answer;
  try { answer=handleEnvelope_(JSON.parse(e.postData.contents)); }
  catch(error) { answer={ok:false,error:{code:'VALIDATION',message:'Richiesta non valida.'}}; }
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({service:'Prenota Calcetto API',version:'1.0',status:'online'})).setMimeType(ContentService.MimeType.JSON);
}
// Configurazione dall’editor: usa lo stesso archivio e le stesse proprietà per tutti i deployment.
function checkConfiguration() {
  const props=PropertiesService.getScriptProperties();
  for(const key of ['SPREADSHEET_ID','API_SECRET','ADMIN_SECRET','OWNER_EMAIL'])
    if(!props.getProperty(key)) throw new Error('Manca la proprietà '+key);
  const book=SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  readConfig_(book);ledger_(book.getSheetByName('Prenotazioni'),book.getSpreadsheetTimeZone());
  console.log('Configurazione verificata. Nessuna credenziale viene stampata.');
}
