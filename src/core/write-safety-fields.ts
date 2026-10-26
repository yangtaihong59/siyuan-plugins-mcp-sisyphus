/**
 * Remove transport and preflight credentials from business arguments.
 * This module deliberately has no Node-only dependencies: help rendering and
 * preflight response construction must not pull the ledger or crypto runtime
 * into the renderer/browser bundle.
 */
export function stripSafetyFields(args: Record<string, unknown>): Record<string, unknown> {
    const out = { ...args };
    delete out.requestId;
    delete out.validateOnly;
    delete out.expectedHash;
    delete out.expectedStateHash;
    delete out.expectedStructureHash;
    delete out.expectedValueHash;
    delete out.expectedManifestHash;
    delete out.expectedSourceHash;
    return out;
}
