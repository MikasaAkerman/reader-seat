/** 本阶段用到的领域类型。模型输出类型由 generation schema 推导，不在这里重复定义。 */

export type SpoilerLevel = '严格' | '可暗示' | '全开放'
export type UnlockMode = '关闭' | '逐段先写后看' | '章末解锁'
export type PredictionStatus = '待验证' | '应验' | '打脸'
export type AuthorType = 'resident' | 'passerby' | 'user'

export interface NicknameEntry {
  character: string
  nickname: string
  by: string
}

export interface Prediction {
  id: string
  by: string
  content: string
  status: PredictionStatus
}

export interface DebateEntry {
  topic: string
  sides: Record<string, string>
}

export interface BookMemory {
  bookId: string
  nicknames: NicknameEntry[]
  predictions: Prediction[]
  debates: DebateEntry[]
  updatedAt: string
}

export interface ResidentPersona {
  role: string
  displayName: string
  voiceSamples: string[]
  focus: string
  taboos: string[]
  relations: { with: string; note: string }[]
}

export interface PasserbyProfile {
  displayName: string
  sampledDims: [string, string, string, string]
}

export interface BlockParagraph {
  /** 块内编号，从 1 起，对应提示词里的 p1 */
  index: number
  text: string
}

export interface TextBlock {
  paragraphs: BlockParagraph[]
}

export type BlockText = TextBlock

export interface GeneratedComment {
  paragraphIndex: number
  text: string
}
