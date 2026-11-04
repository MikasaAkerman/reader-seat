import type { Phase0Paragraph } from './phase0'

export type Phase0Mark = '有趣' | '无聊' | '剧透' | '错误'

export interface Phase0ExportMark {
  id: string
  mark: Phase0Mark
  text: string
  displayName: string
  paragraphIndex: number
  score: number
}

export interface Phase0Export {
  promptVersion: number
  opensByDay: Record<string, number>
  marks: Phase0ExportMark[]
}

export function localDateKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function bumpOpens(
  opens: Record<string, number>,
  date = new Date(),
): Record<string, number> {
  const key = localDateKey(date)
  return { ...opens, [key]: (opens[key] ?? 0) + 1 }
}

function locate(paragraphs: Phase0Paragraph[], id: string) {
  for (const paragraph of paragraphs) {
    for (const comment of paragraph.comments) {
      if (comment.id === id) {
        return {
          text: comment.text,
          displayName: comment.displayName,
          paragraphIndex: paragraph.index,
          score: paragraph.score,
        }
      }
      for (const reply of comment.replies) {
        if (reply.id === id) {
          return {
            text: reply.text,
            displayName: reply.displayName,
            paragraphIndex: paragraph.index,
            score: paragraph.score,
          }
        }
      }
    }
  }
  return null
}

export function buildPhase0Export(input: {
  promptVersion: number
  opensByDay: Record<string, number>
  marks: Record<string, Phase0Mark>
  paragraphs: Phase0Paragraph[]
}): Phase0Export {
  return {
    promptVersion: input.promptVersion,
    opensByDay: input.opensByDay,
    marks: Object.entries(input.marks).map(([id, mark]) => {
      const found = locate(input.paragraphs, id)
      return {
        id,
        mark,
        text: found?.text ?? '',
        displayName: found?.displayName ?? '',
        paragraphIndex: found?.paragraphIndex ?? -1,
        score: found?.score ?? 0,
      }
    }),
  }
}
