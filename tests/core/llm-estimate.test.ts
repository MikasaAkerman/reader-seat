import { describe, expect, it } from 'vitest'
import { estimateCost } from '@/core/llm'

describe('estimateCost', () => {
  it('computes cost from usage and pricing', () => {
    const cost = estimateCost(
      { promptTokens: 1_000_000, completionTokens: 500_000, cacheHitTokens: 250_000 },
      { inputHitPerMTok: 0.1, inputMissPerMTok: 1, outputPerMTok: 2 },
    )
    // hit 0.25*0.1 + miss 0.75*1 + out 0.5*2 = 0.025 + 0.75 + 1 = 1.775
    expect(cost).toBeCloseTo(1.775)
  })
})
