import type { SiYuanClient } from '../../api/client';
import * as systemApi from '../../api/system';
import type { ToolResult } from './shared';

export type UiRefreshOperation =
    | { type: 'reloadProtyle'; id: string }
    | { type: 'reloadAttributeView'; id: string }
    | { type: 'reloadIcon' }
    | { type: 'reloadFiletree' }
    | { type: 'reloadTag' };

type UiRefreshFailure = {
    type: UiRefreshOperation['type'];
    id?: string;
    message: string;
};

function parseJsonResult(result: ToolResult): Record<string, unknown> | null {
    const first = result.content[0];
    if (!first || first.type !== 'text') return null;
    try {
        const parsed = JSON.parse(first.text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function dedupeOperations(operations: UiRefreshOperation[]): UiRefreshOperation[] {
    const seen = new Set<string>();
    const deduped: UiRefreshOperation[] = [];
    for (const operation of operations) {
        const key = `${operation.type}:${'id' in operation ? operation.id : ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(operation);
    }
    return deduped;
}

async function runOperation(client: SiYuanClient, operation: UiRefreshOperation): Promise<void> {
    switch (operation.type) {
        case 'reloadProtyle':
            await systemApi.reloadProtyle(client, operation.id);
            return;
        case 'reloadAttributeView':
            await systemApi.reloadAttributeView(client, operation.id);
            return;
        case 'reloadIcon':
            await systemApi.reloadIcon(client);
            return;
        case 'reloadFiletree':
            await systemApi.reloadFiletree(client);
            return;
        case 'reloadTag':
            await systemApi.reloadTag(client);
            return;
        default: {
            const _exhaustive: never = operation;
            throw new Error(`Unknown UI refresh operation: ${String(_exhaustive)}`);
        }
    }
}

export async function applyUiRefresh(
    client: SiYuanClient,
    result: ToolResult,
    operations: UiRefreshOperation[],
): Promise<ToolResult> {
    if (result.isError || operations.length === 0) return result;

    const payload = parseJsonResult(result);
    if (!payload) return result;

    const deduped = dedupeOperations(operations);
    const failures: UiRefreshFailure[] = [];

    for (const operation of deduped) {
        try {
            await runOperation(client, operation);
        } catch (error) {
            failures.push({
                type: operation.type,
                ...('id' in operation ? { id: operation.id } : {}),
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    payload.uiRefresh = {
        applied: true,
        operations: deduped.map((operation) => ({
            type: operation.type,
            ...('id' in operation ? { id: operation.id } : {}),
        })),
        ...(failures.length > 0 ? { partialFailure: failures } : {}),
    };

    return {
        ...result,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}
