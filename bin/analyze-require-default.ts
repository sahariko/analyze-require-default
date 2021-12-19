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
  root?: FilePath;
}

program.version(version, '-v, --version', 'Output the current version');

program
  .argument(
    '[root]',
    `The project's root (default: ${chalk.yellow('process.cwd()')})`
  )
  .usage(chalk.cyan('[root] [options]'))
  .option(
    '-d, --debug',
    'Output extra debugging information',
    DEFAULT_OPTIONS.debug
  )
  .option('-c, --config <path>', 'The path to a configuration file')
  .helpOption('-h, --help', 'Display this message')
  .action(async (root: string, options: CLIOptions) => {
    const config: ConfigFile = options.config
      ? require(path.resolve(process.cwd(), options.config))
      : {};

    new Analyzer(config.root || root, {
      debug: config.debug || options.debug,
      alias: config.alias || {},
    }).execute();
  });

program.addHelpText(
  'after',
  `

Example:
  $ analyze-require-default ./app`
);

program.parse(process.argv);
