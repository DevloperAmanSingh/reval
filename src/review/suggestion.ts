export interface Suggestion {
  path: string
  startLine: number
  endLine: number
  replacement: string
  title?: string
  rationale?: string
  confidence?: 'low' | 'med' | 'high'
}

export function toSuggestionBlock(s: Suggestion): string {
  const header = s.title ? `**${s.title}**\n\n` : ''
  const rationale =
    s.rationale && s.rationale.trim().length > 0
      ? `${s.rationale.trim()}\n\n`
      : ''

  return `${header}${rationale}\`\`\`suggestion
${s.replacement}
\`\`\``
}
