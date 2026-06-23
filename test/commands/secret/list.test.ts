import {expect} from 'chai'

import {listExternalCredentials} from '../../../src/lib/api.js'

/**
 * Tests for the `sf secret list` command's data-fetching layer.
 *
 * We verify that the Tooling API query result is correctly mapped to the
 * ExternalCredential shape that the command renders. Full oclif table
 * rendering is not tested here — that would require a live oclif context.
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
  it('returns credentials with their principals for table rendering', async () => {
    const records = [
      {
        AuthenticationProtocol: 'OauthClientCredentials',
        DeveloperName: 'CredA',
        MasterLabel: 'Credential A',
        NamedCredentialExternalCredentialPrincipals: {
          records: [
            {AuthenticationStatus: 'Authenticated', PrincipalName: 'PA1'},
            {AuthenticationStatus: 'NotAuthenticated', PrincipalName: 'PA2'},
          ],
        },
      },
      {
        AuthenticationProtocol: 'Basic',
        DeveloperName: 'CredB',
        MasterLabel: 'Credential B',
        NamedCredentialExternalCredentialPrincipals: {
          records: [{AuthenticationStatus: 'Authenticated', PrincipalName: 'PB1'}],
        },
      },
    ]

    const conn = buildMockConn(records)
    const result = await listExternalCredentials(conn)

    // Two credentials returned in order.
    expect(result).to.have.lengthOf(2)
    expect(result.map((c) => c.developerName)).to.deep.equal(['CredA', 'CredB'])

    // First credential has two principals.
    expect(result[0].principals).to.have.lengthOf(2)
    expect(result[0].principals.map((p) => p.principalName)).to.deep.equal(['PA1', 'PA2'])
    expect(result[0].principals[0].authenticationStatus).to.equal('Authenticated')
    expect(result[0].principals[1].authenticationStatus).to.equal('NotAuthenticated')

    // Second credential has one principal.
    expect(result[1].principals).to.have.lengthOf(1)
    expect(result[1].principals[0].principalName).to.equal('PB1')
  })

  it('returns an empty array for an org with no credentials', async () => {
    const conn = buildMockConn([])
    const result = await listExternalCredentials(conn)
    expect(result).to.deep.equal([])
  })

  it('includes protocol information for each credential', async () => {
    const records = [
      {
        AuthenticationProtocol: 'AwsSignatureVersion4',
        DeveloperName: 'AwsCred',
        MasterLabel: 'AWS Cred',
        NamedCredentialExternalCredentialPrincipals: {records: []},
      },
    ]

    const conn = buildMockConn(records)
    const result = await listExternalCredentials(conn)

    expect(result[0].authenticationProtocol).to.equal('AwsSignatureVersion4')
  })
})
