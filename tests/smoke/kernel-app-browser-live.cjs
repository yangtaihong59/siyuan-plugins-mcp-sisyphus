/* Production App HTML in a controlled MCP Host, with read-only tool calls to
 * the real container. Does not claim Claude/ChatGPT client certification.
 * args: connection-state.json fixture.json playwright-module-path chrome-path
 */
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.argv[4]);const s=JSON.parse(fs.readFileSync(process.argv[2])),f=JSON.parse(fs.readFileSync(process.argv[3]));
assert.equal(new URL(s.apiUrl).hostname,'127.0.0.1');
const shop=JSON.parse(fs.readFileSync(path.join(f.dir,'shop-result.json')));let calls=0,browser;
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/app'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(f.dir,'shop.html')));return;}
 if(req.url==='/result'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(shop));return;}
 if(req.url==='/tool'){let body='';for await(const b of req)body+=b;const params=JSON.parse(body);assert.equal(params.name,'mascot_shop_app_action');assert.equal(params.arguments.action,'shop');assert.deepEqual(Object.keys(params.arguments),['action']);
  const r=await fetch(s.apiUrl+'/plugin/private/siyuan-plugins-mcp-sisyphus/mcp',{method:'POST',headers:{Authorization:'Token '+s.token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params})});const j=await r.json();assert.ok(!j.result.isError);calls++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(j.result));return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html><body><iframe id="app" src="/app" style="width:100%;height:850px;border:0"></iframe><script>
 window.received=[];window.addEventListener('message',async event=>{const msg=event.data;if(!msg||msg.jsonrpc!=='2.0')return;window.received.push(msg.method||'response');const send=p=>event.source.postMessage({jsonrpc:'2.0',...p},'*');
 if(msg.method==='ui/initialize')send({id:msg.id,result:{protocolVersion:msg.params.protocolVersion,hostInfo:{name:'Isolated acceptance host',version:'1'},hostCapabilities:{serverTools:{},serverResources:{}},hostContext:{theme:'light',locale:'zh-CN',displayMode:'inline',platform:'web'}}});
 else if(msg.method==='ui/notifications/initialized'){send({method:'ui/notifications/tool-input',params:{arguments:{action:'shop'}}});send({method:'ui/notifications/tool-result',params:await fetch('/result').then(r=>r.json())});}
 else if(msg.method==='tools/call'){try{const result=await fetch('/tool',{method:'POST',body:JSON.stringify(msg.params)}).then(r=>r.json());send({id:msg.id,result});}catch{send({id:msg.id,error:{code:-32000,message:'fixture failed'}});}}
 else if(msg.id!==undefined)send({id:msg.id,result:{}});
 });</script></body></html>`);
 }catch{res.writeHead(500);res.end('controlled host failed');}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
 browser=await chromium.launch({headless:true,executablePath:process.argv[5]});const page=await browser.newPage({viewport:{width:1100,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=page.frameLocator('#app');await frame.getByRole('button',{name:'刷新商品'}).waitFor();await frame.getByRole('button',{name:'刷新商品'}).click();await page.waitForFunction(()=>window.received.includes('tools/call'));
 for(let i=0;i<100&&calls===0;i++)await new Promise(r=>setTimeout(r,50));assert.equal(calls,1);await page.frames().find(x=>x.url().endsWith('/app')).waitForFunction(()=>!document.querySelector('[data-action=shop-refresh]').hasAttribute('aria-busy'));
 await page.screenshot({path:path.join(f.dir,'app-browser.png'),fullPage:true});assert.deepEqual(errors,[]);console.log('PASS production App HTML: real browser initialization, shop rendering, refresh click -> actual container App action -> rerender; no purchase');
 console.log(JSON.stringify({readOnlyCalls:calls,screenshot:path.join(f.dir,'app-browser.png'),scope:'controlled MCP Host; not third-party client certification'}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exitCode=1;server.closeAllConnections();server.close();});
