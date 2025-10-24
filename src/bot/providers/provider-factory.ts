import {getInput} from '@actions/core'

import {AIProvider, ProviderConfig} from './ai-provider'
import {GeminiProvider} from './gemini-provider'
import {OpenAIProvider} from './openai-provider'

export type ProviderType = 'openai' | 'gemini' | 'auto'

export class ProviderFactory {
  static createProvider(
    providerType: ProviderType,
    model: string,
    systemMessage: string,
    language: string,
    options: {
      temperature: number
      timeout: number
      retries: number
      baseUrl?: string
    }
  ): AIProvider {
    const config: ProviderConfig = {
      apiKey: this.getApiKey(providerType),
      model,
      temperature: options.temperature,
      timeout: options.timeout,
      retries: options.retries,
      baseUrl: options.baseUrl
    }

    switch (providerType) {
      case 'openai':
        return new OpenAIProvider(config, systemMessage, language)
      case 'gemini':
        return new GeminiProvider(config, systemMessage, language)
      case 'auto':
        return this.createAutoProvider(config, systemMessage, language)
      default:
        throw new Error(`Unsupported provider type: ${providerType}`)
    }
  }

  private static getApiKey(providerType: ProviderType): string {
    switch (providerType) {
      case 'openai':
        return process.env.OPENAI_API_KEY || getInput('openai_api_key') || ''
      case 'gemini':
        return process.env.GEMINI_API_KEY || getInput('gemini_api_key') || ''
      case 'auto':
        // Auto-select based on available API keys only
        if (process.env.GEMINI_API_KEY || getInput('gemini_api_key')) {
          return process.env.GEMINI_API_KEY || getInput('gemini_api_key') || ''
        }
        if (process.env.OPENAI_API_KEY || getInput('openai_api_key')) {
          return process.env.OPENAI_API_KEY || getInput('openai_api_key') || ''
        }
        return ''
      default:
        throw new Error(`Unsupported provider type: ${providerType}`)
    }
  }

  private static createAutoProvider(
    config: ProviderConfig,
    systemMessage: string,
    language: string
  ): AIProvider {
    // Auto-select based on available API keys and cost
    if (process.env.GEMINI_API_KEY || getInput('gemini_api_key')) {
      return new GeminiProvider(config, systemMessage, language)
    } else if (process.env.OPENAI_API_KEY || getInput('openai_api_key')) {
      return new OpenAIProvider(config, systemMessage, language)
    } else {
      throw new Error(
        'No AI provider API keys available. Please set OPENAI_API_KEY or GEMINI_API_KEY'
      )
    }
  }

  static getAvailableProviders(): ProviderType[] {
    const providers: ProviderType[] = []

    if (process.env.OPENAI_API_KEY || getInput('openai_api_key')) {
      providers.push('openai')
    }

    if (process.env.GEMINI_API_KEY || getInput('gemini_api_key')) {
      providers.push('gemini')
    }

    if (providers.length > 0) {
      providers.push('auto')
    }

    return providers
  }
}
