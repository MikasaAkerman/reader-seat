/** 与产品 §15.2、§15.3 以及 generation schema 对齐的输出示例。 */
export const ROUGH_JSON_EXAMPLE = `{
  "paragraphs": [
    {
      "pid": "p3",
      "score": 2,
      "comments": [
        { "author_type": "resident", "reader_role": "毒舌", "text": "评论正文" },
        { "author_type": "passerby", "display_name": "路人昵称", "text": "评论正文" }
      ]
    },
    {
      "pid": "p7",
      "score": 3,
      "comments": [{ "author_type": "resident", "reader_role": "头回读", "text": "占位短评" }],
      "prediction_hits": [{ "prediction_id": "pr_12", "result": "打脸" }]
    }
  ],
  "new_entities": ["首次出现的人名或地名"]
}`

export const ROUGH_JSONL_EXAMPLE = [
  '{"pid":"p1","score":0,"comments":[]}',
  '{"pid":"p2","score":2,"comments":[{"author_type":"resident","reader_role":"毒舌","text":"评论正文"},{"author_type":"passerby","display_name":"路人昵称","text":"评论正文"}],"new_entities":["本段首次出现的人名或地名"]}',
  '{"pid":"p3","score":3,"comments":[{"author_type":"resident","reader_role":"头回读","text":"占位短评"}],"prediction_hits":[{"prediction_id":"pr_12","result":"打脸"}]}',
].join('\n')

export const REFINE_JSON_EXAMPLE = `{
  "pid": "p7",
  "threads": [
    {
      "root": {
        "author_type": "resident",
        "reader_role": "头回读",
        "text": "主楼正文",
        "uses_outside_plot": false
      },
      "replies": [
        {
          "author_type": "resident",
          "reader_role": "毒舌",
          "reply_type": "反驳",
          "text": "回复正文",
          "uses_outside_plot": false
        },
        {
          "author_type": "passerby",
          "display_name": "路人昵称",
          "reply_type": "接梗",
          "text": "回复正文",
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
