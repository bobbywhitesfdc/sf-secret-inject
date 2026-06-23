import {expect} from 'chai'

import {parseEcInjectYamlString} from '../../src/lib/yaml.js'

// ── Valid YAML ────────────────────────────────────────────────────────────────

describe('parseEcInjectYamlString — valid input', () => {
  it('parses a complete oauth-client-credentials config', () => {
    const yaml = `
credential: MyApiCred
principal: MyPrincipal
protocol: oauth-client-credentials
secrets:
  clientId:
    source: system
    ref: MyApiCred.ClientID
  clientSecret:
    source: system
    ref: MyApiCred.ClientSecret
`.trim()

    const config = parseEcInjectYamlString(yaml)

    expect(config.credential).to.equal('MyApiCred')
    expect(config.principal).to.equal('MyPrincipal')
    expect(config.protocol).to.equal('oauth-client-credentials')
    expect(Object.keys(config.secrets)).to.deep.equal(['clientId', 'clientSecret'])
    expect(config.secrets.clientId).to.deep.equal({ref: 'MyApiCred.ClientID', source: 'system'})
    expect(config.secrets.clientSecret).to.deep.equal({ref: 'MyApiCred.ClientSecret', source: 'system'})
  })

  it('parses a basic-auth config with env source', () => {
    const yaml = `
credential: BasicCred
principal: ServiceUser
protocol: basic-auth
secrets:
  username:
    source: env
    ref: BasicCred.Username
  password:
    source: env
    ref: BasicCred.Password
`.trim()

    const config = parseEcInjectYamlString(yaml)

    expect(config.protocol).to.equal('basic-auth')
    expect(config.secrets.username.source).to.equal('env')
    expect(config.secrets.password.source).to.equal('env')
  })

  it('ignores inline YAML comments', () => {
    const yaml = `
credential: MyCredential # the credential name
principal: MyPrincipal
protocol: custom
secrets:
  apiKey:
    source: system # stored in keychain
    ref: MyCredential.ApiKey
`.trim()

    const config = parseEcInjectYamlString(yaml)
    expect(config.credential).to.equal('MyCredential')
  })

  it('parses a single-secret config', () => {
    const yaml = `
credential: OnlyOne
principal: P1
protocol: custom
secrets:
  token:
    source: env
    ref: OnlyOne.Token
`.trim()

    const config = parseEcInjectYamlString(yaml)
    expect(Object.keys(config.secrets)).to.have.lengthOf(1)
  })
})

// ── Missing required fields ───────────────────────────────────────────────────

describe('parseEcInjectYamlString — missing fields', () => {
  it('throws when "credential" is absent', () => {
    const yaml = `
principal: P
protocol: basic-auth
secrets:
  username:
    source: env
    ref: X
`.trim()

    expect(() => parseEcInjectYamlString(yaml, 'test.yaml')).to.throw(/"credential"/)
  })

  it('throws when "principal" is absent', () => {
    const yaml = `
credential: C
protocol: basic-auth
secrets:
  username:
    source: env
    ref: X
`.trim()

    expect(() => parseEcInjectYamlString(yaml, 'test.yaml')).to.throw(/"principal"/)
  })

  it('throws when "secrets" block is missing', () => {
    const yaml = `
credential: C
principal: P
protocol: basic-auth
`.trim()

    expect(() => parseEcInjectYamlString(yaml, 'test.yaml')).to.throw(/secrets/)
  })

  it('throws when "secrets" block is empty', () => {
    const yaml = `
credential: C
principal: P
protocol: basic-auth
secrets:
`.trim()

    // After parsing, secrets will be an empty object — validation must catch this.
    expect(() => parseEcInjectYamlString(yaml, 'test.yaml')).to.throw(/secrets/)
  })
})

// ── Unknown / invalid source ──────────────────────────────────────────────────

describe('parseEcInjectYamlString — invalid source', () => {
  it('throws when source is not "system" or "env"', () => {
    const yaml = `
credential: C
principal: P
protocol: custom
secrets:
  token:
    source: vault
    ref: C.Token
`.trim()

    expect(() => parseEcInjectYamlString(yaml, 'test.yaml')).to.throw(/source.*"system" or "env"/)
  })
})
