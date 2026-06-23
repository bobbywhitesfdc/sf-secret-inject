import {readFileSync} from 'node:fs'

/**
 * Describes one secret entry within an `.ec-inject.yaml` file.
 */
export interface SecretEntry {
  /**
   * Provider-specific reference passed verbatim to ISecretProvider.get().
   * For the system backend this is a dotted keychain account name.
   * For the env backend this becomes an env var name (dots → underscores, uppercase).
   */
  ref: string
  /** Which backend to read the secret from: 'system' (keychain) or 'env' */
  source: 'env' | 'system'
}

/**
 * The parsed content of a single `.ec-inject.yaml` file.
 */
export interface EcInjectConfig {
  /** Developer name of the External Credential metadata record */
  credential: string
  /** Developer name of the principal within that credential */
  principal: string
  /** Authentication protocol (e.g. 'oauth-client-credentials', 'basic-auth') */
  protocol: string
  /** Map of field name → SecretEntry (e.g. "clientId", "clientSecret") */
  secrets: Record<string, SecretEntry>
}

/**
 * Parse an `.ec-inject.yaml` file.
 *
 * We roll our own minimal YAML parser to avoid introducing a runtime
 * dependency. The format is constrained to four levels of indented
 * key-value pairs. Inline arrays and flow style are not supported.
 *
 * Expected shape:
 * ```yaml
 * credential: MyCredential
 * principal: MyPrincipal
 * protocol: oauth-client-credentials
 * secrets:
 *   clientId:
 *     source: system
 *     ref: MyCredential.ClientID
 *   clientSecret:
 *     source: system
 *     ref: MyCredential.ClientSecret
 * ```
 */
export function parseEcInjectYaml(filePath: string): EcInjectConfig {
  const raw = readFileSync(filePath, 'utf8')
  return parseEcInjectYamlString(raw, filePath)
}

/**
 * Parse the string contents of an `.ec-inject.yaml` file.
 * Separated from `parseEcInjectYaml` so tests can pass strings directly.
 */
export function parseEcInjectYamlString(raw: string, sourceLabel = '<input>'): EcInjectConfig {
  const lines = raw.split('\n')
  const root: Record<string, unknown> = {}

  // Stack of [indent, object] pairs for the current nesting path.
  // We only need to handle 4 levels (0, 2, 4, 6) for this schema.
  const stack: Array<{indent: number; key: null | string; obj: Record<string, unknown>;}> = [
    {indent: -1, key: null, obj: root},
  ]

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
    const raw = lines[lineNumber - 1]
    // Strip inline comments and trailing whitespace.
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (line.trim() === '') continue

    const indent = line.search(/\S/)
    const content = line.trim()

    // Pop the stack back to the nearest ancestor whose indent is < current.
    while (stack.length > 1 && stack.at(-1)!.indent >= indent) {
      stack.pop()
    }

    const parent = stack.at(-1)!.obj

    const colonIdx = content.indexOf(':')
    if (colonIdx === -1) {
      throw new Error(
        `${sourceLabel}:${lineNumber}: expected "key: value" but found: ${JSON.stringify(content)}`,
      )
    }

    const key = content.slice(0, colonIdx).trim()
    const value = content.slice(colonIdx + 1).trim()

    if (value === '') {
      // This key introduces a nested mapping. Push a new object onto the stack.
      const nested: Record<string, unknown> = {}
      parent[key] = nested
      stack.push({indent, key, obj: nested})
    } else {
      parent[key] = value
    }
  }

  return validateEcInjectConfig(root, sourceLabel)
}

/**
 * Validate the parsed object and narrow it to EcInjectConfig.
 * Throws a descriptive error for any missing or invalid field.
 */
function validateEcInjectConfig(raw: Record<string, unknown>, sourceLabel: string): EcInjectConfig {
  const credential = requireString(raw, 'credential', sourceLabel)
  const principal = requireString(raw, 'principal', sourceLabel)
  const protocol = requireString(raw, 'protocol', sourceLabel)

  const rawSecrets = raw.secrets
  if (typeof rawSecrets !== 'object' || rawSecrets === null || Array.isArray(rawSecrets)) {
    throw new Error(`${sourceLabel}: "secrets" must be a mapping of field entries`)
  }

  const secrets: Record<string, SecretEntry> = {}
  for (const [fieldName, fieldEntry] of Object.entries(rawSecrets as Record<string, unknown>)) {
    if (typeof fieldEntry !== 'object' || fieldEntry === null || Array.isArray(fieldEntry)) {
      throw new Error(
        `${sourceLabel}: secrets.${fieldName} must be an object with "source" and "ref" fields`,
      )
    }

    const entry = fieldEntry as Record<string, unknown>
    const source = requireString(entry, 'source', `${sourceLabel} secrets.${fieldName}`)
    if (source !== 'system' && source !== 'env') {
      throw new Error(
        `${sourceLabel}: secrets.${fieldName}.source must be "system" or "env", got "${source}"`,
      )
    }

    const ref = requireString(entry, 'ref', `${sourceLabel} secrets.${fieldName}`)
    secrets[fieldName] = {ref, source}
  }

  if (Object.keys(secrets).length === 0) {
    throw new Error(`${sourceLabel}: "secrets" must contain at least one field entry`)
  }

  return {credential, principal, protocol, secrets}
}

function requireString(obj: Record<string, unknown>, key: string, location: string): string {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${location}: required string field "${key}" is missing or empty`)
  }

  return value
}
