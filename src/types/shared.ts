export interface SiYuanResponse<T = unknown> {
    code: number;
    msg: string;
    data: T;
}

export interface NotebookConf {
    name: string;
    closed: boolean;
    sortMode?: number;
    refCreateSavePath: string;
    createDocNameTemplate: string;
    dailyNoteSavePath: string;
    dailyNoteTemplatePath: string;
}

export type BlockType =
    | 'd'
    | 'p'
    | 'query_embed'
    | 'l'
    | 'i'
    | 'h'
    | 'iframe'
    | 'tb'
    | 'b'
    | 's'
    | 'c'
    | 'widget'
    | 't'
    | 'html'
    | 'm'
    | 'av'
    | 'audio'
    | 'q'
    | 'toc'
    | 'video'
    | 'task'
    | 'code'
    | 'bookmark'
    | 'formula';

export type BlockSubType =
    | 'd1'
    | 'd2'
    | 's1'
    | 's2'
    | 's3'
    | 't1'
    | 't2'
    | 'h1'
    | 'h2'
    | 'h3'
    | 'h4'
    | 'h5'
    | 'h6'
    | 'table'
    | 'task'
    | 'toggle'
    | 'latex'
    | 'quote'
    | 'html'
    | 'code'
    | 'footnote'
    | 'cite'
    | 'collection'
    | 'bookmark'
    | 'attachment'
    | 'comment'
    | 'mindmap'
    | 'spreadsheet'
    | 'calendar'
    | 'image'
    | 'audio'
    | 'video'
    | 'other'
    | 'u'
    | 'o'
    | 'li'
    | 'hr';

export type DataType = 'markdown' | 'dom';

export type BlockAttrs = Record<string, string>;

export interface SetBlockAttrsRequest {
    id: string;
    attrs: BlockAttrs;
}

export interface GetBlockAttrsRequest {
    id: string;
}
