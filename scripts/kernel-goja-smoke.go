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
		_, err := vm.RunString(`var siyuan={plugin:{name:"test",version:"test"},storage:{get:async function(key){return {text:async function(){return key==="mcpHttpSettings"?'{"kernelEndpointEnabled":true}':key==="mcpToolsConfig"?'{"extension":{"enabled":false}}':'{}'}}},put:async function(){}},client:{fetch:async function(){return {ok:true,status:200,text:async function(){return '{"code":0,"data":"3.8.6"}'}}}},server:{private:{http:{}}}};`)
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
   var init=await call("initialize",{protocolVersion:"2026-07-28"});
   var list=await call("tools/list");
   var help=await call("tools/call",{name:"block",arguments:{action:"help",topic:"update"}});
   var read=await call("tools/call",{name:"system",arguments:{action:"get-version"}});
   var invalid=await call("tools/call",{name:"block",arguments:{action:"update",validateOnly:true}});
   if(init.result.protocolVersion!=="2025-11-25" || !list.result.tools.length || help.result.isError || read.result.isError || !invalid.result.isError) throw new Error(JSON.stringify({init:init,help:help,read:read,invalid:invalid}));
   report("PASS goja bundle: initialize, list "+list.result.tools.length+" tools, help, alias read, invalid preflight");
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
