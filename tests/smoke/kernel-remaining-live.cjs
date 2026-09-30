/* Opt-in isolated-container acceptance. Never use a personal workspace.
 * node tests/smoke/kernel-remaining-live.cjs /path/to/0600-state.json
 * State: {apiUrl,token,notebook}; requires the previously authorized test notebook.
 */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), http = require('node:http'), cp = require('node:child_process');
const s = JSON.parse(fs.readFileSync(process.argv[2]));
assert.equal(new URL(s.apiUrl).hostname, '127.0.0.1');
const prefix = 'REMAINING-' + Date.now(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-remaining-'));
const base = s.apiUrl + '/plugin/private/siyuan-plugins-mcp-sisyphus';
const headers = { Authorization: 'Token ' + s.token, 'Content-Type': 'application/json' };
const settingsPath = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings';
const configPath = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';
const fixture = { prefix, notebook: s.notebook, dir, docs: [], files: [], remoteZips: [], passed: [] };
const recordPath = path.join(os.tmpdir(), 'kernel-remaining-fixture.json');
const save = () => fs.writeFileSync(recordPath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
const pass = label => { fixture.passed.push(label); save(); console.log('PASS ' + label); };
async function api(p, args) { const r = await fetch(s.apiUrl + p, {method:'POST',headers,body:JSON.stringify(args)}); const j = await r.json(); assert.equal(j.code,0,p); return j.data; }
async function get(p) { const r = await fetch(s.apiUrl+'/api/file/getFile',{method:'POST',headers,body:JSON.stringify({path:p})}); assert.equal(r.status,200,p); return Buffer.from(await r.arrayBuffer()); }
async function put(p, bytes) { const form = new FormData(); form.append('path',p); form.append('isDir','false'); form.append('file',new Blob([bytes]),'fixture'); const r = await fetch(s.apiUrl+'/api/file/putFile',{method:'POST',headers:{Authorization:headers.Authorization},body:form}); assert.equal((await r.json()).code,0); }
let seq=1, sid;
async function rpc(method, params={}, session=sid) { const r = await fetch(base+'/mcp',{method:'POST',headers:{...headers,...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',id:seq++,method,params})}); const j=await r.json(); assert.equal(r.status,200,JSON.stringify(j).slice(0,300)); assert.ok(!j.error,JSON.stringify(j.error)); return {result:j.result,response:r}; }
const val = r => r.structuredContent || JSON.parse(r.content.find(x=>x.type==='text').text);
async function call(name,args,ok=true) { const {result}=await rpc('tools/call',{name,arguments:args}); if(ok)assert.ok(!result.isError,JSON.stringify(result).slice(0,500)); return result; }
async function mutate(name,args,ok=true) { const pre=val(await call(name,{...args,validateOnly:true})); assert.equal(pre.writeAttempted,false); const leased={...args,requestId:pre.requestId,...(pre.preconditionField?{[pre.preconditionField]:pre[pre.preconditionField]}:{}),confirm:true}; const r=await call(name,leased,ok); if(ok){assert.equal(val(r).safety.transactionState,'committed'); assert.equal(val(await call(name,leased)).replayed,true);}return r; }
let mode='normal', injected=0, proxy;
async function cli(args) { const flags=['cli/dist/cli.cjs','file',args.action,'--json']; for(const[k,v]of Object.entries(args)){if(k==='action')continue; flags.push('--'+k+(Array.isArray(v)?'-json':''),Array.isArray(v)?JSON.stringify(v):String(v));}return new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,flags,{env:{...process.env,SIYUAN_API_URL:'http://127.0.0.1:'+proxy.address().port,SIYUAN_TOKEN:s.token}});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));}); }
(async()=>{
 save(); const notebooks=await api('/api/notebook/lsNotebooks',{}); assert.ok(notebooks.notebooks.some(n=>n.id===s.notebook&&n.name.startsWith('Sisyphus 容器验收')));
 const beforeDocs=await api('/api/query/sql',{stmt:`SELECT id FROM blocks WHERE box='${s.notebook}' AND type='d'`});
 const settingsBytes=await get(settingsPath), configBytes=await get(configPath), settings=JSON.parse(settingsBytes), config=JSON.parse(configBytes);
 const installed=await get('/data/plugins/siyuan-plugins-mcp-sisyphus/kernel.js'); const hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(hash(installed),hash(fs.readFileSync('dist/kernel.js')));fixture.kernelSha=hash(installed);save();pass('installed kernel matches freshly built bundle');
 // Saved only in the local owned temp directory for recovery; never logged.
 fs.writeFileSync(path.join(dir,'settings.backup'),settingsBytes,{mode:0o600});fs.writeFileSync(path.join(dir,'tools.backup'),configBytes,{mode:0o600});
 try {
  const setOptions=opts=>put(settingsPath,JSON.stringify({...settings,kernelOptions:opts}));
  await setOptions({readMaxRequests:0,readMaxMiB:0,readTimeoutMs:0,readRetries:-1,templateMaxMiB:0,allowedOrigins:['*','null','https://x/path','https://x','https://x']});
  let h=await fetch(base+'/health',{headers}).then(r=>r.json());assert.deepEqual(h.kernelOptions,{readMaxRequests:16,readMaxMiB:1,readTimeoutMs:1000,readRetries:0,templateMaxMiB:1,allowedOrigins:['https://x']});
  await setOptions({readMaxRequests:9999,readMaxMiB:9999,readTimeoutMs:999999,readRetries:99,templateMaxMiB:99});
  h=await fetch(base+'/health',{headers}).then(r=>r.json());assert.equal(h.kernelOptions.readMaxRequests,512);assert.equal(h.kernelOptions.readMaxMiB,64);assert.equal(h.kernelOptions.readTimeoutMs,120000);assert.equal(h.kernelOptions.templateMaxMiB,32);assert.equal(h.kernelOptions.readRetries,3);pass('actual persisted options clamp minima/maxima and reject invalid Origins');
  await setOptions({readMaxMiB:1,readTimeoutMs:120000});
  const stmt="SELECT replace(hex(zeroblob(600000)), '00', 'xx') AS payload";
  let r=await call('search',{action:'query_sql',stmt},false);assert.equal(r.isError,true);assert.equal(val(r).error.code,'read_budget_exceeded');assert.equal(val(r).complete,false);
  await setOptions({readMaxMiB:2,readTimeoutMs:120000});r=await call('search',{action:'query_sql',stmt});pass('same real SQL response fails at 1 MiB and succeeds at 2 MiB');
  await setOptions({readMaxRequests:16,readTimeoutMs:120000});
  r=await call('block',{action:'docs_info',ids:Array(50).fill(beforeDocs[0].id)},false);assert.equal(r.isError,true);assert.equal(val(r).error.code,'read_budget_exceeded');
  await call('block',{action:'docs_info',ids:[beforeDocs[0].id]});pass('16-call budget rejects large docs_info; smaller ID batch succeeds');
  await setOptions({templateMaxMiB:1,readTimeoutMs:120000});
  const template=prefix+'.md';fixture.files.push('/data/templates/'+template);save();
  r=await mutate('file',{action:'create_template',path:template,markdown:'x'.repeat(1024*1024+1)},false);assert.equal(r.isError,true);assert.match(JSON.stringify(r),/exceeds 1 MiB/);
  assert.ok(!(await api('/api/file/readDir',{path:'/data/templates'})).some(e=>e.name===template));
  await mutate('file',{action:'create_template',path:template,markdown:'x'.repeat(1024*1024)});assert.equal((await get('/data/templates/'+template)).length,1024*1024);
  r=await mutate('file',{action:'update_template',path:template,markdown:'y'.repeat(1024*1024+1)},false);assert.equal(r.isError,true);assert.equal(hash(await get('/data/templates/'+template)),hash(Buffer.alloc(1024*1024,120)));pass('template 1 MiB exact write; +1 byte create/update rejected with existing bytes preserved');
  const oversize=await fetch(base+'/transfer/upload',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'application/octet-stream','X-Sisyphus-File-Name':prefix+'.bin'},body:Buffer.alloc(10*1024*1024+1)});assert.equal(oversize.status,400);assert.match(JSON.stringify(await oversize.json()),/10 MiB/);pass('10 MiB + 1 byte upload rejected by actual endpoint');
  await put(settingsPath,settingsBytes);
  // App protocol/resource checks only; no snapshot, review rating, or purchase.
  const apps={...config.mcpApps};for(const name of ['flashcardReview','timeline','mascotShop'])apps[name]={...apps[name],enabled:true};
  await put(configPath,JSON.stringify({...config,mcpApps:apps}));
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{extensions:{'io.modelcontextprotocol/ui':{mimeTypes:['text/html;profile=mcp-app']}}}},null);sid=init.response.headers.get('mcp-session-id');assert.ok(sid);
  const tools=(await rpc('tools/list')).result.tools;assert.ok(tools.some(t=>t.name==='mascot_shop_app'));assert.ok(tools.some(t=>t.name==='flashcard_review_app_action'&&t._meta.ui.visibility.includes('app')));
  for(const name of ['flashcard','timeline','shop']){const resource=(await rpc('resources/read',{uri:'ui://siyuan-sisyphus/'+name})).result.contents[0];assert.equal(resource.mimeType,'text/html;profile=mcp-app');assert.ok(resource.text.includes('<html'));fs.writeFileSync(path.join(dir,name+'.html'),resource.text);}
  const shop=await call('mascot_shop_app',{});assert.equal(val(shop).presentationMode,'mcp-app-only');await call('mascot_shop_app_action',{action:'get_balance'});const invalidTimeline=await call('timeline_app_action',{action:'list_nodes',scope:'invalid'},false);assert.equal(invalidTimeline.isError,true);fs.writeFileSync(path.join(dir,'shop-result.json'),JSON.stringify(shop));pass('actual App negotiation, three HTML resources, shop launch and read-only action routes');
  // Create owned fixtures through strict kernel mutation; API only stages the asset bytes.
  const asset='assets/'+prefix+'.bin';fixture.files.push('/data/'+asset);save();await put('/data/'+asset,Buffer.alloc(64*1024,42));
  const doc=val(await mutate('document',{action:'create',notebook:s.notebook,path:'/'+prefix,markdown:'[fixture]('+asset+')'}));fixture.docs.push(doc.id);save();
  proxy=http.createServer(async(req,res)=>{try{const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks);let p;try{p=JSON.parse(body)}catch{}
   const isAsset=req.url==='/api/file/getFile'&&p?.path==='/data/'+asset;
   const isZip=req.url==='/api/file/getFile'&&p?.path?.startsWith('/temp/export/')&&p.path.includes(prefix);
   if(isZip&&!fixture.remoteZips.includes(p.path)){fixture.remoteZips.push(p.path);save();}
   if((isZip&&mode.startsWith('zip'))||(isAsset&&mode==='asset-missing')){injected++;if(mode==='asset-missing'){res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({code:404,msg:'owned fixture fault'}));return;}if(mode==='zip-oversize'){res.writeHead(200,{'Content-Length':String(512*1024*1024+1)});res.end('x');return;}res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':'999999'});res.write(Buffer.alloc(4096));setTimeout(()=>res.destroy(),30);return;}
   const h={...req.headers};delete h.host;delete h.connection;delete h['content-length'];const upstream=await fetch(s.apiUrl+req.url,{method:req.method,headers:h,...(body.length?{body}:{})});res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/octet-stream'});for await(const b of upstream.body)res.write(b);res.end();
  }catch{if(!res.headersSent)res.writeHead(502);res.end('isolated proxy failure');}});
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  {
   const outputDir=path.join(dir,'bridge');fs.mkdirSync(outputDir);fs.writeFileSync(path.join(outputDir,'keep'),'unchanged');
   for(mode of ['zip-reset','zip-oversize']){injected=0;const outputPath=path.join(outputDir,mode+'.zip');const x=await cli({action:'export_resources',paths:[asset],name:prefix+'-'+mode+'-bridge',outputPath});assert.notEqual(x.code,0,x.out.slice(0,200));assert.equal(injected,1);assert.equal(fs.existsSync(outputPath),false);pass('bridge '+mode+': one download, partial file removed');}
   mode='asset-missing';injected=0;const x=await cli({action:'extract_doc',id:doc.id,outputDir});assert.notEqual(x.code,0);assert.equal(injected,1);assert.deepEqual(fs.readdirSync(outputDir),['keep']);assert.equal(fs.readFileSync(path.join(outputDir,'keep'),'utf8'),'unchanged');pass('bridge failed attachment: owned output removed, sibling preserved');
  }
  fixture.complete=true;save();
 } finally {
  if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
  await put(settingsPath,settingsBytes);await put(configPath,configBytes);fixture.settingsRestored=true;
  for(const id of fixture.docs){const info=await api('/api/block/getBlockInfo',{id});assert.equal(info.box,s.notebook);assert.equal(await api('/api/filetree/getHPathByID',{id}),'/'+prefix);await mutate('document',{action:'remove',id});}
  for(const p of [...fixture.files,...fixture.remoteZips]){assert.ok(p.includes(prefix));assert.ok(p.startsWith('/data/assets/')||p.startsWith('/data/templates/')||p.startsWith('/temp/export/'));const parent=p.slice(0,p.lastIndexOf('/'));const entries=await api('/api/file/readDir',{path:parent});if(entries.some(e=>e.name===p.slice(p.lastIndexOf('/')+1)))await api('/api/file/removeFile',{path:p});}
  if(sid)await fetch(base+'/mcp',{method:'DELETE',headers:{...headers,'Mcp-Session-Id':sid}});
  let after;for(let attempt=0;attempt<50;attempt++){after=await api('/api/query/sql',{stmt:`SELECT id FROM blocks WHERE box='${s.notebook}' AND type='d'`});if(JSON.stringify(after.map(x=>x.id).sort())===JSON.stringify(beforeDocs.map(x=>x.id).sort()))break;await new Promise(r=>setTimeout(r,100));}assert.deepEqual(after.map(x=>x.id).sort(),beforeDocs.map(x=>x.id).sort());
  assert.deepEqual(await get(settingsPath),settingsBytes);assert.deepEqual(await get(configPath),configBytes);
  const health=await fetch(base+'/health',{headers}).then(r=>r.json());assert.equal(health.queue.inFlight,0);assert.equal(health.uploadsInFlight,0);fixture.cleaned=true;save();
  // Retain only non-secret App artifacts and the fixture manifest for browser acceptance.
  fs.unlinkSync(path.join(dir,'settings.backup'));fs.unlinkSync(path.join(dir,'tools.backup'));
  fs.rmSync(path.join(dir,'bridge'),{recursive:true,force:true});
  pass('owned remote fixtures removed, configurations restored, queue empty');
 }
 console.log(JSON.stringify({complete:fixture.complete,cleaned:fixture.cleaned,checks:fixture.passed.length,artifacts:dir}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
