import {info, warning} from '@actions/core'
import {type ChatBot} from '../bot/chat-bot'
import {Commenter} from '../github/commenter'
import {COMMENT_REPLY_TAG} from '../github/comment-tags'
import {Inputs} from '../shared/inputs'
import {type Options} from '../config/options'
import {type PromptLibrary} from '../prompts/templates'
import {getTokenCount} from './tokenizer'

export interface FileReviewResult {
  reviewCount: number
  lgtmCount: number
  failures: string[]
  skippedDueToSize: boolean
}

export const generateFileReview = async (
  filename: string,
  patches: Array<[number, number, string]>,
  pullRequest: {number: number} | null,
  commenter: Commenter,
  options: Options,
  prompts: PromptLibrary,
  bot: ChatBot,
  inputs: Inputs
): Promise<FileReviewResult> => {
  info(`reviewing ${filename}`)

  const failures: string[] = []
  const clonedInputs: Inputs = inputs.clone()
  clonedInputs.filename = filename

  let tokens = getTokenCount(prompts.renderReviewFileDiff(clonedInputs))
  let patchesToPack = 0
  for (const [, , patch] of patches) {
    const patchTokens = getTokenCount(patch)
    if (tokens + patchTokens > options.heavyTokenLimits.requestTokens) {
      info(
        `only packing ${patchesToPack} / ${patches.length} patches, tokens: ${tokens} / ${options.heavyTokenLimits.requestTokens}`
      )
      if (options.debug) {
        info(`prompt so far: ${prompts.renderReviewFileDiff(clonedInputs)}`)
      }
      break
    }
    tokens += patchTokens
    patchesToPack += 1
  }

  let patchesPacked = 0
  for (const [startLine, endLine, patch] of patches) {
    if (!pullRequest) {
      warning('No pull request found, skipping.')
      continue
    }

    if (patchesPacked >= patchesToPack) {
      info(
        `unable to pack more patches into this request, packed: ${patchesPacked}, total patches: ${patches.length}, skipping.`
      )
      break
    }
    patchesPacked += 1

    let commentChain = ''
    try {
      const allChains = await commenter.getCommentChainsWithinRange(
        pullRequest.number,
        filename,
        startLine,
        endLine,
        COMMENT_REPLY_TAG
      )

      if (allChains.length > 0) {
        info(`Found comment chains: ${allChains} for ${filename}`)
        commentChain = allChains
      }
    } catch (error: any) {
      warning(
        `Failed to get comments: ${error as string}, skipping. backtrace: ${
          error.stack as string
        }`
      )
    }

    const commentChainTokens = getTokenCount(commentChain)
    if (
      tokens + commentChainTokens >
      options.heavyTokenLimits.requestTokens
    ) {
      commentChain = ''
    } else {
      tokens += commentChainTokens
    }

    clonedInputs.patches += `
${patch}
`
    if (commentChain !== '') {
      clonedInputs.patches += `
---comment_chains---
\`\`\`
${commentChain}
\`\`\`
`
    }

    clonedInputs.patches += `
---end_change_section---
`
  }

  if (patchesPacked === 0) {
    return {
      reviewCount: 0,
      lgtmCount: 0,
      failures,
      skippedDueToSize: true
    }
  }

  try {
    const [response] = await bot.chat(
      prompts.renderReviewFileDiff(clonedInputs),
      {}
    )
    if (response === '') {
      info('review: nothing obtained from openai')
      failures.push(`${filename} (no response)`)
      return {reviewCount: 0, lgtmCount: 0, failures, skippedDueToSize: false}
    }

    const reviews = parseReview(response, patches, options.debug)
    let reviewCount = 0
    let lgtmCount = 0

    for (const review of reviews) {
      if (
        !options.reviewCommentLGTM &&
        (review.comment.includes('LGTM') ||
          review.comment.includes('looks good to me'))
      ) {
        lgtmCount += 1
        continue
      }
      try {
        reviewCount += 1
        await commenter.bufferReviewComment(
          filename,
          review.startLine,
          review.endLine,
          `${review.comment}`
        )
      } catch (error: any) {
        failures.push(`${filename} comment failed (${error as string})`)
      }
    }

    return {reviewCount, lgtmCount, failures, skippedDueToSize: false}
  } catch (error: any) {
    warning(
      `Failed to review: ${error as string}, skipping. backtrace: ${
        error.stack as string
      }`
    )
    failures.push(`${filename} (${error as string})`)
    return {reviewCount: 0, lgtmCount: 0, failures, skippedDueToSize: false}
  }
}

interface Review {
  startLine: number
  endLine: number
  comment: string
}

function parseReview(
  response: string,
  patches: Array<[number, number, string]>,
  debug = false
): Review[] {
  const reviews: Review[] = []

  response = sanitizeResponse(response.trim())

  const lines = response.split('\n')
  const lineNumberRangeRegex = /(?:^|\s)(\d+)-(\d+):\s*$/
  const commentSeparator = '---'

  let currentStartLine: number | null = null
  let currentEndLine: number | null = null
  let currentComment = ''

  function storeReview(): void {
    if (currentStartLine !== null && currentEndLine !== null) {
      const review: Review = {
        startLine: currentStartLine,
        endLine: currentEndLine,
        comment: currentComment
      }

      let withinPatch = false
      let bestPatchStartLine = -1
      let bestPatchEndLine = -1
      let maxIntersection = 0

      for (const [startLine, endLine] of patches) {
        const intersectionStart = Math.max(review.startLine, startLine)
        const intersectionEnd = Math.min(review.endLine, endLine)
        const intersectionLength = Math.max(
          0,
          intersectionEnd - intersectionStart + 1
        )

        if (intersectionLength > maxIntersection) {
          maxIntersection = intersectionLength
          bestPatchStartLine = startLine
          bestPatchEndLine = endLine
          withinPatch =
            intersectionLength === review.endLine - review.startLine + 1
        }

        if (withinPatch) break
      }

      if (!withinPatch) {
        if (bestPatchStartLine !== -1 && bestPatchEndLine !== -1) {
          review.comment = `> Note: This review was outside of the patch, so it was mapped to the patch with the greatest overlap. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = bestPatchStartLine
          review.endLine = bestPatchEndLine
        } else {
          review.comment = `> Note: This review was outside of the patch, but no patch was found that overlapped with it. Original lines [${review.startLine}-${review.endLine}]

${review.comment}`
          review.startLine = patches[0][0]
          review.endLine = patches[0][1]
        }
      }

      reviews.push(review)

      info(
        `Stored comment for line range ${currentStartLine}-${currentEndLine}: ${currentComment.trim()}`
      )
    }
  }

  for (const line of lines) {
    const lineNumberRangeMatch = line.match(lineNumberRangeRegex)

    if (lineNumberRangeMatch != null) {
      storeReview()
      currentStartLine = parseInt(lineNumberRangeMatch[1], 10)
      currentEndLine = parseInt(lineNumberRangeMatch[2], 10)
      currentComment = ''
      if (debug) {
        info(`Found line number range: ${currentStartLine}-${currentEndLine}`)
      }
      continue
    }

    if (line.trim() === commentSeparator) {
      storeReview()
      currentStartLine = null
      currentEndLine = null
      currentComment = ''
      if (debug) {
        info('Found comment separator')
      }
      continue
    }

    if (currentStartLine !== null && currentEndLine !== null) {
      currentComment += `${line}\n`
    }
  }

  storeReview()

  return reviews
}

function sanitizeResponse(comment: string): string {
  comment = sanitizeCodeBlock(comment, 'suggestion')
  comment = sanitizeCodeBlock(comment, 'diff')
  return comment
}

function sanitizeCodeBlock(comment: string, codeBlockLabel: string): string {
  const codeBlockStart = `\`\`\`${codeBlockLabel}`
  const codeBlockEnd = '```'
  const lineNumberRegex = /^ *(\d+): /gm

  let codeBlockStartIndex = comment.indexOf(codeBlockStart)

  while (codeBlockStartIndex !== -1) {
    const codeBlockEndIndex = comment.indexOf(
      codeBlockEnd,
      codeBlockStartIndex + codeBlockStart.length
    )

    if (codeBlockEndIndex === -1) break

    const codeBlock = comment.substring(
      codeBlockStartIndex + codeBlockStart.length,
      codeBlockEndIndex
    )
    const sanitizedBlock = codeBlock.replace(lineNumberRegex, '')

    comment =
      comment.slice(0, codeBlockStartIndex + codeBlockStart.length) +
      sanitizedBlock +
      comment.slice(codeBlockEndIndex)

    codeBlockStartIndex = comment.indexOf(
      codeBlockStart,
      codeBlockStartIndex +
        codeBlockStart.length +
        sanitizedBlock.length +
        codeBlockEnd.length
    )
  }

  return comment
}
