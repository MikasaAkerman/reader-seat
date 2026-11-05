export function bookInfo(ctx: { title: string; author?: string; translator?: string; spoilerLevel: string }): string {
  return [
    `书名：${ctx.title}`,
    ctx.author ? `作者：${ctx.author}` : '',
    ctx.translator ? `译者：${ctx.translator}` : '',
    `防剧透档位：${ctx.spoilerLevel}`,
  ]
    .filter(Boolean)
    .join('\n')
}
