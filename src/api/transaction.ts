import { SiYuanClient } from './client';

export type TransactionOperation = {
    action: string;
    data?: unknown;
    id?: string;
    parentID?: string;
    previousID?: string;
    nextID?: string;
    [key: string]: unknown;
};

export type TransactionBatch = {
    doOperations: TransactionOperation[];
    undoOperations: TransactionOperation[];
};

export async function performTransactions(
    client: SiYuanClient,
    transactions: TransactionBatch[],
    options: {
        reqId?: number;
        app?: string;
        session?: string;
    } = {},
): Promise<unknown> {
    return client.requestWrite('/api/transactions', {
        transactions,
        reqId: options.reqId ?? Date.now(),
        app: options.app ?? '',
        session: options.session ?? '',
    });
}
