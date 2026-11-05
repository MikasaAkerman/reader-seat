/** 阅读计划十二站，对应 docs/reading_plan.md。 */
export interface ReadingStation {
  id: number
  name: string
  question: string
  tools: string[]
  lenses: string
}

export const READING_STATIONS: ReadingStation[] = [
  {
    id: 1,
    name: '地基：细节与潜文本',
    question: '一个判断如何落到具体的词句上？',
    tools: ['冰山', '潜文本'],
    lenses: '正方可细读具体词句；反方参考桑塔格《反对阐释》：不必急着把细节读成象征。',
  },
  {
    id: 2,
    name: '现实主义：叙述者的声音',
    question: '叙述者在哪里退场，人物的声音在哪里浮现？',
    tools: ['自由间接引语', '白描式反讽'],
    lenses: '可对照纳博科夫论福楼拜与奥尔巴赫论现实主义的分歧。',
  },
  {
    id: 3,
    name: '史诗、悲剧与框架',
    question: '「发现—突转」这类结构如何运作？',
    tools: ['发现与突转', '环形结构', '框形叙事'],
    lenses: '可参考奥尔巴赫从具体段落推出大论断的读法，以及本雅明谈叙事与经验。',
  },
  {
    id: 4,
    name: '反讽与现代自我',
    question: '反讽如何塑造人物与读者的距离？',
    tools: ['三种反讽', '元叙事'],
    lenses: '可把艾略特对《哈姆雷特》的指责当作反方：这部作品是否在艺术上失败。',
  },
  {
    id: 5,
    name: '一部小说如何装下一个时代',
    question: '全景史诗与网状家族叙事各靠什么组织经验？',
    tools: ['全知介入', '网状叙事'],
    lenses: '《红楼梦》一侧可对照王国维与余英时；史诗一侧可对照伯林谈刺猬与狐狸。',
  },
  {
    id: 6,
    name: '复调与精神极限',
    question: '多个声音如何并列，而不被作者收编？',
    tools: ['复调'],
    lenses: '正方可用巴赫金的复调；反方参考纳博科夫对陀思妥耶夫斯基的贬斥。只作分析视角，不剧透后文。',
  },
  {
    id: 7,
    name: '边缘人与叙述的可靠性',
    question: '叙述者设置如何影响读者对主人公的信任？',
    tools: ['不可靠叙述', '嵌套叙述'],
    lenses: '可对照伍尔夫评《简·爱》与《呼啸山庄》的褒贬判断。',
  },
  {
    id: 8,
    name: '时间与意识',
    question: '时间在叙述里是被唤醒、被拉长，还是被留白？',
    tools: ['非自愿记忆', '意识流两种模式'],
    lenses: '可对照纳博科夫论普鲁斯特与本雅明《普鲁斯特的形象》。',
  },
  {
    id: 9,
    name: '荒诞与现代性',
    question: '荒诞是靠取消修辞，还是靠反讽和温度？',
    tools: ['白色写作', '荒诞'],
    lenses: '卡夫卡一侧可在加缪与博尔赫斯之间选边；不要把后文结局写进来。',
  },
  {
    id: 10,
    name: '打破时间与空间',
    question: '循环、预叙或多视角具体靠哪些句法与结构手段？',
    tools: ['预叙', '循环时间', '多视角'],
    lenses: '作者自述只是待检验的证词，必须回到眼前文本。',
  },
  {
    id: 11,
    name: '殖民之后',
    question: '审美评价与权力批判如何同时成立？',
    tools: ['他者化', '悲剧英雄'],
    lenses: '可把萨义德、阿契贝对《黑暗之心》的指控当作必须回应的反方。',
  },
  {
    id: 12,
    name: '终点：没有定论的新作',
    question: '没有定论时，你自己的判断标准是什么？',
    tools: ['判断', '证据', '保留'],
    lenses: '先依据眼前文本立论，再决定要不要动用背景知识。',
  },
]

export function stationById(id: number | null | undefined): ReadingStation | undefined {
  if (!id) return undefined
  return READING_STATIONS.find((station) => station.id === id)
}

export function stationLensOf(id: number | null | undefined): string {
  const station = stationById(id)
  if (!station) return ''
  return [`第${station.id}站 ${station.name}`, `核心问题：${station.question}`, `工具：${station.tools.join('、')}`, station.lenses].join('\n')
}
