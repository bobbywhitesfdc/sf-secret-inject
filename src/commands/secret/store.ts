import {Flags, SfCommand} from '@salesforce/sf-plugins-core'
import * as readline from 'node:readline'

import {writeToMacKeychain, writeToSecretTool} from '../../lib/providers/system.js'

/** Keychain service name — must match SystemKeychainProvider */
const KEYCHAIN_SERVICE = 'sf-secret-inject'

/** Source backends supported for storage */
const STORE_SOURCE_OPTIONS = ['system', 'env'] as const
type StoreSource = (typeof STORE_SOURCE_OPTIONS)[number]

export interface StoreResult {
  /** The scoped account key written (never the secret value) */
  scopedAccount: string
  source: StoreSource
}

export default class SecretStore extends SfCommand<StoreResult> {
  public static readonly description = `Prompts for a secret value (input is hidden) and stores it under the scoped
account key "{orgAlias}.{credential}.{field}" in the system keychain service
"sf-secret-inject".

The stored key format directly matches what the YAML "ref" field should
contain, so you can copy the printed account name straight into your
.ec-inject.yaml.

When --source env is specified, no value is stored. The command instead prints
the environment variable name you need to export before running inject.`
public static readonly examples = [
    '<%= config.bin %> <%= command.id %> --credential MMMCPDemo --field clientSecret --target-org myOrg',
    '<%= config.bin %> <%= command.id %> --credential MMMCPDemo --field clientId --target-org myOrg --source system',
    '<%= config.bin %> <%= command.id %> --credential MMMCPDemo --field clientSecret --target-org myOrg --source env',
  ]
public static readonly flags = {
    credential: Flags.string({
      description: 'Developer name of the External Credential (e.g. MMMCPDemo).',
      required: true,
    }),
    field: Flags.string({
      description: 'Field name to store (e.g. clientId, clientSecret, username, password).',
      required: true,
    }),
    source: Flags.string({
      default: 'system',
      description:
        'Backend to store the secret in. "system" writes to the OS keychain. ' +
        '"env" prints the env var name you need to export instead.',
      options: [...STORE_SOURCE_OPTIONS],
    }),
    'target-org': Flags.requiredOrg({
      char: 'o',
      description: 'Alias or username of the org. Used as the scope prefix for the keychain key.',
    }),
  }
public static readonly summary =
    'Store a secret in the local keychain (or print the env var name) for later use by `sf secret inject`.'

  public async run(): Promise<StoreResult> {
    const {flags} = await this.parse(SecretStore)

    const org = flags['target-org']
    const orgAlias = org.getUsername() ?? org.getOrgId()
    const {credential} = flags
    const {field} = flags
    const source = flags.source as StoreSource

    // The scoped account key is the canonical reference used in YAML "ref" fields.
    const scopedAccount = `${orgAlias}.${credential}.${field}`

    if (source === 'env') {
      // For the env backend, no secret is stored — we just tell the user what
      // variable name to export.
      const envKey = scopedAccount.replaceAll('.', '_').toUpperCase()
      this.log(`Set the following environment variable before running inject:`)
      this.log(`  export ${envKey}=<value>`)
      this.log(``)
      this.log(`In your .ec-inject.yaml use:`)
      this.log(`  source: env`)
      this.log(`  ref: ${scopedAccount}`)
      return {scopedAccount, source}
    }

    // Prompt for the secret. We use readline with the input stream muted
    // so the value is never echoed to the terminal.
    const secret = await promptHidden(`Enter value for ${credential}.${field}: `)

    if (secret === '') {
      this.error('Secret value cannot be empty.', {exit: 1})
    }

    storePlatformSecret(scopedAccount, secret)

    this.log(`Stored in keychain service="${KEYCHAIN_SERVICE}" account="${scopedAccount}"`)
    this.log(`Add to your .ec-inject.yaml:`)
    this.log(`  source: system`)
    this.log(`  ref: ${credential}.${field}`)

    return {scopedAccount, source}
  }
}

/**
 * Prompt for a hidden (non-echoed) input line.
 * Falls back to a visible prompt when stdin is not a TTY (e.g. in tests).
 */
async function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    process.stdout.write(prompt)

    // Mute output so the typed value is not echoed.
    if ((process.stdout as NodeJS.WriteStream).isTTY) {
      ;(process.stdin as NodeJS.ReadStream).setRawMode?.(true)
    }

    let value = ''
    process.stdin.setEncoding('utf8')

    const onData = (char: string): void => {
      switch (char) {
      case '\n': 
      case '\r': 
      case '': {
        process.stdout.write('\n')
        cleanup()
        resolve(value)
      
      break;
      }

      case '': {
        cleanup()
        reject(new Error('Aborted by user.'))
      
      break;
      }

      case '': {
        // Backspace
        value = value.slice(0, -1)
      
      break;
      }

      default: {
        value += char
      }
      }
    }

    function cleanup(): void {
      process.stdin.removeListener('data', onData)
      if ((process.stdin as NodeJS.ReadStream).isTTY) {
        ;(process.stdin as NodeJS.ReadStream).setRawMode?.(false)
      }

      rl.close()
    }

    process.stdin.on('data', onData)
    process.stdin.resume()
  })
}

/**
 * Dispatch to the correct platform keychain writer.
 */
function storePlatformSecret(scopedAccount: string, secret: string): void {
  const {platform} = process

  if (platform === 'win32') {
    throw new Error(
      'Windows keychain is not supported in this release. ' +
        'Use --source env and export the secret as an environment variable.',
    )
  }

  if (platform === 'darwin') {
    writeToMacKeychain(scopedAccount, secret)
    return
  }

  writeToSecretTool(scopedAccount, secret)
}

