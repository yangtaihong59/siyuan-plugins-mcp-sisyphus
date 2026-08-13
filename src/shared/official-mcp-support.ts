import { isSiYuanVersionAtLeast } from './siyuan-version';

export const MIN_OFFICIAL_MCP_VERSION = '3.7.0';

export function supportsOfficialMcp(version: string): boolean {
    return isSiYuanVersionAtLeast(version, MIN_OFFICIAL_MCP_VERSION);
}
