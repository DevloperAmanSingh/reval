import '../../utils/fetch-polyfill'
import {info, setFailed, warning} from '@actions/core'
import {GoogleGenerativeAI} from '@google/generative-ai'
import pRetry from 'p-retry'

import {
  AIProvider,
  ConversationState,
  ModelInfo,
  ProviderConfig
} from './ai-provider'

export class GeminiProvider implements AIProvider {
  private readonly model: any
  private readonly config: ProviderConfig
  private readonly generationConfig: any

  constructor(config: ProviderConfig, systemMessage: string, language: string) {
    this.config = config
    this.generationConfig = {
      temperature: Math.max(config.temperature, 0.1), // Ensure some creativity for finding issues
      maxOutputTokens: this.getMaxOutputTokens(config.model),
      topP: 0.9, // Higher for more diverse responses
      topK: 50 // Higher for more exploration
    }
    this.model = this.createModel(systemMessage, language)
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
      warning(`Failed to chat with Gemini: ${error}`)
      return ['', state]
    }
  }

  getTokenCount(text: string): number {
    // Gemini uses different tokenization, approximate with character count
    return Math.ceil(text.length / 4)
  }

  getModelInfo(): ModelInfo {
    return {
      name: this.config.model,
      maxTokens: this.getMaxTokens(this.config.model),
      responseTokens: this.getMaxOutputTokens(this.config.model),
      knowledgeCutOff: '2024-04-09' // Gemini's knowledge cutoff
    }
  }

  private createModel(systemMessage: string, language: string): any {
    if (!this.config.apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not available')
    }

    const genAI = new GoogleGenerativeAI(this.config.apiKey)
    const model = genAI.getGenerativeModel({
      model: this.config.model,
      generationConfig: this.generationConfig,
      systemInstruction: this.composeSystemMessage(systemMessage, language)
    })

    return model
  }

  private composeSystemMessage(
    systemMessage: string,
    language: string
  ): string {
    const currentDate = new Date().toISOString().split('T')[0]
    const prefix = systemMessage ? `${systemMessage}\n` : ''

    return `${prefix}Knowledge cutoff: 2024-04-09
Current date: ${currentDate}

IMPORTANT: Entire response must be in the language with ISO code: ${language}

You are an expert code reviewer. Provide specific, actionable feedback on code changes.
Focus on:
- Security vulnerabilities
- Performance issues  
- Code quality and maintainability
- Best practices and patterns
- Potential bugs and edge cases

Be concise, professional, and constructive in your feedback.`
  }

  private async executeChat(
    message: string,
    state: ConversationState
  ): Promise<[string, ConversationState]> {
    const startedAt = Date.now()

    let response
    try {
      response = await pRetry(() => this.model.generateContent(message), {
        retries: this.config.retries
      })
    } catch (error: unknown) {
      info(`Gemini response failed: ${error}`)
      return ['', state]
    }

    const endedAt = Date.now()
    info(`Gemini response time: ${endedAt - startedAt} ms`)

    const text = this.extractMessageText(response)
    const nextState: ConversationState = {
      parentMessageId: `gemini-${Date.now()}`, // Gemini doesn't have message IDs
      conversationId: state.conversationId || `conv-${Date.now()}`,
      provider: 'gemini'
    }

    return [text, nextState]
  }

  private extractMessageText(response: any): string {
    if (!response || !response.response) {
      warning('Gemini response is null')
      return ''
    }

    try {
      const text = response.response.text()
      return text || ''
    } catch (error) {
      warning(`Failed to extract text from Gemini response: ${error}`)
      return ''
    }
  }

  private getMaxTokens(model: string): number {
    const limits: Record<string, number> = {
      'gemini-pro': 30720,
      'gemini-pro-vision': 12288,
      'gemini-1.5-pro': 2097152,
      'gemini-1.5-flash': 1048576
    }
    return limits[model] || 30720
  }

  private getMaxOutputTokens(model: string): number {
    const limits: Record<string, number> = {
      'gemini-pro': 8192,
      'gemini-pro-vision': 4096,
      'gemini-1.5-pro': 8192,
      'gemini-1.5-flash': 8192
    }
    return limits[model] || 8192
  }
}
