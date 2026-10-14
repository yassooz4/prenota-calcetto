// Solo demo locale: usa esattamente Code.gs con adattatori Google simulati.
const fs=require('node:fs'),http=require('node:http'),{mock}=require('./google_mock.cjs');
const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const m=mock({apiSecret:cfg.api_secret,adminSecret:cfg.admin_secret,ownerEmail:cfg.owner_email});
const server=http.createServer((req,res)=>{
 if(req.method!=='POST'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({status:'demo'}));}
 let bytes='',large=false;req.on('data',chunk=>{bytes+=chunk;if(bytes.length>12000){large=true;req.destroy();}});
 req.on('end',()=>{if(large)return;let answer;try{m.clock.now=Date.now();answer=m.handle(JSON.parse(bytes));}catch(e){answer={ok:false,error:{code:'VALIDATION',message:'Richiesta non valida.'}};}
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(answer));});
});
server.listen(Number(cfg.port),'127.0.0.1',()=>console.log('DEMO_READY'));
