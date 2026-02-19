import { fetchPost } from "siyuan";

let cachedToken: string | null = null;

export function getApiToken(): string {
    if (cachedToken) {
        return cachedToken;
    }
    throw new Error("getApiToken must be called within plugin context. Use getApiTokenAsync for async access.");
}

export async function getApiTokenAsync(): Promise<string> {
    if (cachedToken) {
        return cachedToken;
    }

    return new Promise((resolve, reject) => {
        fetchPost(
            "/api/system/getApiToken",
            {},
            (response: { code: number; msg: string; data: string }) => {
                if (response.code === 0 && response.data) {
                    cachedToken = response.data;
                    resolve(cachedToken);
                } else {
                    reject(new Error(response.msg || "Failed to get API token"));
                }
            }
        );
    });
}

export function clearTokenCache(): void {
    cachedToken = null;
}

export function isTokenCached(): boolean {
    return cachedToken !== null;
}
