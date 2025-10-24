import {error, info, warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'
import pLimit from 'p-limit'
import {type ChatBot} from '../bot/chat-bot'
import {Commenter} from '../github/commenter'
import {
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG,
  SUMMARIZE_TAG
} from '../github/comment-tags'
import {Inputs} from '../shared/inputs'
import {type Options} from '../config/options'
import {type PromptLibrary} from '../prompts/templates'
import {FileProcessor} from './file-processor'
import {generateFileReview} from './reviewer'
import {getTokenCount} from './tokenizer'

// eslint-disable-next-line camelcase
const context = github_context

const ignoreKeyword = '@reval: ignore'

const isPullRequestEvent = (): boolean =>
  context.eventName === 'pull_request' ||
  context.eventName === 'pull_request_target'

const getPullRequestPayload = (): typeof context.payload.pull_request | null =>
  context.payload?.pull_request ?? null

export class ReviewOrchestrator {
  async orchestrateReview(
    lightBot: ChatBot,
    heavyBot: ChatBot,
    options: Options,
    prompts: PromptLibrary
  ): Promise<void> {
    const commenter = new Commenter()
    const openaiConcurrencyLimit = pLimit(options.openaiConcurrencyLimit)
    const githubConcurrencyLimit = pLimit(options.githubConcurrencyLimit)

    if (!isPullRequestEvent()) {
      warning(
        `Skipped: current event is ${context.eventName}, only support pull_request event`
      )
      return
    }

    const pullRequest = getPullRequestPayload()
    if (pullRequest == null) {
      warning('Skipped: context.payload.pull_request is null')
      return
    }

    const inputs = new Inputs()
    inputs.title = pullRequest.title
    if (pullRequest.body != null) {
      inputs.description = commenter.getDescription(pullRequest.body)
    }

    if (inputs.description.includes(ignoreKeyword)) {
      info('Skipped: description contains ignore_keyword')
      return
    }

    inputs.systemMessage = options.systemMessage

    const existingSummarizeCmt = await commenter.findCommentWithTag(
      SUMMARIZE_TAG,
      pullRequest.number
    )
    let existingCommitIdsBlock = ''
    let existingSummarizeCmtBody = ''
    if (existingSummarizeCmt != null) {
      existingSummarizeCmtBody = existingSummarizeCmt.body
      inputs.rawSummary = commenter.getRawSummary(existingSummarizeCmtBody)
      inputs.shortSummary = commenter.getShortSummary(existingSummarizeCmtBody)
      existingCommitIdsBlock = commenter.getReviewedCommitIdsBlock(
        existingSummarizeCmtBody
      )
    }

    const allCommitIds = await commenter.getAllCommitIds()
    let highestReviewedCommitId = ''
    if (existingCommitIdsBlock !== '') {
      highestReviewedCommitId = commenter.getHighestReviewedCommitId(
        allCommitIds,
        commenter.getReviewedCommitIds(existingCommitIdsBlock)
      )
    }

    if (
      highestReviewedCommitId === '' ||
      highestReviewedCommitId === pullRequest.head.sha
    ) {
      info(
        `Will review from the base commit: ${pullRequest.base.sha as string}`
      )
      highestReviewedCommitId = pullRequest.base.sha
    } else {
      info(`Will review from commit: ${highestReviewedCommitId}`)
    }

    const fileProcessor = new FileProcessor(options, githubConcurrencyLimit)
    const {files, commits} = await fileProcessor.getChangedFiles(
      pullRequest,
      highestReviewedCommitId
    )

    if (files.length === 0) {
      warning('Skipped: files is null')
      return
    }

    const {selected, ignored} = fileProcessor.filterIgnoredFiles(files)

    if (selected.length === 0) {
      warning('Skipped: filterSelectedFiles is null')
      return
    }

    const filesAndChanges = await fileProcessor.buildFileChanges(
      selected,
      pullRequest
    )

    if (filesAndChanges.length === 0) {
      error('Skipped: no files to review')
      return
    }

    let statusMsg = `<details>
<summary>Commits</summary>
Files that changed from the base of the PR and between ${highestReviewedCommitId} and ${pullRequest.head.sha} commits.
</details>
${
  filesAndChanges.length > 0
    ? `
<details>
<summary>Files selected (${filesAndChanges.length})</summary>

* ${filesAndChanges
        .map(([filename, , , patches]) => `${filename} (${patches.length})`)
        .join('\n* ')}
</details>
`
    : ''
}
${
  ignored.length > 0
    ? `
<details>
<summary>Files ignored due to filter (${ignored.length})</summary>

* ${ignored.map(file => file.filename).join('\n* ')}

</details>
`
    : ''
}
`

    const inProgressSummarizeCmt = commenter.addInProgressStatus(
      existingSummarizeCmtBody,
      statusMsg
    )

    await commenter.comment(`${inProgressSummarizeCmt}`, SUMMARIZE_TAG, 'replace')

    const summariesFailed: string[] = []

    const doSummary = async (
      filename: string,
      fileContent: string,
      fileDiff: string
    ): Promise<[string, string, boolean] | null> => {
      info(`summarize: ${filename}`)
      const ins = inputs.clone()
      if (fileDiff.length === 0) {
        warning(`summarize: file_diff is empty, skip ${filename}`)
        summariesFailed.push(`${filename} (empty diff)`)
        return null
      }

      ins.filename = filename
      ins.fileDiff = fileDiff

      const summarizePrompt = prompts.renderSummarizeFileDiff(
        ins,
        options.reviewSimpleChanges
      )
      const tokens = getTokenCount(summarizePrompt)

      if (tokens > options.lightTokenLimits.requestTokens) {
        info(`summarize: diff tokens exceeds limit, skip ${filename}`)
        summariesFailed.push(`${filename} (diff tokens exceeds limit)`)
        return null
      }

      try {
        const [summarizeResp] = await lightBot.chat(summarizePrompt, {})

        if (summarizeResp === '') {
          info('summarize: nothing obtained from openai')
          summariesFailed.push(`${filename} (nothing obtained from openai)`)
          return null
        } else {
          if (options.reviewSimpleChanges === false) {
            const triageRegex = /\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/
            const triageMatch = summarizeResp.match(triageRegex)

            if (triageMatch != null) {
              const triage = triageMatch[1]
              const needsReview = triage === 'NEEDS_REVIEW'

              const summary = summarizeResp.replace(triageRegex, '').trim()
              info(`filename: ${filename}, triage: ${triage}`)
              return [filename, summary, needsReview]
            }
          }
          return [filename, summarizeResp, true]
        }
      } catch (error: any) {
        warning(`summarize: error from openai: ${error as string}`)
        summariesFailed.push(
          `${filename} (error from openai: ${error as string})})`
        )
        return null
      }
    }

    const summaryPromises = []
    const skippedFiles: string[] = []
    for (const [filename, fileContent, fileDiff] of filesAndChanges) {
      if (options.maxFiles <= 0 || summaryPromises.length < options.maxFiles) {
        summaryPromises.push(
          openaiConcurrencyLimit(
            async () => await doSummary(filename, fileContent, fileDiff)
          )
        )
      } else {
        skippedFiles.push(filename)
      }
    }

    const summaries = (await Promise.all(summaryPromises)).filter(
      summary => summary !== null
    ) as Array<[string, string, boolean]>

    if (summaries.length > 0) {
      const batchSize = 10
      for (let i = 0; i < summaries.length; i += batchSize) {
        const summariesBatch = summaries.slice(i, i + batchSize)
        for (const [filename, summary] of summariesBatch) {
          inputs.rawSummary += `---
${filename}: ${summary}
`
        }
        const [summarizeResp] = await heavyBot.chat(
          prompts.renderSummarizeChangesets(inputs),
          {}
        )
        if (summarizeResp === '') {
          warning('summarize: nothing obtained from openai')
        } else {
          inputs.rawSummary = summarizeResp
        }
      }
    }

    const [summarizeFinalResponse] = await heavyBot.chat(
      prompts.renderSummarize(inputs),
      {}
    )
    if (summarizeFinalResponse === '') {
      info('summarize: nothing obtained from openai')
    }

    if (options.disableReleaseNotes === false) {
      const [releaseNotesResponse] = await heavyBot.chat(
        prompts.renderSummarizeReleaseNotes(inputs),
        {}
      )
      if (releaseNotesResponse === '') {
        info('release notes: nothing obtained from openai')
      } else {
        let message = '### Summary by Reval\n\n'
        message += releaseNotesResponse
        try {
          await commenter.updateDescription(pullRequest.number, message)
        } catch (error: any) {
          warning(`release notes: error from github: ${error.message as string}`)
        }
      }
    }

    const [summarizeShortResponse] = await heavyBot.chat(
      prompts.renderSummarizeShort(inputs),
      {}
    )
    inputs.shortSummary = summarizeShortResponse

    let summarizeComment = `${summarizeFinalResponse}
${RAW_SUMMARY_START_TAG}
${inputs.rawSummary}
${RAW_SUMMARY_END_TAG}
${SHORT_SUMMARY_START_TAG}
${inputs.shortSummary}
${SHORT_SUMMARY_END_TAG}

---

<details>
<summary>Power your reviews with Reval Cloud</summary>

### Reval Cloud

Reval Cloud delivers deeper context, lower latency, and tailored review rules for growing teams. Reach out at support@reval.dev to learn more.

</details>
`

    statusMsg += `
${
  skippedFiles.length > 0
    ? `
<details>
<summary>Files not processed due to max files limit (${skippedFiles.length})</summary>

* ${skippedFiles.join('\n* ')}

</details>
`
    : ''
}
${
  summariesFailed.length > 0
    ? `
<details>
<summary>Files not summarized due to errors (${summariesFailed.length})</summary>

* ${summariesFailed.join('\n* ')}

</details>
`
    : ''
}
`

    if (!options.disableReview) {
      const filesAndChangesReview = filesAndChanges.filter(([filename]) => {
        const needsReview =
          summaries.find(([summaryFilename]) => summaryFilename === filename)?.[2] ??
          true
        return needsReview
      })

      const reviewsSkipped = filesAndChanges
        .filter(
          ([filename]) =>
            !filesAndChangesReview.some(
              ([reviewFilename]) => reviewFilename === filename
            )
        )
        .map(([filename]) => filename)

      const reviewsFailed: string[] = []
      let lgtmCount = 0
      let reviewCount = 0

      const reviewPromises = []
      for (const [filename, , , patches] of filesAndChangesReview) {
        if (options.maxFiles <= 0 || reviewPromises.length < options.maxFiles) {
          reviewPromises.push(
            openaiConcurrencyLimit(async () => {
              const result = await generateFileReview(
                filename,
                patches,
                pullRequest,
                commenter,
                options,
                prompts,
                heavyBot,
                inputs
              )
              reviewCount += result.reviewCount
              lgtmCount += result.lgtmCount
              reviewsFailed.push(...result.failures)
              if (result.skippedDueToSize) {
                reviewsSkipped.push(`${filename} (diff too large)`)
              }
            })
          )
        } else {
          skippedFiles.push(filename)
        }
      }

      await Promise.all(reviewPromises)

      statusMsg += `
${
  reviewsFailed.length > 0
    ? `<details>
<summary>Files not reviewed due to errors (${reviewsFailed.length})</summary>

* ${reviewsFailed.join('\n* ')}

</details>
`
    : ''
}
${
  reviewsSkipped.length > 0
    ? `<details>
<summary>Files skipped from review due to trivial changes (${reviewsSkipped.length})</summary>

* ${reviewsSkipped.join('\n* ')}

</details>
`
    : ''
}
<details>
<summary>Review comments generated (${reviewCount + lgtmCount})</summary>

* Review: ${reviewCount}
* LGTM: ${lgtmCount}

</details>

---

<details>
<summary>Tips</summary>

### Collaborate with Reval (\`@reval\`)
- Reply on review comments left by this bot to ask follow-up questions.
- Invite the bot into a review comment chain by tagging \`@reval\` in a reply.

### Code suggestions
- The bot may make code suggestions, but please review them carefully before committing since the line number ranges may be misaligned.
- You can edit the comment made by the bot and manually tweak the suggestion if it is slightly off.

### Pausing incremental reviews
- Add \`@reval: ignore\` anywhere in the PR description to pause further reviews from the bot.

</details>
`
      summarizeComment += `\n${commenter.addReviewedCommitId(
        existingCommitIdsBlock,
        pullRequest.head.sha
      )}`

      await commenter.submitReview(
        pullRequest.number,
        commits[commits.length - 1]?.sha ?? pullRequest.head.sha,
        statusMsg
      )
    }

    await commenter.comment(`${summarizeComment}`, SUMMARIZE_TAG, 'replace')
  }
}
