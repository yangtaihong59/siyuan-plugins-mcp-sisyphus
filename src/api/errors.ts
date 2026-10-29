/**
 * Typed transport errors thrown by both SiYuanClient implementations
 * (HttpSiYuanClient and KernelSiYuanClient). Callers classify by type and
 * fields, never by message text; the messages stay stable for display only.
 */

export type SiYuanRequestErrorKind =
    /** Non-2xx HTTP status. */
    | 'http'
    /** No response within the client timeout. */
    | 'timeout'
    /** SiYuan answered with a non-zero `code`. */
    | 'api'
    /** The body was not a SiYuan JSON envelope. */
    | 'invalid_response';

export class SiYuanRequestError extends Error {
    readonly status?: number;
    readonly apiCode?: number;
    readonly retryable: boolean;

    constructor(
        readonly kind: SiYuanRequestErrorKind,
        message: string,
        details: { status?: number; apiCode?: number; retryable?: boolean } = {},
    ) {
        super(message);
        this.name = 'SiYuanRequestError';
        this.status = details.status;
        this.apiCode = details.apiCode;
        this.retryable = details.retryable ?? false;
    }
}

export function httpStatusError(status: number, message: string): SiYuanRequestError {
    // 4xx other than 429 is a definite rejection; anything else may be transient.
    return new SiYuanRequestError('http', message, { status, retryable: status === 429 || status >= 500 || status === 0 });
}

export function apiCodeError(code: unknown, msg: unknown, status?: number): SiYuanRequestError {
    return new SiYuanRequestError('api', `SiYuan API error: ${code} - ${msg}`, {
        status,
        apiCode: typeof code === 'number' ? code : Number(code),
    });
}

export class ResponseSizeLimitError extends Error {
    readonly code = 'response_too_large';
    constructor(readonly maxBytes: number) {
        super(`SiYuan response exceeds the ${maxBytes}-byte read limit. Narrow the requested content.`);
        this.name = 'ResponseSizeLimitError';
    }
}

/** A write may already have reached SiYuan when transport acknowledgement fails. */
export class WriteOutcomeUnknownError extends Error {
    readonly code = 'outcome_unknown';
    readonly endpoint: string;

    constructor(endpoint: string, cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        super(`Write outcome is unknown for ${endpoint}: ${message}`);
        this.name = 'WriteOutcomeUnknownError';
        this.endpoint = endpoint;
        (this as Error & { cause?: unknown }).cause = cause;
    }
}

/**
 * Whether a failed write may still have committed. Only an explicit SiYuan
 * rejection (an API error code or a 4xx status) proves it did not.
 */
export function isAmbiguousWriteFailure(error: unknown): boolean {
    if (!(error instanceof SiYuanRequestError)) return true;
    if (error.kind === 'api') return false;
    if (error.kind === 'http') return !(error.status !== undefined && error.status >= 400 && error.status < 500);
    return true;
}

/** Errors that come from talking to SiYuan rather than from tool logic. */
export function isSiYuanRequestError(error: unknown): error is SiYuanRequestError {
    return error instanceof SiYuanRequestError;
}

/** A missing file or endpoint target: HTTP 404 or SiYuan's 404 code. */
export function isMissingFileError(error: unknown): boolean {
    return error instanceof SiYuanRequestError
        && (error.status === 404 || (error.kind === 'api' && error.apiCode === 404));
}
