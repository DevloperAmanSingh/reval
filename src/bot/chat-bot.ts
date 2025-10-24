import '../utils/fetch-polyfill'

import {info, setFailed, warning} from '@actions/core'

import {AIProvider, ConversationState} from './providers/ai-provider'
import {ProviderFactory, ProviderType} from './providers/provider-factory'
import {Options} from '../config/options'

export class ChatBot {
  private readonly options: Options
  private readonly provider: AIProvider

  constructor(options: Options, providerType: ProviderType, model: string) {
    this.options = options
    this.provider = ProviderFactory.createProvider(
      providerType,
      model,
      options.systemMessage,
      options.language,
      {
        temperature: options.openaiModelTemperature,
        timeout: options.openaiTimeoutMS,
        retries: options.openaiRetries,
        baseUrl: options.apiBaseUrl
      }
    )
  }

  async chat(
    message: string,
    state: ConversationState
  ): Promise<[string, ConversationState]> {
    return this.provider.chat(message, state)
  }

  getTokenCount(text: string): number {
    return this.provider.getTokenCount(text)
  }

  getModelInfo() {
    return this.provider.getModelInfo()
  }
}
