import {type Suggestion} from './suggestion'

export interface SuggestionExtractionResult {
  comment: string
  suggestion: Suggestion | null
}

export function extractSuggestion(
  markdown: string,
  defaults: {path: string; startLine: number; endLine: number}
): SuggestionExtractionResult {
  const suggestRegex = /<SUGGEST\b([^>]*)>([\s\S]*?)<\/SUGGEST>/i
  const match = markdown.match(suggestRegex)

  if (!match) {
    return {
      comment: markdown.trim(),
      suggestion: null
    }
  }

  const [, rawAttributes, rawReplacement] = match
  const attrs = parseAttributes(rawAttributes ?? '')

  const replacement = sanitizeReplacement(rawReplacement)
  if (!replacement) {
    return {
      comment: stripSuggestionBlock(markdown, match[0]),
      suggestion: null
    }
  }

  const startLine = parseLineNumber(
    attrs.start ?? attrs.start_line ?? attrs.line,
    defaults.startLine
  )
  const endLine = parseLineNumber(
    attrs.end ?? attrs.end_line ?? attrs.line,
    defaults.endLine
  )
  const path = typeof attrs.path === 'string' && attrs.path.trim().length > 0
    ? attrs.path.trim()
    : defaults.path

  const suggestion: Suggestion = {
    path,
    startLine,
    endLine,
    replacement,
    title: typeof attrs.title === 'string' ? attrs.title.trim() : undefined,
    confidence: normalizeConfidence(attrs.confidence),
    rationale: ''
  }

  const comment = stripSuggestionBlock(markdown, match[0])
  suggestion.rationale = comment.trim()

  return {
    comment: suggestion.rationale,
    suggestion
  }
}

function parseAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const attrRegex =
    /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g

  let match: RegExpExecArray | null
  while ((match = attrRegex.exec(input)) !== null) {
    const [, key, valueDouble, valueSingle, valueBare] = match
    const value = valueDouble ?? valueSingle ?? valueBare ?? ''
    attributes[key] = value
  }

  return attributes
}

function sanitizeReplacement(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.replace(/^\s*\n?/, '').replace(/\s*$/, '')
  if (trimmed.includes('```')) {
    return ''
  }
  return trimmed
}

function stripSuggestionBlock(comment: string, block: string): string {
  return comment.replace(block, '').trim()
}

function parseLineNumber(
  raw: string | undefined,
  fallback: number
): number {
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeConfidence(
  raw: string | undefined
): 'low' | 'med' | 'high' | undefined {
  if (!raw) return undefined
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'high' || normalized === 'med' || normalized === 'low') {
    return normalized
  }
  return undefined
}
