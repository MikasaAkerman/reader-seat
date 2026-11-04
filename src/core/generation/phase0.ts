import { estimateCost, type LlmClient, type LlmUsage, type Pricing } from '../llm'
import { applyMemoryUpdates, emptyMemory, formatMemoryForPrompt } from '../memory/apply'
import { PROMPT_VERSION } from '../prompts'
import type { BookMemory } from '../types'
import { formatBlock, planBlocks, splitParagraphs } from './blocks'
import { runRefine } from './refine'
import { runRough } from './rough'
import type { RefineThread, RoughComment } from './schema'

export interface Phase0Comment {
  id: string
  authorType: 'resident' | 'passerby'
  displayName: string
  text: string
  replies: Phase0Reply[]
}

export interface Phase0Reply {
  id: string
  authorType: 'resident' | 'passerby'
  displayName: string
  text: string
  replyType?: string
}

export interface Phase0Paragraph {
  index: number
  text: string
  score: number
  comments: Phase0Comment[]
}

export interface Phase0Document {
  promptVersion: number
  title: string
  paragraphs: Phase0Paragraph[]
  usage: LlmUsage
  cost: number
}

export interface Phase0Meta {
  title: string
  author?: string
  translator?: string
  spoilerLevel?: string
  pricing?: Pricing
}

const DEFAULT_PRICING: Pricing = {
  inputHitPerMTok: 0.1,
  inputMissPerMTok: 1,
  outputPerMTok: 2,
}

function displayName(comment: { author_type: string; reader_role?: string; display_name?: string }): string {
  if (comment.author_type === 'resident') return comment.reader_role || '常驻书友'
  return comment.display_name || '路人'
}

function fromRough(comment: RoughComment, id: string): Phase0Comment {
  return {
    id,
    authorType: comment.author_type,
    displayName: displayName(comment),
    text: comment.text,
    replies: [],
  }
}

function fromThread(thread: RefineThread, id: string): Phase0Comment {
  return {
    id,
    authorType: thread.root.author_type,
    displayName: displayName(thread.root),
    text: thread.root.text,
    replies: thread.replies.map((reply, index) => ({
      id: `${id}-r${index + 1}`,
      authorType: reply.author_type,
      displayName: displayName(reply),
      text: reply.text,
      replyType: reply.reply_type,
    })),
  }
}

function addUsage(total: LlmUsage, part: LlmUsage) {
  total.promptTokens += part.promptTokens
  total.completionTokens += part.completionTokens
  total.cacheHitTokens += part.cacheHitTokens
  total.reasoningTokens += part.reasoningTokens
}

function metering(client: LlmClient, total: LlmUsage): LlmClient {
  return {
    chatJson: async (messages, schema, opts) => {
      const out = await client.chatJson(messages, schema, opts)
      addUsage(total, out.usage)
      return out
    },
    chatStream: (messages, onDelta, opts) => client.chatStream(messages, onDelta, opts),
    chatJsonl: (messages, schema, onItem, opts) => client.chatJsonl(messages, schema, onItem, opts),
  }
}

export async function generatePhase0(
  source: string,
  client: LlmClient,
  meta: Phase0Meta,
): Promise<{ document: Phase0Document; memory: BookMemory }> {
  const usage: LlmUsage = { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, reasoningTokens: 0 }
  const metered = metering(client, usage)
  const pricing = meta.pricing ?? DEFAULT_PRICING
  const paragraphs = splitParagraphs(source)
  const blocks = planBlocks(paragraphs)
  const known = new Set<string>()
  let memory = emptyMemory()
  let priorSummary = ''
  let globalIndex = 0
  const output: Phase0Paragraph[] = []

  for (const block of blocks) {
    const rough = await runRough(
      {
        title: meta.title,
        author: meta.author,
        translator: meta.translator,
        spoilerLevel: meta.spoilerLevel ?? '严格',
        memorySnapshot: formatMemoryForPrompt(memory),
        priorSummary,
        blockText: formatBlock(block),
        knownEntities: [...known],
      },
      block,
      metered,
      known,
    )

    for (const local of block.paragraphs) {
      globalIndex += 1
      const paragraph = rough.paragraphs.find((item) => item.pid === `p${local.index}`)
      const text = local.text
      if (paragraph?.score === 3) {
        const refined = await runRefine(
          {
            title: meta.title,
            spoilerLevel: meta.spoilerLevel ?? '严格',
            memorySnapshot: formatMemoryForPrompt(memory),
            priorSummary,
            textUntilHot: formatBlock(block, local.index),
            pid: paragraph.pid,
            hotReason:
              paragraph.prediction_hits.map((hit) => `${hit.prediction_id}:${hit.result}`).join('；') ||
              '粗评分为 3',
            residentState: formatMemoryForPrompt(memory),
          },
          block,
          metered,
          known,
          rough.new_entities,
        )
        memory = applyMemoryUpdates(memory, refined.memory_updates)
        output.push({
          index: globalIndex,
          text,
          score: 3,
          comments: refined.threads.map((thread, index) =>
            fromThread(thread, `p${globalIndex}-t${index + 1}`),
          ),
        })
      } else {
        output.push({
          index: globalIndex,
          text,
          score: paragraph?.score ?? 0,
          comments: (paragraph?.comments ?? []).map((comment, index) =>
            fromRough(comment, `p${globalIndex}-c${index + 1}`),
          ),
        })
      }
    }

    for (const name of rough.new_entities) known.add(name)
    priorSummary = block.paragraphs.map((p) => p.text).join('').slice(0, 400)
  }

  return {
    memory,
    document: {
      promptVersion: PROMPT_VERSION,
      title: meta.title,
      paragraphs: output,
      usage,
      cost: estimateCost(usage, pricing),
    },
  }
}
