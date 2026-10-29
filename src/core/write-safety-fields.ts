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
    // A read-derived precondition, never part of the business arguments or
    // the requestId digest: the same write with or without it is one request.
    delete out.ifMatch;
    // The write-impact preview detail ("summary" | "full") only shapes the
    // preflight response. It never enters argsHash or commitArgs. Boolean
    // `preview` is a business argument of read actions (document.get_outline,
    // file.render) and stays.
    if (typeof out.preview === 'string') delete out.preview;
    return out;
}
