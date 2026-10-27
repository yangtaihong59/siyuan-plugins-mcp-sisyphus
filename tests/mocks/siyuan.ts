export class Plugin {
    name = 'siyuan-plugins-mcp-sisyphus';
    i18n: Record<string, string> = {};

    constructor(_options?: unknown) {}

    loadData(_name: string): Promise<unknown> {
        return Promise.resolve(undefined);
    }

    saveData(_name: string, _data: unknown): Promise<void> {
        return Promise.resolve();
    }

    removeData(_name: string): Promise<void> {
        return Promise.resolve();
    }
}

export class Dialog {
    element: HTMLElement;

    constructor(_options?: unknown) {
        this.element = document.createElement('div');
    }
}

export function fetchPost(_url: string, _data?: unknown, _callback?: (response: any) => void, _headers?: unknown): void {}

export function showMessage(_message?: string, _timeout?: number, _type?: string): void {}

export function getAllEditor(): any[] {
    return [];
}
