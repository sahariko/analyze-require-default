import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import {
  FunctionDeclaration,
  Identifier,
  MemberExpression,
  StringLiteral,
} from '@babel/types';
import prettyPrint from 'pretty-print-ms';
import Queue from './Queue';
import { DEFAULT_OPTIONS, FilePath, Options } from './constants';

const PARSEABLE_EXTENSIONS = new Set(['.ts', '.js', '.jsx']);

interface QueueItem {
  filePath: FilePath;
  parent?: FilePath;
}

interface SuspiciousModule {
  hasDefaultExport: boolean;
  callers: FilePath[];
}

export default class Analyzer {
  private options: Required<Options>;
  private queue = new Queue<QueueItem>();
  private analyzedModules = new Set();
  suspiciousModules: Record<FilePath, SuspiciousModule> = {};

  constructor(entries: FilePath | FilePath[], options: Options = {}) {
    this.options = Object.keys(DEFAULT_OPTIONS).reduce((opts, key) => {
      const k = key as keyof Options;
      return {
        ...opts,
        [key]:
          typeof options[k] !== 'undefined' ? options[k] : DEFAULT_OPTIONS[k],
      };
    }, {}) as Required<Options>;

    if (Array.isArray(entries)) {
      entries.forEach((entry) => {
        this.queue.push({ filePath: entry });
      });
    } else {
      this.queue.push({ filePath: entries });
    }

    this.validate();
  }

  execute() {
    const start = Date.now();

    while (this.queue.hasItems) {
      this.analyze(this.queue.pop()!);
    }

    const end = Date.now();
    console.log(
      `Analyzed ${chalk.magenta(
        this.analyzedModules.size
      )} modules in ${chalk.yellow(prettyPrint(end - start))}`
    );
    console.log();

    const usages = [];

    for (const suspiciousModule in this.suspiciousModules) {
      const { hasDefaultExport, callers } =
        this.suspiciousModules[suspiciousModule];

      if (hasDefaultExport && callers.length) {
        usages.push(
          `  - ${this.printModulePath(
            suspiciousModule
          )} is required by ${this.printModulePath(callers.join(', '))}`
        );
      }
    }

    if (usages.length) {
      console.log(
        `Found ${usages.length} ES modules that are being "require"ed without dpecifying "default":`
      );
      usages.forEach((usage) => console.log(usage));
    } else {
      console.log(
        `Found 0 ES modules that are being "require"ed without dpecifying "default" 🎉`
      );
    }
  }

  private analyze({ filePath, parent }: QueueItem) {
    const resolvedPath = this.resolveFilePath({ filePath, parent });

    if (
      this.analyzedModules.has(resolvedPath) ||
      !PARSEABLE_EXTENSIONS.has(path.extname(resolvedPath))
    ) {
      return;
    }

    const source = fs.readFileSync(resolvedPath, 'utf-8');
    let ast;

    try {
      ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    } catch (e) {
      throw new Error(`Error while parsing ${resolvedPath}: ${e}`);
    }

    traverse(ast, {
      ImportDeclaration: ({ node }) => {
        this.safePushToQueue({
          filePath: node.source.value,
          parent: resolvedPath,
        });
      },
      CallExpression: ({ node, container }) => {
        const isRequireStatement =
          (node.callee as Identifier).name === 'require';
        const isPlainVarDeclaration =
          (container as FunctionDeclaration).id?.type === 'Identifier'; // e.g. const a = require('module');

        if (!isRequireStatement || !isPlainVarDeclaration) {
          return;
        }

        // e.g. require('module').default;
        const property = (
          (container as MemberExpression).property as Identifier
        )?.name;

        if (property) {
          return;
        }

        const { value: modulePath } = node.arguments[0] as StringLiteral;

        this.safePushToQueue({ filePath: modulePath, parent: resolvedPath });
        this.suspectModule(modulePath, resolvedPath);
      },
      ExportDefaultDeclaration: () => {
        this.markSuspiciousModule(resolvedPath);
      },
    });

    this.analyzedModules.add(resolvedPath);
  }

  private markSuspiciousModule = (filePath: FilePath) => {
    if (this.suspiciousModules[filePath]) {
      this.suspiciousModules[filePath].hasDefaultExport = true;
    }
  };

  private suspectModule = (filePath: FilePath, parent: FilePath) => {
    const suspiciousModuleResolvedPath = this.resolveFilePath({
      filePath,
      parent,
    });

    if (this.suspiciousModules[suspiciousModuleResolvedPath]) {
      this.suspiciousModules[suspiciousModuleResolvedPath].callers.push(parent);
    } else {
      this.suspiciousModules[suspiciousModuleResolvedPath] = {
        hasDefaultExport: false,
        callers: [parent],
      };
    }
  };

  private safePushToQueue(queueItem: QueueItem) {
    const extension = path.extname(queueItem.filePath);

    if (
      (extension && !PARSEABLE_EXTENSIONS.has(extension)) ||
      queueItem.parent?.includes('node_modules')
    ) {
      return;
    }

    this.queue.push(queueItem);
  }

  private resolveFilePath = ({ filePath, parent }: QueueItem) => {
    const replacedAliasFile = this.replaceAlias(filePath);

    return this.resolveWithExtension(replacedAliasFile, parent);
  };

  /**
   * node doesn't know how to resolve non-standard extensions (.ts, for example)
   * So we give it some help!
   */
  private resolveWithExtension = (filePath: FilePath, parent?: FilePath) => {
    const fullPath = this.getFullPath(filePath, parent);

    // If a file already has an extension, we're good
    if (path.extname(filePath)) {
      return this.res(filePath, parent);
    }

    try {
      // Try resolving with extension
      const fileName = path.basename(fullPath);
      const dirName = path.dirname(fullPath);
      const files = fs.readdirSync(dirName);
      const fileWithExtension = files.find((file) => {
        const { name, ext } = path.parse(file);

        return name === fileName && !!ext;
      });

      if (fileWithExtension) {
        return this.res(
          this.normalizeFilePath(path.join(dirName, fileWithExtension)),
          parent
        );
      }
    } catch {
      /**/
    }

    try {
      // Try resolving by treating the path as a directory, and looking for an index file
      const files = fs.readdirSync(fullPath);
      const indexFile = files.find((file) => {
        const { name, ext } = path.parse(file);

        return name === 'index' && !!ext;
      });

      if (indexFile) {
        return this.res(
          this.normalizeFilePath(path.join(filePath, indexFile)),
          parent
        );
      }
    } catch {
      /**/
    }

    return this.res(filePath, parent);
  };

  private replaceAlias = (filePath: FilePath) => {
    const parts = filePath.split(path.sep);
    const firstSegment = parts[0];

    if (firstSegment === '.' || firstSegment === '..') {
      return filePath;
    }

    if (firstSegment in this.options.alias) {
      parts[0] = this.options.alias[firstSegment];

      return path.join(this.options.root, parts.join(path.sep));
    }

    return filePath;
  };

  private res = (filePath: FilePath, parent: FilePath = '') => {
    const isAbsolute = path.isAbsolute(filePath);
    const options = (() => {
      if (isAbsolute) return {};

      const dirName = path.extname(parent) ? path.dirname(parent) : parent;

      return {
        paths: [this.getFullPath(dirName)],
      };
    })();

    try {
      return require.resolve(filePath, options);
    } catch {
      console.log(
        ...[
          chalk.red("Couldn't resolve path to module"),
          this.printModulePath(filePath),
          parent && `(required by ${this.printModulePath(parent)})`,
        ].filter(Boolean)
      );
      process.exit(1);
    }
  };

  private getFullPath = (
    filePath: FilePath,
    parent: FilePath = this.options.root
  ) =>
    path.isAbsolute(filePath)
      ? filePath
      : path.join(
          path.extname(parent) ? path.dirname(parent) : parent,
          filePath
        );

  private normalizeFilePath = (filePath: FilePath) =>
    filePath.startsWith(`.${path.sep}`) ||
    filePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(filePath)
      ? filePath
      : `.${path.sep}${filePath}`;

  private printModulePath = (filePath: FilePath) =>
    chalk.cyan(filePath.replace(`${this.options.root}${path.sep}`, ''));

  private debug = (...message: any[]) => {
    if (!this.options.debug) {
      return;
    }

    console.log(chalk.blue('[DEBUG]'), ...message);
  };

  private validate = () => {
    if (!fs.existsSync(this.options.root)) {
      console.log(
        chalk.red("Couldn't find root directory"),
        chalk.cyan(this.options.root)
      );
      process.exit(1);
    }
  };
}
