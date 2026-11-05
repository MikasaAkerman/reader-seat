export {
  extractQuoted,
  normalize,
  quotesInTextPass,
  quoteLength,
  verifyQuote,
} from './quote'
export { charBigrams, containment, diversityScore, isNearDuplicate, jaccard, stripForCompare } from './similarity'
export { retrievePassages, type Passage } from './retrieve'
export {
  addDropped,
  dropRate,
  emptyDropped,
  gateComment,
  markDropped,
  type DroppedCounts,
  type DropReason,
} from './gate'
