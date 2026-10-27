/** Typed error for write-safety refusals; `code` is surfaced to clients verbatim. */
export function safetyError(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { name: 'WriteSafetyError', code });
}
