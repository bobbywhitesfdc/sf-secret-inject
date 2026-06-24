import {expect} from 'chai'

import {listExternalCredentials} from '../../../src/lib/api.js'

/**
 * Tests for the `sf secret list` command's data-fetching layer.
 *
 * We verify that the Tooling API query result is correctly mapped to the
 * ExternalCredential shape that the command renders. Principal details are
 * not available via Tooling API SOQL — principals is always an empty array.
 */

function buildMockConn(records: unknown[]): Parameters<typeof listExternalCredentials>[0] {
  return {
    async request() {
      throw new Error('request() should not be called by list')
    },
    tooling: {
      query: async (_soql: string) => ({
        done: true,
        records,
        totalSize: records.length,
      }),
    },
  } as unknown as Parameters<typeof listExternalCredentials>[0]
}

describe('listExternalCredentials — table data', () => {
  it('returns credentials in order with correct field mapping', async () => {
    const records = [
      {AuthenticationProtocol: 'OauthClientCredentials', DeveloperName: 'CredA', MasterLabel: 'Credential A'},
      {AuthenticationProtocol: 'Basic', DeveloperName: 'CredB', MasterLabel: 'Credential B'},
    ]

    const conn = buildMockConn(records)
    const result = await listExternalCredentials(conn)

    expect(result).to.have.lengthOf(2)
    expect(result.map((c) => c.developerName)).to.deep.equal(['CredA', 'CredB'])
    expect(result[0].masterLabel).to.equal('Credential A')
    expect(result[1].masterLabel).to.equal('Credential B')
    expect(result[0].principals).to.deep.equal([])
    expect(result[1].principals).to.deep.equal([])
  })

  it('returns an empty array for an org with no credentials', async () => {
    const conn = buildMockConn([])
    const result = await listExternalCredentials(conn)
    expect(result).to.deep.equal([])
  })

  it('includes protocol information for each credential', async () => {
    const records = [
      {AuthenticationProtocol: 'AwsSignatureVersion4', DeveloperName: 'AwsCred', MasterLabel: 'AWS Cred'},
    ]

    const conn = buildMockConn(records)
    const result = await listExternalCredentials(conn)

    expect(result[0].authenticationProtocol).to.equal('AwsSignatureVersion4')
  })
})
