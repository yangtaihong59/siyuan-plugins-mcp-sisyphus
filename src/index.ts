import {
    Plugin,
    showMessage,
    Dialog,
} from "siyuan";
import "./index.scss";

import McpConfig from "@/setting/mcp-config.svelte";

/** 思源 API 端口写死，不读写 menu-config.json */
const MCP_API_URL = "http://127.0.0.1:6806";

export default class SiyuanMCP extends Plugin {

    /** 供其他模块读取，端口固定 */
    mcpSettings = { apiUrl: MCP_API_URL };

    async onload() {
        // console.log('SiYuanMCP onload');
    }

    onLayoutReady() {}

    onunload() {
        // console.log('SiYuanMCP onunload');
    }

    uninstall() {
        this.removeData("mcpToolsConfig").catch(e => {
            showMessage(`uninstall [${this.name}] remove data [mcpToolsConfig] fail: ${e.msg}`);
        });
    }

    /**
     * A custom setting pannel provided by svelte
     */
    openSetting(): void {
        let dialog = new Dialog({
            title: this.i18n.mcpToolsSettingTitle,
            content: `<div id="SettingPanel" style="height: 100%;"></div>`,
            width: "800px",
            destroyCallback: (options) => {
                //You'd better destroy the component when the dialog is closed
                pannel.$destroy();
            }
        });
        let pannel = new McpConfig({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

}
