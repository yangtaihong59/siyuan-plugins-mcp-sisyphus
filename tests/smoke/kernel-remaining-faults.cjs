/* Isolated Docker fault injection using an extra temporary plugin.
 * The production kernel.js is appended byte-for-byte after a host-boundary shim.
 * Only version-read and external-feedback destinations are redirected to a local
 * HTTP receiver. Every response still traverses the real SiYuan forwardProxy.
 * Never install this fixture in a personal workspace.
 */
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const s=JSON.parse(fs.readFileSync(process.argv[2]));assert.equal(new URL(s.apiUrl).hostname,'127.0.0.1');
const headers={Authorization:'Token '+s.token,'Content-Type':'application/json'};
const name='sisyphus-remaining-'+Date.now(),root='/data/plugins/'+name,storage='/data/storage/petal/'+name;
const modeState={mode:'success',hits:0,gets:0,posts:0,times:[]};let enabled=false,created=false,seq=0;
async function api(p,args){const r=await fetch(s.apiUrl+p,{method:'POST',headers,body:JSON.stringify(args)});const j=await r.json();assert.equal(j.code,0,p+': '+j.msg);return j.data;}
async function put(p,bytes){const f=new FormData();f.append('path',p);f.append('isDir','false');f.append('file',new Blob([bytes]),'fixture');const r=await fetch(s.apiUrl+'/api/file/putFile',{method:'POST',headers:{Authorization:headers.Authorization},body:f});assert.equal((await r.json()).code,0);}
const server=http.createServer(async(req,res)=>{try{let body='';for await(const b of req)body+=b;
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/version') {modeState.hits++;modeState.times.push(Date.now());let status=200;
  if(modeState.mode==='503-once'&&modeState.hits===1)status=503;
  if(modeState.mode==='429-once'&&modeState.hits===1)status=429;
  if(['503-always','no-retry'].includes(modeState.mode))status=503;
  if(modeState.mode==='403')status=403;
  if(modeState.mode==='disconnect-once'&&modeState.hits===1){req.socket.destroy();return;}
  if(status!==200){json(status,{code:-1,msg:'controlled transient'});return;}
  if(modeState.mode==='malformed'){res.writeHead(200);res.end('not JSON');return;}
  if(modeState.mode==='api-error'){json(200,{code:-1,msg:'controlled application error'});return;}
  const version=await api('/api/system/version',{});json(200,{code:0,data:version});return;
 }
 if(req.url==='/feedback'){if(req.method==='GET'){modeState.gets++;json(200,{code:0,data:{editVersion:2,token:'fixture',questionMap:{},setting:{baseSetting:{checkLogin:false,commitConfig:{options:[{id:'fixture'}]}}}}});return;}
  assert.equal(req.method,'POST');modeState.posts++;const payload=JSON.parse(body);assert.equal(payload.answerJson.answers.v5nhl6.strValue,'容器受控反馈验证');
  if(modeState.mode==='post-fail'){json(503,{code:-1});return;}json(200,{code:0,data:{aid:'isolated-receiver'}});return;}
 json(404,{});
 }catch{res.writeHead(500);res.end('controlled receiver failure');}});
function reset(mode){Object.assign(modeState,{mode,hits:0,gets:0,posts:0,times:[]});}
async function call(tool,args){const r=await fetch(s.apiUrl+'/plugin/private/'+name+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name:tool,arguments:args}})});assert.equal(r.status,200);const j=await r.json();assert.ok(!j.error);return j.result;}
(async()=>{const n=await api('/api/notebook/lsNotebooks',{});assert.ok(n.notebooks.some(n=>n.id===s.notebook&&n.name.startsWith('Sisyphus 容器验收')));
await new Promise(r=>server.listen(0,'0.0.0.0',r));const destination='http://host.docker.internal:'+server.address().port;
try{
 const original=fs.readFileSync('dist/kernel.js');
 const shim=`// TEST ONLY: controlled HTTP destination, production bundle follows unchanged.\n(function(){
 var originalSiyuan=globalThis.siyuan;
 globalThis.siyuan=Object.assign({},originalSiyuan,{client:Object.assign({},originalSiyuan.client)});
 var originalFetch=originalSiyuan.client.fetch;
 siyuan.client.fetch=async function(path,init){
  if(path==='/api/system/version' || path==='/api/system/getVersion'){
   var forwarded=await originalFetch('/api/network/forwardProxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:${JSON.stringify(destination+'/version')},method:'GET',timeout:5000,headers:[],payload:'',payloadEncoding:'base64',responseEncoding:'text',redirect:false})});
   var envelope=await forwarded.json(); if(envelope.code!==0)throw Error('controlled transport failure');var d=envelope.data;
   return {ok:d.status>=200&&d.status<300,status:d.status,text:async function(){return d.body},json:async function(){return JSON.parse(d.body)}};
  }
  if(path==='/api/network/forwardProxy'){
   var body=JSON.parse(init.body);
   if(body.url.indexOf('https://f-api.wps.cn/')!==0)throw Error('Fixture forbids unrelated external destination');
   body.url=${JSON.stringify(destination+'/feedback')};init=Object.assign({},init,{body:JSON.stringify(body)});
  }
  return originalFetch(path,init);
 };
})();\n`;
 const manifest={...JSON.parse(fs.readFileSync('plugin.json')),name,version:'0.0.1',displayName:{default:'Temporary controlled acceptance fixture'}};
 await put(root+'/plugin.json',JSON.stringify(manifest));created=true;await put(root+'/index.js',"module.exports = class {};");await put(root+'/kernel.js',Buffer.concat([Buffer.from(shim),original]));
 await put(storage+'/mcpHttpSettings',JSON.stringify({kernelEndpointEnabled:true,kernelOptions:{readRetries:3}}));
 await api('/api/petal/setPetalEnabled',{packageName:name,enabled:true});enabled=true;
 let ready=false;for(let i=0;i<100;i++){const r=await fetch(s.apiUrl+'/plugin/private/'+name+'/health',{headers});if(r.status===200){ready=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'fixture endpoint did not become ready');
 for(const [mode,expected,ok] of [['503-once',2,true],['429-once',2,true],['disconnect-once',2,true],['503-always',4,false],['403',1,false],['malformed',1,false],['api-error',1,false]]){
  reset(mode);const r=await call('system',{action:'get_version'});assert.equal(!!r.isError,!ok,mode+': '+JSON.stringify(r).slice(0,200));assert.equal(modeState.hits,expected,mode);if(expected>1)assert.ok(modeState.times[1]-modeState.times[0]>=90);console.log('PASS container fixture '+mode+': '+expected+' attempts');
 }
 await put(storage+'/mcpHttpSettings',JSON.stringify({kernelEndpointEnabled:true,kernelOptions:{readRetries:0}}));reset('no-retry');const failed=await call('system',{action:'get_version'});assert.equal(failed.isError,true);assert.equal(modeState.hits,1);console.log('PASS container readRetries=0: one failed attempt');
 reset('success');const submitted=await call('feedback',{action:'submit',description:'容器受控反馈验证',confirm:true});assert.ok(!submitted.isError,JSON.stringify(submitted));assert.equal(modeState.gets,1);assert.equal(modeState.posts,1);console.log('PASS actual container fixture feedback GET+POST via real forwardProxy to local receiver');
 reset('post-fail');const rejected=await call('feedback',{action:'submit',description:'容器受控反馈验证',confirm:true});assert.equal(rejected.isError,true);assert.equal(modeState.gets,1);assert.equal(modeState.posts,1);console.log('PASS feedback HTTP 503: one POST, no automatic resubmission');
 console.log(JSON.stringify({productionKernelSha:crypto.createHash('sha256').update(original).digest('hex'),hostBoundaryInjected:true,realExternalSubmissions:0,fixturePlugin:name}));
}finally{
 if(enabled)await api('/api/petal/setPetalEnabled',{packageName:name,enabled:false});
 if(created){assert.ok(root.startsWith('/data/plugins/sisyphus-remaining-'));await api('/api/file/removeFile',{path:root});await api('/api/file/removeFile',{path:storage});}
 server.closeAllConnections();await new Promise(r=>server.close(r));console.log('Temporary fixture plugin disabled and removed; main plugin untouched');
}
})().catch(e=>{console.error(e.stack);process.exitCode=1;server.closeAllConnections();server.close();});
