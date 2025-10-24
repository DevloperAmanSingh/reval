import {getInput, setFailed, warning} from '@actions/core'

import {ChatBot} from '../bot/chat-bot'
import {OpenAIOptions, Options} from '../config/options'
import {PromptLibrary} from '../prompts/templates'
import {handleReviewComment} from '../review/comment-responder'
import {ReviewOrchestrator} from '../review/review-orchestrator'

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
    openaiLightModel: getInput('openai_light_model'),
    openaiHeavyModel: getInput('openai_heavy_model'),
    language: getInput('language'),
    summarize: getInput('summarize'),
    summarizeReleaseNotes: getInput('summarize_release_notes')
  })

const createBots = (
  options: Options
): {lightBot: ChatBot | null; heavyBot: ChatBot | null} => {
  let lightBot: ChatBot | null = null
  let heavyBot: ChatBot | null = null
  try {
    lightBot = new ChatBot(
      options,
      new OpenAIOptions(options.openaiLightModel, options.lightTokenLimits)
    )
  } catch (error: any) {
    warning(
      `Skipped: failed to create summary bot, please check your openai_api_key: ${error}, backtrace: ${error.stack}`
    )
  }

  try {
    heavyBot = new ChatBot(
      options,
      new OpenAIOptions(options.openaiHeavyModel, options.heavyTokenLimits)
    )
  } catch (error: any) {
    warning(
      `Skipped: failed to create review bot, please check your openai_api_key: ${error}, backtrace: ${error.stack}`
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
  options.print()
  const prompts = buildPrompts(options)

  const {lightBot, heavyBot} = createBots(options)
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
