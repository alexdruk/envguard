#!/usr/bin/env node

const { Command } = require('commander');
const { initCommand } = require('./commands/init');
const { checkCommand } = require('./commands/check');

const program = new Command();

program
  .name('envguard')
  .description('ESLint for environment variables — enforce .env.schema documentation')
  .version(require('../package.json').version);

program
  .command('init')
  .description('Scan the codebase and generate (or update) .env.schema')
  .option('-d, --dir <path>', 'Directory to scan (default: current directory)', process.cwd())
  .action(async (opts) => {
    await initCommand({ cwd: opts.dir });
  });

program
  .command('check')
  .description('Check the codebase against .env.schema and report violations')
  .option('-d, --dir <path>', 'Directory to check (default: current directory)', process.cwd())
  .option('--strict', 'Also flag schema entries with missing descriptions or examples', false)
  .action(async (opts) => {
    await checkCommand({ cwd: opts.dir, strict: opts.strict });
  });

// Default command — show help if called with no args
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
