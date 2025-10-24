import {info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import {type ChatBot} from '../bot/chat-bot'
import {Commenter} from '../github/commenter'
import {
  COMMENT_REPLY_TAG,
  COMMENT_TAG,
  SUMMARIZE_TAG
} from '../github/comment-tags'
import {Inputs} from '../shared/inputs'
import {octokit} from '../github/octokit'
import {type Options} from '../config/options'
import {type PromptLibrary} from '../prompts/templates'
import {getTokenCount} from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo
const ASK_BOT = '@reval-bot'

const isReviewCommentEvent = (): boolean =>
  context.eventName === 'pull_request_review_comment'

const isBotAuthored = (body: string): boolean =>
  body.includes(COMMENT_TAG) || body.includes(COMMENT_REPLY_TAG)

const shouldRespondToChain = (chain: string, body: string): boolean =>
  chain.includes(COMMENT_TAG) ||
  chain.includes(COMMENT_REPLY_TAG) ||
  body.includes(ASK_BOT)

const replyWithNotice = async (
  commenter: Commenter,
  pullNumber: number,
  topLevelComment: any,
  message: string
): Promise<void> => {
  await commenter.reviewCommentReply(pullNumber, topLevelComment, message)
}

const fetchFileDiff = async (
  filename: string,
  baseSha: string,
  headSha: string
): Promise<string> => {
  try {
    const diffAll = await octokit.repos.compareCommits({
      owner: repo.owner,
      repo: repo.repo,
      base: baseSha,
      head: headSha
    })
    const files = diffAll.data?.files ?? []
    const target = files.find(file => file.filename === filename)
    return target?.patch ?? ''
  } catch (error) {
    warning(`Failed to get file diff: ${error}, skipping.`)
    return ''
  }
}

export const handleReviewComment = async (
  heavyBot: ChatBot,
  options: Options,
  prompts: PromptLibrary
) => {
  const commenter: Commenter = new Commenter()
  const inputs: Inputs = new Inputs()

  if (!isReviewCommentEvent()) {
    warning(
      `Skipped: ${context.eventName} is not a pull_request_review_comment event`
    )
    return
  }

  if (!context.payload) {
    warning(`Skipped: ${context.eventName} event is missing payload`)
    return
  }

  const {comment, pull_request: pullRequest} = context.payload
  if (!comment) {
    warning(`Skipped: ${context.eventName} event is missing comment`)
    return
  }
  if (pullRequest == null || context.payload.repository == null) {
    warning(`Skipped: ${context.eventName} event is missing pull_request`)
    return
  }

  inputs.title = pullRequest.title
  if (pullRequest.body) {
    inputs.description = commenter.getDescription(pullRequest.body)
  }

  // check if the comment was created and not edited or deleted
  if (context.payload.action !== 'created') {
    warning(`Skipped: ${context.eventName} event is not created`)
    return
  }

  // Check if the comment is not from the bot itself
  if (isBotAuthored(comment.body)) {
    info(`Skipped: ${context.eventName} event is from the bot itself`)
    return
  }

  const pullNumber = pullRequest.number
  inputs.comment = `${comment.user.login}: ${comment.body}`
  inputs.diff = comment.diff_hunk
  inputs.filename = comment.path

  const {chain: commentChain, topLevelComment} =
    await commenter.getCommentChain(pullNumber, comment)

  if (!topLevelComment) {
    warning('Failed to find the top-level comment to reply to')
    return
  }

  inputs.commentChain = commentChain

  if (!shouldRespondToChain(commentChain, comment.body)) {
    return
  }

  let fileDiff = await fetchFileDiff(
    comment.path,
    pullRequest.base.sha,
    pullRequest.head.sha
  )

  if (!inputs.diff.length) {
    if (fileDiff.length > 0) {
      inputs.diff = fileDiff
      fileDiff = ''
    } else {
      await replyWithNotice(
        commenter,
        pullNumber,
        topLevelComment,
        'Cannot reply to this comment as diff could not be found.'
      )
      return
    }
  }

  let tokens = getTokenCount(prompts.renderComment(inputs))

  if (tokens > options.heavyTokenLimits.requestTokens) {
    await replyWithNotice(
      commenter,
      pullNumber,
      topLevelComment,
      'Cannot reply to this comment as diff being commented is too large and exceeds the token limit.'
    )
    return
  }

  if (fileDiff.length > 0) {
    const placeholderCount = prompts.comment.split('$file_diff').length - 1
    const fileDiffTokens = getTokenCount(fileDiff)
    const projected = tokens + fileDiffTokens * placeholderCount
    if (
      placeholderCount > 0 &&
      projected <= options.heavyTokenLimits.requestTokens
    ) {
      tokens = projected
      inputs.fileDiff = fileDiff
    }
  }

  const summary = await commenter.findCommentWithTag(SUMMARIZE_TAG, pullNumber)
  if (summary) {
    const shortSummary = commenter.getShortSummary(summary.body)
    const shortSummaryTokens = getTokenCount(shortSummary)
    if (tokens + shortSummaryTokens <= options.heavyTokenLimits.requestTokens) {
      tokens += shortSummaryTokens
      inputs.shortSummary = shortSummary
    }
  }

  const [reply] = await heavyBot.chat(prompts.renderComment(inputs), {})
  await commenter.reviewCommentReply(pullNumber, topLevelComment, reply)
}
