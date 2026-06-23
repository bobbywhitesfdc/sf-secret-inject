import {expect} from 'chai'

import {EnvProvider, refToEnvKey} from '../../../src/lib/providers/env.js'

// ── refToEnvKey helper ────────────────────────────────────────────────────────

describe('refToEnvKey', () => {
  it('replaces dots with underscores and uppercases', () => {
    expect(refToEnvKey('MMMCPDemo.ClientSecret')).to.equal('MMMCPDEMO_CLIENTSECRET')
  })

  it('handles a single-segment ref with no dots', () => {
    expect(refToEnvKey('mytoken')).to.equal('MYTOKEN')
  })

  it('handles multiple dots', () => {
    expect(refToEnvKey('a.b.c.d')).to.equal('A_B_C_D')
  })
})

// ── EnvProvider ───────────────────────────────────────────────────────────────

describe('EnvProvider', () => {
  const provider = new EnvProvider()

  afterEach(() => {
    // Clean up any env vars set during tests.
    delete process.env.MMMCPDEMO_CLIENTSECRET
    delete process.env.BASICCRED_PASSWORD
  })

  it('resolves an env var that is set', async () => {
    process.env.MMMCPDEMO_CLIENTSECRET = 'supersecret'
    const value = await provider.get('MMMCPDemo.ClientSecret', 'any-org')
    expect(value).to.equal('supersecret')
  })

  it('ignores orgAlias — env vars are global to the process', async () => {
    process.env.BASICCRED_PASSWORD = 'p@ssw0rd'
    const value = await provider.get('BasicCred.Password', 'org-one')
    const value2 = await provider.get('BasicCred.Password', 'org-two')
    expect(value).to.equal(value2)
  })

  it('throws with the env var name when the variable is not set', async () => {
    try {
      await provider.get('MMMCPDemo.ClientSecret', 'any-org')
      expect.fail('Expected an error to be thrown')
    } catch (error) {
      const {message} = (error as Error)
      expect(message).to.include('MMMCPDEMO_CLIENTSECRET')
      expect(message).to.include('not set')
    }
  })

  it('throws when the variable is set to empty string', async () => {
    process.env.MMMCPDEMO_CLIENTSECRET = ''
    try {
      await provider.get('MMMCPDemo.ClientSecret', 'any-org')
      expect.fail('Expected an error to be thrown')
    } catch (error) {
      const {message} = (error as Error)
      expect(message).to.include('MMMCPDEMO_CLIENTSECRET')
    }
  })
})
