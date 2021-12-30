# analyze-require-default [![](https://img.shields.io/npm/v/analyze-require-default.svg?colorA=cb3837&colorB=474a50)](https://www.npmjs.com/package/analyze-require-default)

Analyze `require()` statements of ES modules without `.default`.

JavaScript's module systems can be confusing sometimes, specifically the tiny differences in default exports/imports between ES modules (`import`/`export`) and commonjs (`module.exports`/`require`) syntax.

Such differences can be hard to find manually, and could potentially cause weird behaviours/bugs, and this is what this package is for!

Here's a quick example to demonstrate:

```js
// a.js

module.exports = 1;
```

```js
// b.js

export default 2;
```

```js
// Import default from
import a from 'a'; // This is fine, even though we're mixing 2 different module systems
import b from 'b'; // This is fine, we're on the same module system

const a = require('a'); // This is fine, we're on the same module system
const b = require('b'); // This is NOT fine, we'll get "{ default: 2 }"
```

## Installation

Install the package:

```sh
npm i -g analyze-require-default
```

## Usage and options

```
analyze-require-default [root] [options]
```

#### Example

```
analyze-require-default ./app
```

### Options

| Option | Alias       | What it does                                      | Positional arguments                                                         | Default |
| ------ | ----------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| `-c`   | `--config`  | Uses a [configuration file](#configuration-file). | An absolute or relative path to a [configuration file](#configuration-file). | -       |
| `-d`   | `--debug`   | Outputs extra debugging information.              | -                                                                            | `false` |
| `-v`   | `--version` | Outputs the current version.                      | -                                                                            | -       |
| `-h`   | `--help`    | Output the program's usage information.           | -                                                                            | -       |

### Configuration file

Can be either a `.js` file or a `.json` file, supports the following options:

| Option  | What it does                                                                                                    | Type                                 |
| ------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `root`  | An absolute or relative path to the root directory.                                                             | `string`                             |
| `alias` | A map of path aliases, similar to Webpack's [alias](https://webpack.js.org/configuration/resolve/#resolvealias) | `Record<string, string \| string[]>` |
| `debug` | Output extra debugging information.                                                                             | `boolean`                            |

#### Example

```
analyze-require-default -c ./config.js
```

```js
// ./config.js

const path = require('path');

module.exports = {
  root: './app',
  debug: true,
  alias: {
    Utilities: path.resolve(__dirname, 'src/utilities/'),
    Templates: path.resolve(__dirname, 'src/templates/'),
  },
};
```
