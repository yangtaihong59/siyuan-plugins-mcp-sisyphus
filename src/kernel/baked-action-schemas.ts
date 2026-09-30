import manifest from './generated/kernel-schemas.json';

export const usesBakedActionSchemas = true;
export function getBakedActionSchema(category: string, action: string): Record<string, any> {
    const schema = (manifest as any).actions?.[category]?.[action];
    if (!schema) throw new Error(`Missing baked action schema: ${category}.${action}. Rebuild kernel.js.`);
    return schema;
}
