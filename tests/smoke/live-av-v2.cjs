#!/usr/bin/env node
/** Fresh bundles, real kernel data, isolated HTTP coordinator and ledger. No production settings are changed. */
const fs=require('node:fs'), path=require('node:path'), http=require('node:http'), net=require('node:net'), crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');const {promisify}=require('node:util');const runFile=promisify(execFile);
const assert=require('node:assert/strict');const {Client,StreamableHTTPClientTransport,InMemoryTransport}=require('@modelcontextprotocol/client');
const {StdioClientTransport}=require('@modelcontextprotocol/client/stdio');
const root=process.cwd(), prefix='AV-V2-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
const reportPath=process.env.SIYUAN_TEST_REPORT||'/tmp/'+prefix+'.json';
const notebook=process.env.SIYUAN_TEST_NOTEBOOK;
const permissionsOnly=process.env.SIYUAN_TEST_PERMISSIONS_ONLY==='1';
const report={prefix,startedAt:new Date().toISOString(),permissionsOnly,route:'Fresh Node HTTP CJS coordinator through a temporary API settings proxy; actual notebook operations reach the real kernel. Installed kernel.js is not replaced.',checks:[],mutations:[],fixtures:[],artifacts:{},coverage:[]};
const cliConfigPath=reportPath+'.cli.json';
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
const payload=r=>r.structuredContent||JSON.parse(r.content.find(c=>c.type==='text').text);
const executed=new Set();let proxy,child,client,stdio,direct,rt,docID,env,profile,mcpPort,proxyUrl;
const ledger='/data/storage/petal/siyuan-plugins-mcp-sisyphus/writeSafetyLedger';const testLedger=ledger+'-'+prefix;
const permissions='/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions';const testPermissions=permissions+'-'+prefix;
const permissionNotebooks=[];report.permissionNotebooks=permissionNotebooks;const batchRenameFixtures=[];report.batchRenameFixtures=batchRenameFixtures;let permissionsHash,sqlRequests=0,appendRequests=0,deleteRequests=0,renameDocRequests=0,backlinkDocRequests=0,transactionRequests=0;let backlinkTargetID, carrierOrderProbe;
const templateFixtures=[];report.templateFixtures=templateFixtures;
const settings='/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings';
async function api(endpoint,args){const r=await fetch(profile.apiUrl+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(profile.token?{Authorization:'Token '+profile.token}:{})},body:JSON.stringify(args)});const v=await r.json();if(v.code!==0)throw Error(v.msg||'Kernel API failed');return v.data;}
async function exportedMarkdown(id){const value=await api('/api/export/exportMdContent',{id});return typeof value?.content==='string'?value.content:JSON.stringify(value);}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function check(name,fn){try{const value=await fn();report.checks.push({name,status:'passed'});save();console.log('PASS '+name);return value;}catch(e){report.checks.push({name,status:'failed',error:e.message});save();throw e;}}
async function call(tool,args,c=client){const started=Date.now();const result=payload(await c.callTool({name:tool,arguments:args}));fs.appendFileSync(reportPath+'.calls.jsonl',JSON.stringify({at:new Date().toISOString(),tool,args,response:result,ms:Date.now()-started})+'\n');if(result.error)throw Error(JSON.stringify(result));return result;}
async function mutation(tool,args,{replay=false,viaCli=false}={}){
 const pre=await call(tool,{...args,validateOnly:true});assert.equal(pre.writeAttempted,false);
 const input={...args,requestId:pre.requestId,...(pre.preconditionField?{[pre.preconditionField]:pre[pre.preconditionField]}:{})};
 let out;
 if(viaCli){const flags=[];for(const [key,value]of Object.entries(input)){if(key==='action')continue;const name=key.replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase();flags.push('--'+name+(typeof value==='object'?'-json':''),typeof value==='object'?JSON.stringify(value):String(value));}const result=await runFile(process.execPath,[root+'/cli/dist/cli.cjs',tool,args.action,...flags,'--config',cliConfigPath,'--url',proxyUrl,'--json','--debug'],{env,maxBuffer:8*1024*1024});out=JSON.parse(result.stdout.trim());}
 else out=await call(tool,input);
 assert(!out.error,JSON.stringify(out));assert.equal(out.safety?.writeSafetyGuaranteed,true);assert(['committed','no_change'].includes(out.safety?.transactionState),JSON.stringify(out));executed.add(tool+'.'+args.action);
 if(replay){const again=await call(tool,input);assert.equal((again.safety||again).replayed,true);if(tool==='av'&&args.action==='create')assert.equal(again.blockID,out.blockID);}
 report.mutations.push({action:tool+'.'+args.action,transport:viaCli?'HTTP preflight / CLI commit':'fresh HTTP CJS',preflight:true,preconditionField:pre.preconditionField??null,requestId:pre.requestId,transactionState:out.safety.transactionState,replay,strictReadback:true});save();return out;
}
async function cleanupBatchRenameFixtures(){
 for(const fixture of [...batchRenameFixtures].reverse()){
  if(fixture.cleaned)continue;
  try{
   if(!await api('/api/block/checkBlockExist',{id:fixture.id})){fixture.cleaned=true;delete fixture.cleanupError;save();continue;}
   const info=await api('/api/block/getBlockInfo',{id:fixture.id});assert.equal(info.box,notebook);assert.equal(info.rootID,fixture.id);
   const hpath=await api('/api/filetree/getHPathByID',{id:fixture.id});
   assert(hpath.startsWith('/'+prefix));
   await mutation('document',{action:'remove',id:fixture.id});
   assert.equal(await api('/api/block/checkBlockExist',{id:fixture.id}),false);
   fixture.cleaned=true;delete fixture.cleanupError;save();
  }catch(e){fixture.cleanupError=e.message;save();}
 }
}
async function cleanupPermissionNotebooks(){
 for(const fixture of [...permissionNotebooks].reverse()){
  if(fixture.cleaned)continue;const notebooks=await api('/api/notebook/lsNotebooks',{});const current=notebooks.notebooks.find(n=>n.id===fixture.id);if(!current){fixture.cleaned=true;continue;}
  assert.equal(current.name,fixture.name);assert(current.name.startsWith(prefix+'-permission-'));
  await mutation('notebook',{action:'set_permission',notebook:fixture.id,permission:'rwd'});
  await mutation('notebook',{action:'remove',notebook:fixture.id},{replay:true});
  assert(!(await api('/api/notebook/lsNotebooks',{})).notebooks.some(n=>n.id===fixture.id));fixture.cleaned=true;save();
 }
}
async function start(){
 child=spawn(process.execPath,[root+'/dist/mcp-server.cjs'],{env:{...env,SIYUAN_MCP_TRANSPORT:'http',SIYUAN_MCP_PORT:String(mcpPort),SIYUAN_MCP_HOST:'127.0.0.1'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>{errors=(errors+b).slice(-4000)});
 for(let i=0;i<80;i++){try{const response=await fetch('http://127.0.0.1:'+mcpPort+'/health');if(response.ok)break;}catch{}if(child.exitCode!==null)throw Error('New CJS exited: '+errors);await new Promise(r=>setTimeout(r,100));}
 client=new Client({name:'av-v2-live',version:'1'},{capabilities:{elicitation:{}},versionNegotiation:{mode:'auto'}});client.setRequestHandler('elicitation/create',async()=>({action:'accept',content:{confirm:true}}));
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+mcpPort+'/mcp')));
}
async function main(){
 assert(notebook,'SIYUAN_TEST_NOTEBOOK must explicitly identify the isolated test notebook');
 const configPath=path.join(process.env.HOME,'.siyuan-sisyphus/config.json');const file=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};const selected=file.profiles?.[process.env.SIYUAN_TEST_PROFILE||file.currentProfile]||file;
 profile={apiUrl:process.env.SIYUAN_API_URL??selected.apiUrl,token:process.env.SIYUAN_TOKEN??selected.token??''};assert(profile.apiUrl,'Set SIYUAN_API_URL or select an existing CLI profile');
 for(const f of ['dist/mcp-server.cjs','cli/dist/cli.cjs','dist/kernel.js'])if(fs.existsSync(f))report.artifacts[f]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 report.version=await api('/api/system/version',{});
 if(!permissionsOnly){const response=await fetch(profile.apiUrl+'/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json',...(profile.token?{Authorization:'Token '+profile.token}:{})},body:JSON.stringify({path:'/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'})});assert(response.ok);const config=await response.json();assert.equal(config.writeSafety?.strictMode,true,'Live acceptance requires strict writes');assert.equal(config.debug?.slimResponses,true,'Link mapping regression must exercise slim responses');assert.equal(config.file?.actions?.delete_template,true,'Template cleanup must already be enabled before creating templates');}
 const notebooks=await api('/api/notebook/lsNotebooks',{});const nb=notebooks.notebooks.find(n=>n.id===notebook);assert(nb&&/测试|test/i.test(nb.name),'Must target an existing explicit test notebook');report.notebook={id:nb.id,name:nb.name};
 const originalPermissions=await fetch(profile.apiUrl+'/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json',...(profile.token?{Authorization:'Token '+profile.token}:{})},body:JSON.stringify({path:permissions})});assert(originalPermissions.ok);const permissionsText=await originalPermissions.text();assert.equal(JSON.parse(permissionsText)[notebook],'rwd');permissionsHash=crypto.createHash('sha256').update(permissionsText).digest('hex');
 const permissionForm=new FormData();permissionForm.set('path',testPermissions);permissionForm.set('isDir','false');permissionForm.set('file',new Blob([permissionsText]),'permissions.json');const stored=await fetch(profile.apiUrl+'/api/file/putFile',{method:'POST',headers:profile.token?{Authorization:'Token '+profile.token}:{},body:permissionForm});assert.equal((await stored.json()).code,0);report.permissionRoute='A separate persisted API permission file is used only by the temporary fresh-CJS coordinator; original notebook permissions are not rewritten.';
 mcpPort=await freePort();
 proxy=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const c of req)chunks.push(c);let body=Buffer.concat(chunks),headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
  if(req.url==='/api/query/sql')sqlRequests++;
  if(req.url==='/api/transactions')transactionRequests++;
  if(req.url==='/api/block/appendBlock')appendRequests++;
  if(req.url==='/api/ref/getBacklinkDoc'||req.url==='/api/ref/getBackmentionDoc')backlinkDocRequests++;
  if(/\/api\/filetree\/removeDoc(?:ByID|s)?$/.test(req.url))deleteRequests++;
  if(req.url==='/api/filetree/renameDocByID')renameDocRequests++;
  if(req.url==='/api/file/getFile'){
   const args=JSON.parse(body.toString());
   if(args.path===settings){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({enabled:true,kernelEndpointEnabled:false,host:'127.0.0.1',port:mcpPort}));}
   if(args.path===ledger)body=Buffer.from(JSON.stringify({...args,path:testLedger}));
   if(args.path===permissions)body=Buffer.from(JSON.stringify({...args,path:testPermissions}));
  }
  if(req.url==='/api/file/putFile'){
   const form=await new Response(body,{headers:{'content-type':req.headers['content-type']}}).formData();
   if(form.get('path')===ledger){form.set('path',testLedger);body=form;delete headers['content-type'];}
   if(form.get('path')===permissions){form.set('path',testPermissions);body=form;delete headers['content-type'];}
  }
  const upstream=await fetch(profile.apiUrl+req.url,{method:req.method,headers,body:req.method==='GET'?undefined:body});
  let bytes=Buffer.from(await upstream.arrayBuffer());
  if(carrierOrderProbe&&req.url==='/api/av/getMirrorDatabaseBlocks'&&JSON.parse(body.toString()).avID===carrierOrderProbe.avID){
   const value=JSON.parse(bytes.toString());const refs=value.data?.refDefs;
   if(Array.isArray(refs)){const original=refs.map(r=>r.refID);refs.sort((a,b)=>a.refID.localeCompare(b.refID)*(carrierOrderProbe.reverse?-1:1));report.carrierCandidateOrders.push({original,delivered:refs.map(r=>r.refID)});bytes=Buffer.from(JSON.stringify(value));}
  }
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});res.end(bytes);
 }catch(e){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({code:-1,msg:e.message}));}});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));proxyUrl='http://127.0.0.1:'+proxy.address().port;
 env={...process.env,SIYUAN_API_URL:proxyUrl,SIYUAN_TOKEN:profile.token};process.env.SIYUAN_API_URL=proxyUrl;process.env.SIYUAN_TOKEN=profile.token;
 fs.writeFileSync(cliConfigPath,JSON.stringify({apiUrl:proxyUrl,token:profile.token}),{mode:0o600});
 await start();
 if(!permissionsOnly){
 const built=require(root+'/dist/mcp-server.cjs');rt=await built.createSiYuanServerRuntime();assert.equal(rt.permMgr.get(notebook),'rwd');
 const server=await built.createSiYuanServer({runtime:rt,transportMode:'http'});direct=new Client({name:'av-v2-direct',version:'1'});const[ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([direct.connect(ct),server.connect(st)]);
 stdio=new Client({name:'av-v2-stdio',version:'1'});await stdio.connect(new StdioClientTransport({command:process.execPath,args:[root+'/dist/mcp-server.cjs'],env:{...env,SIYUAN_MCP_TRANSPORT:'stdio'},stderr:'ignore'}));
 await check('fresh CJS discovery via HTTP/direct/stdio',async()=>{for(const c of [client,direct,stdio]){const list=await c.listTools();const av=list.tools.find(t=>t.name==='av');assert(av);const text=JSON.stringify(av.inputSchema);assert(text.includes('update_view'));assert(!text.includes('get_attribute_view_keys'));}});
 await check('link target help uses valid shared examples through HTTP, resource and CLI',async()=>{
  const help=await call('document',{action:'help',topic:'ensure_link_targets'});assert.equal(help.example.mode,'resolve');assert(help.example.targets[0].id);assert(!help.example.targets[0].title);assert.deepEqual(help.examples.map(e=>e.mcp.mode),['resolve','reuse','create']);
  for(const example of help.examples){const target=example.mcp.targets[0];if(example.mcp.mode==='create'){assert(target.title);assert(!target.id);assert.equal(example.mcp.validateOnly,true);}else{assert(target.id);assert(!target.title);}}
  const avHelp=await call('av',{action:'help',topic:'update_view'});assert.equal(avHelp.example.validateOnly,true);assert(avHelp.example.filters[0].column);assert(!avHelp.example.filters[0].combination);assert(avHelp.examples[1].mcp.filters[0].combination);assert.deepEqual(Object.keys(avHelp.examples[1].mcp.filters[0]).sort(),['combination','filters']);
  const resource=await direct.readResource({uri:'siyuan://help/action/document/ensure_link_targets'});assert(JSON.stringify(resource).includes('source-index'));assert(JSON.stringify(resource).includes('Resolve explicit existing child IDs'));
  const output=await runFile(process.execPath,[root+'/cli/dist/cli.cjs','help','document','ensure_link_targets','--config',cliConfigPath,'--url',proxyUrl,'--json'],{env});const cli=JSON.parse(output.stdout.trim());assert.equal(cli.example,cli.examples[0].mcp);assert(cli.example.includes('--mode resolve'));assert(cli.example.includes('--targets-json'));assert(cli.example.includes('def4567'));
 });
 const doc=await check('create isolated parent document',()=>mutation('document',{action:'create',notebook,path:'/'+prefix,markdown:'AV v2 isolated acceptance fixture.'}));docID=doc.id;assert(docID);report.fixtures.push({type:'document',id:docID,path:'/'+prefix});save();
 const basicPath='/'+nb.name+'/'+prefix+'/Basic';
 await check('fs create, overwrite and replace with real Markdown readback',async()=>{
  await mutation('fs',{action:'write',path:basicPath,markdown:prefix+' initial'},{replay:true});
  await mutation('fs',{action:'write',path:basicPath,markdown:prefix+' updated',overwrite:true},{replay:true});
  await mutation('fs',{action:'replace',path:basicPath,edit:{old:'updated',new:'verified'}},{replay:true});
  assert(JSON.stringify(await call('fs',{action:'read',path:basicPath})).includes(prefix+' verified'));
 });
 await check('fs list, tree and scoped search',async()=>{
  assert(JSON.stringify(await call('fs',{action:'ls',path:'/'+nb.name+'/'+prefix})).includes('Basic'));
  assert(JSON.stringify(await call('fs',{action:'tree',path:'/'+nb.name+'/'+prefix,maxDepth:2})).includes('Basic'));
  const found=await call('fs',{action:'search',path:basicPath,query:prefix});assert(found.data?.length>0);
 });
 const renamedPath='/'+nb.name+'/'+prefix+'/Basic-renamed';
 await check('fs move and remove isolated child with ownership checks',async()=>{
  await mutation('fs',{action:'mv',from:basicPath,to:renamedPath},{replay:true});
  assert(JSON.stringify(await call('fs',{action:'read',path:renamedPath})).includes(prefix+' verified'));
  const child=await call('document',{action:'lookup',notebook,hpath:'/'+prefix+'/Basic-renamed',include:['path']});const id=child.id||child.document?.id||child.idPath?.path?.split('/').at(-1)?.replace(/\.sy$/,'');assert(id,JSON.stringify(child));
  assert.equal((await api('/api/block/getBlockInfo',{id})).box,notebook);assert((await api('/api/filetree/getHPathByID',{id})).includes(prefix));
  await mutation('fs',{action:'rm',path:renamedPath},{replay:true});
 });
 const paragraph=await check('block append, update and attributes with strict replay',async()=>{
  const added=await mutation('block',{action:'append',parentID:docID,dataType:'markdown',data:prefix+' block'},{replay:true});const id=added.id||added.operations?.[0]?.id;assert(id);
  await mutation('block',{action:'update',id,dataType:'markdown',data:prefix+' block verified'},{replay:true});
  await mutation('block',{action:'set_attrs',id,attrs:{'custom-release-probe':'first'}},{replay:true});
  assert(JSON.stringify(await call('block',{action:'get_kramdown',id})).includes(prefix+' block verified'));return id;
 });
 backlinkTargetID=paragraph;
 await check('stale block state is rejected without overwriting current content',async()=>{
  const args={action:'update',id:paragraph,dataType:'markdown',data:prefix+' must not appear'};const pre=await call('block',{...args,validateOnly:true});
  await mutation('block',{action:'set_attrs',id:paragraph,attrs:{'custom-release-probe':'second'}});
  const rejected=payload(await client.callTool({name:'block',arguments:{...args,requestId:pre.requestId,[pre.preconditionField]:pre[pre.preconditionField]}}));assert.equal(rejected.error?.code,'state_changed');assert.equal(rejected.writeAttempted,false);
  assert(!JSON.stringify(await call('block',{action:'get_kramdown',id:paragraph})).includes('must not appear'));
 });
 await check('document read and scoped fulltext search',async()=>{
  assert(JSON.stringify(await call('document',{action:'get_doc',id:docID,mode:'markdown'})).includes(prefix+' block verified'));
  let found;for(let i=0;i<20;i++){found=await call('search',{action:'fulltext',query:prefix,parentId:docID,pageSize:32});if(found.data?.length)break;await new Promise(r=>setTimeout(r,150));}assert(found.data?.length>0);
 });
 await check('link targets retain complete mappings with slim responses enabled',async()=>{
  const out=await mutation('document',{action:'ensure_link_targets',notebook,parentId:docID,mode:'create',targets:[{key:'target',title:'Link-target'}],markdown:prefix+' link target'},{replay:true});
  const id=out.linkMap?.target?.id;assert(id);assert((await exportedMarkdown(id)).includes(prefix+' link target'));
  for(const mode of ['resolve','reuse']){const resolved=await call('document',{action:'ensure_link_targets',notebook,parentId:docID,mode,targets:[{key:'target',id}]});assert.equal(resolved.linkMap?.target?.id,id);assert.equal(resolved[mode==='resolve'?'resolvedCount':'reusedCount'],1);assert.equal(resolved.changed,false);}
  const planned=await call('document',{action:'ensure_link_targets',notebook,parentId:docID,mode:'create',dryRun:true,targets:[{key:'future',title:'Future-target'}]});assert.equal(planned.dryRun,true);assert.equal(planned.createdCount,0);assert(planned.wouldCreate.some(t=>t.key==='future'));
 });
 await check('templates create, overwrite, save to new name and delete with strict replay',async()=>{
  const path=prefix+'-template.md',saved=prefix+'-saved';templateFixtures.push({path,cleaned:false},{path:saved+'.md',cleaned:false});
  await mutation('file',{action:'create_template',path,markdown:prefix+' template first'},{replay:true});
  await mutation('file',{action:'create_template',path,markdown:prefix+' template overwritten',overwrite:true},{replay:true});
  assert(JSON.stringify(await call('file',{action:'read_template',path})).includes('template overwritten'));
  await mutation('file',{action:'save_doc_as_template',id:docID,name:saved},{replay:true});
  assert(JSON.stringify(await call('file',{action:'read_template',path:saved+'.md'})).includes(prefix));
  for(const fixture of templateFixtures){assert(fixture.path.startsWith(prefix));await mutation('file',{action:'delete_template',path:fixture.path},{replay:true});const response=await fetch(profile.apiUrl+'/templates/'+encodeURIComponent(fixture.path),{headers:profile.token?{Authorization:'Token '+profile.token}:{}});assert.equal(response.status,404);fixture.cleaned=true;save();}
 });
 await check('backlinks and mentions accept omitted optional kernel fields',async()=>{
  await mutation('block',{action:'set_attrs',id:paragraph,attrs:{name:prefix+' backlink'}});
  const reference=await mutation('document',{action:'create',notebook,path:'/'+prefix+'/Backlink-source',markdown:"(("+paragraph+" '"+prefix+" backlink'))"});assert(reference.id);
  const mention=await mutation('document',{action:'create',notebook,path:'/'+prefix+'/Mention-source',markdown:prefix+' backlink'});assert(mention.id);
  let result;for(let i=0;i<20;i++){result=await call('search',{action:'get_backlinks',id:paragraph});if(JSON.stringify(result.backlinks).includes(reference.id)&&JSON.stringify(result.backmentions).includes(mention.id))break;await new Promise(r=>setTimeout(r,150));}
  assert(JSON.stringify(result.backlinks).includes(reference.id));assert(JSON.stringify(result.backmentions).includes(mention.id));assert(!result.error);
  const scoped=await call('search',{action:'get_backlinks',id:paragraph,scopeRootId:reference.id,mode:'links'});assert(JSON.stringify(scoped.backlinks).includes(reference.id));
  const empty=await call('search',{action:'get_backlinks',id:paragraph,scopeRootId:mention.id,mode:'links'});assert.equal(empty.backlinks.length,0);assert.equal(empty.fallbackQuery,undefined);
 });
 await check('aggregate SQL and selected box survive HTTP, direct, stdio and CLI',async()=>{
  const countSql="SELECT COUNT(*) AS n FROM blocks WHERE box='"+notebook+"' AND root_id='"+docID+"'";
  for(const connection of [client,direct,stdio]){
   const count=await call('search',{action:'query_sql',sql:countSql},connection);assert.equal(count.data.length,1);assert(Number(count.data[0].n)>0);assert.equal(count.reason,undefined);
   const rows=await call('search',{action:'query_sql',stmt:"SELECT id, box, type FROM blocks WHERE root_id='"+docID+"' LIMIT 10"},connection);assert(rows.data.length>0);assert(rows.data.every(row=>row.box===notebook));
  }
  const cli=await runFile(process.execPath,[root+'/cli/dist/cli.cjs','search','query_sql','--sql',countSql,'--config',cliConfigPath,'--url',proxyUrl,'--json'],{env});const out=JSON.parse(cli.stdout.trim());assert(Number(out.data?.[0]?.n)>0);assert.equal(out.reason,undefined);
 });
 const created=await check('create database, stable IDs and replay',()=>mutation('av',{action:'create',parentID:docID},{replay:true}));
 await check('creation replay survives HTTP coordinator restart',async()=>{
  const replayArgs={action:'create',parentID:docID,requestId:created.safety.requestId};
  await client.close();const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;await start();
  const out=await call('av',replayArgs);assert.equal(out.avID,created.avID);assert.equal(out.blockID,created.blockID);assert.equal(out.safety.replayed,true);
 });
 assert.equal(created.stage,'verified');const {avID,blockID}=created;report.fixtures.push({type:'av',avID,blockID,parentID:docID});save();
 let structure=await check('structure excludes rows and exposes actual view',async()=>{const out=await call('av',{action:'get',avID,blockID});assert(!('resolvedRows'in out));assert(!('av'in out));assert(out.columns.length);return out;});
 await check('columns and raw scopes return their documented representations',async()=>{const columns=await call('av',{action:'get',scope:'columns',avID,blockID});assert(columns.columns.length>0);assert(!('resolvedRows'in columns));const raw=await call('av',{action:'get',scope:'raw',avID,blockID});assert(raw.av);assert(Array.isArray(raw.resolvedRows));});
 let viewID=structure.viewID;assert(viewID);const primary=structure.columns.find(k=>k.type==='block').columnID;
 // Creation does not force native navigation metadata; bind the test carrier explicitly for subsequent strict view updates.
 await check('select test carrier view explicitly',()=>mutation('block',{action:'set_attrs',id:blockID,attrs:{'custom-sy-av-view':viewID}}));
 await check('add select column',()=>mutation('av',{action:'add_column',avID,blockID,keyName:'Status',keyType:'select'}));
 structure=await call('av',{action:'get',avID,blockID});const status=structure.columns.find(k=>k.name==='Status').columnID;
 await check('F08 parent document cannot authorize an AV mutation',async()=>{
  const before=transactionRequests;
  const rejected=payload(await client.callTool({name:'av',arguments:{action:'set_column_options',avID,blockID:docID,keyID:status,options:[],validateOnly:true}}));
  assert.equal(rejected.error?.code,'permission_denied');assert.equal(rejected.writeAttempted,false);assert.equal(transactionRequests,before);report.parentCarrierRejected=rejected;
 });
 await check('F08 ten implicit carrier leases commit and read back with natural and reordered candidates',async()=>{
  report.carrierCandidateOrders=[];report.carrierLeaseRounds=[];
  for(let round=1;round<=10;round++){
   const args={action:'set_column_options',avID,keyID:status,options:[{name:'Todo',color:'',desc:prefix+' round '+round}]};
   if(round>5)carrierOrderProbe={avID,reverse:false};
   const pre=await call('av',{...args,validateOnly:true});assert.equal(pre.writeAttempted,false);
   if(carrierOrderProbe)carrierOrderProbe.reverse=true;
   await new Promise(r=>setTimeout(r,1500));
   const out=await call('av',{...args,requestId:pre.requestId,[pre.preconditionField]:pre[pre.preconditionField]});
   assert.equal(out.safety?.transactionState,'committed');assert.equal(out.safety?.writeSafetyGuaranteed,true);
   const native=await api('/api/av/getAttributeView',{id:avID});const key=(native.av||native).keyValues.find(k=>k.key.id===status).key;
   assert.deepEqual(key.options,args.options);
   report.carrierLeaseRounds.push({round,order:round<=5?'native':'proxy reordered native candidates',requestId:pre.requestId,transactionState:out.safety.transactionState,independentReadback:true});save();
  }
  carrierOrderProbe=undefined;executed.add('av.set_column_options');
  assert(report.carrierCandidateOrders.some(r=>r.original.includes(docID)&&r.original.includes(blockID)),'must exercise real parent and carrier candidates');
  await mutation('av',{action:'set_column_options',avID,blockID,keyID:status,options:[{name:'Todo',color:'',desc:'explicit carrier control'}]},{replay:true,viaCli:true});
 });
 const added=await check('add isolated detached rows',()=>mutation('av',{action:'add_rows',avID,blockID,primaryKeyTexts:['Alpha','Beta','Gamma']}));
 const rows=await check('query canonical row IDs and complete pagination',async()=>{const out=await call('av',{action:'query',avID,blockID,viewID,pageSize:2});assert.equal(out.structureVersion,2);assert.equal(out.rows.length,2);assert.equal(out.resolvedRows,undefined);assert.equal(out.data,undefined);const step=out.nextSteps.find(s=>s.purpose==='continue_read');assert(step);const last=await call('av',step.arguments);assert(last.rows.length>0);assert(!last.nextSteps?.some(s=>s.purpose==='continue_read'));out.acceptanceAllRows=[...out.rows,...last.rows];assert.equal(out.acceptanceAllRows.length,3);return out;});
 await check('primary-key paging and keyword via direct CJS',async()=>{const out=await call('av',{action:'query',mode:'primary_keys',avID,blockID,keyword:'Alpha',pageSize:1},direct);assert(out.resolvedRows.length===1);});
 await check('set cell with query row ID',()=>mutation('av',{action:'set_cells',avID,blockID,rowID:rows.rows[0].rowID,columnID:status,valueType:'select',option:'Todo'}));
 await check('stale cell manifest is rejected and the current value survives',async()=>{const args={action:'set_cells',avID,blockID,rowID:rows.rows[0].rowID,columnID:status,valueType:'select',option:'StaleMustNotAppear'};const pre=await call('av',{...args,validateOnly:true});await mutation('av',{...args,option:'CurrentVerified'});const rejected=payload(await client.callTool({name:'av',arguments:{...args,requestId:pre.requestId,[pre.preconditionField]:pre[pre.preconditionField]}}));assert.equal(rejected.error?.code,'state_changed');assert.equal(rejected.writeAttempted,false);const after=JSON.stringify(await call('av',{action:'query',avID,blockID,viewID}));assert(after.includes('CurrentVerified'));assert(!after.includes('StaleMustNotAppear'));});
 const selectFilter=[{column:status,operator:'=',value:{type:'select',mSelect:[{content:'CurrentVerified'}]}}];
 await check('select filter without color commits, replays and reads back its native default',async()=>{
  const before=transactionRequests;const out=await mutation('av',{action:'update_view',avID,blockID,viewID,filters:selectFilter},{replay:true});assert.equal(out.safety.transactionState,'committed');assert.equal(transactionRequests,before+1);
  const raw=(await api('/api/av/getAttributeView',{id:avID})).av;const filter=raw.views.find(v=>v.id===viewID).filters[0].filters[0];assert.deepEqual(filter.value.mSelect,[{content:'CurrentVerified',color:''}]);
  const query=await call('av',{action:'query',avID,blockID,viewID});assert.deepEqual(query.rows.map(r=>r.rowID),[rows.rows[0].rowID]);
 });
 await check('mixed group and leaf filters are rejected before any transaction',async()=>{
  const before=transactionRequests;
  for(const filters of [[{...selectFilter[0],combination:'and'}],[{filters:[]}]]){const rejected=payload(await client.callTool({name:'av',arguments:{action:'update_view',avID,blockID,viewID,filters,validateOnly:true}}));assert(rejected.error);assert(/group|leaf/i.test(JSON.stringify(rejected.error)));}
  assert.equal(transactionRequests,before);report.mixedFilterRejectedBeforeWrite=true;
 });
 await check('equivalent omitted and empty select colors return no_change without transactions',async()=>{
  const before=transactionRequests;for(const filters of [selectFilter,[{...selectFilter[0],value:{type:'select',mSelect:[{content:'CurrentVerified',color:''}]}}]]){const out=await mutation('av',{action:'update_view',avID,blockID,viewID,filters});assert.equal(out.safety.transactionState,'no_change');}assert.equal(transactionRequests,before);
 });
 await check('a leaf with an optional empty child list retains native filter semantics',async()=>{
  const before=transactionRequests;const out=await mutation('av',{action:'update_view',avID,blockID,viewID,filters:[{...selectFilter[0],filters:[]}]});assert.equal(out.safety.transactionState,'no_change');assert.equal(transactionRequests,before);
 });
 await check('explicit filter color remains part of the verified configuration',async()=>{
  const filters=[{...selectFilter[0],value:{type:'select',mSelect:[{content:'CurrentVerified',color:'3'}]}}];const out=await mutation('av',{action:'update_view',avID,blockID,viewID,filters});assert.equal(out.safety.transactionState,'committed');
  const raw=(await api('/api/av/getAttributeView',{id:avID})).av;assert.equal(raw.views.find(v=>v.id===viewID).filters[0].filters[0].value.mSelect[0].color,'3');
 });
 await check('multi-select and nested OR filters preserve default colors and row membership',async()=>{
  await mutation('av',{action:'add_column',avID,blockID,keyName:'FilterLabels',keyType:'mSelect'});
  const columns=await call('av',{action:'get',scope:'columns',avID,blockID});const labels=columns.columns.find(c=>c.name==='FilterLabels').columnID;assert(labels);
  await mutation('av',{action:'set_cells',avID,blockID,rowID:rows.rows[1].rowID,columnID:labels,valueType:'multi_select',options:['Review','Secondary']});
  const multiFilter={column:labels,operator:'Contains',value:{type:'mSelect',mSelect:[{content:'Review'}]}};
  const first=await mutation('av',{action:'update_view',avID,blockID,viewID,filters:[multiFilter]},{replay:true});assert.equal(first.safety.transactionState,'committed');
  let query=await call('av',{action:'query',avID,blockID,viewID});assert.deepEqual(query.rows.map(r=>r.rowID),[rows.rows[1].rowID]);
  const before=transactionRequests;const same=await mutation('av',{action:'update_view',avID,blockID,viewID,filters:[multiFilter]});assert.equal(same.safety.transactionState,'no_change');assert.equal(transactionRequests,before);
  const filters=[{combination:'or',filters:[selectFilter[0],{combination:'and',filters:[multiFilter]}]}];const nested=await mutation('av',{action:'update_view',avID,blockID,viewID,filters},{replay:true});assert.equal(nested.safety.transactionState,'committed');
  query=await call('av',{action:'query',avID,blockID,viewID});assert.deepEqual(query.rows.map(r=>r.rowID).sort(),rows.rows.map(r=>r.rowID).sort());
  const after=transactionRequests;const again=await mutation('av',{action:'update_view',avID,blockID,viewID,filters});assert.equal(again.safety.transactionState,'no_change');assert.equal(transactionRequests,after);
  report.filterDefaults={selectOmittedColorCommitted:true,replayVerified:true,omittedAndEmptyNoChange:true,noChangeTransactionRequests:0,explicitColor:'3',multiSelectCommitted:true,nestedOrCommitted:true};
 });
 const tableConfig=await call('av',{action:'get',scope:'view',avID,blockID});const tableOrder=[status,...tableConfig.view.columnOrder.filter(id=>id!==status)];
 await check('combined update and HTTP-preflight/CLI-commit lease sharing',()=>mutation('av',{action:'update_view',avID,blockID,viewID,filters:[],sorts:[{column:primary,order:'DESC'}],group:{field:''},columnVisibility:[{columnID:status,hidden:true}],columnOrder:tableOrder},{replay:true,viaCli:true}));
 await check('read exact persisted configuration through stdio',async()=>{const out=await call('av',{action:'get',scope:'view',avID,blockID},stdio);assert.deepEqual(out.view.columnOrder,tableOrder);assert(out.view.columnVisibility.find(k=>k.columnID===status).hidden);});
 await check('unchanged combined view configuration returns no_change',async()=>{const out=await mutation('av',{action:'update_view',avID,blockID,viewID,filters:[],sorts:[{column:primary,order:'DESC'}],group:{field:''},columnVisibility:[{columnID:status,hidden:true}],columnOrder:tableOrder});assert.equal(out.safety.transactionState,'no_change');});
 await check('stale view configuration is rejected before changing visibility',async()=>{const args={action:'update_view',avID,blockID,viewID,columnVisibility:[{columnID:status,hidden:false}]};const pre=await call('av',{...args,validateOnly:true});await mutation('av',{action:'update_view',avID,blockID,viewID,sorts:[{column:primary,order:'ASC'}]});const rejected=payload(await client.callTool({name:'av',arguments:{...args,requestId:pre.requestId,[pre.preconditionField]:pre[pre.preconditionField]}}));assert.equal(rejected.error?.code,'state_changed');assert.equal(rejected.writeAttempted,false);const current=await call('av',{action:'get',scope:'view',avID,blockID});assert(current.view.columnVisibility.find(k=>k.columnID===status).hidden);});
 const originalView=viewID;
 for(const layout of ['gallery','kanban']){
  const newID=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+crypto.randomBytes(4).toString('hex').slice(0,7);
  await check('add '+layout+' view',()=>mutation('av',{action:'add_view',avID,blockID,viewID:newID,layout,name:layout}));viewID=newID;
  const config=await call('av',{action:'get',scope:'view',avID,blockID});
  await check('combined '+layout+' configuration',()=>mutation('av',{action:'update_view',avID,blockID,viewID,filters:[],sorts:[{column:primary,order:'ASC'}],group:{field:status,method:0,order:3,hideEmpty:false},columnVisibility:[{columnID:status,hidden:true}],columnOrder:[...config.view.columnOrder].reverse()}));
 }
 await check('explicit read does not switch the selected carrier view',async()=>{const before=await api('/api/attr/getBlockAttrs',{id:blockID});const other=await call('av',{action:'get',scope:'view',avID,blockID,viewID:originalView});assert.equal(other.viewID,originalView);const after=await api('/api/attr/getBlockAttrs',{id:blockID});assert.equal(after['custom-sy-av-view'],before['custom-sy-av-view']);const rejected=payload(await client.callTool({name:'av',arguments:{action:'update_view',avID,blockID,viewID:originalView,filters:[],validateOnly:true}}));assert(rejected.error);});
 await check('mirror carriers keep independent selected views',async()=>{
  const reservedMirrorID=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+crypto.randomBytes(4).toString('hex').slice(0,7);
  const dom=(await api('/api/block/getBlockDOM',{id:blockID})).dom.replaceAll(blockID,reservedMirrorID);
  const mirror=await mutation('block',{action:'append',parentID:docID,dataType:'dom',data:dom});
  const mirrorID=mirror.id||mirror.operations?.[0]?.id;assert(mirrorID&&mirrorID!==blockID,JSON.stringify(mirror));
  await mutation('block',{action:'set_attrs',id:mirrorID,attrs:{'custom-sy-av-view':originalView}});
  const a=await call('av',{action:'get',scope:'view',avID,blockID});const b=await call('av',{action:'get',scope:'view',avID,blockID:mirrorID});
  assert.equal(a.viewID,viewID);assert.equal(b.viewID,originalView);
  const explicit=await call('av',{action:'get',scope:'view',avID,blockID:mirrorID,viewID});assert.equal(explicit.viewID,viewID);
  assert.equal((await api('/api/attr/getBlockAttrs',{id:mirrorID}))['custom-sy-av-view'],originalView);
  assert(payload(await client.callTool({name:'av',arguments:{action:'update_view',avID,blockID:mirrorID,viewID,filters:[],validateOnly:true}})).error);
 });
 await check('new request cannot recreate existing AV',async()=>{const result=payload(await client.callTool({name:'av',arguments:{action:'create',parentID:docID,avID,validateOnly:true}}));assert(result.error);});
 await check('search points to get with real IDs',async()=>{const out=await call('av',{action:'search',keyword:'Alpha'});assert(out.results.some(r=>r.avID===avID));assert(out.results.find(r=>r.avID===avID).nextSteps.some(s=>s.arguments.action==='get'&&s.arguments.avID===avID));});
 await check('four detached date events: preflight/commit via commitArgs and nested date formatted readback',async()=>{
  await mutation('av',{action:'add_column',avID,blockID,keyName:'EventDate',keyType:'date'});
  const dateViewID=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+crypto.randomBytes(4).toString('hex').slice(0,7);
  await mutation('av',{action:'add_view',avID,blockID,viewID:dateViewID,layout:'table',name:'DateEvents'});
  const dateColumns=await call('av',{action:'get',scope:'columns',avID,blockID});const dateKey=dateColumns.columns.find(column=>column.name==='EventDate').columnID;assert(dateKey);
  const events=[
   {clientKey:'date-1',primaryKeyText:prefix+' 事件-一',cells:[{columnID:dateKey,valueType:'date',date:'2026-03-01T09:30:00+08:00',includeTime:true}]},
   {clientKey:'date-2',primaryKeyText:prefix+' 事件-二',cells:[{columnID:dateKey,valueType:'date',date:'2026-03-02',includeTime:false}]},
   {clientKey:'date-3',primaryKeyText:prefix+' 事件-三',cells:[{columnID:dateKey,valueType:'date',date:'2026-03-03T00:00:00Z',endDate:'2026-03-05T00:00:00Z',includeTime:false}]},
   {clientKey:'date-4',primaryKeyText:prefix+' 事件-四',cells:[{columnID:dateKey,valueType:'date',date:'2026-03-04T23:59:00+08:00',includeTime:true}]},
  ];
  const args={action:'add_rows',avID,blockID,viewID:dateViewID,rows:events};
  const pre=await call('av',{...args,validateOnly:true});
  assert.equal(pre.writeAttempted,false);assert.equal(pre.preflight?.version,2);
  assert.equal(pre.preflight.commitArgs.action,'add_rows');assert.equal(pre.preflight.commitArgs.validateOnly,false);
  assert.deepEqual(pre.preflight.commitArgs.rows,events);
  const committed=await call('av',pre.preflight.commitArgs);
  assert.equal(committed.safety?.writeSafetyGuaranteed,true);assert.equal(committed.safety?.transactionState,'committed');
  assert.equal(committed.added,4);assert.equal(committed.stage,'verified');assert.equal(committed.cellsWritten,4);
  const rowIDs=committed.rows.map(row=>row.rowID);assert.equal(new Set(rowIDs).size,4);
  const queried=await call('av',{action:'query',avID,blockID,viewID:dateViewID,fields:[primary,dateKey]});
  const native=(await api('/api/av/getAttributeView',{id:avID})).av;
  const nativeKey=native.keyValues.find(entry=>entry.key.id===dateKey);assert(nativeKey);
  const nativeRows=new Map(nativeKey.values.map(value=>[value.blockID,value]));
  for(const rowID of rowIDs){
   const projected=queried.rows.find(row=>row.rowID===rowID);assert(projected,'query must return detached date event '+rowID);
   const cell=projected.cells[dateKey];assert(cell,JSON.stringify({rowID,projected}));
   const nativeValue=nativeRows.get(rowID);assert(nativeValue,'native AV must contain date event '+rowID);
   assert.equal(typeof nativeValue.date?.content,'number');
   assert(nativeValue.date.formattedContent,'native date formattedContent must be present');
   assert.equal(cell.value,nativeValue.date.content);
   assert.equal(cell.formatted,nativeValue.date.formattedContent);
  }
  report.dateEvents={rowIDs,viewID:dateViewID,columnID:dateKey,formattedSource:'value.date.formattedContent',preflightRequestId:pre.requestId};
  executed.add('av.add_rows');
 });
 await check('remove_rows deletes plain-text detached rows through canonical rowIDs',async()=>{
  const removeIDs=rows.acceptanceAllRows.map(row=>row.rowID);
  assert.equal(removeIDs.length,3);
  const removed=await mutation('av',{action:'remove_rows',avID,blockID,rowIDs:removeIDs},{replay:true});
  assert.equal(removed.removed,removeIDs.length);
  const native=(await api('/api/av/getAttributeView',{id:avID})).av;
  const remaining=new Set();
  for(const entry of native.keyValues){if(Array.isArray(entry.values))for(const value of entry.values)if(value?.blockID)remaining.add(value.blockID);}
  for(const rowID of removeIDs)assert(!remaining.has(rowID),'row '+rowID+' still exists after rowIDs removal');
  const queried=await call('av',{action:'query',avID,blockID,viewID:report.dateEvents.viewID});
  assert.equal(queried.rows.length,4);
  assert(!queried.rows.some(row=>removeIDs.includes(row.rowID)));
  report.rowIDsRemoval={removed:removeIDs,remainingRows:queried.rows.map(row=>row.rowID),nativeClean:true};
 });
 await check('18-document batch rename: preflight/commit via commitArgs, native check and idempotent replay',async()=>{
  const items=[];
  for(let index=1;index<=18;index+=1){
   const ordinal=String(index).padStart(2,'0');
   const created=await mutation('document',{action:'create',notebook,path:'/'+prefix+'/batch-'+ordinal,markdown:prefix+' batch rename '+ordinal});
   const info=await api('/api/filetree/getPathByID',{id:created.id});
   const fixture={id:created.id,originalPath:info.path,title:prefix+' batch renamed '+ordinal,cleaned:false};
   batchRenameFixtures.push(fixture);save();
   items.push({id:created.id,title:fixture.title});
  }
  const args={action:'rename',items};
  const pre=await call('document',{...args,validateOnly:true});
  assert.equal(pre.writeAttempted,false);assert.equal(pre.preflight?.commitArgs.action,'rename');
  assert.equal(pre.preflight.commitArgs.items.length,18);
  const beforeRenames=renameDocRequests;
  const committed=await call('document',pre.preflight.commitArgs);
  assert.equal(committed.overallState,'committed');assert.equal(committed.items.length,18);
  assert.equal(committed.counts.committed,18);assert.equal(committed.safety?.transactionState,'committed');
  assert.equal(renameDocRequests-beforeRenames,18);
  for(let index=0;index<items.length;index+=1){
   const item=items[index];
   assert.equal(await api('/api/filetree/getHPathByID',{id:item.id}),'/'+prefix+'/'+item.title);
   assert.equal((await api('/api/filetree/getPathByID',{id:item.id})).path,batchRenameFixtures[index].originalPath);
   assert((await api('/api/filetree/getIDsByHPath',{path:'/'+prefix+'/'+item.title,notebook})).includes(item.id));
  }
  const replay=await call('document',pre.preflight.commitArgs);
  assert.equal(replay.safety?.replayed,true);assert.equal(replay.overallState,'committed');
  assert.deepEqual(replay.items,committed.items);assert.equal(renameDocRequests-beforeRenames,18);
  report.batchRename={count:items.length,requestId:pre.requestId,items:committed.items,replayed:true,kernelRenameRequests:renameDocRequests-beforeRenames};
  executed.add('document.rename');
  await cleanupBatchRenameFixtures();
  assert(batchRenameFixtures.every(fixture=>fixture.cleaned),'18-document batch fixtures must be cleaned by their own IDs');
 });
 }
 for(const permission of ['rwd','rw','r','none'])await check('permission '+permission+': real notebook read, write and delete boundaries',async()=>{
  const name=prefix+'-permission-'+permission;const created=await mutation('notebook',{action:'create',name},{replay:true});assert(created.id);const fixture={id:created.id,name,permission,cleaned:false};permissionNotebooks.push(fixture);save();
  await mutation('notebook',{action:'set_permission',notebook:fixture.id,permission:'rwd'});
  const doc=await mutation('document',{action:'create',notebook:fixture.id,path:'/'+prefix+'-fixture',markdown:prefix+' permission fixture'+(backlinkTargetID?"\n\n(("+backlinkTargetID+" 'permission backlink'))":'')});fixture.docID=doc.id;assert(doc.id);
  if(permission==='none'&&backlinkTargetID){let found;for(let i=0;i<20;i++){found=await call('search',{action:'get_backlinks',id:backlinkTargetID,mode:'links'});if(JSON.stringify(found.backlinks).includes(doc.id))break;await new Promise(r=>setTimeout(r,150));}assert(JSON.stringify(found.backlinks).includes(doc.id),'permission fixture reference must be indexed before hiding it');}
  await mutation('notebook',{action:'set_permission',notebook:fixture.id,permission});
  if(permission==='none'&&backlinkTargetID)await check('backlinks hide unreadable sources and reject scoped access before native context queries',async()=>{
   const global=await call('search',{action:'get_backlinks',id:backlinkTargetID,mode:'links'});assert(!JSON.stringify(global.backlinks).includes(doc.id));assert.equal(global.partial,true);
   const before=backlinkDocRequests;const denied=payload(await client.callTool({name:'search',arguments:{action:'get_backlinks',id:backlinkTargetID,scopeRootId:doc.id}}));assert.match(denied.error?.type||denied.error?.code||'',/permission_denied/);assert.equal(backlinkDocRequests,before);report.restrictedBacklinks={sourceId:doc.id,globalFiltered:true,scopedDenied:true,nativeContextRequests:backlinkDocRequests-before};
  });
  const perms=await call('notebook',{action:'get_permissions',notebook:fixture.id});assert.equal(perms.notebook.permission,permission);
  const read=payload(await client.callTool({name:'document',arguments:{action:'get_doc',id:doc.id,mode:'markdown'}}));
  if(permission==='none'){assert.equal(read.error?.type||read.error?.code,'permission_denied');}else{assert(!read.error,JSON.stringify(read));}
  const beforeWrite=await exportedMarkdown(doc.id);assert(beforeWrite.includes(prefix+' permission fixture'));
  const writeArgs={action:'append',parentID:doc.id,dataType:'markdown',data:prefix+' permission write verified'};
  const appendBefore=appendRequests;
  if(permission==='rwd'||permission==='rw'){await mutation('block',writeArgs,{replay:true});assert(JSON.stringify(await call('document',{action:'get_doc',id:doc.id})).includes('permission write verified'));}
  else{
   // Additive append has precondition=none: validateOnly only issues a requestId.
   // The permission decision happens in the handler immediately before the kernel
   // append. Therefore the same requestId must be dispatched for the denial to be
   // meaningful, and no kernel appendBlock request may occur.
   const pre=await call('block',{...writeArgs,validateOnly:true});assert.equal(pre.writeAttempted,false);assert(pre.requestId);
   const denied=payload(await client.callTool({name:'block',arguments:{...writeArgs,requestId:pre.requestId}}));
   assert.match(denied.error?.type||denied.error?.code||'',/permission_denied/);assert.equal(denied.safety?.writeAttempted,false);assert.equal(denied.safety?.transactionState,'rejected');
   assert.equal(appendRequests,appendBefore,'denied append must not reach the kernel appendBlock API');
   const afterWrite=await exportedMarkdown(doc.id);assert.equal(afterWrite,beforeWrite,'denied append must leave the fixture body unchanged');assert(!afterWrite.includes('permission write verified'));
   fixture.writeDeniedAfterPreflight=true;fixture.kernelAppendRequests=appendRequests-appendBefore;
  }
  assert.equal((await api('/api/block/getBlockInfo',{id:doc.id})).box,fixture.id);assert((await api('/api/filetree/getHPathByID',{id:doc.id})).includes(prefix));
  if(permission==='rwd')await mutation('document',{action:'remove',id:doc.id},{replay:true});
  else{
   const deleteBefore=deleteRequests;
   let denied=payload(await client.callTool({name:'document',arguments:{action:'remove',id:doc.id,validateOnly:true}}));
   if(!denied.error){assert(denied.requestId);const input={action:'remove',id:doc.id,requestId:denied.requestId,...(denied.preconditionField?{[denied.preconditionField]:denied[denied.preconditionField]}:{})};denied=payload(await client.callTool({name:'document',arguments:input}));}
   assert.match(denied.error?.type||denied.error?.code||'',/permission_denied/);assert.equal(denied.writeAttempted??denied.safety?.writeAttempted,false);
   assert.equal(deleteRequests,deleteBefore,'denied delete must not reach a kernel removeDoc API');assert.equal((await api('/api/block/getBlockInfo',{id:doc.id})).box,fixture.id);
  }
  fixture.readAllowed=permission!=='none';fixture.writeAllowed=permission==='rwd'||permission==='rw';fixture.deleteAllowed=permission==='rwd';fixture.deleteDeniedWithoutKernelWrite=permission!=='rwd';save();
 });
 await check('unreadable notebook rejects raw SQL before any SQL API request',async()=>{const before=sqlRequests;const rejected=payload(await client.callTool({name:'search',arguments:{action:'query_sql',sql:'SELECT COUNT(*) AS n FROM blocks'}}));assert.equal(rejected.error?.code,'raw_sql_unavailable_with_restricted_notebooks');assert.equal(sqlRequests,before);report.restrictedSql={sqlRequestsBefore:before,sqlRequestsAfter:sqlRequests,executed:false};});
 await check('all-readable mixed r/rw/rwd permissions allow aggregate SQL',async()=>{const hidden=permissionNotebooks.find(n=>n.permission==='none');await mutation('notebook',{action:'set_permission',notebook:hidden.id,permission:'r'});const sql="SELECT COUNT(*) AS n FROM blocks WHERE root_id='"+hidden.docID+"'";let rows;for(let i=0;i<20;i++){rows=await call('search',{action:'query_sql',sql});if(Number(rows.data?.[0]?.n)>0)break;await new Promise(r=>setTimeout(r,150));}assert(Number(rows.data?.[0]?.n)>0,JSON.stringify({sql,rows,notebook:hidden.id,docID:hidden.docID}));assert.equal(rows.reason,undefined);report.allReadableSql={sql,rows,notebook:hidden.id,docID:hidden.docID};});
 await check('cleanup temporary permission notebooks and preserve original permissions',async()=>{await cleanupPermissionNotebooks();const response=await fetch(profile.apiUrl+'/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json',...(profile.token?{Authorization:'Token '+profile.token}:{})},body:JSON.stringify({path:permissions})});assert.equal(crypto.createHash('sha256').update(await response.text()).digest('hex'),permissionsHash);report.originalPermissionsUnchanged=true;});
 if(!permissionsOnly)await check('cleanup isolated document',async()=>{const info=await api('/api/block/getBlockInfo',{id:docID});assert.equal(info.box,notebook);const hpath=await api('/api/filetree/getHPathByID',{id:docID});assert(hpath.includes(prefix));await mutation('document',{action:'remove',id:docID});report.fixtures.forEach(f=>f.cleaned=true);docID=undefined;});
 const note=await check('retain a user-readable acceptance report',()=>mutation('document',{action:'create',notebook,path:'/'+prefix+'-验收报告',markdown:'# Strict Write v2 真实验收\n\n- 时间：'+new Date().toISOString()+'\n- 思源内核：'+report.version+'\n- 测试产物：本轮 dist CJS；临时 Node 协调器连接同一真实工作区\n- 本轮夹具已清理；此报告保留\n\n'+report.checks.map(c=>'- '+c.name+'：'+c.status).join('\n')+'\n\n未覆盖：笔记本全局设置、排序模式、快照、同步、反馈、第三方写入、购买，以及本场景未逐项执行的其他 action。完整 action 矩阵见本轮本地 JSON 报告。'}));report.reportDocument={id:note.id,path:'/'+nb.name+'/'+prefix+'-验收报告',retained:true};
 for(const artifact of Object.keys(report.artifacts))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),report.artifacts[artifact],'Artifact changed during acceptance');
}
main().catch(e=>{report.failure=e.message;console.error(e.message);process.exitCode=1;}).finally(async()=>{
 if(docID&&client){try{const info=await api('/api/block/getBlockInfo',{id:docID});const name=await api('/api/filetree/getHPathByID',{id:docID});assert.equal(info.box,notebook);assert(name.includes(prefix));await mutation('document',{action:'remove',id:docID});report.fixtures.forEach(f=>f.cleaned=true);docID=undefined;report.cleanup='completed after failure';}catch(e){report.cleanup='blocked: '+e.message;}}
 if(client&&batchRenameFixtures.some(f=>!f.cleaned)){try{await cleanupBatchRenameFixtures();}catch(e){report.batchRenameCleanup='blocked: '+e.message;}}
 if(client&&permissionNotebooks.some(n=>!n.cleaned)){try{await cleanupPermissionNotebooks();}catch(e){report.permissionCleanup='blocked: '+e.message;}}
 for(const c of [client,stdio,direct])await c?.close().catch(()=>{});await rt?.close().catch(()=>{});if(child)child.kill();if(proxy)await new Promise(r=>proxy.close(r));
 if(profile&&!docID)await api('/api/file/removeFile',{path:testLedger}).catch(()=>{});if(profile&&permissionNotebooks.every(n=>n.cleaned))await api('/api/file/removeFile',{path:testPermissions}).catch(()=>{});if(fs.existsSync(cliConfigPath))fs.unlinkSync(cliConfigPath);
 const policy=fs.readFileSync(root+'/src/core/write-safety-policy.ts','utf8');let category='';for(const line of policy.split('\n')){const c=line.match(/^    (\w+): \{/);if(c)category=c[1];for(const m of line.matchAll(/(\w+): mutation\(/g)){const action=category+'.'+m[1];report.coverage.push({action,status:executed.has(action)?'covered':(['file.remove_unused_assets','timeline.create_node','timeline.delete_node','timeline.rollback_document','timeline.rollback_block','mascot.buy'].includes(action)?'intentionally excluded':'not_run'),reason:executed.has(action)?'Fresh Node CJS with real kernel fixtures':'Not executed in this focused repair acceptance; shared paths have automated regression coverage. See the repair report for scoped exclusions.'});}}
 report.finishedAt=new Date().toISOString();save();console.log('REPORT '+reportPath);
});
