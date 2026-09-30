package main

import (
	"fmt"
	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/url"
	"os"
	"time"
)

func main() {
	bundle, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	done := make(chan string, 1)
	loop := eventloop.NewEventLoop()
	loop.Start()
	loop.RunOnLoop(func(vm *goja.Runtime) {
		url.Enable(vm)
		buffer.Enable(vm)
		vm.Set("report", func(s string) { done <- s })
		_, err := vm.RunString(`var submissions=0,metaReads=0,telemetryPosts=0; var store={mcpHttpSettings:JSON.stringify({kernelEndpointEnabled:true,skillsExtensionEnabled:false,kernelOptions:{allowedOrigins:["https://client.example"]}}),mcpToolsConfig:JSON.stringify({extension:{enabled:false}})};
var metadata={code:0,data:{editVersion:2,token:"fixture",questionMap:{},setting:{baseSetting:{checkLogin:false,commitConfig:{options:[{id:"fixture"}]}}}}};
var siyuan={plugin:{name:"test",version:"test"},storage:{get:async function(key){return {text:async function(){return store[key]||"{}"}}},put:async function(key,value){store[key]=value}},client:{fetch:async function(path,init){
var data="3.8.5";
if(path==="/api/network/forwardProxy") {var p=JSON.parse(init.body); if(p.redirect!==false||p.payloadEncoding!=="base64")throw Error("unsafe proxy request");
if(p.url==="https://fixture.invalid/telemetry") {telemetryPosts++; var stats=JSON.parse(Buffer.from(p.payload,"base64").toString());if(stats.aggregates.totalCalls<1)throw Error("missing telemetry");data={status:200,body:"{}"};}
else if(p.method==="GET") {metaReads++;data={status:200,body:JSON.stringify(metadata)};}
else {submissions++;var body=JSON.parse(Buffer.from(p.payload,"base64").toString());if(body.answerJson.answers.v5nhl6.strValue!=="沙箱验证")throw Error("payload lost");data={status:200,body:JSON.stringify({code:0,data:{aid:"fixture-success"}})};}}
return {ok:true,status:200,text:async function(){return JSON.stringify({code:0,data:data})}};}},server:{private:{http:{}}}};`)
		if err != nil {
			done <- err.Error()
			return
		}
		_, err = vm.RunString(string(bundle))
		if err != nil {
			done <- err.Error()
			return
		}
		_, err = vm.RunString(`(async function(){
   async function call(method,params){return (await siyuan.server.private.http.handler({url:{path:"/mcp"},request:{body:{data:{text:async function(){return JSON.stringify({jsonrpc:"2.0",id:1,method:method,params:params||{}})}}}}})).body.data.data;}
   var init=await call("initialize",{});
   if(!init.result.capabilities.extensions["io.modelcontextprotocol/ui"] || init.result.capabilities.extensions["io.modelcontextprotocol/skills"])throw Error("capability mismatch");
   var feedback=await call("tools/call",{name:"feedback",arguments:{action:"submit",description:"沙箱验证",confirm:true}});
   if(feedback.result.isError || metaReads!==1 || submissions!==1)throw Error(JSON.stringify(feedback));
   var origin=await siyuan.server.private.http.handler({url:{path:"/health"},request:{method:"GET",headers:{Origin:["https://client.example"],Host:["localhost:6806"]}}});
   if(origin.statusCode!==200)throw Error("Origin rejected");
   // Telemetry remains opt-in; enable only the intercepted test destination.
   store.telemetryConfig=JSON.stringify({enabled:true,reportIntervalHours:1,lastReportAt:0,endpoint:"https://fixture.invalid/telemetry"});
   var read=await call("tools/call",{name:"system",arguments:{action:"get_version"}});
   for(var i=0;i<20 && telemetryPosts===0;i++) await new Promise(function(r){setTimeout(r,10)});
   if(telemetryPosts!==1)throw Error("telemetry missing: "+Object.keys(store).join(","));
   report("PASS goja: App/Skills negotiation, exact Origin, feedback GET+POST and opted-in telemetry through intercepted proxy; no external network calls");
  })().catch(function(e){report("FAIL "+e.stack)});`)
		if err != nil {
			done <- err.Error()
		}
	})
	select {
	case result := <-done:
		fmt.Println(result)
		if len(result) < 4 || result[:4] != "PASS" {
			os.Exit(1)
		}
	case <-time.After(25 * time.Second):
		fmt.Println("FAIL goja timeout")
		os.Exit(1)
	}
	loop.Stop()
}
