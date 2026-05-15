import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SiYuanClient } from '@/api/client';

describe('SiYuanClient', () => {
    let client: SiYuanClient;
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        global.fetch = mockFetch as typeof fetch;
        client = new SiYuanClient({
            baseUrl: 'http://127.0.0.1:6806',
            timeout: 5000,
        });
    });

    describe('constructor', () => {
        it('should use default config when no config provided', () => {
            const defaultClient = new SiYuanClient();
            expect(defaultClient).toBeDefined();
        });

        it('should use custom config when provided', () => {
            const customClient = new SiYuanClient({
                baseUrl: 'http://custom:8080',
                timeout: 10000,
            });
            expect(customClient).toBeDefined();
        });
    });

    describe('setToken', () => {
        it('should set token correctly', () => {
            client.setToken('test-token-123');
            // Token is private, but we can verify through behavior
            expect(client).toBeDefined();
        });
    });

    describe('request', () => {
        it('should make successful request and return data', async () => {
            const mockData = { notebooks: [] };
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 0, msg: 'success', data: mockData }),
            } as Response);

            const result = await client.request('/api/notebook/lsNotebooks');
            expect(result).toEqual(mockData);
        });

        it('should treat an empty successful response body as null data', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => '',
            } as Response);

            await expect(client.request('/api/asset/deleteAsset')).resolves.toBeNull();
        });

        it('should report invalid JSON responses with endpoint context', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => '<html>not json</html>',
            } as Response);

            await expect(client.request('/api/test')).rejects.toThrow(
                'Invalid SiYuan API response from http://127.0.0.1:6806/api/test (HTTP 200 OK): <html>not json</html>',
            );
        });

        it('should handle API error response', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 1, msg: 'Invalid parameter', data: null }),
            } as Response);

            await expect(client.request('/api/test')).rejects.toThrow('SiYuan API error: 1');
        });

        it('should handle HTTP error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                arrayBuffer: async () => new ArrayBuffer(0),
            } as Response);

            await expect(client.request('/api/test')).rejects.toThrow('HTTP error: 500');
        });

        it('should handle network error', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));
            await expect(client.request('/api/test')).rejects.toThrow('Network error');
        });

        it('should handle timeout error', async () => {
            mockFetch.mockImplementation(() => {
                return new Promise((_, reject) => {
                    setTimeout(() => {
                        const error = new Error('AbortError');
                        error.name = 'AbortError';
                        reject(error);
                    }, 10);
                });
            });

            const timeoutClient = new SiYuanClient({ timeout: 5 });
            await expect(timeoutClient.request('/api/test')).rejects.toThrow('timeout');
        });

        it('should include authorization header when token is set', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 0, msg: 'success', data: {} }),
            } as Response);

            client.setToken('test-token');
            await client.request('/api/test');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://127.0.0.1:6806/api/test',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Token test-token',
                        'Content-Type': 'application/json',
                    }),
                })
            );
        });

        it('should send request body when data is provided', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 0, msg: 'success', data: {} }),
            } as Response);

            const requestData = { notebook: 'test', path: '/test' };
            await client.request('/api/test', requestData);

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: JSON.stringify(requestData),
                })
            );
        });
    });

    describe('readFile', () => {
        it('should read file content successfully', async () => {
            const fileContent = 'file content here';
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => fileContent,
            } as Response);

            const result = await client.readFile('/data/test.txt');
            expect(result).toBe(fileContent);
        });

        it('should handle file read HTTP error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
            } as Response);

            await expect(client.readFile('/data/missing.txt')).rejects.toThrow('HTTP error: 404');
        });

        it('should include authorization header when token is set', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => 'content',
            } as Response);

            client.setToken('file-token');
            await client.readFile('/data/test.txt');

            expect(mockFetch).toHaveBeenCalledWith(
                'http://127.0.0.1:6806/api/file/getFile',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Token file-token',
                    }),
                })
            );
        });
    });

    describe('readFileBinary', () => {
        it('should read binary file content successfully', async () => {
            const bytes = new Uint8Array([65, 66, 67]);
            mockFetch.mockResolvedValue({
                ok: true,
                arrayBuffer: async () => bytes.buffer.slice(0),
            } as Response);

            const result = await client.readFileBinary('/data/test.bin');
            expect(Array.from(result)).toEqual([65, 66, 67]);
        });
    });

    describe('writeFile', () => {
        it('should write file content successfully', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 0, msg: 'success', data: null }),
            } as Response);

            await client.writeFile('/data/test.txt', 'content');
            expect(mockFetch).toHaveBeenCalled();
        });

        it('should handle write file API error', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 19, msg: 'File system error', data: null }),
            } as Response);

            await expect(client.writeFile('/invalid/path', 'content')).rejects.toThrow('SiYuan API error');
        });

        it('should handle write file HTTP error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 403,
                statusText: 'Forbidden',
            } as Response);

            await expect(client.writeFile('/protected/file', 'content')).rejects.toThrow('HTTP error: 403');
        });

        it('should handle timeout on write', async () => {
            mockFetch.mockImplementation(() => {
                return new Promise((_, reject) => {
                    setTimeout(() => {
                        const error = new Error('AbortError');
                        error.name = 'AbortError';
                        reject(error);
                    }, 10);
                });
            });

            const timeoutClient = new SiYuanClient({ timeout: 5 });
            await expect(timeoutClient.writeFile('/data/test.txt', 'content')).rejects.toThrow('timeout');
        });
    });

    describe('requestFormData', () => {
        it('should make successful multipart requests without forcing a content type', async () => {
            const mockData = { errFiles: [], succMap: { 'demo.txt': '/assets/demo.txt' } };
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 0, msg: 'success', data: mockData }),
            } as Response);

            const formData = new FormData();
            formData.append('assetsDirPath', '/assets/');
            client.setToken('upload-token');

            const result = await client.requestFormData('/api/asset/upload', formData);

            expect(result).toEqual(mockData);
            const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(init.headers).toEqual({ Connection: 'close', Authorization: 'Token upload-token' });
            expect(init.body).toBe(formData);
        });

        it('should surface API errors for multipart requests', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ code: 1, msg: 'Upload failed', data: null }),
            } as Response);

            await expect(client.requestFormData('/api/asset/upload', new FormData())).rejects.toThrow('SiYuan API error: 1');
        });
    });
});
