/** A legacy bare declaration implies form support; URL-only clients do not. */
export function supportsFormElicitation(capabilities: { elicitation?: unknown } | undefined): boolean {
    const elicitation = capabilities?.elicitation;
    if (!elicitation || typeof elicitation !== 'object' || Array.isArray(elicitation)) return false;
    const modes = elicitation as { form?: unknown; url?: unknown };
    return (modes.form !== null && typeof modes.form === 'object' && !Array.isArray(modes.form))
        || (modes.form === undefined && modes.url === undefined);
}
