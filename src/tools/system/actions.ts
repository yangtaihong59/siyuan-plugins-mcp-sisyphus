import { defineActionSpecs, external, read } from '../../core/action-spec';

/** Every system action, declared once; core config, defaults and write-safety policy derive from it. */
export const SYSTEM_ACTION_SPECS = defineActionSpecs({
    workspace_info: { tier: 'advanced', policy: read(), defaultEnabled: false, dangerous: true },
    network: { tier: 'advanced', policy: read(), defaultEnabled: true },
    conf: { tier: 'basic', policy: read(), defaultEnabled: true },
    notify: { tier: 'advanced', policy: external(), defaultEnabled: true },
    changelog: { tier: 'basic', policy: read(), defaultEnabled: true },
    perform_sync: { tier: 'advanced', policy: external(), defaultEnabled: true, dangerous: true },
    get_version: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_current_time: { tier: 'basic', policy: read(), defaultEnabled: true },
});
