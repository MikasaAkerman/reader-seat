import type { PasserbyProfile } from '../types'

const REACTIONS = ['情绪反应', '吐槽', '疑问', '联想', '补充', '质疑', '预测', '短评']
const STANCES = ['赞同', '反对', '部分认同', '替代解释']
const STYLES = ['简短口语', '认真分析', '幽默', '感性', '克制']
const BACKGROUNDS = ['初读', '读过类似题材', '喜欢抠句子', '习惯站队', '只看人物', '在意译本']

function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(list: readonly T[], seed: string, salt: string): T {
  const index = fnv1a(`${seed}:${salt}`) % list.length
  return list[index]!
}

export function samplePassersby(seed: string, count: number): PasserbyProfile[] {
  const result: PasserbyProfile[] = []
  const seen = new Set<string>()
  let n = 0
  while (result.length < count && n < 400) {
    const dims: PasserbyProfile['sampledDims'] = [
      pick(REACTIONS, seed, `r${n}`),
      pick(STANCES, seed, `s${n}`),
      pick(STYLES, seed, `y${n}`),
      pick(BACKGROUNDS, seed, `b${n}`),
    ]
    const key = dims.join('|')
    if (!seen.has(key)) {
      seen.add(key)
      result.push({
        displayName: `路人·${dims[3]}·${dims[0]}`,
        sampledDims: dims,
      })
    }
    n += 1
  }
  return result
}
