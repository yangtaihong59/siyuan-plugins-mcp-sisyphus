import type { ParsedArgs } from './args';
import { loadFileConfig, normalizeFileConfig, type ProfileEntry } from './config';
import {
    discoverLocalKernels,
    readWorkspaceConfFromDisk,
    type DiscoveredKernel,
} from './discover-instances';
import { writeHeading, writeHint, writeKeyValueRows, writeMuted } from './render';

export async function runInstancesCommand(cli: ParsedArgs): Promise<number> {
    const instances = await discoverLocalKernels();
    const normalized = normalizeFileConfig(loadFileConfig(cli.configPath));
    const described = instances.map((instance) => ({
        ...instance,
        profiles: profilesForInstance(instance, normalized.profiles),
    }));

    if (cli.json) {
        process.stdout.write(`${JSON.stringify({ instances: described })}\n`);
        return 0;
    }

    writeHeading('SiYuan kernels');
    if (described.length === 0) {
        writeMuted('No running SiYuan kernel was found.');
    } else {
        for (const instance of described) {
            process.stdout.write(`\n  pid ${instance.pid}\n`);
            writeKeyValueRows([
                { key: 'apiUrl', value: instance.apiUrl },
                ...(instance.workspace ? [{ key: 'workspace', value: instance.workspace }] : []),
                ...(instance.publishUrl ? [{ key: 'publishUrl', value: `${instance.publishUrl} (not kernel API)` }] : []),
                { key: 'profiles', value: formatProfiles(instance.profiles, normalized.currentProfile) },
            ]);
        }
    }

    process.stdout.write('\n');
    writeHint('Note', 'apiUrl is the kernel --port. publishUrl is the read-only publish service and is not the kernel API.');
    return 0;
}

function profilesForInstance(instance: DiscoveredKernel, profiles: Record<string, ProfileEntry>): string[] {
    if (!instance.workspace) return [];
    const token = readWorkspaceConfFromDisk(instance.workspace)?.apiToken;
    if (!token) return [];
    return Object.entries(profiles)
        .filter(([, profile]) => profile.token === token)
        .map(([name]) => name);
}

function formatProfiles(profiles: string[], currentProfile: string): string {
    if (profiles.length === 0) return 'none';
    return profiles
        .map((name) => name === currentProfile ? `${name} (current)` : name)
        .join(', ');
}
