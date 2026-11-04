import type { UnlockMode } from '../types'

/** 章末解锁时，段评和本章说先藏起来，直到本章读完并写过微评。 */
export function commentsHidden(mode: UnlockMode, chapterDone: boolean, hasMicroReview: boolean): boolean {
  return mode === '章末解锁' && !(chapterDone && hasMicroReview)
}

/** 逐段先写后看：这一段还没有自己的段评或划线时，评论先不给看。 */
export function paragraphLocked(mode: UnlockMode, hasOwnWords: boolean): boolean {
  return mode === '逐段先写后看' && !hasOwnWords
}
