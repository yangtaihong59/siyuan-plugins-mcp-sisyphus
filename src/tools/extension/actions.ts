import { defineActionSpecs, read } from '../../core/action-spec';

/** Every extension action, declared once; core config, defaults and write-safety policy derive from it. */
export const EXTENSION_ACTION_SPECS = defineActionSpecs({
    list: { tier: 'basic', policy: read(), defaultEnabled: true },
    validate_package: { tier: 'basic', policy: read(), defaultEnabled: true },
    diagnose_plugin_mcp: { tier: 'basic', policy: read(), defaultEnabled: true },
});
