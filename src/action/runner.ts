import {getInput, setFailed, warning} from '@actions/core'

import {ChatBot} from '../bot/chat-bot'
import {Options} from '../config/options'
import {PromptLibrary} from '../prompts/templates'
import {handleReviewComment} from '../review/comment-responder'
import {ReviewOrchestrator} from '../review/review-orchestrator'
import {ProviderType} from '../bot/providers/provider-factory'

const attachProcessGuards = (): void => {
  process
    .on('unhandledRejection', (reason, promise) => {
      warning(
        `Unhandled Rejection at Promise: ${reason}, promise is ${promise}`
      )
    })
    .on('uncaughtException', (error: any) => {
      warning(`Uncaught Exception thrown: ${error}, backtrace: ${error.stack}`)
    })
}

const buildOptions = (): Options =>
  new Options({
    systemMessage: getInput('system_message'),
    language: getInput('language'),
    summarize: getInput('summarize'),
    summarizeReleaseNotes: getInput('summarize_release_notes'),
    aiProvider: getInput('ai_provider') || 'auto',
    model:
      getInput('model') ||
      getInput('light_model') ||
      getInput('heavy_model') ||
      '',
    openaiModel:
      getInput('openai_model') ||
      getInput('openai_light_model') ||
      getInput('openai_heavy_model') ||
      '',
    geminiModel:
      getInput('gemini_model') ||
      getInput('gemini_light_model') ||
      getInput('gemini_heavy_model') ||
      ''
  })

const resolveProviderType = (requested: ProviderType): ProviderType => {
  if (requested !== 'auto') {
    return requested
  }

  const hasGemini =
    Boolean(process.env.GEMINI_API_KEY) || Boolean(getInput('gemini_api_key'))
  if (hasGemini) {
    return 'gemini'
  }

  const hasOpenAI =
    Boolean(process.env.OPENAI_API_KEY) || Boolean(getInput('openai_api_key'))
  if (hasOpenAI) {
    return 'openai'
  }

  return 'auto'
}

const createBots = (
  options: Options
): {lightBot: ChatBot | null; heavyBot: ChatBot | null} => {
  let lightBot: ChatBot | null = null
  let heavyBot: ChatBot | null = null

  const requestedProvider = (options.aiProvider || 'auto') as ProviderType
  const providerType = resolveProviderType(requestedProvider)
  const model = options.getModelForProvider(providerType)

  options.aiProvider = providerType
  options.updateSelectedModel(model)

  try {
    lightBot = new ChatBot(options, providerType, model)
  } catch (error: any) {
    warning(
      `Skipped: failed to create summary bot, please check your API keys: ${error}, backtrace: ${error.stack}`
    )
  }

  try {
    heavyBot = new ChatBot(options, providerType, model)
  } catch (error: any) {
    warning(
      `Skipped: failed to create review bot, please check your API keys: ${error}, backtrace: ${error.stack}`
    )
  }

  return {lightBot, heavyBot}
}

const buildPrompts = (options: Options): PromptLibrary => {
  const prompts = new PromptLibrary()
  prompts.summarize = options.summarizePrompt
  prompts.summarizeReleaseNotes = options.summarizeReleaseNotesPrompt
  return prompts
}

export const runAction = async (): Promise<void> => {
  attachProcessGuards()

  const options = buildOptions()
  const prompts = buildPrompts(options)

  const {lightBot, heavyBot} = createBots(options)
  options.print()
  if (!lightBot || !heavyBot) {
    return
  }

  try {
    const eventName = process.env.GITHUB_EVENT_NAME
    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
      const orchestrator = new ReviewOrchestrator()
      await orchestrator.orchestrateReview(lightBot, heavyBot, options, prompts)
    } else if (eventName === 'pull_request_review_comment') {
      await handleReviewComment(heavyBot, options, prompts)
    } else {
      warning('Skipped: this action only works on push events or pull_request')
    }
  } catch (error: any) {
    if (error instanceof Error) {
      setFailed(`Failed to run: ${error.message}, backtrace: ${error.stack}`)
    } else {
      setFailed(`Failed to run: ${error}, backtrace: ${error?.stack}`)
    }
  }
}
