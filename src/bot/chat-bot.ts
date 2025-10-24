import '../utils/fetch-polyfill'

import {info, setFailed, warning} from '@actions/core'
import {
  ChatGPTAPI,
  ChatGPTError,
  ChatMessage,
  SendMessageOptions // eslint-disable-next-line import/no-unresolved
} from 'chatgpt'
import pRetry from 'p-retry'

import {OpenAIOptions, Options} from '../config/options'

export interface ConversationState {
  parentMessageId?: string
  conversationId?: string
}

export class ChatBot {
  private readonly options: Options
  private readonly client: ChatGPTAPI | null

  constructor(options: Options, openaiOptions: OpenAIOptions) {
    this.options = options
    this.client = this.createClient(openaiOptions)
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
        warning(`Failed to chat: ${error}, backtrace: ${error.stack}`)
      }
      return ['', state]
    }
  }

  private createClient(openai: OpenAIOptions): ChatGPTAPI | null {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      const err =
        "Unable to initialize the OpenAI API, both 'OPENAI_API_KEY' environment variable are not available"
      throw new Error(err)
    }

    const systemMessage = this.composeSystemMessage(openai)

    return new ChatGPTAPI({
      apiBaseUrl: this.options.apiBaseUrl,
      apiKey,
      apiOrg: process.env.OPENAI_API_ORG ?? undefined,
      systemMessage,
      debug: this.options.debug,
      maxModelTokens: openai.tokenLimits.maxTokens,
      maxResponseTokens: openai.tokenLimits.responseTokens,
      completionParams: {
        model: openai.model,
        temperature: this.options.openaiModelTemperature
      }
    })
  }

  private composeSystemMessage(openai: OpenAIOptions): string {
    const currentDate = new Date().toISOString().split('T')[0]
    const prefix = this.options.systemMessage
      ? `${this.options.systemMessage}\n`
      : ''

    return `${prefix}Knowledge cutoff: ${openai.tokenLimits.knowledgeCutOff}
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${this.options.language}
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
      timeoutMs: this.options.openaiTimeoutMS,
      parentMessageId: state.parentMessageId
    }

    let response: ChatMessage | undefined
    try {
      response = await pRetry(
        () => this.client!.sendMessage(message, sendOptions),
        {
          retries: this.options.openaiRetries
        }
      )
    } catch (error: unknown) {
      if (error instanceof ChatGPTError) {
        info(
          `response: ${response}, failed to send message to openai: ${error}, backtrace: ${error.stack}`
        )
      }
    }
    const endedAt = Date.now()

    info(`response: ${JSON.stringify(response)}`)
    info(
      `openai sendMessage (including retries) response time: ${endedAt - startedAt} ms`
    )

    const text = this.extractMessageText(response)
    const nextState: ConversationState = {
      parentMessageId: response?.id,
      conversationId: response?.conversationId
    }

    return [text, nextState]
  }

  private extractMessageText(response: ChatMessage | undefined): string {
    if (!response) {
      warning('openai response is null')
      return ''
    }

    let output = response.text ?? ''
    if (output.startsWith('with ')) {
      output = output.substring(5)
    }

    if (this.options.debug) {
      info(`openai responses: ${output}`)
    }

    return output
  }
}
