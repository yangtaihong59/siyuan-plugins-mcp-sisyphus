/*
 * Exact NodeAttributeView carrier checks over SiYuan's serialized getBlockDOM
 * HTML. Shared by the write-safety coordinator and the av tool so both
 * accept the same carrier evidence.
 */

export interface HtmlOpeningTagAttribute {
    name: string;
    value: string;
    raw: string;
    index: number;
}

export function findHtmlOpeningTagEnd(value: string, start: number): number | undefined {
    let quote: '"' | "'" | undefined;
    for (let index = start; index < value.length; index += 1) {
        const character = value[index];
        if (quote) {
            if (character === quote) quote = undefined;
            continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '>') return index;
    }
    return undefined;
}

export function parseHtmlOpeningTagAttributes(value: string): { attributes: HtmlOpeningTagAttribute[]; selfClosing: boolean } | undefined {
    const attributes: HtmlOpeningTagAttribute[] = [];
    const source = value.trim();
    const selfClosing = source.endsWith('/');
    const body = selfClosing ? source.slice(0, -1).trimEnd() : source;
    let index = 0;
    while (index < body.length) {
        while (/\s/.test(body[index] ?? '')) index += 1;
        if (index >= body.length) break;
        const start = index;
        const nameMatch = /^[^\s=/>]+/.exec(body.slice(index));
        if (!nameMatch) return undefined;
        const name = nameMatch[0];
        index += name.length;
        while (/\s/.test(body[index] ?? '')) index += 1;
        let parsedValue = '';
        if (body[index] === '=') {
            index += 1;
            while (/\s/.test(body[index] ?? '')) index += 1;
            const quote = body[index];
            if (quote === '"' || quote === "'") {
                index += 1;
                const valueStart = index;
                while (index < body.length && body[index] !== quote) index += 1;
                if (index >= body.length) return undefined;
                parsedValue = body.slice(valueStart, index);
                index += 1;
            } else {
                const valueMatch = /^[^\s"'=<>`]+/.exec(body.slice(index));
                if (!valueMatch) return undefined;
                parsedValue = valueMatch[0];
                index += parsedValue.length;
            }
        }
        attributes.push({ name, value: parsedValue, raw: body.slice(start, index), index: attributes.length });
    }
    return { attributes, selfClosing };
}

/**
 * `getBlockDOM` is serialized HTML, not a semantic document revision. SiYuan
 * v3.8 may emit the same NodeAttributeView attributes in a different order
 * between adjacent reads; treating that byte-order change as a mutation makes
 * a cross-AV lease unusable even though the AV definitions and carrier binding
 * are unchanged. Canonicalize only the attribute order of that carrier tag.
 * Values, duplicate attributes, nested DOM, and every non-attribute change
 * stay in the strict hash so this cannot hide a changed carrier identity.
 */
export function canonicalizeAvCarrierDom(dom: string): string {
    const tagPattern = /<([A-Za-z][A-Za-z0-9:-]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(dom)) !== null) {
        const tagEnd = findHtmlOpeningTagEnd(dom, tagPattern.lastIndex);
        if (tagEnd === undefined) return dom;
        const parsed = parseHtmlOpeningTagAttributes(dom.slice(tagPattern.lastIndex, tagEnd));
        if (!parsed) {
            tagPattern.lastIndex = tagEnd + 1;
            continue;
        }
        const isCarrier = parsed.attributes.some((attribute) => attribute.name.toLowerCase() === 'data-type'
            && attribute.value === 'NodeAttributeView');
        if (!isCarrier) {
            tagPattern.lastIndex = tagEnd + 1;
            continue;
        }
        const attributes = [...parsed.attributes].sort((left, right) => {
            const nameOrder = left.name.localeCompare(right.name);
            return nameOrder !== 0 ? nameOrder : left.index - right.index;
        });
        const normalizedTag = `<${match[1]}${attributes.map((attribute) => ` ${attribute.raw}`).join('')}${parsed.selfClosing ? ' /' : ''}>`;
        return `${dom.slice(0, match.index)}${normalizedTag}${dom.slice(tagEnd + 1)}`;
    }
    return dom;
}

export function isExactAvCarrierDom(dom: string, blockID: string, avID: string): boolean {
    // A document's DOM may start with its child AV. Verify the requested
    // block itself, with all three attributes on the same opening tag.
    const tag = /^\s*<[A-Za-z][A-Za-z0-9:-]*\b/.exec(dom);
    if (!tag) return false;
    const end = findHtmlOpeningTagEnd(dom, tag[0].length);
    if (end === undefined) return false;
    const parsed = parseHtmlOpeningTagAttributes(dom.slice(tag[0].length, end));
    if (!parsed) return false;
    const expected = { 'data-node-id': blockID, 'data-type': 'NodeAttributeView', 'data-av-id': avID };
    return Object.entries(expected).every(([name, value]) => {
        const attributes = parsed.attributes.filter((attribute) => attribute.name.toLowerCase() === name);
        return attributes.length === 1 && attributes[0].value === value;
    });
}
