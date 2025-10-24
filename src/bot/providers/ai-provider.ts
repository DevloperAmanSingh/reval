export interface AIProvider {
  chat(
    message: string,
    state: ConversationState
  ): Promise<[string, ConversationState]>
  getTokenCount(text: string): number
  getModelInfo(): ModelInfo
}

export interface ConversationState {
  parentMessageId?: string
  conversationId?: string
  provider?: string
}

export interface ModelInfo {
  name: string
  maxTokens: number
  responseTokens: number
  knowledgeCutOff: string
  costPerToken?: number
}

export interface ProviderConfig {
  apiKey: string
  model: string
  temperature: number
  timeout: number
  retries: number
  baseUrl?: string
}
