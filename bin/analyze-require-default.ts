#!/usr/bin/env node

import path from 'path';
import chalk from 'chalk';
import { program } from 'commander';
import { DEFAULT_OPTIONS, FilePath, Options } from '../src/constants';
import Analyzer from '../src';
import { version } from '../package.json';

interface CLIOptions extends Options {
  config?: string;
}

interface ConfigFile extends Options {
  entries?: FilePath | FilePath[];
}

program.version(version, '-v, --version', 'Output the current version');

program
  .argument('[entries...]', 'Entries to parse, separated by a space')
  .usage(chalk.cyan('[entries...] [options]'))
  .option(
    '-r, --root [path]',
    `The project's root (default: ${chalk.yellow('process.cwd()')})`
  )
  .option(
    '-d, --debug',
    'Output extra debugging information',
    DEFAULT_OPTIONS.debug
  )
  .option('-c, --config <path>', 'The path to a configuration file')
  .helpOption('-h, --help', 'Display this message')
  .action((entries: string[], options: CLIOptions) => {
    const config: ConfigFile = options.config
      ? require(path.resolve(process.cwd(), options.config))
      : {};

    const entryPoints = config.entries || entries;

    new Analyzer(entryPoints, {
      root: config.root || options.root,
      debug: config.debug || options.debug,
      alias: config.alias || {},
    }).execute();
  });

program.addHelpText(
  'after',
  `

Example:
  $ analyze-require-default ./a.js ./b.js`
);

program.parse(process.argv);
