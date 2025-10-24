import {info} from '@actions/core'
import {minimatch} from 'minimatch'

import {TokenLimits} from './token-limits'
import type {ProviderType} from '../bot/providers/provider-factory'

export interface OptionsInit {
  systemMessage: string
  language: string
  summarize: string
  summarizeReleaseNotes: string
  aiProvider: string
  model: string
  openaiModel: string
  geminiModel: string
}

export class Options {
  systemMessage: string
  language: string
  summarizePrompt: string
  summarizeReleaseNotesPrompt: string

  aiProvider: string
  model: string
  openaiModel: string
  geminiModel: string

  debug = false
  disableReview = false
  disableReleaseNotes = false
  maxFiles = 0
  reviewSimpleChanges = false
  reviewCommentLGTM = false
  pathFilters: PathFilter
  openaiModelTemperature = 0.0
  openaiRetries = 3
  openaiTimeoutMS = 120000
  openaiConcurrencyLimit = 6
  githubConcurrencyLimit = 6
  apiBaseUrl = 'https://api.openai.com/v1'

  lightTokenLimits: TokenLimits
  heavyTokenLimits: TokenLimits

  constructor(init: OptionsInit) {
    this.systemMessage = init.systemMessage?.trim() ?? ''
    this.language = init.language?.trim() || 'en-US'
    this.summarizePrompt = init.summarize ?? ''
    this.summarizeReleaseNotesPrompt = init.summarizeReleaseNotes ?? ''
    this.aiProvider = init.aiProvider?.trim() || 'auto'

    const sharedModel = init.model?.trim()
    this.openaiModel =
      sharedModel || init.openaiModel?.trim() || 'gpt-3.5-turbo'
    this.geminiModel =
      sharedModel || init.geminiModel?.trim() || 'gemini-2.5-flash'

    this.model = this.getModelForProvider(this.aiProvider as ProviderType)

    this.pathFilters = new PathFilter(null)
    this.lightTokenLimits = new TokenLimits(this.model)
    this.heavyTokenLimits = new TokenLimits(this.model)
  }

  print(): void {
    info(`debug: ${this.debug}`)
    info(`disable_review: ${this.disableReview}`)
    info(`disable_release_notes: ${this.disableReleaseNotes}`)
    info(`max_files: ${this.maxFiles}`)
    info(`review_simple_changes: ${this.reviewSimpleChanges}`)
    info(`review_comment_lgtm: ${this.reviewCommentLGTM}`)
    info(`path_filters: ${this.pathFilters}`)
    info(`system_message: ${this.systemMessage}`)
    info(`ai_provider: ${this.aiProvider}`)
    info(`selected_model: ${this.model}`)
    info(`openai_model: ${this.openaiModel}`)
    info(`gemini_model: ${this.geminiModel}`)
    info(`openai_model_temperature: ${this.openaiModelTemperature}`)
    info(`openai_retries: ${this.openaiRetries}`)
    info(`openai_timeout_ms: ${this.openaiTimeoutMS}`)
    info(`openai_concurrency_limit: ${this.openaiConcurrencyLimit}`)
    info(`github_concurrency_limit: ${this.githubConcurrencyLimit}`)
    info(`summary_token_limits: ${this.lightTokenLimits.string()}`)
    info(`review_token_limits: ${this.heavyTokenLimits.string()}`)
    info(`api_base_url: ${this.apiBaseUrl}`)
    info(`language: ${this.language}`)
  }

  checkPath(path: string): boolean {
    const ok = this.pathFilters.check(path)
    info(`checking path: ${path} => ${ok}`)
    return ok
  }

  getModelForProvider(providerType: ProviderType): string {
    switch (providerType) {
      case 'gemini':
        return this.geminiModel || this.openaiModel
      case 'openai':
        return this.openaiModel || this.geminiModel
      case 'auto':
      default:
        return this.geminiModel || this.openaiModel
    }
  }

  updateSelectedModel(model: string): void {
    this.model = model
    this.lightTokenLimits = new TokenLimits(model)
    this.heavyTokenLimits = new TokenLimits(model)
  }
}

export class PathFilter {
  private readonly rules: Array<[string, boolean]>

  constructor(rules: string[] | null) {
    this.rules = []
    if (rules) {
      for (const rawRule of rules) {
        const rule = rawRule.trim()
        if (!rule) {
          continue
        }
        if (rule.startsWith('!')) {
          this.rules.push([rule.substring(1).trim(), true])
        } else {
          this.rules.push([rule, false])
        }
      }
    }
  }

  check(path: string): boolean {
    if (this.rules.length === 0) {
      return true
    }

    let included = false
    let excluded = false
    let inclusionRuleExists = false

    for (const [rule, exclude] of this.rules) {
      if (minimatch(path, rule)) {
        if (exclude) {
          excluded = true
        } else {
          included = true
        }
      }
      if (!exclude) {
        inclusionRuleExists = true
      }
    }

    return (!inclusionRuleExists || included) && !excluded
  }

  toString(): string {
    return this.rules
      .map(([rule, exclude]) => (exclude ? `!${rule}` : rule))
      .join(', ')
  }
}

export class OpenAIOptions {
  model: string
  tokenLimits: TokenLimits

  constructor(model = 'gpt-3.5-turbo', tokenLimits: TokenLimits | null = null) {
    this.model = model
    this.tokenLimits = tokenLimits ?? new TokenLimits(model)
  }
}
