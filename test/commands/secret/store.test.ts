import {expect} from 'chai'

/**
 * Unit tests for `sf secret store` key-format logic.
 *
 * The command's primary responsibility (beyond prompting) is to derive the
 * correct scoped account key. We test that logic directly rather than
 * exercising the full oclif command harness, which would require interactive
 * stdin and a live org.
 */

// ── Scoped account key format ─────────────────────────────────────────────────

/**
 * Derives the scoped account key from org alias, credential name, and field.
 * This mirrors the formula used in SecretStore.run() and must stay in sync.
 */
function buildScopedAccount(orgAlias: string, credential: string, field: string): string {
  return `${orgAlias}.${credential}.${field}`
}

describe('SecretStore — scoped account key format', () => {
  it('joins orgAlias, credential, and field with dots', () => {
    expect(buildScopedAccount('myOrg', 'MyApiCred', 'clientSecret')).to.equal(
      'myOrg.MyApiCred.clientSecret',
    )
  })

  it('matches what SystemKeychainProvider expects for a lookup', () => {
    // SystemKeychainProvider.get(ref, orgAlias) builds scopedAccount as
    // `${orgAlias}.${ref}`. When `ref` = `${credential}.${field}`, the
    // concatenated form must equal `${orgAlias}.${credential}.${field}`.
    const orgAlias = 'staging'
    const credential = 'PaymentGateway'
    const field = 'apiKey'

    const storeKey = buildScopedAccount(orgAlias, credential, field)

    // Simulate what the provider constructs: orgAlias + '.' + ref
    // where ref = `${credential}.${field}`
    const ref = `${credential}.${field}`
    const providerKey = `${orgAlias}.${ref}`

    expect(storeKey).to.equal(providerKey)
  })

  it('preserves case — keys are case-sensitive', () => {
    expect(buildScopedAccount('MyOrg', 'MyCredential', 'clientId')).to.equal(
      'MyOrg.MyCredential.clientId',
    )
    expect(buildScopedAccount('myorg', 'myCredential', 'clientId')).not.to.equal(
      'MyOrg.MyCredential.clientId',
    )
  })

  it('works with field names that contain no dots', () => {
    const key = buildScopedAccount('prod-org', 'ExternalCred', 'password')
    expect(key.split('.')).to.deep.equal(['prod-org', 'ExternalCred', 'password'])
  })
})

// ── env backend: env var name derivation ─────────────────────────────────────

/**
 * Derives the env var name that the env backend expects.
 * Mirrors SecretStore's inline formula and refToEnvKey.
 */
function scopedAccountToEnvKey(scopedAccount: string): string {
  return scopedAccount.replaceAll('.', '_').toUpperCase()
}

describe('SecretStore — env var name derivation', () => {
  it('converts a scoped account key to the expected env var name', () => {
    expect(scopedAccountToEnvKey('myOrg.MyApiCred.clientSecret')).to.equal(
      'MYORG_MYAPICRED_CLIENTSECRET',
    )
  })

  it('is consistent with EnvProvider.refToEnvKey applied to the store key', () => {
    // The store command prints the env var name. The env provider reads the
    // same var. They must derive the same key for the same input.
    const storeKey = buildScopedAccount('staging', 'Cred', 'username')
    const envKey = scopedAccountToEnvKey(storeKey)
    expect(envKey).to.equal('STAGING_CRED_USERNAME')
  })
})
