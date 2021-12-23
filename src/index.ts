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
  SourceLocation,
} from '@babel/types';
import prettyPrint from 'pretty-print-ms';
import Queue from './Queue';
import { ALWAYS_IGNORE, DEFAULT_OPTIONS, FilePath, Options } from './constants';

const PARSEABLE_EXTENSIONS = new Set(['.ts', '.js', '.jsx']);

class ModuleData {
  hasDefaultExport = false;
  callers: FilePath[] = [];
}

export default class Analyzer {
  private root: FilePath;
  private options: Required<Options>;
  private analyzeQueue = new Queue<FilePath>();
  private scanQueue = new Queue<FilePath>();
  private analyzedModules: Record<FilePath, ModuleData> = {};
  ignoreRegex: RegExp;

  constructor(root: FilePath = process.cwd(), options: Options = {}) {
    this.options = Object.keys(DEFAULT_OPTIONS).reduce((opts, key) => {
      const k = key as keyof Options;
      return {
        ...opts,
        [key]:
          typeof options[k] !== 'undefined' ? options[k] : DEFAULT_OPTIONS[k],
      };
    }, {}) as Required<Options>;
    this.ignoreRegex = new RegExp(`${this.options.ignore}|${ALWAYS_IGNORE}`);
    this.root = root;

    this.validate();

    this.scanQueue.push(this.root);
    this.scan();
  }

  execute() {
    const start = Date.now();

    while (this.analyzeQueue.hasItems) {
      this.analyze(this.analyzeQueue.pop()!);
    }

    const end = Date.now();
    console.log(
      `Analyzed ${chalk.magenta(
        Object.keys(this.analyzedModules).length
      )} modules in ${chalk.yellow(prettyPrint(end - start))}`
    );
    console.log();

    const usages = [];

    for (const analyzedModule in this.analyzedModules) {
      const { hasDefaultExport, callers } =
        this.analyzedModules[analyzedModule];

      if (hasDefaultExport && callers.length) {
        usages.push(
          `  - ${this.printModulePath(analyzedModule)} is required by ${callers
            .map((m) => this.printModulePath([this.root, m].join(path.sep)))
            .join(', ')}`
        );
      }
    }

    if (usages.length) {
      console.log(
        `Found ${usages.length} ES modules that are being "require"ed without specifying "default":`
      );
      usages.forEach((usage) => console.log(usage));
    } else {
      console.log(
        `Found 0 ES modules that are being "require"ed without specifying "default" 🎉`
      );
    }
  }

  private analyze(filePath: FilePath) {
    if (this.analyzedModules[filePath]) {
      return;
    }

    this.analyzedModules[filePath] = new ModuleData();
    const source = fs.readFileSync(filePath, 'utf-8');
    let ast;

    try {
      ast = parse(source, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });
    } catch (e) {
      throw new Error(
        chalk.red('Error while parsing ') + chalk.cyan(filePath) + ' ' + e
      );
    }

    traverse(ast, {
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

        this.suspectModule(modulePath, filePath, node.loc?.start);
      },
      ExportDefaultDeclaration: () => {
        this.analyzedModules[filePath].hasDefaultExport = true;
      },
    });
  }

  private scan = () => {
    while (this.scanQueue.hasItems) {
      const dirPath = this.scanQueue.pop();

      fs.readdirSync(dirPath!).forEach((f) => {
        const fullPath = path.join(dirPath!, f);

        if (this.ignoreRegex.test(fullPath)) {
          return;
        }

        const isDirectory = fs.lstatSync(fullPath).isDirectory();

        if (isDirectory) {
          this.scanQueue.push(fullPath);
        } else if (PARSEABLE_EXTENSIONS.has(path.extname(fullPath))) {
          this.analyzeQueue.push(fullPath);
        }
      });
    }
  };

  private suspectModule = (
    filePath: FilePath,
    parent: FilePath,
    location?: SourceLocation['start']
  ) => {
    const suspiciousModuleResolvedPath = this.resolveFilePath(filePath, parent);
    const fullParentPath = location
      ? [parent, location.line, location.column].join(':')
      : parent;

    if (this.analyzedModules[suspiciousModuleResolvedPath]) {
      this.analyzedModules[suspiciousModuleResolvedPath].callers.push(
        fullParentPath
      );
    } else {
      this.analyzedModules[suspiciousModuleResolvedPath] = {
        hasDefaultExport: false,
        callers: [fullParentPath],
      };
    }
  };

  private resolveFilePath = (filePath: FilePath, parent: FilePath) => {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

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

      return path.join(this.root, parts.join(path.sep));
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

  private getFullPath = (filePath: FilePath, parent: FilePath = this.root) =>
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
    chalk.cyan(filePath.replace(`${this.root}${path.sep}`, ''));

  private debug = (...message: any[]) => {
    if (!this.options.debug) {
      return;
    }

    console.log(chalk.blue('[DEBUG]'), ...message);
  };

  private validate = () => {
    if (!fs.existsSync(this.root)) {
      console.log(
        chalk.red("Couldn't find root directory"),
        chalk.cyan(this.root)
      );
      process.exit(1);
    }
  };
}
