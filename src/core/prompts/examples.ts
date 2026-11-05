export const OBSERVE_JSON_EXAMPLE = `{
  "paragraphs": [
    {
      "pid": "p3",
      "score": 2,
      "observations": [
        { "oid": "o1", "kind": "矛盾", "quote": "原文短引", "point": "一句话的观察" }
      ]
    },
    {
      "pid": "p7",
      "score": 3,
      "observations": [
        { "oid": "o2", "kind": "动机", "quote": "原文短引", "point": "人物为什么这样做" },
        { "oid": "o3", "kind": "修辞", "quote": "原文短引", "point": "这一处手法" }
      ],
      "prediction_hits": [{ "prediction_id": "pr_12", "result": "打脸" }]
    }
  ],
  "hot_pids": ["p7"],
  "new_entities": ["首次出现的人名或地名"]
}`

export const VOICE_JSONL_EXAMPLE = [
  '{"cid":"c1","text":"评论正文","quote":"原文短引","uses_outside_plot":false}',
  '{"cid":"c2","text":"另一条","quote":"原文短引","uses_outside_plot":false}',
].join('\n')

export const REFINE_JSON_EXAMPLE = `{
  "pid": "p7",
  "threads": [
    {
      "root": {
        "author_type": "resident",
        "reader_role": "头回读",
        "text": "主楼正文",
        "quote": "原文短引",
        "uses_outside_plot": false
      },
      "replies": [
        {
          "author_type": "resident",
          "reader_role": "毒舌",
          "reply_type": "反驳",
          "text": "回复正文",
          "quote": "原文短引",
          "uses_outside_plot": false
        }
      ]
    }
  ],
  "memory_updates": {
    "nicknames": [{ "character": "人物名", "nickname": "外号", "by": "毒舌" }],
    "predictions": [{ "by": "头回读", "content": "预测内容" }],
    "debates": [{ "topic": "争议话题", "sides": { "头回读": "立场", "毒舌": "立场" } }],
    "resident_stance_changes": []
  }
}`

export const DEEP_JSON_EXAMPLE = `{
  "thesis": {
    "author": "课代表",
    "title": "一句话论点",
    "body": "400到800字的主评",
    "evidence": [{ "pid": "p12", "quote": "原文短引" }, { "pid": "p14", "quote": "另一处原文" }],
    "reservation": "还不能确定的一点"
  },
  "rebuttal": {
    "author": "毒舌",
    "body": "200到500字，回应主评并给出替代解读",
    "evidence": [{ "pid": "p12", "quote": "原文短引" }]
  },
  "background": "可选的批评观点或创作背景，不得涉及本书后文",
  "question": "留给读者的一个问题"
}`

export const DEEP_PLAN_EXAMPLE = `{
  "spots": [
    { "start_pid": "p10", "end_pid": "p18", "label": "场景短名", "why": "为什么值得深读", "lens": "分析视角" }
  ]
}`
