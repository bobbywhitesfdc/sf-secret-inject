import {execFileSync} from 'node:child_process'

import type {ISecretProvider} from './index.js'

/**
 * Keychain service name under which all sf-secret-inject secrets are stored.
 * Accounts are scoped as `{orgAlias}.{ref}` to prevent cross-org collisions.
 */
const KEYCHAIN_SERVICE = 'sf-secret-inject'

/**
 * Reads a secret from the OS-native credential store.
 *
 * - macOS : Keychain Access via `security find-generic-password`
 * - Linux : libsecret via `secret-tool lookup`
 * - Windows: not supported — throws with a clear remediation message
 *
 * The scoped account format `{orgAlias}.{ref}` is the canonical key.
 * `sf secret store` uses the same format when writing, so reads always match.
 */
export class SystemKeychainProvider implements ISecretProvider {
  public async get(ref: string, orgAlias: string): Promise<string> {
    const scopedAccount = `${orgAlias}.${ref}`
    const {platform} = process

    if (platform === 'win32') {
      throw new Error(
        'Windows keychain is not supported in this release. ' +
          'Set --source env and export the secret as an environment variable instead.',
      )
    }

    if (platform === 'darwin') {
      return readMacKeychain(scopedAccount)
    }

    // Assume linux / other POSIX — fall through to secret-tool.
    return readSecretTool(scopedAccount)
  }
}

/**
 * Reads from macOS Keychain via the `security` CLI.
 * Trims the trailing newline that `security -w` appends.
 */
function readMacKeychain(scopedAccount: string): string {
  try {
    const result = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', scopedAccount, '-w'],
      {encoding: 'utf8'},
    )
    return result.trim()
  } catch {
    throw new Error(
      `Secret not found in macOS Keychain for service="${KEYCHAIN_SERVICE}" account="${scopedAccount}". ` +
        'Run `sf secret store` to save the secret first.',
    )
  }
}

/**
 * Reads from the libsecret store via the `secret-tool` CLI (Linux).
 */
function readSecretTool(scopedAccount: string): string {
  try {
    const result = execFileSync(
      'secret-tool',
      ['lookup', 'service', KEYCHAIN_SERVICE, 'account', scopedAccount],
      {encoding: 'utf8'},
    )
    return result.trim()
  } catch {
    throw new Error(
      `Secret not found in libsecret for service="${KEYCHAIN_SERVICE}" account="${scopedAccount}". ` +
        'Run `sf secret store` to save the secret first.',
    )
  }
}

/**
 * Writes a secret to the macOS Keychain.
 * Used by `sf secret store` on darwin.
 */
export function writeToMacKeychain(scopedAccount: string, secret: string): void {
  // -U updates an existing entry or creates a new one.
  execFileSync('security', [
    'add-generic-password',
    '-U',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    scopedAccount,
    '-w',
    secret,
  ])
}

/**
 * Writes a secret via secret-tool (Linux).
 */
export function writeToSecretTool(scopedAccount: string, secret: string): void {
  execFileSync(
    'secret-tool',
    ['store', '--label', `${KEYCHAIN_SERVICE}:${scopedAccount}`, 'service', KEYCHAIN_SERVICE, 'account', scopedAccount],
    {encoding: 'utf8', input: secret},
  )
}
