import type {Connection} from '@salesforce/core'

import {Flags, SfCommand} from '@salesforce/sf-plugins-core'
import {glob} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {ISecretProvider} from '../../lib/providers/index.js'
import type {EcInjectConfig} from '../../lib/yaml.js'

import {injectCredential} from '../../lib/api.js'
import {EnvProvider} from '../../lib/providers/env.js'
import {SystemKeychainProvider} from '../../lib/providers/system.js'
import {parseEcInjectYaml} from '../../lib/yaml.js'

/** Source backends the user can select via --source */
const SOURCE_OPTIONS = ['system', 'env'] as const
type SourceOption = (typeof SOURCE_OPTIONS)[number]

/** Per-credential result included in the --json envelope */
export interface InjectResult {
  credential: string
  fieldsInjected: string[]
  principal: string
  revision: number | undefined
}

export default class SecretInject extends SfCommand<InjectResult[]> {
  public static readonly description = `Reads secret values from the configured backend (system keychain or environment
variables) and POSTs them to the Named Credentials REST endpoint. If the
principal already exists the command retries with a PUT so the operation is
always idempotent.

Secret values are never logged or echoed to stdout or stderr.`
public static readonly examples = [
    '<%= config.bin %> <%= command.id %> --config .ec-inject.yaml --target-org myOrg',
    '<%= config.bin %> <%= command.id %> --all --target-org myOrg',
    '<%= config.bin %> <%= command.id %> --config .ec-inject.yaml --target-org myOrg --source env',
  ]
public static readonly flags = {
    all: Flags.boolean({
      description:
        'Discover and process all *.ec-inject.yaml files under the current directory. ' +
        'Mutually exclusive with --config.',
      exclusive: ['config'],
    }),
    config: Flags.string({
      description: 'Path to the .ec-inject.yaml file that describes this credential injection.',
      exclusive: ['all'],
    }),
    source: Flags.string({
      description:
        'Override the secret backend for all entries in the YAML file. ' +
        'If omitted, each entry uses the "source" field from the YAML.',
      options: [...SOURCE_OPTIONS],
    }),
    'target-org': Flags.requiredOrg({
      char: 'o',
      description: 'Alias or username of the org to inject into.',
    }),
  }
public static readonly summary =
    'Inject secrets from a local keychain or environment into a Salesforce External Credential principal.'

  public async run(): Promise<InjectResult[]> {
    const {flags} = await this.parse(SecretInject)

    if (!flags.config && !flags.all) {
      this.error('Provide either --config <path> or --all.', {exit: 1})
    }

    const org = flags['target-org']
    const orgAlias = org.getUsername() ?? org.getOrgId()
    const conn = org.getConnection()
    const sourceOverride = flags.source as SourceOption | undefined

    const configPaths = flags.all
      ? await discoverYamlFiles(process.cwd())
      : [resolve(flags.config!)]

    if (configPaths.length === 0) {
      this.warn('No .ec-inject.yaml files found.')
      return []
    }

    const results: InjectResult[] = []

    for (const configPath of configPaths) {
      const config = parseEcInjectYaml(configPath)
      const result = await this.processConfig(conn, config, orgAlias, sourceOverride)
      results.push(result)
    }

    return results
  }

  /**
   * Resolve secrets for one config file and POST them to the org.
   */
  private async processConfig(
    conn: Connection,
    config: EcInjectConfig,
    orgAlias: string,
    sourceOverride: SourceOption | undefined,
  ): Promise<InjectResult> {
    const resolvedSecrets: Record<string, string> = {}

    for (const [fieldName, entry] of Object.entries(config.secrets)) {
      const effectiveSource = sourceOverride ?? entry.source
      const provider: ISecretProvider =
        effectiveSource === 'system' ? new SystemKeychainProvider() : new EnvProvider()

      // Secret is resolved here but never interpolated into log output.
      resolvedSecrets[fieldName] = await provider.get(entry.ref, orgAlias)
    }

    const response = await injectCredential(conn, config, resolvedSecrets)

    const fieldsInjected = Object.keys(resolvedSecrets)

    if (!this.jsonEnabled()) {
      for (const fieldName of fieldsInjected) {
        const revisionSuffix =
          response.revision === undefined ? '' : ` (revision ${response.revision})`
        this.log(`✔ ${fieldName}${revisionSuffix}`)
      }
    }

    return {
      credential: config.credential,
      fieldsInjected,
      principal: config.principal,
      revision: response.revision,
    }
  }
}

/**
 * Recursively discover all `*.ec-inject.yaml` files under `rootDir`,
 * excluding `node_modules`.
 */
async function discoverYamlFiles(rootDir: string): Promise<string[]> {
  const found: string[] = []
  for await (const entry of glob('**/*.ec-inject.yaml', {
    cwd: rootDir,
    exclude: (name) => name === 'node_modules',
  })) {
    found.push(resolve(rootDir, entry))
  }

  return found.sort()
}
