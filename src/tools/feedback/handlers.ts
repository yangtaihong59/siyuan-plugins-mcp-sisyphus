import { externalFetch } from '../../core/external-fetch';
import type { FeedbackAction } from '../../core/config';
import { submitFeedback } from '../../core/feedback';
import { FeedbackSubmitSchema } from '../../core/types';
import type { ToolActionHandler } from '../internal/define-tool';
import { createJsonResult } from '../internal/shared';

/*
 * Feedback handlers in a separate module keep the kernel goja bundle free of
 * the z.toJSONSchema variant construction in index.ts.
 */
export const FEEDBACK_ACTION_HANDLERS: Record<FeedbackAction, ToolActionHandler> = {
        submit: async ({ client, rawArgs }) => {
            const parsed = FeedbackSubmitSchema.parse(rawArgs);
            const result = await submitFeedback({
                description: parsed.description,
                impact: parsed.impact,
                suggestion: parsed.suggestion,
                agent: parsed.agent,
                source: parsed.source,
            }, externalFetch(client));
            return createJsonResult({
                action: 'submit',
                ...result,
            });
        },
};
