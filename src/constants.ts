export interface Options {
  alias?: Record<string, string>;
  debug?: boolean;
  ignore?: string;
}

export const DEFAULT_OPTIONS: Required<Options> = {
  alias: {},
  debug: false,
  ignore: 'node_modules',
};

export type FilePath = string;

export const ALWAYS_IGNORE = '.git|.vscode|.idea';
