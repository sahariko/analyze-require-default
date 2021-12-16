export interface Options {
  alias?: Record<string, string>;
  root?: string;
  debug?: boolean;
}

export const DEFAULT_OPTIONS: Required<Options> = {
  alias: {},
  root: process.cwd(),
  debug: false,
};

export type FilePath = string;
