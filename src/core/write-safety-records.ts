/*
 * Small record/selector helpers shared by the write-safety coordinator,
 * probe and AV modules. Kept dependency-free to avoid import cycles.
 */

import type { ToolResult } from './tool-result';
import { escapeSqlString } from '../shared/sql';
import { isRecord } from '../shared/record';
export { isRecord };

export interface StateProbe {
    hash: string;
    targetIds: string[];
    summary: Record<string, unknown>;
    /** Raw probe data stays coordinator-internal; only its digest/summary reaches callers. */
    state?: Record<string, unknown>;
}

export const AV_VIEW_CONFIGURATION_ACTIONS = new Set([
    'add_view',
    'update_view',
]);

export function sortedUniqueIds(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))].sort();
}

export function collectNotebookBoxes(value: unknown, boxes: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) collectNotebookBoxes(item, boxes);
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'box' || key === 'notebookID' || key === 'notebook') && typeof nested === 'string' && nested.trim()) boxes.add(nested.trim());
        else collectNotebookBoxes(nested, boxes);
    }
}

export function collectTargetSelectors(args: Record<string, unknown>): string[] {
    const values = new Set<string>();
    for (const [key, value] of Object.entries(args)) {
        if (!/(?:^id$|^ids$|ID$|IDs$|^notebook$|^path$|^from$|^to$|^oldPath$|^tag$|^label$|^oldLabel$)/.test(key)) continue;
        if (typeof value === 'string' && value.trim()) values.add(value.trim());
        if (Array.isArray(value)) {
            for (const item of value) if (typeof item === 'string' && item.trim()) values.add(item.trim());
        }
    }
    if (typeof args.parentId === 'string' && args.parentId.trim()) values.add(args.parentId.trim());
    if (Array.isArray(args.resolvedTargetIds)) {
        for (const id of args.resolvedTargetIds) if (typeof id === 'string' && id.trim()) values.add(id.trim());
    }
    if (Array.isArray(args.targets)) {
        for (const target of args.targets) {
            if (isRecord(target) && typeof target.id === 'string' && target.id.trim()) values.add(target.id.trim());
        }
    }
    if (Array.isArray(args.items)) {
        for (const item of args.items) {
            if (!isRecord(item)) continue;
            // items[].id (rename, block update) and items[].from/to (fs mv batch).
            for (const key of ['id', 'from', 'to']) {
                const value = item[key];
                if (typeof value === 'string' && value.trim()) values.add(value.trim());
            }
        }
    }
    return [...values].sort();
}

export function collectPathSelectors(args: Record<string, unknown>): string[] {
    const paths = new Set<string>();
    for (const key of ['path', 'from', 'to', 'oldPath', 'hpath']) {
        const value = args[key];
        if (typeof value === 'string' && value.trim()) paths.add(value.trim());
    }
    // fs mv batch: items[].from/to are workspace paths too.
    if (Array.isArray(args.items)) {
        for (const item of args.items) {
            if (!isRecord(item)) continue;
            for (const key of ['from', 'to']) {
                const value = item[key];
                if (typeof value === 'string' && value.trim()) paths.add(value.trim());
            }
        }
    }
    return [...paths].sort();
}

export function collectStateSelectors(args: Record<string, unknown>): Record<string, unknown> {
    const selectors: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        if (key === 'action' || key === 'requestId' || key === 'validateOnly' || key.startsWith('expected')) continue;
        if (/(?:^id$|ID$|IDs$|path|notebook|tag|label|row|column|key)/i.test(key)) selectors[key] = value;
    }
    return selectors;
}

export function sqlString(value: string): string {
    return `'${escapeSqlString(value)}'`;
}

export function parseResultObject(result: ToolResult): Record<string, unknown> | null {
    if (result.structuredContent) return result.structuredContent;
    const text = result.content.find((item) => item.type === 'text')?.text;
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

