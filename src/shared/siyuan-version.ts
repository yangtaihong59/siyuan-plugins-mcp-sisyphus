export function numericVersionParts(version: string): [number, number, number] | undefined {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
    if (!match) return undefined;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSiYuanVersionAtLeast(version: string, minimumVersion: string): boolean {
    const current = numericVersionParts(version);
    const minimum = numericVersionParts(minimumVersion);
    if (!current || !minimum) return false;

    for (let index = 0; index < minimum.length; index += 1) {
        if (current[index] > minimum[index]) return true;
        if (current[index] < minimum[index]) return false;
    }
    return true;
}
