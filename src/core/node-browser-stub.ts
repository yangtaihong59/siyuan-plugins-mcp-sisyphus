/**
 * Renderer-bundle stubs for Node builtins. Code paths that touch these
 * never run in the plugin UI; the module exists only so rollup can
 * resolve the imports in src/core/node-loader.ts.
 */
function unavailable(name: string): never {
    throw new Error("node builtin " + name + " is unavailable in the SiYuan plugin renderer bundle.");
}

const handler: ProxyHandler<object> = {
    get(_target, prop) {
        if (prop === Symbol.toPrimitive || prop === "then") return undefined;
        return unavailable(String(prop));
    },
};

export default new Proxy({}, handler) as never;

export function readFileSync(): never { return unavailable("readFileSync"); }
export function existsSync(): never { return unavailable("existsSync"); }
export function statSync(): never { return unavailable("statSync"); }
export function writeFileSync(): never { return unavailable("writeFileSync"); }
export function rmSync(): never { return unavailable("rmSync"); }
export function mkdirSync(): never { return unavailable("mkdirSync"); }
export function readdirSync(): never { return unavailable("readdirSync"); }
export function copyFileSync(): never { return unavailable("copyFileSync"); }
export function renameSync(): never { return unavailable("renameSync"); }
export function unlinkSync(): never { return unavailable("unlinkSync"); }
export function appendFileSync(): never { return unavailable("appendFileSync"); }
export const promises = new Proxy({}, handler);

export function createHash(): never { return unavailable("createHash"); }
export function randomBytes(): never { return unavailable("randomBytes"); }
export function randomUUID(): never { return unavailable("randomUUID"); }