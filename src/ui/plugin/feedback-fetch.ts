/** Feedback transport: Node http(s) inside Electron (no CORS), global fetch elsewhere. */
export function createFeedbackFetch(): typeof fetch {
    const req = getNodeRequire();
    if (req) {
        try {
            const https = req("https") as typeof import("https");
            const http = req("http") as typeof import("http");
            return ((url: string, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
                const target = new URL(url);
                const transport = target.protocol === "http:" ? http : https;
                const headers = init.headers instanceof Headers
                    ? Object.fromEntries(init.headers.entries())
                    : (init.headers ?? {}) as Record<string, string>;
                const rawBody = init.body
                    ? (typeof init.body === "string" || Buffer.isBuffer(init.body) ? init.body : String(init.body))
                    : undefined;
                const request = transport.request(target, {
                    method: init.method ?? "GET",
                    headers: {
                        ...headers,
                        ...(rawBody && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")
                            ? { "Content-Length": Buffer.byteLength(rawBody) }
                            : {}),
                    },
                }, (response) => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                    response.on("end", () => {
                        const responseHeaders = new Headers();
                        for (const [key, value] of Object.entries(response.headers)) {
                            if (Array.isArray(value)) {
                                for (const item of value) responseHeaders.append(key, item);
                            } else if (typeof value === "string") {
                                responseHeaders.set(key, value);
                            }
                        }
                        resolve(new Response(Buffer.concat(chunks), {
                            status: response.statusCode ?? 0,
                            statusText: response.statusMessage ?? "",
                            headers: responseHeaders,
                        }));
                    });
                });
                request.on("error", reject);
                if (rawBody) {
                    request.write(rawBody);
                }
                request.end();
            })) as typeof fetch;
        } catch {
            // Fall through to global fetch below.
        }
    }
    if (typeof fetch === "function") {
        return fetch.bind(globalThis);
    }
    throw new Error("Feedback submission is unavailable in this environment.");
}

function getNodeRequire(): NodeRequire | undefined {
    if (typeof require === "function") {
        try {
            require("https");
            return require;
        } catch { /* not Node require */ }
    }
    if (typeof window !== "undefined") {
        const w = window as unknown as { require?: NodeRequire };
        if (typeof w.require === "function") return w.require;
    }
    return undefined;
}
