import type {ISecretProvider} from './index.js'

/**
 * Resolves secrets from environment variables.
 *
 * The `ref` is converted to an env var name by replacing all dots with
 * underscores and uppercasing the result. `orgAlias` is ignored — env vars
 * are global to the process and are not scoped per-org.
 *
 * Example: ref "MMMCPDemo.ClientSecret" → env var "MMMCPDEMO_CLIENTSECRET"
 *
 * This backend is intended for CI/CD environments where secrets are injected
 * as environment variables rather than stored in a local keychain.
 */
export class EnvProvider implements ISecretProvider {
  public async get(ref: string, _orgAlias: string): Promise<string> {
    const envKey = refToEnvKey(ref)
    const value = process.env[envKey]

    if (value === undefined || value === '') {
      throw new Error(
        `Environment variable "${envKey}" is not set. ` +
          `Export the secret before running: export ${envKey}=<value>`,
      )
    }

    return value
  }
}

/**
 * Converts a dotted ref string to an env var name.
 * All dots become underscores; the result is uppercased.
 *
 * "MMMCPDemo.ClientSecret" → "MMMCPDEMO_CLIENTSECRET"
 */
export function refToEnvKey(ref: string): string {
  return ref.replaceAll('.', '_').toUpperCase()
}
