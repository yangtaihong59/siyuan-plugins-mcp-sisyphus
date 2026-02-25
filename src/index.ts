import {
    Plugin,
    showMessage,
    Dialog,
} from "siyuan";
import "./index.scss";

import McpConfig from "@/setting/mcp-config.svelte";

/** 思源 API 端口写死，不读写 menu-config.json */
const MCP_API_URL = "http://127.0.0.1:6806";

/** 与 mcp-config.svelte 一致：默认启用全部工具，高危操作默认关闭 */
const DEFAULT_MCP_TOOLS_CONFIG: Record<string, boolean> = {
    list_notebooks: true, create_notebook: true, open_notebook: true, close_notebook: true,
    remove_notebook: false, rename_notebook: true, get_notebook_conf: true, set_notebook_conf: true,
    create_document: true, rename_document: true, rename_document_by_id: true,
    remove_document: false, remove_document_by_id: false, move_documents: true, move_documents_by_id: true,
    get_document_path: true, get_hpath_by_path: true, get_hpath_by_id: true, get_ids_by_hpath: true,
    insert_block: true, prepend_block: true, append_block: true, update_block: true, delete_block: false,
    move_block: true, fold_block: true, unfold_block: true, get_block_kramdown: true, get_child_blocks: true,
    transfer_block_ref: true, set_block_attrs: true, get_block_attrs: true,
    upload_asset: true, render_template: true, render_sprig: true, export_md_content: true, export_resources: true,
    push_msg: true, push_err_msg: true, get_version: true, get_current_time: true,
};

export default class SiyuanMCP extends Plugin {

    /** 供其他模块读取，端口固定 */
    mcpSettings = { apiUrl: MCP_API_URL };

    async onload() {
        const existing = await this.loadData("mcpToolsConfig");
        if (existing == null || typeof existing !== "object") {
            await this.saveData("mcpToolsConfig", DEFAULT_MCP_TOOLS_CONFIG);
        }
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
