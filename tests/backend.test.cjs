const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads'),{mock,initial}=require('./google_mock.cjs');
const NOW=Date.parse('2026-10-14T08:00:00Z');
const id=()=>crypto.randomBytes(24).toString('base64url'), token=()=>crypto.randomBytes(32).toString('base64url');
const booking=(changes={})=>({action:'book',date:'2026-10-15',hour:18,first_name:'Cliente',last_name:'Prova',phone:'+393331234567',management_token:token(),request_id:id(),...changes});
const admin=(action,changes={})=>({action,owner_email:'owner@example.test',request_id:id(),...changes});
test('due richieste realmente parallele: un solo evento di prenotazione',async()=>{
  const root=path.resolve(process.env.TEST_SCRATCH||'work/calcetto/concurrency');fs.mkdirSync(root,{recursive:true});
  const file=path.join(root,crypto.randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(initial()));const lockBuffer=new SharedArrayBuffer(4);
  const run=payload=>new Promise((resolve,reject)=>{const w=new Worker(path.join(__dirname,'concurrent_worker.cjs'),{workerData:{file,lockBuffer,now:NOW,payload}});w.on('message',resolve);w.on('error',reject);});
  const answers=await Promise.all(Array.from({length:8},()=>run(booking())));
  assert.equal(answers.filter(a=>a.ok).length,1);assert.equal(answers.filter(a=>a.error?.code==='OCCUPIED').length,7);
  assert.equal(JSON.parse(fs.readFileSync(file)).Prenotazioni.length,2);
});
test('ritentativo identico anche simultaneo: stessa prenotazione',async()=>{
  const root=path.resolve(process.env.TEST_SCRATCH||'work/calcetto/concurrency');fs.mkdirSync(root,{recursive:true});const file=path.join(root,crypto.randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(initial()));const lockBuffer=new SharedArrayBuffer(4),payload=booking();
  const run=()=>new Promise((resolve,reject)=>{const w=new Worker(path.join(__dirname,'concurrent_worker.cjs'),{workerData:{file,lockBuffer,now:NOW,payload}});w.on('message',resolve);w.on('error',reject);});
  const result=await Promise.all([run(),run(),run(),run()]);assert(result.every(r=>r.ok));assert.equal(new Set(result.map(r=>r.result.booking_id)).size,1);assert.equal(JSON.parse(fs.readFileSync(file)).Prenotazioni.length,2);
});
test('retry con dati diversi viene rifiutato; token mai salvato in chiaro',()=>{
 const m=mock({now:NOW}),p=booking();assert(m.call(p).ok);assert.equal(m.call({...p,phone:'+393339999999'}).error.code,'IDEMPOTENCY_CONFLICT');assert(!JSON.stringify(m.data()).includes(p.management_token));
});
test('cancellazione a sei ore esatte; turno riaperto e vecchio retry non ricrea',()=>{
 const m=mock({now:NOW}),p=booking(),created=m.call(p);m.clock.now=Date.parse(created.result.start)-6*3600000;
 assert(m.call({action:'cancel',management_token:p.management_token,request_id:id()}).ok);
 assert.equal(m.call({action:'availability',date:p.date}).result.slots.find(s=>s.hour===18).status,'free');
 assert.equal(m.call(p).result.status,'CANCELLED');assert(m.call(booking()).ok);
});
test('sei ore meno un millisecondo: cancellazione negata sul server',()=>{
 const m=mock({now:NOW}),p=booking(),created=m.call(p);m.clock.now=Date.parse(created.result.start)-6*3600000+1;
 assert.equal(m.call({action:'cancel',management_token:p.management_token,request_id:id()}).error.code,'TOO_LATE');assert.equal(m.data().Prenotazioni.length,2);
});
test('turni passati, ora di inizio esatta, fuori orario e date impossibili',()=>{
 const m=mock({now:NOW});for(const hour of [14,22,15.5])assert.equal(m.call(booking({hour})).error.code,'VALIDATION');
 assert.equal(m.call(booking({date:'2026-02-30'})).error.code,'VALIDATION');
 assert.equal(m.call(booking({date:'2026-10-13'})).error.code,'PAST');
 m.clock.now=Date.parse('2026-10-15T16:00:00Z');assert.equal(m.call(booking()).error.code,'PAST');
});
test('fuso Rome e cambi ora legale, cancellazione calcolata in ore reali',()=>{
 const m=mock({now:Date.parse('2026-03-27T08:00Z')});
 assert.equal(m.call(booking({date:'2026-03-28',hour:15})).result.start,'2026-03-28T14:00:00.000Z');
 assert.equal(m.call(booking({date:'2026-03-29',hour:15})).result.start,'2026-03-29T13:00:00.000Z');
 const a=mock({now:NOW});assert.equal(a.call(booking({date:'2026-10-24',hour:15})).result.start,'2026-10-24T13:00:00.000Z');
 assert.equal(a.call(booking({date:'2026-10-25',hour:15})).result.start,'2026-10-25T14:00:00.000Z');
});
test('API pubblica senza dati personali o hash; gestione solo con codice',()=>{
 const m=mock({now:NOW}),p=booking(),created=m.call(p),availability=m.call({action:'availability',date:p.date});
 for(const result of [created,availability,m.call({action:'manage',management_token:p.management_token})]){
 const text=JSON.stringify(result);for(const secret of [p.phone,p.first_name,p.last_name,p.management_token,'Token_hash','Telefono','first_name'])assert(!text.includes(secret));}
 assert.equal(m.call({action:'manage',management_token:token()}).error.code,'NOT_FOUND');
});
test('autorizzazione verificata per ogni operazione proprietario',()=>{
 const m=mock({now:NOW});for(const action of ['admin_list','admin_book','admin_cancel','admin_paid','admin_block','admin_unblock']){
 assert.equal(m.call(admin(action)).error.code,'FORBIDDEN');assert.equal(m.call(admin(action,{owner_email:'intruso@example.test'}),true).error.code,'FORBIDDEN');}
 assert(m.call(admin('admin_list'),true).ok);
});
test('prenotazione telefonica, pagato, annullamento e blocco/sblocco',()=>{
 const m=mock({now:NOW}),p=booking({action:'admin_book',owner_email:'owner@example.test'}),r=m.call(p,true);assert(r.ok);
 assert(m.call(admin('admin_paid',{booking_id:r.result.booking_id,paid:true}),true).ok);
 let list=m.call(admin('admin_list'),true).result.bookings;assert.equal(list[0].paid,true);assert.equal(list[0].phone,p.phone);
 assert(m.call(admin('admin_cancel',{booking_id:r.result.booking_id}),true).ok);
 const block=admin('admin_block',{date:p.date,hour:p.hour});assert(m.call(block,true).ok);assert.equal(m.call(booking()).error.code,'OCCUPIED');
 assert(m.call(admin('admin_unblock',{date:p.date,hour:p.hour}),true).ok);assert(m.call(booking()).ok);
});
test('firma alterata, scaduta e proprietà assenti falliscono senza scrivere',()=>{
 const m=mock({now:NOW}),p=booking(),env=m.envelope(p);env.signature='0'.repeat(64);assert.equal(m.handle(env).error.code,'UNAUTHORIZED');
 const old=m.envelope(p);m.clock.now+=301000;assert.equal(m.handle(old).error.code,'UNAUTHORIZED');
 delete m.props.ADMIN_SECRET;assert.equal(m.call(p).error.code,'CONFIGURATION');assert.equal(m.data().Prenotazioni.length,1);
});
test('lock occupato o errore di scrittura: fallisce chiuso e rilascia il lock',()=>{
 const busy=mock({now:NOW,lockBusy:true});assert.equal(busy.call(booking()).error.code,'BUSY');assert.equal(busy.stats.writes,0);
 const broken=mock({now:NOW,failBeforeWrite:true});assert.equal(broken.call(booking()).error.code,'UNAVAILABLE');assert.equal(broken.stats.releases,1);
 const valid=mock({now:NOW});assert(valid.call(booking()).ok);assert.equal(valid.stats.flushes,1);assert.equal(valid.stats.releases,1);
});
test('risposta persa dopo il salvataggio: il ritentativo recupera la stessa prenotazione',()=>{
 const m=mock({now:NOW,failAfterWrite:true}),p=booking();assert.equal(m.call(p).error.code,'UNAVAILABLE');
 const retry=m.call(p);assert(retry.ok);assert(retry.result.replayed);assert.equal(m.data().Prenotazioni.length,2);
});
test('configurazione pubblica contiene solo metadati e segue il fuso configurato',()=>{
 const data=initial();data.Impostazioni[2][1]='America/New_York';
 const m=mock({data,now:Date.parse('2026-10-14T01:00:00Z')});const config=m.call({action:'configuration'}).result;
 assert.equal(config.today,'2026-10-13');assert.deepEqual(Object.keys(config).sort(),['name','price','server_now','timezone','today']);
});
