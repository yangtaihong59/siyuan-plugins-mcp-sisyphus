import { describe, expect, it } from 'vitest';

import { isExactAvCarrierDom } from '@/shared/av-carrier-dom';

describe('isExactAvCarrierDom', () => {
    const carrier = '<div data-node-id="blk" data-type="NodeAttributeView" data-av-id="av-1" class="av"></div>';

    it('accepts the requested block carrying the requested AV, in any attribute order', () => {
        expect(isExactAvCarrierDom(carrier, 'blk', 'av-1')).toBe(true);
        expect(isExactAvCarrierDom('<div data-av-id="av-1" class="av" data-type="NodeAttributeView" data-node-id="blk"></div>', 'blk', 'av-1')).toBe(true);
    });

    it('rejects a document whose DOM merely contains the AV carrier', () => {
        const documentDom = `<div data-node-id="doc" data-type="NodeDocument">${carrier}</div>`;
        expect(isExactAvCarrierDom(documentDom, 'doc', 'av-1')).toBe(false);
    });

    it('rejects another block ID, another AV, and duplicated attributes', () => {
        expect(isExactAvCarrierDom(carrier, 'other', 'av-1')).toBe(false);
        expect(isExactAvCarrierDom(carrier, 'blk', 'av-2')).toBe(false);
        expect(isExactAvCarrierDom('<div data-node-id="blk" data-type="NodeAttributeView" data-av-id="av-1" data-av-id="av-2"></div>', 'blk', 'av-1')).toBe(false);
    });
});
