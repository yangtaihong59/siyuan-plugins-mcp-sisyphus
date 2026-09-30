/** Node builds reflect Zod schemas; the kernel build aliases this module. */
export const usesBakedActionSchemas = false;
export function getBakedActionSchema(_category: string, _action: string): Record<string, any> | undefined {
    return undefined;
}
