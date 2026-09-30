import { getHelpText, parseArgs } from './args';
import { runConfigCommand } from './config-command';
import { runDispatch } from './dispatch';
import { runInit } from './init';
import { runInstancesCommand } from './instances-command';
import { runHelp, runList } from './list-help';
import { renderCliError } from './render';
import { runSkillCommand } from './skill-command';

declare const __CLI_VERSION__: string;

async function main(): Promise<number> {
    let cli;
    try {
        cli = parseArgs(process.argv.slice(2));
    } catch (error) {
        renderCliError(error);
        return 2;
    }

    switch (cli.command) {
        case 'show-help':
            process.stdout.write(getHelpText());
            return 0;
        case 'version':
            process.stdout.write(`${__CLI_VERSION__}\n`);
            return 0;
        case 'init':
            await runInit(cli.configPath);
            return 0;
        case 'config':
            return runConfigCommand(cli);
        case 'skill':
            return runSkillCommand(cli);
        case 'instances':
            return await runInstancesCommand(cli);
        case 'list':
            return await runList(cli);
        case 'help':
            return await runHelp(cli);
        case 'dispatch':
            return await runDispatch(cli);
        default:
            throw new Error(`Unknown command: ${String((cli as { command: string }).command)}`);
    }
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        renderCliError(error, { debug: process.env.SIYUAN_MCP_DEBUG === '1' });
        process.exit(1);
    });
