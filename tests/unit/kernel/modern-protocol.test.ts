import { expect, it } from 'vitest';
import { KernelConfirmations, MODERN_VERSION, VERSION_META, CAPABILITIES_META, modernContext } from '@/kernel/modern-protocol';
const context = (params = {}, binding = 'client-a') => ({ params, capabilities: { elicitation: {} }, binding });
const answer = { 'dangerous-action-confirmation': { action: 'accept', content: { confirm: true } } };
it('confirmation requires an issued state, binds arguments and principal, and consumes exactly once', () => {
    const c = new KernelConfirmations(); const args = { action: 'delete', id: 'fixture', confirm: true };
    expect(c.check(context({ inputResponses: answer }), 'block', args).isError).toBe(true);
    const prompt = c.check(context(), 'block', args);
    expect(prompt.resultType).toBe('input_required');
    const retry = { requestState: prompt.requestState, inputResponses: answer };
    expect(c.check(context(retry, 'client-b'), 'block', args).isError).toBe(true);
    expect(c.check(context(retry), 'block', { ...args, id: 'another' }).isError).toBe(true);
    expect(c.check(context(retry), 'block', args)).toBeUndefined();
    expect(c.check(context(retry), 'block', args).isError).toBe(true);
});
it('decline, expiry, capacity, and missing elicitation never approve a write', () => {
    let now = 1; const c = new KernelConfirmations(() => now, 100, 1); const args = { action: 'delete' };
    const first = c.check(context(), 'block', args);
    expect(c.check(context(), 'block', args).structuredContent.error.code).toBe('confirmation_capacity');
    const retry = { requestState: first.requestState, inputResponses: { 'dangerous-action-confirmation': { action: 'decline' } } };
    expect(c.check(context(retry), 'block', args).structuredContent.writeAttempted).toBe(false);
    const next = c.check(context(), 'block', args); now = 102;
    expect(c.check(context({ requestState: next.requestState, inputResponses: answer }), 'block', args).isError).toBe(true);
    expect(c.check({ ...context(), capabilities: {} }, 'block', args).isError).toBe(true);
});
it('rejects mismatched versions and malformed modern envelopes', () => {
    const request = { request: { headers: { 'MCP-Protocol-Version': MODERN_VERSION } } };
    expect(() => modernContext(request, { params: {} })).toThrow();
    expect(() => modernContext(request, { params: { _meta: { [VERSION_META]: '2025-11-25', [CAPABILITIES_META]: {} } } })).toThrow();
    expect(modernContext(request, { params: { _meta: { [VERSION_META]: MODERN_VERSION, [CAPABILITIES_META]: {} } } })).toBeDefined();
});

it.each([
    [{ action: 'decline' }, 'confirmation_declined', false],
    [{ action: 'cancel' }, 'confirmation_cancelled', true],
    [{ action: 'accept', content: { confirm: false } }, 'confirmation_declined', false],
    [{ action: 'accept' }, 'confirmation_invalid', false],
    [{ action: 'accept', content: {} }, 'confirmation_invalid', false],
    [{ action: 'accept', content: { confirm: 'true' } }, 'confirmation_invalid', false],
    [{ action: 'accept', content: { confirm: true, extra: 1 } }, 'confirmation_invalid', false],
    [null, 'confirmation_invalid', false],
    [{ result: { action: 'accept', content: { confirm: true } } }, 'confirmation_invalid', false],
])('distinguishes confirmation response %j without executing', (response, code, cancelled) => {
    const confirmations = new KernelConfirmations();
    const args = { action: 'move', id: 'fixture' };
    const prompt = confirmations.check(context(), 'block', args);
    const result = confirmations.check(context({ requestState: prompt.requestState,
        inputResponses: { 'dangerous-action-confirmation': response } }), 'block', args);
    expect(result.structuredContent).toMatchObject({ cancelled, writeAttempted: false, writeExecuted: false, error: { code } });
    expect(confirmations.check(context({ requestState: prompt.requestState, inputResponses: answer }), 'block', args).isError).toBe(true);
});
