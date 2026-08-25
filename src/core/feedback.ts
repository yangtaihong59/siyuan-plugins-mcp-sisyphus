export const FEEDBACK_SHARE_ID = 'Uq2KRv7t';
export const FEEDBACK_API_BASE = 'https://f-api.wps.cn/ksform/api/v3/campaign';
export const FEEDBACK_FORM_URL = `https://f.wps.cn/ksform/w/write/${FEEDBACK_SHARE_ID}`;
export const FEEDBACK_PLUGIN_VERSION = '0.6.4';

import { getInvocationTransport } from './runtime';

declare const __PLUGIN_VERSION__: string | undefined;

const FEEDBACK_FIELD_IDS = {
    description: 'v5nhl6',
    impact: 'bbev5x',
    suggestion: '6wxpgj',
    source: '8dcnsl',
    agent: 'fu27dr',
    pluginVersion: 'yl3by8',
} as const;

const FEEDBACK_SOURCE_OPTIONS = {
    settings: { value: '用户' },
    cli: { value: 'CLI' },
    stdio: { value: 'STDIO' },
    http: { value: 'HTTP' },
} as const;

type FeedbackSource = keyof typeof FEEDBACK_SOURCE_OPTIONS;

const EMPTY_FEEDBACK_VALUE = '无';

export interface FeedbackInput {
    description: string;
    impact?: string;
    suggestion?: string;
    agent?: string;
    source?: string;
    pluginVersion?: string;
}

export interface FeedbackSubmitResult {
    success: boolean;
    aid?: string;
    answerShareId?: string;
    createdTs?: number;
}

interface WpsCampaignResponse {
    code: number;
    result?: string;
    data?: {
        editVersion?: number;
        token?: string;
        questionMap?: Record<string, {
            type?: string;
            title?: string;
            baseInfo?: {
                delete?: boolean;
            };
        }>;
        setting?: {
            baseSetting?: {
                checkLogin?: boolean;
                commitConfig?: {
                    options?: Array<{ id?: string; text?: string }>;
                };
            };
        };
    };
}

interface WpsSubmitResponse {
    code: number;
    result?: string;
    data?: {
        aid?: string;
        createdTs?: number;
        answerShare?: {
            asid?: string;
        };
    };
}

export type FeedbackFetch = (url: string, init?: RequestInit) => Promise<Response>;

function normalizeOptionalText(value: string | undefined): string {
    return value?.trim() || EMPTY_FEEDBACK_VALUE;
}

function createInputAnswer(value: string) {
    return {
        type: 'input',
        strValue: value,
        isManualInput: true,
    };
}

function createSourceAnswer(source: FeedbackSource) {
    const option = FEEDBACK_SOURCE_OPTIONS[source];
    return createInputAnswer(option.value);
}

function resolveQuestionId(
    metadata: WpsCampaignResponse['data'],
    title: string,
    fallback: string,
    preferredType = 'input',
): string {
    const questions = metadata?.questionMap ? Object.entries(metadata.questionMap) : [];
    const activeByType = questions.find(([, question]) => (
        question.title === title
        && question.type === preferredType
        && question.baseInfo?.delete !== true
    ));
    if (activeByType) {
        return activeByType[0];
    }

    const active = questions.find(([, question]) => (
        question.title === title
        && question.baseInfo?.delete !== true
    ));
    return active?.[0] ?? fallback;
}

export function resolveFeedbackSource(source?: string): FeedbackSource {
    const normalized = (source ?? '').trim().toLowerCase();
    if (normalized === 'settings' || normalized === 'user' || normalized === '用户') {
        return 'settings';
    }
    if (normalized === 'cli') {
        return 'cli';
    }
    if (normalized === 'http') {
        return 'http';
    }
    if (normalized === 'stdio') {
        return 'stdio';
    }

    const transport = getInvocationTransport();
    if (transport === 'cli' || transport === 'http') {
        return transport;
    }
    return 'stdio';
}

export function resolvePluginVersion(inputVersion?: string): string {
    const explicit = normalizeOptionalText(inputVersion);
    if (explicit !== EMPTY_FEEDBACK_VALUE) {
        return explicit;
    }
    if (typeof __PLUGIN_VERSION__ === 'string' && __PLUGIN_VERSION__.trim()) {
        return __PLUGIN_VERSION__.trim();
    }
    return FEEDBACK_PLUGIN_VERSION;
}

export function buildFeedbackPayload(input: FeedbackInput, metadata: WpsCampaignResponse['data']) {
    const option = metadata?.setting?.baseSetting?.commitConfig?.options?.[0];
    if (!metadata?.token) {
        throw new Error('Feedback form metadata did not include a submit token.');
    }
    if (!option?.id) {
        throw new Error('Feedback form metadata did not include a submit option.');
    }

    const description = input.description.trim();
    const impact = normalizeOptionalText(input.impact);
    const suggestion = normalizeOptionalText(input.suggestion);
    const agent = normalizeOptionalText(input.agent);
    const pluginVersion = resolvePluginVersion(input.pluginVersion);
    const source = resolveFeedbackSource(input.source);
    const sourceFieldId = resolveQuestionId(metadata, '来源', FEEDBACK_FIELD_IDS.source);

    return {
        answerJson: {
            answers: {
                [FEEDBACK_FIELD_IDS.description]: createInputAnswer(description),
                [FEEDBACK_FIELD_IDS.impact]: createInputAnswer(impact),
                [FEEDBACK_FIELD_IDS.suggestion]: createInputAnswer(suggestion),
                [sourceFieldId]: createSourceAnswer(source),
                [FEEDBACK_FIELD_IDS.agent]: createInputAnswer(agent),
                [FEEDBACK_FIELD_IDS.pluginVersion]: createInputAnswer(pluginVersion),
            },
            answersProperty: {
                commitInfo: {
                    optionId: option.id,
                    optionText: '',
                },
            },
            consumeTime: 2,
        },
        phoneNumber: '',
        editVersion: metadata.editVersion ?? 1,
        token: metadata.token,
        channel: source,
    };
}

function createFeedbackHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://f.wps.cn',
        Referer: FEEDBACK_FORM_URL,
        'User-Agent': 'siyuan-plugin-mcp-sisyphus feedback',
        ...extra,
    };
}

async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
    const text = await response.text();
    let payload: T;
    try {
        payload = JSON.parse(text) as T;
    } catch {
        const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text;
        throw new Error(`${context} returned invalid JSON: ${snippet}`);
    }
    return payload;
}

async function formatHttpError(response: Response, context: string): Promise<Error> {
    const text = await response.text();
    const snippet = text.length > 300 ? `${text.slice(0, 300)}...` : text;
    return new Error(`${context} failed: HTTP ${response.status}${snippet ? ` ${snippet}` : ''}`);
}

export async function submitFeedback(input: FeedbackInput, fetcher: FeedbackFetch = fetch): Promise<FeedbackSubmitResult> {
    const description = input.description.trim();
    if (!description) {
        throw new Error('Feedback description is required.');
    }

    const endpoint = `${FEEDBACK_API_BASE}/${FEEDBACK_SHARE_ID}`;
    const metadataResponse = await fetcher(endpoint, {
        method: 'GET',
        headers: createFeedbackHeaders(),
    });
    if (!metadataResponse.ok) {
        throw await formatHttpError(metadataResponse, 'Feedback metadata request');
    }

    const metadata = await readJsonResponse<WpsCampaignResponse>(metadataResponse, 'Feedback metadata request');
    if (metadata.code !== 0 || !metadata.data) {
        throw new Error(`Feedback metadata request failed: ${metadata.result || metadata.code}`);
    }
    if (metadata.data.setting?.baseSetting?.checkLogin) {
        throw new Error('Feedback form currently requires WPS login.');
    }

    const csrf = `sisyphus${Math.random().toString(36).slice(2)}`;
    const payload = buildFeedbackPayload({ ...input, description }, metadata.data);
    const submitResponse = await fetcher(endpoint, {
        method: 'POST',
        headers: createFeedbackHeaders({
            'Content-Type': 'application/json',
            Cookie: `csrf=${csrf}`,
        }),
        body: JSON.stringify({
            ...payload,
            csrfmiddlewaretoken: csrf,
        }),
    });
    if (!submitResponse.ok) {
        throw await formatHttpError(submitResponse, 'Feedback submit');
    }

    const submitted = await readJsonResponse<WpsSubmitResponse>(submitResponse, 'Feedback submit');
    if (submitted.code !== 0) {
        throw new Error(`Feedback submit failed: ${submitted.result || submitted.code}`);
    }

    return {
        success: true,
        aid: submitted.data?.aid,
        answerShareId: submitted.data?.answerShare?.asid,
        createdTs: submitted.data?.createdTs,
    };
}
