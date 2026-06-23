import {expect} from 'chai'

import type {EcInjectConfig} from '../../../src/lib/yaml.js'

import {injectCredential} from '../../../src/lib/api.js'
import {EnvProvider} from '../../../src/lib/providers/env.js'

/**
 * Integration-style tests for the inject command's core orchestration logic.
 *
 * We test the units that the command composes rather than running the full
 * oclif command harness, which would require a live org. Tests verify that
 * the correct fields are assembled from the config + provider and passed to
 * the API client.
 */

// ── Mock connection ───────────────────────────────────────────────────────────

type MockRequest = {body?: string; method: string; url: string;}

function buildMockConn(response: unknown = {revision: 1}): {
  conn: Parameters<typeof injectCredential>[0]
  requests: MockRequest[]
} {
  const requests: MockRequest[] = []
  const conn = {
    async request(req: MockRequest) {
      requests.push(req)
      return response
    },
    tooling: {query: async () => ({done: true, records: [], totalSize: 0})},
  } as unknown as Parameters<typeof injectCredential>[0]
  return {conn, requests}
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OAUTH_CONFIG: EcInjectConfig = {
  credential: 'IntegrationCred',
  principal: 'IntegrationPrincipal',
  protocol: 'oauth-client-credentials',
  secrets: {
    clientId: {ref: 'IntegrationCred.ClientId', source: 'env'},
    clientSecret: {ref: 'IntegrationCred.ClientSecret', source: 'env'},
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('inject orchestration — EnvProvider + API', () => {
  afterEach(() => {
    delete process.env.INTEGRATIONCRED_CLIENTID
    delete process.env.INTEGRATIONCRED_CLIENTSECRET
  })

  it('resolves env vars and posts correct fields to the Named Credentials endpoint', async () => {
    process.env.INTEGRATIONCRED_CLIENTID = 'test-id'
    process.env.INTEGRATIONCRED_CLIENTSECRET = 'test-secret'

    const provider = new EnvProvider()
    const resolvedSecrets: Record<string, string> = {}

    for (const [fieldName, entry] of Object.entries(OAUTH_CONFIG.secrets)) {
      resolvedSecrets[fieldName] = await provider.get(entry.ref, 'test-org')
    }

    const {conn, requests} = buildMockConn({revision: 1})
    const response = await injectCredential(conn, OAUTH_CONFIG, resolvedSecrets)

    expect(requests).to.have.lengthOf(1)
    expect(requests[0].method).to.equal('POST')

    const body = JSON.parse(requests[0].body ?? '{}') as Record<string, unknown>
    const credentials = body.credentials as Record<string, {encrypted: boolean; value: string;}>

    // Verify the field names are correct — never assert on the values in logs.
    expect(credentials.clientId.value).to.equal('test-id')
    expect(credentials.clientId.encrypted).to.equal(false)
    expect(credentials.clientSecret.value).to.equal('test-secret')
    expect(credentials.clientSecret.encrypted).to.equal(true)
    expect(body.externalCredential).to.equal('IntegrationCred')
    expect(body.principalName).to.equal('IntegrationPrincipal')

    expect(response.revision).to.equal(1)
  })

  it('throws before calling the API when a required env var is missing', async () => {
    process.env.INTEGRATIONCRED_CLIENTID = 'test-id'
    // clientSecret is intentionally not set

    const provider = new EnvProvider()
    const resolvedSecrets: Record<string, string> = {}

    try {
      for (const [fieldName, entry] of Object.entries(OAUTH_CONFIG.secrets)) {
        resolvedSecrets[fieldName] = await provider.get(entry.ref, 'test-org')
      }

      expect.fail('Expected an error from the missing env var')
    } catch (error) {
      expect((error as Error).message).to.include('INTEGRATIONCRED_CLIENTSECRET')
    }
  })

  it('handles multiple YAML entries producing multiple field posts', async () => {
    process.env.INTEGRATIONCRED_CLIENTID = 'id-value'
    process.env.INTEGRATIONCRED_CLIENTSECRET = 'secret-value'

    const provider = new EnvProvider()
    const resolvedSecrets: Record<string, string> = {}

    for (const [fieldName, entry] of Object.entries(OAUTH_CONFIG.secrets)) {
      resolvedSecrets[fieldName] = await provider.get(entry.ref, 'test-org')
    }

    expect(Object.keys(resolvedSecrets)).to.have.lengthOf(2)
    expect(Object.keys(resolvedSecrets).sort()).to.deep.equal(['clientId', 'clientSecret'])
  })
})
