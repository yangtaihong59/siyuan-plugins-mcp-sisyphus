// The kernel build substitutes baked schemas, so all help resources can use
// the same registry and renderers as Node without executing Zod reflection.
export {
    listHelpResources as kernelListResources,
    listHelpResourceTemplates as kernelListResourceTemplates,
    readHelpResource as kernelReadResource,
} from '../core/resources';
export { listMcpPrompts as kernelListPrompts, getMcpPrompt as kernelGetPrompt } from '../core/skills';
