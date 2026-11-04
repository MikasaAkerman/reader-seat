import type { BlockParagraph, TextBlock } from '../types'

const BLOCK_TARGET_CHARS = 1500
const BLOCK_MAX_PARAS = 15
const BLOCK_MAX_CHARS = 3000

export function splitParagraphs(source: string): string[] {
  return source
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** 累积到 1500 字或 15 段结束；已有内容时不再塞进会超过 3000 字的下一段。 */
export function planBlocks(paragraphs: string[]): TextBlock[] {
  const blocks: TextBlock[] = []
  let current: BlockParagraph[] = []
  let chars = 0

  const flush = () => {
    if (current.length === 0) return
    blocks.push({ paragraphs: current })
    current = []
    chars = 0
  }

  for (const text of paragraphs) {
    if (current.length > 0 && chars + text.length > BLOCK_MAX_CHARS) flush()
    current.push({ index: current.length + 1, text })
    chars += text.length
    if (current.length >= BLOCK_MAX_PARAS || chars >= BLOCK_TARGET_CHARS) flush()
  }
  flush()
  return blocks
}

export function formatBlock(block: TextBlock, untilIndex?: number): string {
  return block.paragraphs
    .filter((p) => untilIndex === undefined || p.index <= untilIndex)
    .map((p) => `p${p.index} ${p.text}`)
    .join('\n')
}
