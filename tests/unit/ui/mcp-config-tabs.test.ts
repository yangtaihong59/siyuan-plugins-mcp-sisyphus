import { describe, expect, it } from 'vitest';

import {
    CATEGORY_TAB_DEFS,
    HTTP_GROUP_KEY,
    ICON_SVGS,
    PERM_GROUP_KEY,
    TOOL_GROUP_KEY,
    PUPPY_GROUP_KEY,
    FEEDBACK_GROUP_KEY,
    ANALYTICS_GROUP_KEY,
    USER_RULES_GROUP_KEY,
} from '@/ui/setting/mcp-config-tabs';
import { TOOL_CATEGORIES } from '@/core/config';

describe('mcp-config-tabs icon system', () => {
    it('has all required icon keys', () => {
        const requiredKeys = [
            'globe',
            'lock',
            'book',
            'fileText',
            'layout',
            'database',
            'folder',
            'paperclip',
            'search',
            'tagIcon',
            'monitor',
            'layers',
            'paw',
            'barChart',
            'compass',
            'message',
        ];
        for (const key of requiredKeys) {
            expect(ICON_SVGS).toHaveProperty(key);
        }
    });

    it('has one category tab definition per tool category', () => {
        expect(CATEGORY_TAB_DEFS).toHaveLength(TOOL_CATEGORIES.length);
    });

    it('maps every category to an existing icon key', () => {
        for (const def of CATEGORY_TAB_DEFS) {
            expect(ICON_SVGS).toHaveProperty(def.iconKey);
        }
    });

    it('renders valid svg strings for every icon', () => {
        for (const [key, svg] of Object.entries(ICON_SVGS)) {
            expect(svg, `icon ${key} should contain <svg`).toContain('<svg');
            expect(svg, `icon ${key} should contain </svg>`).toContain('</svg>');
        }
    });

    it('keeps stable group key constants', () => {
        expect(HTTP_GROUP_KEY).toBe('Connection Config');
        expect(PERM_GROUP_KEY).toBe('Permissions');
        expect(TOOL_GROUP_KEY).toBe('Tool Settings');
        expect(PUPPY_GROUP_KEY).toBe('Mascot Display');
        expect(FEEDBACK_GROUP_KEY).toBe('feedbackGroupTitle');
        expect(ANALYTICS_GROUP_KEY).toBe('analyticsGroupTitle');
        expect(USER_RULES_GROUP_KEY).toBe('User Rules');
    });

    it('covers all tool categories', () => {
        const categories = CATEGORY_TAB_DEFS.map((d) => d.category);
        expect(categories).toEqual([...TOOL_CATEGORIES]);
    });

    it('keeps mascot tool and mascot display tabs distinct', () => {
        expect(CATEGORY_TAB_DEFS.find((d) => d.category === 'mascot')?.groupKey).toBe('Mascot Tool');
        expect(PUPPY_GROUP_KEY).toBe('Mascot Display');
    });

    it('gives every tool category its own icon', () => {
        const iconKeys = CATEGORY_TAB_DEFS.map((def) => def.iconKey);
        expect(new Set(iconKeys).size).toBe(iconKeys.length);
    });

    it('keeps filesystem and files tool icons distinct', () => {
        expect(CATEGORY_TAB_DEFS.find((d) => d.category === 'fs')?.iconKey).toBe('folder');
        expect(CATEGORY_TAB_DEFS.find((d) => d.category === 'file')?.iconKey).toBe('paperclip');
    });

    it('does not use category tabs as top-level settings tabs anymore', () => {
        const toolTabKeys = new Set(CATEGORY_TAB_DEFS.map((def) => def.groupKey));
        expect(toolTabKeys.has(TOOL_GROUP_KEY)).toBe(false);
        expect(toolTabKeys.has(PUPPY_GROUP_KEY)).toBe(false);
    });
});
