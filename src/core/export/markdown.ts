export interface MarkdownNote {
  opening: string
  text: string
}

export interface MarkdownComment {
  text: string
  replies: string[]
}

export interface MarkdownMicro {
  judgment: string
  evidence: string
  reservation: string
}

export interface MarkdownChapter {
  title: string
  notes: MarkdownNote[]
  comments: MarkdownComment[]
  micro?: MarkdownMicro
}

export function paragraphOpening(text: string): string {
  return text.replace(/\s+/g, '').slice(0, 20)
}

export function buildReadingMarkdown(input: {
  title: string
  translator: string
  station: number | null
  exportedAt: string
  chapters: MarkdownChapter[]
  includeReplies: boolean
}): string {
  const head = [
    '---',
    `book: ${input.title}`,
    `translator: ${input.translator}`,
    `station: ${input.station ?? ''}`,
    `exported: ${input.exportedAt}`,
    '---',
    '',
  ]
  const chapters = input.chapters.map((chapter) => {
    const notes = chapter.notes.map((note) => `- 「${note.opening}」：${note.text}`)
    const comments = chapter.comments.flatMap((comment) => {
      const lines = [`- ${comment.text}`]
      if (input.includeReplies) {
        for (const reply of comment.replies) lines.push(`  - ${reply}`)
      }
      return lines
    })
    const micro = chapter.micro
      ? [`判断：${chapter.micro.judgment}`, `证据：${chapter.micro.evidence}`, `保留：${chapter.micro.reservation}`]
      : []
    return [
      `## ${chapter.title || '未命名章节'}`,
      '',
      '### 我的批注',
      ...(notes.length > 0 ? notes : ['- （无）']),
      '',
      '### 我的段评',
      ...(comments.length > 0 ? comments : ['- （无）']),
      '',
      '### 本章微评',
      ...(micro.length > 0 ? micro : ['（无）']),
      '',
    ].join('\n')
  })
  return [...head, ...chapters].join('\n')
}
