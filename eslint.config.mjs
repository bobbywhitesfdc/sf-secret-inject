import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  ...oclif,
  prettier,
  {
    rules: {
      // Sequential provider lookups are intentional.
      'no-await-in-loop': 'off',
      // camelCase file naming is the established convention here.
      'unicorn/filename-case': 'off',
    },
  },
  {
    // glob() in node:fs/promises is available in Node 22+; engines field enforces that.
    files: ['src/commands/secret/inject.ts'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
  {
    // Multiple describe() blocks per file is conventional in this test suite.
    // object-as-default-parameter is fine in test-only helper functions.
    files: ['test/**'],
    rules: {
      'mocha/max-top-level-suites': 'off',
      'unicorn/no-object-as-default-parameter': 'off',
    },
  },
]
