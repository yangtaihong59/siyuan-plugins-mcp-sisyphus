import { countOccurrences } from '../../shared/text';

export interface ExactReplaceEdit {
    old: string;
    new: string;
    replace_all?: boolean;
}

export interface ExactReplaceSummary {
    index: number;
    replaced: number;
    replace_all: boolean;
}

export function applyExactReplaceEdit(
    content: string,
    edit: ExactReplaceEdit,
    editIndex: number,
    actionName: string,
): { content: string; replaced: number; replaceAll: boolean } {
    const occurrences = countOccurrences(content, edit.old);
    if (occurrences === 0) {
        const scopeHint = actionName === 'block.replace'
            ? ' block.replace only searches the kramdown of the single block identified by id; it does not include child blocks, sibling blocks, or the whole document. Read block(action="get_kramdown") for the target id first, or use fs(action="replace") for exact replacement across one document.'
            : '';
        throw new Error(`${actionName} edit #${editIndex + 1} did not match any text.${scopeHint}`);
    }

    if (edit.replace_all) {
        return {
            content: content.split(edit.old).join(edit.new),
            replaced: occurrences,
            replaceAll: true,
        };
    }

    const index = content.indexOf(edit.old);
    return {
        content: `${content.slice(0, index)}${edit.new}${content.slice(index + edit.old.length)}`,
        replaced: 1,
        replaceAll: false,
    };
}

export function applyExactReplaceEdits(
    content: string,
    edits: ExactReplaceEdit[],
    actionName: string,
): { content: string; summary: ExactReplaceSummary[] } {
    let nextContent = content;
    const summary = edits.map((edit, index) => {
        const result = applyExactReplaceEdit(nextContent, edit, index, actionName);
        nextContent = result.content;
        return {
            index: index + 1,
            replaced: result.replaced,
            replace_all: result.replaceAll,
        };
    });

    return { content: nextContent, summary };
}
