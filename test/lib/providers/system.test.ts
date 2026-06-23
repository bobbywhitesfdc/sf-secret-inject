import {expect} from 'chai'

import {SystemKeychainProvider} from '../../../src/lib/providers/system.js'

/**
 * Unit tests for SystemKeychainProvider.
 *
 * We cannot call the real `security` or `secret-tool` binaries in CI, so
 * tests that would hit the actual keychain are guarded by platform checks
 * or rely on a ref that is guaranteed not to exist.
 *
 * The primary goals here are:
 * 1. Confirm the Windows guard throws with a useful message.
 * 2. Confirm the scoped account format is constructed correctly.
 * 3. Confirm that a missing keychain entry surfaces a useful error message.
 */
describe('SystemKeychainProvider', () => {
  const provider = new SystemKeychainProvider()

  describe('Windows platform guard', () => {
    let originalPlatform: PropertyDescriptor | undefined

    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    })

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    })

    it('throws on win32 with a remediation message', async () => {
      Object.defineProperty(process, 'platform', {value: 'win32'})

      try {
        await provider.get('SomeCred.ClientSecret', 'myOrg')
        expect.fail('Expected an error to be thrown')
      } catch (error) {
        const {message} = (error as Error)
        expect(message).to.include('Windows keychain is not supported')
        expect(message).to.include('--source env')
      }
    })
  })

  describe('scoped account format', () => {
    it('constructs scopedAccount as {orgAlias}.{ref}', () => {
      // We verify the format indirectly: on non-Windows platforms, a call
      // with a nonexistent account must throw an error containing the
      // expected scopedAccount string.
      if (process.platform === 'win32') return // skip

      // Use a ref that is guaranteed not to exist so the keychain lookup fails
      // in a controlled and fast way.
      const ref = `test-ref-that-does-not-exist-${Date.now()}`
      const orgAlias = `test-org-${Date.now()}`
      const expectedAccount = `${orgAlias}.${ref}`

      return provider.get(ref, orgAlias).then(
        () => {
          expect.fail('Expected the keychain lookup to fail')
        },
        (error: Error) => {
          expect(error.message).to.include(expectedAccount)
        },
      )
    })
  })

  describe('missing secret error messages', () => {
    it('includes the service name in the error on darwin/linux', () => {
      if (process.platform === 'win32') return // skip

      return provider.get(`no-such-secret-${Date.now()}`, 'no-such-org').then(
        () => {
          expect.fail('Expected an error')
        },
        (error: Error) => {
          expect(error.message).to.include('sf-secret-inject')
          expect(error.message).to.include('sf secret store')
        },
      )
    })
  })
})
