import '../utils/fetch-polyfill'
import {info, setFailed, warning} from '@actions/core'
import {
  ChatGPTAPI,
  ChatGPTError,
  ChatMessage,
  SendMessageOptions
} from 'chatgpt'
import pRetry from 'p-retry'

import {
  AIProvider,
  ConversationState,
  ModelInfo,
  ProviderConfig
} from './ai-provider'
import {TokenLimits} from '../../config/token-limits'

export class OpenAIProvider implements AIProvider {
  private readonly client: ChatGPTAPI | null
  private readonly config: ProviderConfig
  private readonly tokenLimits: TokenLimits

  constructor(config: ProviderConfig, systemMessage: string, language: string) {
    this.config = config
    this.tokenLimits = new TokenLimits(config.model)
    this.client = this.createClient(systemMessage, language)
  }

  async chat(
    message: string,
    state: ConversationState
  ): Promise<[string, ConversationState]> {
    if (!message.trim()) {
      return ['', state]
    }

    try {
      return await this.executeChat(message, state)
    } catch (error: unknown) {
      if (error instanceof ChatGPTError) {
        warning(
          `Failed to chat with OpenAI: ${error}, backtrace: ${error.stack}`
        )
      }
      return ['', state]
    }
  }

  getTokenCount(text: string): number {
    // Use existing tokenizer
    return this.tokenLimits.getTokenCount(text)
  }

  getModelInfo(): ModelInfo {
    return {
      name: this.config.model,
      maxTokens: this.tokenLimits.maxTokens,
      responseTokens: this.tokenLimits.responseTokens,
      knowledgeCutOff: this.tokenLimits.knowledgeCutOff
    }
  }

  private createClient(
    systemMessage: string,
    language: string
  ): ChatGPTAPI | null {
    if (!this.config.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not available')
    }

    const fullSystemMessage = this.composeSystemMessage(systemMessage, language)

    return new ChatGPTAPI({
      apiBaseUrl: this.config.baseUrl || 'https://api.openai.com/v1',
      apiKey: this.config.apiKey,
      apiOrg: process.env.OPENAI_API_ORG ?? undefined,
      systemMessage: fullSystemMessage,
      maxModelTokens: this.tokenLimits.maxTokens,
      maxResponseTokens: this.tokenLimits.responseTokens,
      completionParams: {
        model: this.config.model,
        temperature: this.config.temperature
      }
    })
  }

  private composeSystemMessage(
    systemMessage: string,
    language: string
  ): string {
    const currentDate = new Date().toISOString().split('T')[0]
    const prefix = systemMessage ? `${systemMessage}\n` : ''

    return `${prefix}Knowledge cutoff: ${this.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${language}
`
  }

  private async executeChat(
    message: string,
    state: ConversationState
  ): Promise<[string, ConversationState]> {
    if (this.client == null) {
      setFailed('The OpenAI API is not initialized')
      return ['', state]
    }

    const startedAt = Date.now()
    const sendOptions: SendMessageOptions = {
      timeoutMs: this.config.timeout,
      parentMessageId: state.parentMessageId
    }

    let response: ChatMessage | undefined
    try {
      response = await pRetry(
        () => this.client!.sendMessage(message, sendOptions),
        {
          retries: this.config.retries
        }
      )
    } catch (error: unknown) {
      if (error instanceof ChatGPTError) {
        info(
          `OpenAI response: ${response}, failed to send message: ${error}, backtrace: ${error.stack}`
        )
      }
    }

    const endedAt = Date.now()
    info(`OpenAI response: ${JSON.stringify(response)}`)
    info(`OpenAI sendMessage response time: ${endedAt - startedAt} ms`)

    const text = this.extractMessageText(response)
    const nextState: ConversationState = {
      parentMessageId: response?.id,
      conversationId: response?.conversationId,
      provider: 'openai'
    }

    return [text, nextState]
  }

  private extractMessageText(response: ChatMessage | undefined): string {
    if (!response) {
      warning('OpenAI response is null')
      return ''
    }

    let output = response.text ?? ''
    if (output.startsWith('with ')) {
      output = output.substring(5)
    }

    return output
  }
}
