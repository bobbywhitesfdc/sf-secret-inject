/**
 * Contract that every secret backend must satisfy.
 *
 * `ref` is the provider-specific identifier (e.g. a keychain account name or
 * an env var name prefix). `orgAlias` is used by backends that scope their
 * storage per-org so that the same credential name in two different orgs does
 * not collide.
 */
export interface ISecretProvider {
  /**
   * Resolve a secret value. Throws if the secret cannot be found.
   * @param ref    Provider-specific reference (e.g. "MMMCPDemo.ClientSecret")
   * @param orgAlias  Salesforce org alias (used as scope prefix where applicable)
   */
  get(ref: string, orgAlias: string): Promise<string>
}
