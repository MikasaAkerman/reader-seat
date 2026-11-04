import { describe, expect, it } from 'vitest'
import { fingerprintBytes } from '@/core/epub/hash'

describe('fingerprintBytes', () => {
  it('matches SHA-256 when the page has no crypto.subtle', async () => {
    const samples = [new Uint8Array(), new TextEncoder().encode('abc'), new Uint8Array(60).fill(0x61)]
    const expected = await Promise.all(samples.map((sample) => fingerprintBytes(sample)))
    const subtle = crypto.subtle
    Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined })
    try {
      for (let i = 0; i < samples.length; i++) {
        await expect(fingerprintBytes(samples[i])).resolves.toBe(expected[i])
      }
      await expect(fingerprintBytes(new TextEncoder().encode('abc'))).resolves.toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      )
    } finally {
      Object.defineProperty(crypto, 'subtle', { configurable: true, value: subtle })
    }
  })
})
