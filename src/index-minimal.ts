import { Plugin, showMessage } from "siyuan";

export default class SiyuanMCP extends Plugin {
    async onload() {
        console.log("SiyuanMCP plugin loading...");
        showMessage("SiyuanMCP loaded!");
    }
    
    onunload() {
        console.log("SiyuanMCP plugin unloaded");
    }
}
