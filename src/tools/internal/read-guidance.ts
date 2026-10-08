import type { SiYuanClient } from '../../api/client';
import { loadToolConfigFromApiFileWithStatus, type ToolCategory } from '../../core/config';
import { getActionSafetyPolicy } from '../../core/write-safety-policy';

export interface ReadInfo {
    scope: 'document' | 'block' | 'blocks' | 'database' | 'database_columns' | 'view_query' | 'search_query' | 'sql_query' | 'primary_key_query';
    coverage: 'complete' | 'partial' | 'unknown';
    representation: 'markdown' | 'kramdown' | 'textmark' | 'html' | 'database_raw' | 'database_columns' | 'view' | 'search_snippets' | 'sql_rows' | 'primary_key_values';
    limitations: string[];
}

export interface ReadStep {
    purpose: string;
    tool: ToolCategory;
    arguments: Record<string, unknown> & { action: string };
}

/** Suggestions contain only reads/help. Configuration failure never advertises defaults. */
export async function availableReadSteps(client: SiYuanClient, steps: ReadStep[]): Promise<ReadStep[]> {
    if (!steps.length) return [];
    const loaded = await loadToolConfigFromApiFileWithStatus(client);
    if (!loaded.ok) return [];
    return steps.filter(step => {
        const category = loaded.config[step.tool];
        const action = step.arguments.action === 'help' ? step.arguments.topic : step.arguments.action;
        return category.enabled && typeof action === 'string' && category.actions[action] === true
            && getActionSafetyPolicy(step.tool, step.arguments.action, step.arguments).mode === 'read';
    });
}

export function databaseReadSteps(databases: Array<{ avID?: string; blockID?: string }>): ReadStep[] {
    return databases.filter(database => database.avID).map(({ avID, blockID }) => ({
        purpose: 'read_database', tool: 'av',
        arguments: { action: 'get', avID, ...(blockID ? { blockID } : {}) },
    }));
}

/** A completed suffix is still only part of the document. Null totals stay unknown. */
export function documentReadInfo(
    window: { blockStart: number; hasNextWindow: boolean; totalBlocks: number | null; limitReason?: string },
    blockTypes: Array<string | undefined> = [],
): ReadInfo {
    const limitations: string[] = [];
    if (window.blockStart > 0) limitations.push('window_offset');
    if (window.hasNextWindow) limitations.push(window.limitReason ?? 'pagination');
    if (window.totalBlocks === null) limitations.push('unknown_total');
    if (blockTypes.includes('av')) limitations.push('database_contents_not_included');
    if (blockTypes.some(type => ['s', 'iframe', 'widget', 'query_embed', 'html', 'video', 'audio'].includes(type ?? ''))) {
        limitations.push('native_structure_not_fully_represented');
    }
    return {
        scope: 'document', representation: 'markdown',
        coverage: window.blockStart > 0 || window.hasNextWindow ? 'partial' : window.totalBlocks === null ? 'unknown' : 'complete',
        limitations,
    };
}

/** IDs come only from the returned Kramdown; no title lookup or guessed carrier. */
export function kramdownDatabases(kramdown: string): Array<{ avID: string }> {
    const ids = new Set<string>();
    const pattern = /\bdata-av-id=["'](\d{14}-[a-z0-9]{7})["']/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(kramdown))) ids.add(match[1]);
    return [...ids].map(avID => ({ avID }));
}
