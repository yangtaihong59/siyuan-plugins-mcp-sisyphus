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

interface IResDocOutlineBlock {
    id: string;
    content?: string;
    depth?: number;
    type?: string;
    subType?: string;
    folded?: boolean;
    children?: IResDocOutlineBlock[];
}

interface IResDocOutlinePath {
    id: string;
    box?: string;
    name?: string;
    hPath?: string;
    depth?: number;
    type?: string;
    nodeType?: string;
    subType?: string;
    folded?: boolean;
    blocks?: IResDocOutlineBlock[];
    children?: IResDocOutlinePath[];
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

interface IResSearchTemplates {
    templates: IResGetTemplates[];
    k: string;
}

interface IResReadDir {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
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
    sortMode?: number;
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

interface IReqSetNotebookIcon {
    notebook: string;
    icon: string;
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
    box?: string;
    notebook: string;
    path: string;
}

interface IReqListDocsByPath {
    notebook: string;
    path: string;
    sort?: number;
    maxListCount?: number;
    showHidden?: boolean;
    ignoreMaxListHint?: boolean;
}

interface IResListDoc {
    id?: string;
    box?: string;
    path: string;
    hPath?: string;
    name?: string;
    icon?: string;
    sort?: number;
    count?: number;
    subFileCount?: number;
}

interface IResListDocsByPath {
    box: string;
    path: string;
    files: IResListDoc[];
}

interface IReqUpload {
    assetsDirPath: string;
    file: File[];
    localFilePath?: string;
}

type BlockId = string;
type BlockType = 'd' | 'p' | 'query_embed' | 'l' | 'i' | 'h' | 'iframe' | 'tb' | 'b' | 's' | 'c' | 'widget' | 't' | 'html' | 'm' | 'av' | 'audio' | 'q' | 'toc' | 'video' | 'task' | 'code' | 'bookmark' | 'formula';
type BlockSubType = 'd1' | 'd2' | 's1' | 's2' | 's3' | 't1' | 't2' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'table' | 'task' | 'toggle' | 'latex' | 'quote' | 'html' | 'code' | 'footnote' | 'cite' | 'collection' | 'bookmark' | 'attachment' | 'comment' | 'mindmap' | 'spreadsheet' | 'calendar' | 'image' | 'audio' | 'video' | 'other' | 'u' | 'o' | 'li' | 'hr';
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

interface IReqGetDocInfo {
    id: string;
}

interface IReqTransferBlockRef {
    fromID: string;
    toID: string;
    refIDs?: string[];
}

interface IResInsertBlock {
    doOperations?: doOperation[];
    undoOperations?: doOperation[] | null;
    updated?: unknown;
}

interface IResPrependBlock extends IResInsertBlock {}
interface IResAppendBlock extends IResInsertBlock {}
interface IResUpdateBlock extends IResInsertBlock {}
interface IResDeleteBlock extends IResInsertBlock {}
interface IResMoveBlock extends IResInsertBlock {}

interface IResGetDocInfo {
    id: string;
    rootID: string;
    name: string;
    subFileCount?: number;
    icon?: string;
}

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

interface IReqFullTextSearchBlock {
    query: string;
    method?: number;
    types?: Record<string, boolean>;
    paths?: string[];
    groupBy?: number;
    orderBy?: number;
    page?: number;
    pageSize?: number;
}

interface IResFullTextSearchBlock {
    blocks: unknown[];
    matchedBlockCount: number;
    matchedRootCount: number;
    pageCount: number;
}

interface IReqSearchTag {
    k: string;
}

interface IResSearchTag {
    tags: string[];
    k: string;
}

interface IReqGetBacklinkDoc {
    defID: string;
    refTreeID?: string;
    keyword?: string;
}

interface IResGetBacklinkDoc {
    backlinks: unknown[];
    backmentions: unknown[];
}

interface IReqGetBackmentionDoc {
    defID: string;
    refTreeID?: string;
    keyword?: string;
}

interface IResGetBackmentionDoc {
    backmentions: unknown[];
}

interface IReqRenderTemplate {
    id: string;
    path: string;
    preview?: boolean;
}

interface IReqDocSaveAsTemplate {
    id: string;
    name: string;
    overwrite: boolean;
}

interface IReqRenderSprig {
    template: string;
}

interface IReqSearchTemplates {
    k: string;
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

export type {
    ForwardProxyHeader,
    IReqAppendBlock,
    IReqCloseNotebook,
    IReqCreateDocWithMd,
    IReqCreateNotebook,
    IReqDeleteBlock,
    IReqExportMdContent,
    IReqExportResources,
    IReqFoldBlock,
    IReqForwardProxy,
    IReqFullTextSearchBlock,
    IReqGetBacklinkDoc,
    IReqGetBackmentionDoc,
    IReqGetBlockKramdown,
    IReqGetChildBlocks,
    IReqGetDocInfo,
    IReqGetFile,
    IReqGetHPathByID,
    IReqGetHPathByPath,
    IReqGetIDsByHPath,
    IReqGetNotebookConf,
    IReqGetPathByID,
    IReqInsertBlock,
    IReqListDocsByPath,
    IReqMoveBlock,
    IReqMoveDocs,
    IReqMoveDocsByID,
    IReqOpenNotebook,
    IReqPandoc,
    IReqPrependBlock,
    IReqPushErrMsg,
    IReqPushMsg,
    IReqPutFile,
    IReqQuerySQL,
    IReqReadDir,
    IReqRemoveDoc,
    IReqRemoveDocByID,
    IReqRemoveFile,
    IReqRemoveNotebook,
    IReqRenameDoc,
    IReqRenameDocByID,
    IReqRenameFile,
    IReqRenameNotebook,
    IReqRenderSprig,
    IReqRenderTemplate,
    IReqSearchTemplates,
    IReqSearchTag,
    IReqSetNotebookConf,
    IReqSetNotebookIcon,
    IReqTransferBlockRef,
    IReqUnfoldBlock,
    IReqUpdateBlock,
    IReqUpload,
    IResBootProgress,
    IResCreateNotebook,
    IResCurrentTime,
    IResDocOutlineBlock,
    IResDocOutlinePath,
    IResExportMdContent,
    IResExportResources,
    IResForwardProxy,
    IResFullTextSearchBlock,
    IResGetBacklinkDoc,
    IResGetBackmentionDoc,
    IResGetBlockKramdown,
    IResGetChildBlock,
    IResGetDocInfo,
    IResGetNotebookConf,
    IResGetPathByID,
    IResGetTemplates,
    IResInsertBlock,
    IResListDoc,
    IResListDocsByPath,
    IResPandoc,
    IResPushErrMsg,
    IResPushMsg,
    IResReadDir,
    IResReadDirItem,
    IResSearchTemplates,
    IResSearchTag,
    IResSetNotebookConf,
    IResUpload,
    IResVersion,
    IResdoOperations,
    IReslsNotebooks,
    Notebook,
};
