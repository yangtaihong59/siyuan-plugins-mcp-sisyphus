/**
 * Translates raw SiYuan kernel errors into semantic codes with actionable hints
 * so LLMs can branch on failure type without regex-matching Chinese messages.
 */

export type ErrorCode =
    | 'block_not_found'
    | 'notebook_not_found'
    | 'notebook_closed'
    | 'document_not_found'
    | 'av_not_found'
    | 'permission_denied'
    | 'unsupported_siyuan_version'
    | 'kernel_unreachable';

export interface ErrorTranslation {
    code: ErrorCode;
    hint: string;
}

interface ErrorRule {
    code: ErrorCode;
    patterns: RegExp[];
    hint: string;
}

const ERROR_RULES: ErrorRule[] = [
    {
        code: 'unsupported_siyuan_version',
        patterns: [/SiYuan version .* does not support semantic search/i],
        hint: 'Upgrade SiYuan to version 3.7.0 or newer before using search(action="semantic").',
    },
    {
        code: 'block_not_found',
        patterns: [
            /未找到 ID 为 \[[^\]]+\] 的内容块/,
            /SiYuan API error:\s*-1\b.*(block|id)/i,
            /block not found/i,
        ],
        hint: 'Verify the block ID with block(action="info", id="...") or locate it via search(action="fulltext", query="...").',
    },
    {
        code: 'notebook_not_found',
        patterns: [
            /notebook .*not found/i,
            /笔记本不存在/,
            /not found in lsNotebooks/i,
        ],
        hint: 'List available notebooks via notebook(action="list") and retry with a valid notebook ID.',
    },
    {
        code: 'notebook_closed',
        patterns: [
            /notebook is currently closed/i,
            /kernel still initializing/i,
            /closed_or_initializing/i,
            /笔记本已关闭/,
        ],
        hint: 'Re-open the notebook via notebook(action="set_open_state", opened=true) or retry after a short wait.',
    },
    {
        code: 'document_not_found',
        patterns: [
            /document .*not found/i,
            /文档不存在/,
        ],
        hint: 'Resolve the document via document(action="lookup") or search(action="search_docs").',
    },
    {
        code: 'av_not_found',
        patterns: [
            /attribute view .*not found/i,
            /数据库不存在/,
            /av .*not found/i,
        ],
        hint: 'Locate the attribute view via av(action="search", keyword="...") or av(action="list").',
    },
    {
        code: 'permission_denied',
        patterns: [
            /permission denied/i,
            /权限被拒绝/,
            /no .*permission/i,
        ],
        hint: 'Inspect current permissions with notebook(action="get_permissions") and adjust via notebook(action="set_permission").',
    },
    {
        code: 'kernel_unreachable',
        patterns: [
            /HTTP error:/i,
            /Request timeout/i,
            /ECONNREFUSED/i,
            /fetch failed/i,
        ],
        hint: 'MCP server is running but the SiYuan kernel is unreachable. Prompt the user to start SiYuan. Do not explore source files to debug this.',
    },
];

export function translateError(error: Error): ErrorTranslation | null {
    const message = error.message ?? '';
    for (const rule of ERROR_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(message))) {
            return { code: rule.code, hint: rule.hint };
        }
    }
    return null;
}

/** Returns true when the error indicates a missing/deleted block. */
export function isMissingBlockError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return translateError(error)?.code === 'block_not_found';
}
