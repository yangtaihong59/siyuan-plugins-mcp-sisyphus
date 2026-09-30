import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    buildFeedbackPayload,
    FEEDBACK_API_BASE,
    FEEDBACK_PLUGIN_VERSION,
    FEEDBACK_SHARE_ID,
    resolveFeedbackSource,
    resolvePluginVersion,
    submitFeedback,
    type FeedbackFetch,
} from '@/core/feedback';

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
        },
    });
}

function createMetadata(overrides: Record<string, unknown> = {}) {
    return {
        editVersion: 17,
        token: 'fresh-token',
        questionMap: {
            v5nhl6: { type: 'input', title: '问题描述', baseInfo: { delete: false } },
            bbev5x: { type: 'input', title: '影响', baseInfo: { delete: false } },
            '6wxpgj': { type: 'input', title: '建议改进', baseInfo: { delete: false } },
            sy30r0: { type: 'select', title: '来源', baseInfo: { delete: true } },
            '8dcnsl': { type: 'input', title: '来源', baseInfo: { delete: false } },
            fu27dr: { type: 'input', title: 'Agent产品名称及模型名称', baseInfo: { delete: false } },
            yl3by8: { type: 'input', title: '插件版本号', baseInfo: { delete: false } },
        },
        setting: {
            baseSetting: {
                checkLogin: false,
                commitConfig: {
                    options: [{ id: '7p65io', text: '' }],
                },
            },
        },
        ...overrides,
    };
}

function readPackageVersion(): string {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version: string }).version;
}

describe('feedback submission', () => {
    it.each(['timeout', 'http', 'invalid json'])('does not retry a feedback POST after %s', async (failure) => {
        const fetcher = vi.fn<Parameters<FeedbackFetch>, ReturnType<FeedbackFetch>>()
            .mockResolvedValueOnce(jsonResponse({ code: 0, data: createMetadata() }));
        if (failure === 'timeout') fetcher.mockRejectedValueOnce(new Error('request timed out'));
        else if (failure === 'http') fetcher.mockResolvedValueOnce(new Response('upstream failed', { status: 503 }));
        else fetcher.mockResolvedValueOnce(new Response('not json'));
        await expect(submitFeedback({ description: 'isolated mock feedback' }, fetcher)).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    });

    it('builds the WPS payload with discovered token, editVersion, and commit option', () => {
        const payload = buildFeedbackPayload({
            description: '  问题描述  ',
            source: 'settings',
            pluginVersion: '0.4.7',
        }, createMetadata());

        expect(payload).toMatchObject({
            editVersion: 17,
            token: 'fresh-token',
            channel: 'settings',
            answerJson: {
                answers: {
                    v5nhl6: { type: 'input', strValue: '问题描述', isManualInput: true },
                    bbev5x: { type: 'input', strValue: '无', isManualInput: true },
                    '6wxpgj': { type: 'input', strValue: '无', isManualInput: true },
                    '8dcnsl': { type: 'input', strValue: '用户', isManualInput: true },
                    fu27dr: { type: 'input', strValue: '无', isManualInput: true },
                    yl3by8: { type: 'input', strValue: '0.4.7', isManualInput: true },
                },
                answersProperty: {
                    commitInfo: {
                        optionId: '7p65io',
                        optionText: '',
                    },
                },
            },
        });
    });

    it('gets fresh metadata before posting feedback', async () => {
        const fetcher = vi.fn<Parameters<FeedbackFetch>, ReturnType<FeedbackFetch>>()
            .mockResolvedValueOnce(jsonResponse({ code: 0, data: createMetadata() }))
            .mockResolvedValueOnce(jsonResponse({
                code: 0,
                data: {
                    aid: 'aid-1',
                    createdTs: 1710000000000,
                    answerShare: { asid: 'asid-1' },
                },
            }));

        const result = await submitFeedback({
            description: 'MCP 调用体验反馈',
            impact: '影响轻微',
            suggestion: '希望增加反馈入口',
            agent: 'Codex / GPT-5',
            source: 'http',
            pluginVersion: '0.4.9',
        }, fetcher);

        expect(result).toEqual({
            success: true,
            aid: 'aid-1',
            answerShareId: 'asid-1',
            createdTs: 1710000000000,
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0][0]).toBe(`${FEEDBACK_API_BASE}/${FEEDBACK_SHARE_ID}`);
        expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET' });
        expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST' });

        const posted = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
        expect(posted.token).toBe('fresh-token');
        expect(posted.editVersion).toBe(17);
        expect(posted.answerJson.answers.v5nhl6.strValue).toBe('MCP 调用体验反馈');
        expect(posted.answerJson.answers.bbev5x.strValue).toBe('影响轻微');
        expect(posted.answerJson.answers['6wxpgj'].strValue).toBe('希望增加反馈入口');
        expect(posted.answerJson.answers.sy30r0).toBeUndefined();
        expect(posted.answerJson.answers['8dcnsl']).toMatchObject({
            type: 'input',
            strValue: 'HTTP',
            isManualInput: true,
        });
        expect(posted.answerJson.answers.fu27dr.strValue).toBe('Codex / GPT-5');
        expect(posted.answerJson.answers.yl3by8.strValue).toBe('0.4.9');
        expect(posted.answerJson.answersProperty.commitInfo.optionId).toBe('7p65io');
        expect(posted.csrfmiddlewaretoken).toEqual(expect.any(String));
    });

    it('resolves source and plugin version defaults', () => {
        const packageVersion = readPackageVersion();

        expect(resolveFeedbackSource('settings')).toBe('settings');
        expect(resolveFeedbackSource('cli')).toBe('cli');
        expect(resolveFeedbackSource('stdio')).toBe('stdio');
        expect(resolveFeedbackSource('http')).toBe('http');
        expect(resolvePluginVersion(' 0.4.9 ')).toBe('0.4.9');
        expect(FEEDBACK_PLUGIN_VERSION).toBe(packageVersion);
        expect(resolvePluginVersion('   ')).toBe(packageVersion);
    });

    it('fails clearly when the form requires login or submit returns an error', async () => {
        await expect(submitFeedback({ description: 'hello' }, vi.fn<Parameters<FeedbackFetch>, ReturnType<FeedbackFetch>>()
            .mockResolvedValueOnce(jsonResponse({
                code: 0,
                data: createMetadata({
                    setting: { baseSetting: { checkLogin: true } },
                }),
            })))).rejects.toThrow('requires WPS login');

        await expect(submitFeedback({ description: 'hello' }, vi.fn<Parameters<FeedbackFetch>, ReturnType<FeedbackFetch>>()
            .mockResolvedValueOnce(jsonResponse({ code: 0, data: createMetadata() }))
            .mockResolvedValueOnce(jsonResponse({ code: 4001, result: 'bad token' }))))
            .rejects.toThrow('bad token');
    });
});
