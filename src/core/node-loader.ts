/**
 * Indirection layer for Node builtins used by code paths that run under
 * Node (MCP server, CLI, or the SiYuan CJS plugin runtime). The renderer
 * build aliases the node: specifiers to node-browser-stub.ts instead of
 * bundling real builtins.
 *
 * Import shapes follow how tests hook each module:
 * - node:fs / node:path are spied via "(await import(mod)).default", so
 *   they must flow through the default interop binding.
 * - node:crypto is replaced via vi.mock factories returning a named-export
 *   object, so its functions must go through named bindings.
 */
import fsModule from "node:fs";
import pathModule from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

type Fs = typeof fsModule;
type Path = typeof pathModule;
type Crypto = typeof import("node:crypto");

const cryptoFacade = { createHash, randomBytes, randomUUID } as unknown as Crypto;

export function nodeFs(): Fs {
    return fsModule;
}

export function nodePath(): Path {
    return pathModule;
}

export function nodeCrypto(): Crypto {
    return cryptoFacade;
}
