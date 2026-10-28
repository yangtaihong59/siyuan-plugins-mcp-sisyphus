import { ZodError, type ZodIssue } from 'zod';

import { getActionHint } from '../../core/help';
import type { ToolErrorContext, ToolFieldError } from './types';
import { isSiYuanRequestError } from '../../api/errors';

export function formatIssuePath(path: PropertyKey[]): string {
    return path
        .map((segment) => typeof segment === 'number' ? `[${segment}]` : String(segment))
        .join('.')
        .replace(/\.\[/g, '[');
}

export function getValueAtPath(value: unknown, path: PropertyKey[]): unknown {
    let current = value;
    for (const segment of path) {
        if (current === null || current === undefined) return undefined;
        if (typeof segment === 'number') {
            if (!Array.isArray(current)) return undefined;
            current = current[segment];
            continue;
        }
        if (typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[String(segment)];
    }
    return current;
}

export function formatIssueMessage(issue: ZodIssue, rawArgs?: Record<string, unknown>): string {
    const path = formatIssuePath(issue.path);
    const valueAtPath = path ? getValueAtPath(rawArgs, issue.path) : undefined;

    if (issue.code === 'invalid_type') {
        if (valueAtPath === undefined && path) {
            return `${path} is required.`;
        }
        const expected = 'expected' in issue && typeof issue.expected === 'string' ? ` Expected ${issue.expected}.` : '';
        return path ? `${path} has an invalid type.${expected}` : `Invalid input type.${expected}`;
    }

    // Enum mismatches: name the allowed values instead of a bare "invalid value".
    const allowed = (issue as { values?: unknown }).values;
    if (Array.isArray(allowed) && allowed.length > 0 && allowed.length <= 30) {
        const list = allowed.map((value) => JSON.stringify(value)).join(', ');
        return path ? `${path} must be one of: ${list}.` : `Must be one of: ${list}.`;
    }

    if (issue.code === 'unrecognized_keys' && 'keys' in issue && Array.isArray(issue.keys)) {
        return `Unexpected field(s): ${issue.keys.join(', ')}.`;
    }

    if (issue.message && issue.message !== 'Invalid input') {
        return issue.message;
    }

    return path ? `Invalid value for ${path}.` : 'Invalid input.';
}

export function formatZodIssues(error: ZodError, rawArgs?: Record<string, unknown>): ToolFieldError[] {
    return error.issues.map((issue) => ({
        path: formatIssuePath(issue.path),
        message: formatIssueMessage(issue, rawArgs),
    }));
}

export function getValidationMessage(tool?: string, action?: string): string {
    if (tool && action) return `Invalid arguments for ${tool}(action="${action}").`;
    if (tool) return `Invalid arguments for tool "${tool}".`;
    return 'Invalid arguments.';
}

export function resolveHint(context?: ToolErrorContext): string | undefined {
    return context?.hint ?? getActionHint(context?.tool, context?.action);
}

export function isApiError(error: Error): boolean {
    return isSiYuanRequestError(error);
}

export function includeDebugDetails(): boolean {
    return process.env.SIYUAN_MCP_DEBUG_ERRORS === '1';
}
