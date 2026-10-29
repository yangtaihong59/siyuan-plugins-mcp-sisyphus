/**
 * Shared types for the MCP tool layer.
 *
 * This module is the type-only root of src/tools/internal/ — it has zero
 * runtime imports into the rest of the tool layer, which prevents
 * circular-dependency cycles between shared.ts and help-render.ts.
 */

export type { ToolTextContent, ToolImageContent, ToolContent, ToolResult } from '../../core/tool-result';

export type JsonSchema = Record<string, any>;

export interface ActionVariant<Action extends string> {
    action: Action;
    schema: JsonSchema;
    validate?: (args: Record<string, unknown>) => void;
}

export interface AggregatedToolOptions<Action extends string> {
    guidance?: string[];
    actionHints?: Partial<Record<Action, string>>;
    propertyDescriptionOverrides?: Record<string, string>;
}

export interface TruncationMeta {
    truncated: boolean;
    showing: number;
    total: number;
    hint: string;
}

export interface PaginationResult<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    showing: number;
    truncated: boolean;
    hasNextPage: boolean;
}

export interface PaginatedPayload<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    hasNextPage: boolean;
}

export interface ToolErrorContext {
    tool?: string;
    action?: string;
    rawArgs?: Record<string, unknown>;
    hint?: string;
}

export interface ToolFieldError {
    path: string;
    message: string;
}
