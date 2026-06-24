import {expect} from 'chai'

import type {EcInjectConfig} from '../../src/lib/yaml.js'

import {injectCredential, listExternalCredentials} from '../../src/lib/api.js'

// ── Minimal Connection mock ───────────────────────────────────────────────────

/**
 * Builds a mock @salesforce/core Connection that records calls and returns
 * configured responses. Only the methods used by api.ts are implemented.
 */
function buildMockConnection(options: {
  postError?: unknown
  postResponse?: unknown
  putResponse?: unknown
  toolingRecords?: unknown[]
}): {
  calls: {body?: string; method: string; url: string;}[]
  conn: MockConnection
} {
  const calls: {body?: string; method: string; url: string;}[] = []

  const conn = {
    async request(req: {body?: string; method: string; url: string;}) {
      calls.push({body: req.body, method: req.method, url: req.url})

      if (req.method === 'POST') {
        if (options.postError) throw options.postError
        return options.postResponse ?? {credentialName: 'MockCred', revision: 1}
      }

      if (req.method === 'PUT') {
        return options.putResponse ?? {credentialName: 'MockCred', revision: 2}
      }

      throw new Error(`Unexpected method: ${req.method}`)
    },
    tooling: {
      query: async (_soql: string) => ({
        done: true,
        records: options.toolingRecords ?? [],
        totalSize: (options.toolingRecords ?? []).length,
      }),
    },
  } as unknown as MockConnection

  return {calls, conn}
}

type MockConnection = Parameters<typeof injectCredential>[0]

// ── Config fixture ────────────────────────────────────────────────────────────

const MOCK_CONFIG: EcInjectConfig = {
  credential: 'MyApiCred',
  principal: 'MyPrincipal',
  protocol: 'oauth-client-credentials',
  secrets: {
    clientId: {ref: 'MyApiCred.ClientID', source: 'system'},
    clientSecret: {ref: 'MyApiCred.ClientSecret', source: 'system'},
  },
}

const MOCK_SECRETS: Record<string, string> = {
  clientId: 'my-client-id',
  clientSecret: 'my-client-secret',
}

// ── injectCredential ──────────────────────────────────────────────────────────

describe('injectCredential', () => {
  it('POSTs to the named-credentials endpoint and returns the response', async () => {
    const {calls, conn} = buildMockConnection({
      postResponse: {credentialName: 'MyApiCred', revision: 1},
    })

    const result = await injectCredential(conn, MOCK_CONFIG, MOCK_SECRETS)

    expect(calls).to.have.lengthOf(1)
    expect(calls[0].method).to.equal('POST')
    expect(calls[0].url).to.include('/named-credentials/credential/')
    expect(result.revision).to.equal(1)
  })

  it('includes externalCredential and principalName in the POST body', async () => {
    const {calls, conn} = buildMockConnection({})

    await injectCredential(conn, MOCK_CONFIG, MOCK_SECRETS)

    const body = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>
    expect(body.externalCredential).to.equal('MyApiCred')
    expect(body.principalName).to.equal('MyPrincipal')
    expect(body.principalType).to.equal('NamedPrincipal')
  })

  it('includes credentials map with value/encrypted per field in the POST body', async () => {
    const {calls, conn} = buildMockConnection({})

    await injectCredential(conn, MOCK_CONFIG, MOCK_SECRETS)

    const body = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>
    const credentials = body.credentials as Record<string, {encrypted: boolean; value: string;}>
    expect(Object.keys(credentials).sort()).to.deep.equal(['clientId', 'clientSecret'])
    expect(credentials.clientId.encrypted).to.equal(false)
    expect(credentials.clientSecret.encrypted).to.equal(true)
  })

  it('retries with PUT when POST throws a CONFLICT error', async () => {
    const conflictError = {errorCode: 'CONFLICT', message: 'Principal already exists'}

    const {calls, conn} = buildMockConnection({
      postError: conflictError,
      putResponse: {credentialName: 'MyApiCred', revision: 3},
    })

    const result = await injectCredential(conn, MOCK_CONFIG, MOCK_SECRETS)

    // First call is POST, second is PUT.
    expect(calls).to.have.lengthOf(2)
    expect(calls[0].method).to.equal('POST')
    expect(calls[1].method).to.equal('PUT')
    expect(result.revision).to.equal(3)
  })

  it('re-throws non-CONFLICT errors without a PUT retry', async () => {
    const authError = {errorCode: 'INSUFFICIENT_ACCESS', message: 'Not authorized'}
    const {conn} = buildMockConnection({postError: authError})

    try {
      await injectCredential(conn, MOCK_CONFIG, MOCK_SECRETS)
      expect.fail('Expected an error')
    } catch (error) {
      expect((error as {errorCode: string}).errorCode).to.equal('INSUFFICIENT_ACCESS')
    }
  })
})

// ── listExternalCredentials ───────────────────────────────────────────────────

describe('listExternalCredentials', () => {
  it('returns an empty array when there are no credentials', async () => {
    const {conn} = buildMockConnection({toolingRecords: []})
    const result = await listExternalCredentials(conn)
    expect(result).to.deep.equal([])
  })

  it('maps Tooling API records to the ExternalCredential shape', async () => {
    const toolingRecords = [
      {
        AuthenticationProtocol: 'OauthClientCredentials',
        DeveloperName: 'MyApiCred',
        MasterLabel: 'My API Credential',
      },
    ]

    const {conn} = buildMockConnection({toolingRecords})
    const result = await listExternalCredentials(conn)

    expect(result).to.have.lengthOf(1)
    expect(result[0].developerName).to.equal('MyApiCred')
    expect(result[0].masterLabel).to.equal('My API Credential')
    expect(result[0].authenticationProtocol).to.equal('OauthClientCredentials')
    expect(result[0].principals).to.deep.equal([])
  })

  it('always returns an empty principals array', async () => {
    const toolingRecords = [
      {AuthenticationProtocol: 'Custom', DeveloperName: 'AnyCred', MasterLabel: 'Any Cred'},
    ]

    const {conn} = buildMockConnection({toolingRecords})
    const result = await listExternalCredentials(conn)

    expect(result[0].principals).to.deep.equal([])
  })
})
