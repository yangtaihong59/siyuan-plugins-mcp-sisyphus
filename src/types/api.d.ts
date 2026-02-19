interface IResGetNotebookConf {
    box: string;
    conf: NotebookConf;
    name: string;
}

interface IReslsNotebooks {
    notebooks: Notebook[];
}

interface IResUpload {
    errFiles: string[];
    succMap: { [key: string]: string };
}

interface IResdoOperations {
    doOperations: doOperation[];
    undoOperations: doOperation[] | null;
}

interface IResGetBlockKramdown {
    id: BlockId;
    kramdown: string;
}

interface IResGetChildBlock {
    id: BlockId;
    type: BlockType;
    subtype?: BlockSubType;
}

interface IResGetTemplates {
    content: string;
    path: string;
}

interface IResReadDir {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
}

interface IResExportMdContent {
    hPath: string;
    content: string;
}

interface IResBootProgress {
    progress: number;
    details: string;
}

interface IResForwardProxy {
    body: string;
    contentType: string;
    elapsed: number;
    headers: { [key: string]: string };
    status: number;
    url: string;
}

interface IResExportResources {
    path: string;
}

interface Notebook {
    id: string;
    name: string;
    icon: string;
    sort: number;
    closed: boolean;
}

interface NotebookConf {
    name: string;
    closed: boolean;
    refCreateSavePath: string;
    createDocNameTemplate: string;
    dailyNoteSavePath: string;
    dailyNoteTemplatePath: string;
}

interface IReqOpenNotebook {
    notebook: string;
}

interface IReqCloseNotebook {
    notebook: string;
}

interface IReqRenameNotebook {
    notebook: string;
    name: string;
}

interface IReqCreateNotebook {
    name: string;
}

interface IReqRemoveNotebook {
    notebook: string;
}

interface IReqGetNotebookConf {
    notebook: string;
}

interface IReqSetNotebookConf {
    notebook: string;
    conf: NotebookConf;
}

interface IResCreateNotebook {
    notebook: Notebook;
}

interface IResSetNotebookConf extends NotebookConf {}

interface IReqCreateDocWithMd {
    notebook: string;
    path: string;
    markdown: string;
}

interface IReqRenameDoc {
    notebook: string;
    path: string;
    title: string;
}

interface IReqRenameDocByID {
    id: string;
    title: string;
}

interface IReqRemoveDoc {
    notebook: string;
    path: string;
}

interface IReqRemoveDocByID {
    id: string;
}

interface IReqMoveDocs {
    fromPaths: string[];
    toNotebook: string;
    toPath: string;
}

interface IReqMoveDocsByID {
    fromIDs: string[];
    toID: string;
}

interface IReqGetHPathByPath {
    notebook: string;
    path: string;
}

interface IReqGetHPathByID {
    id: string;
}

interface IReqGetPathByID {
    id: string;
}

interface IReqGetIDsByHPath {
    path: string;
    notebook: string;
}

interface IResGetPathByID {
    notebook: string;
    path: string;
}

interface IReqUpload {
    assetsDirPath: string;
    file: File[];
}

type BlockId = string;
type BlockType = 'd' | 'p' | 'h' | 's' | 'l' | 'i' | 'b' | 'q' | 'c' | 'm' | 't' | 'toc' | 'html' | 'video' | 'audio' | 'widget' | 'task' | 'code' | 'bookmark' | 'formula';
type BlockSubType = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'u' | 'o' | 'li' | 'hr';
type DataType = 'markdown' | 'dom';

interface doOperation {
    action: 'insert' | 'update' | 'delete' | 'move';
    data: string | null;
    id: string;
    parentID: string;
    previousID: string;
    nextID?: string;
    srcIDs?: string[] | null;
    name?: string;
    type?: string;
    retData?: unknown;
}

interface IReqInsertBlock {
    dataType: DataType;
    data: string;
    nextID?: string;
    previousID?: string;
    parentID?: string;
}

interface IReqPrependBlock {
    data: string;
    dataType: DataType;
    parentID: string;
}

interface IReqAppendBlock {
    data: string;
    dataType: DataType;
    parentID: string;
}

interface IReqUpdateBlock {
    dataType: DataType;
    data: string;
    id: string;
}

interface IReqDeleteBlock {
    id: string;
}

interface IReqMoveBlock {
    id: string;
    previousID?: string;
    parentID?: string;
}

interface IReqFoldBlock {
    id: string;
}

interface IReqUnfoldBlock {
    id: string;
}

interface IReqGetBlockKramdown {
    id: string;
}

interface IReqGetChildBlocks {
    id: string;
}

interface IReqTransferBlockRef {
    fromID: string;
    toID: string;
    refIDs?: string[];
}

interface IResInsertBlock {
    doOperations: doOperation[];
    undoOperations: doOperation[] | null;
}

interface IResPrependBlock extends IResInsertBlock {}
interface IResAppendBlock extends IResInsertBlock {}
interface IResUpdateBlock extends IResInsertBlock {}
interface IResDeleteBlock extends IResInsertBlock {}
interface IResMoveBlock extends IResInsertBlock {}

interface IReqSetBlockAttrs {
    id: string;
    attrs: Record<string, string>;
}

interface IReqGetBlockAttrs {
    id: string;
}

interface IResGetBlockAttrs {
    [key: string]: string;
}

interface IReqQuerySQL {
    stmt: string;
}

interface IResQuerySQL {
    [key: string]: unknown;
}

interface IReqRenderTemplate {
    id: string;
    path: string;
}

interface IReqRenderSprig {
    template: string;
}

interface IReqGetFile {
    path: string;
}

interface IReqPutFile {
    path: string;
    isDir?: boolean;
    modTime?: number;
    file?: File;
}

interface IReqRemoveFile {
    path: string;
}

interface IReqRenameFile {
    path: string;
    newPath: string;
}

interface IReqReadDir {
    path: string;
}

interface IResReadDirItem {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
    updated?: number;
}

interface IReqExportMdContent {
    id: string;
}

interface IReqExportResources {
    paths: string[];
    name?: string;
}

interface IResExportMdContent {
    hPath: string;
    content: string;
}

interface IReqPandoc {
    dir: string;
    args: string[];
}

interface IResPandoc {
    path: string;
}

interface IReqPushMsg {
    msg: string;
    timeout?: number;
}

interface IReqPushErrMsg {
    msg: string;
    timeout?: number;
}

interface IResPushMsg {
    id: string;
}

interface IResPushErrMsg extends IResPushMsg {}

interface ForwardProxyHeader {
    [key: string]: string;
}

interface IReqForwardProxy {
    url: string;
    method?: string;
    timeout?: number;
    contentType?: string;
    headers?: ForwardProxyHeader[];
    payload?: unknown;
    payloadEncoding?: 'text' | 'base64' | 'base64-std' | 'base64-url' | 'base32' | 'base32-std' | 'base32-hex' | 'hex';
    responseEncoding?: 'text' | 'base64' | 'base64-std' | 'base64-url' | 'base32' | 'base32-std' | 'base32-hex' | 'hex';
}

interface IResForwardProxy {
    body: string;
    bodyEncoding: string;
    contentType: string;
    elapsed: number;
    headers: ForwardProxyHeader;
    status: number;
    url: string;
}

interface IResBootProgress {
    progress: number;
    details: string;
}

interface IResVersion {
    version: string;
}

interface IResCurrentTime {
    currentTime: number;
}
