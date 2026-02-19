export interface SiYuanResponse<T = any> {
    code: number;
    msg: string;
    data: T;
}

export class SiYuanError extends Error {
    code: number;
    msg: string;

    constructor(code: number, msg: string) {
        super(`SiYuan API error: ${code} - ${msg}`);
        this.name = 'SiYuanError';
        this.code = code;
        this.msg = msg;
    }
}

export const errorCodeMap: {[code: number]: string} = {
    -1: 'Unknown error',
    0: 'Success',
    1: 'Invalid parameter',
    2: 'Unsupported operation',
    3: 'Data not found',
    4: 'Permission denied',
    5: 'Data conflict',
    6: 'Data validation failed',
    7: 'Internal server error',
    8: 'Database error',
    9: 'Network error',
    10: 'Timeout',
    11: 'Service unavailable',
    12: 'Authentication failed',
    13: 'Token expired',
    14: 'Rate limit exceeded',
    15: 'Resource not found',
    16: 'Resource already exists',
    17: 'Operation cancelled',
    18: 'Invalid data format',
    19: 'File system error',
    20: 'Storage quota exceeded',
};

export function createError(response: SiYuanResponse): SiYuanError | undefined {
    if (response.code === 0) {
        return undefined;
    }
    return new SiYuanError(response.code, response.msg);
}

export function createErrorFromCode(code: number, msg: string): SiYuanError {
    return new SiYuanError(code, msg);
}

export function getErrorDescription(code: number): string {
    return errorCodeMap[code] || errorCodeMap[-1] || 'Unknown error';
}
