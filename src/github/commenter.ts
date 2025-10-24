import {info, warning} from '@actions/core'
import {context as github_context} from '@actions/github'
import {octokit} from './octokit'
import {
  COMMENT_GREETING,
  COMMENT_REPLY_TAG,
  COMMENT_TAG,
  DESCRIPTION_END_TAG,
  DESCRIPTION_START_TAG,
  SUMMARIZE_TAG
} from './comment-tags'
import {CommentParser} from './comment-parser'

const context = github_context
const repo = context.repo

type CommentMode = 'create' | 'replace'

interface ReviewCommentDraft {
  path: string
  startLine: number
  endLine: number
  message: string
}

export class Commenter extends CommentParser {
  private readonly reviewCommentsBuffer: ReviewCommentDraft[] = []

  async comment(
    message: string,
    tag: string = COMMENT_TAG,
    mode: CommentMode = 'replace'
  ): Promise<void> {
    const target = this.resolveTargetNumber()
    if (target == null) {
      warning(
        'Skipped: context.payload.pull_request and context.payload.issue are both null'
      )
      return
    }

    const body = this.composeCommentBody(message, tag)

    if (mode === 'create') {
      await this.create(body, target)
      return
    }

    if (mode !== 'replace') {
      warning(`Unknown mode: ${mode}, use "replace" instead`)
    }

    await this.replace(body, tag, target)
  }

  async updateDescription(pullNumber: number, message: string): Promise<void> {
    try {
      const pr = await octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber
      })

      const body = pr.data.body ?? ''
      const description = this.getDescription(body)
      const messageClean = this.removeContentWithinTags(
        message,
        DESCRIPTION_START_TAG,
        DESCRIPTION_END_TAG
      )

      const newDescription = `${description}\n${DESCRIPTION_START_TAG}\n${messageClean}\n${DESCRIPTION_END_TAG}`
      await octokit.pulls.update({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber,
        body: newDescription
      })
    } catch (error) {
      warning(
        `Failed to get PR: ${error}, skipping adding release notes to description.`
      )
    }
  }

  async bufferReviewComment(
    path: string,
    startLine: number,
    endLine: number,
    message: string
  ): Promise<void> {
    const body = this.composeCommentBody(message, COMMENT_TAG)
    this.reviewCommentsBuffer.push({
      path,
      startLine,
      endLine,
      message: body
    })
  }

  async deletePendingReview(pullNumber: number) {
    try {
      const reviews = await octokit.pulls.listReviews({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber
      })

      const pendingReview = reviews.data.find(
        review => review.state === 'PENDING'
      )

      if (pendingReview) {
        info(
          `Deleting pending review for PR #${pullNumber} id: ${pendingReview.id}`
        )
        try {
          await octokit.pulls.deletePendingReview({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pullNumber,
            review_id: pendingReview.id
          })
        } catch (e) {
          warning(`Failed to delete pending review: ${e}`)
        }
      }
    } catch (e) {
      warning(`Failed to list reviews: ${e}`)
    }
  }

  async submitReview(pullNumber: number, commitId: string, statusMsg: string) {
    const body = `${COMMENT_GREETING}

${statusMsg}
`

    if (this.reviewCommentsBuffer.length === 0) {
      // Submit empty review with statusMsg
      info(`Submitting empty review for PR #${pullNumber}`)
      try {
        await octokit.pulls.createReview({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: pullNumber,
          commit_id: commitId,
          event: 'COMMENT',
          body
        })
      } catch (e) {
        warning(`Failed to submit empty review: ${e}`)
      }
      return
    }
    for (const comment of this.reviewCommentsBuffer) {
      const comments = await this.getCommentsAtRange(
        pullNumber,
        comment.path,
        comment.startLine,
        comment.endLine
      )
      for (const c of comments) {
        if (c.body.includes(COMMENT_TAG)) {
          info(
            `Deleting review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
          )
          try {
            await octokit.pulls.deleteReviewComment({
              owner: repo.owner,
              repo: repo.repo,
              comment_id: c.id
            })
          } catch (e) {
            warning(`Failed to delete review comment: ${e}`)
          }
        }
      }
    }

    await this.deletePendingReview(pullNumber)

    const generateCommentData = (comment: any) => {
      const commentData: any = {
        path: comment.path,
        body: comment.message,
        line: comment.endLine
      }

      if (comment.startLine !== comment.endLine) {
        commentData.start_line = comment.startLine
        commentData.start_side = 'RIGHT'
      }

      return commentData
    }

    try {
      const review = await octokit.pulls.createReview({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber,
        commit_id: commitId,
        comments: this.reviewCommentsBuffer.map(comment =>
          generateCommentData(comment)
        )
      })

      info(
        `Submitting review for PR #${pullNumber}, total comments: ${this.reviewCommentsBuffer.length}, review id: ${review.data.id}`
      )

      await octokit.pulls.submitReview({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber,
        review_id: review.data.id,
        event: 'COMMENT',
        body
      })
    } catch (e) {
      warning(
        `Failed to create review: ${e}. Falling back to individual comments.`
      )
      await this.deletePendingReview(pullNumber)
      let commentCounter = 0
      for (const comment of this.reviewCommentsBuffer) {
        info(
          `Creating new review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
        )
        const commentData: any = {
          owner: repo.owner,
          repo: repo.repo,
          pull_number: pullNumber,
          commit_id: commitId,
          ...generateCommentData(comment)
        }

        try {
          await octokit.pulls.createReviewComment(commentData)
        } catch (ee) {
          warning(`Failed to create review comment: ${ee}`)
        }

        commentCounter++
        info(
          `Comment ${commentCounter}/${this.reviewCommentsBuffer.length} posted`
        )
      }
    }
  }

  async reviewCommentReply(
    pullNumber: number,
    topLevelComment: any,
    message: string
  ) {
    const reply = `${COMMENT_GREETING}

${message}

${COMMENT_REPLY_TAG}
`
    try {
      // Post the reply to the user comment
      await octokit.pulls.createReplyForReviewComment({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber,
        body: reply,
        comment_id: topLevelComment.id
      })
    } catch (error) {
      warning(`Failed to reply to the top-level comment ${error}`)
      try {
        await octokit.pulls.createReplyForReviewComment({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: pullNumber,
          body: `Could not post the reply to the top-level comment due to the following error: ${error}`,
          comment_id: topLevelComment.id
        })
      } catch (e) {
        warning(`Failed to reply to the top-level comment ${e}`)
      }
    }
    try {
      if (topLevelComment.body.includes(COMMENT_TAG)) {
        // replace COMMENT_TAG with COMMENT_REPLY_TAG in topLevelComment
        const newBody = topLevelComment.body.replace(
          COMMENT_TAG,
          COMMENT_REPLY_TAG
        )
        await octokit.pulls.updateReviewComment({
          owner: repo.owner,
          repo: repo.repo,
          comment_id: topLevelComment.id,
          body: newBody
        })
      }
    } catch (error) {
      warning(`Failed to update the top-level comment ${error}`)
    }
  }

  async getCommentsWithinRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number
  ) {
    const comments = await this.listReviewComments(pullNumber)
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== '' &&
        ((comment.start_line !== undefined &&
          comment.start_line >= startLine &&
          comment.line <= endLine) ||
          (startLine === endLine && comment.line === endLine))
    )
  }

  async getCommentsAtRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number
  ) {
    const comments = await this.listReviewComments(pullNumber)
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== '' &&
        ((comment.start_line !== undefined &&
          comment.start_line === startLine &&
          comment.line === endLine) ||
          (startLine === endLine && comment.line === endLine))
    )
  }

  async getCommentChainsWithinRange(
    pullNumber: number,
    path: string,
    startLine: number,
    endLine: number,
    tag = ''
  ) {
    const existingComments = await this.getCommentsWithinRange(
      pullNumber,
      path,
      startLine,
      endLine
    )
    // find all top most comments
    const topLevelComments = []
    for (const comment of existingComments) {
      if (!comment.in_reply_to_id) {
        topLevelComments.push(comment)
      }
    }

    let allChains = ''
    let chainNum = 0
    for (const topLevelComment of topLevelComments) {
      // get conversation chain
      const chain = await this.composeCommentChain(
        existingComments,
        topLevelComment
      )
      if (chain && chain.includes(tag)) {
        chainNum += 1
        allChains += `Conversation Chain ${chainNum}:
${chain}
---
`
      }
    }
    return allChains
  }

  async composeCommentChain(reviewComments: any[], topLevelComment: any) {
    const conversationChain = reviewComments
      .filter((cmt: any) => cmt.in_reply_to_id === topLevelComment.id)
      .map((cmt: any) => `${cmt.user.login}: ${cmt.body}`)

    conversationChain.unshift(
      `${topLevelComment.user.login}: ${topLevelComment.body}`
    )

    return conversationChain.join('\n---\n')
  }

  async getCommentChain(pullNumber: number, comment: any) {
    try {
      const reviewComments = await this.listReviewComments(pullNumber)
      const topLevelComment = await this.getTopLevelComment(
        reviewComments,
        comment
      )
      const chain = await this.composeCommentChain(
        reviewComments,
        topLevelComment
      )
      return {chain, topLevelComment}
    } catch (e) {
      warning(`Failed to get conversation chain: ${e}`)
      return {
        chain: '',
        topLevelComment: null
      }
    }
  }

  async getTopLevelComment(reviewComments: any[], comment: any) {
    let topLevelComment = comment

    while (topLevelComment.in_reply_to_id) {
      const parentComment = reviewComments.find(
        (cmt: any) => cmt.id === topLevelComment.in_reply_to_id
      )

      if (parentComment) {
        topLevelComment = parentComment
      } else {
        break
      }
    }

    return topLevelComment
  }

  private reviewCommentsCache: Record<number, any[]> = {}

  async listReviewComments(target: number) {
    if (this.reviewCommentsCache[target]) {
      return this.reviewCommentsCache[target]
    }

    const allComments: any[] = []
    let page = 1
    try {
      for (;;) {
        const {data: comments} = await octokit.pulls.listReviewComments({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: target,
          page,
          per_page: 100
        })
        allComments.push(...comments)
        page++
        if (!comments || comments.length < 100) {
          break
        }
      }

      this.reviewCommentsCache[target] = allComments
      return allComments
    } catch (e) {
      warning(`Failed to list review comments: ${e}`)
      return allComments
    }
  }

  async create(body: string, target: number) {
    try {
      // get comment ID from the response
      const response = await octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: target,
        body
      })
      // add comment to issueCommentsCache
      if (this.issueCommentsCache[target]) {
        this.issueCommentsCache[target].push(response.data)
      } else {
        this.issueCommentsCache[target] = [response.data]
      }
    } catch (e) {
      warning(`Failed to create comment: ${e}`)
    }
  }

  async replace(body: string, tag: string, target: number) {
    try {
      const cmt = await this.findCommentWithTag(tag, target)
      if (cmt) {
        await octokit.issues.updateComment({
          owner: repo.owner,
          repo: repo.repo,
          comment_id: cmt.id,
          body
        })
      } else {
        await this.create(body, target)
      }
    } catch (e) {
      warning(`Failed to replace comment: ${e}`)
    }
  }

  async findCommentWithTag(tag: string, target: number) {
    try {
      const comments = await this.listComments(target)
      for (const cmt of comments) {
        if (cmt.body && cmt.body.includes(tag)) {
          return cmt
        }
      }

      return null
    } catch (e: unknown) {
      warning(`Failed to find comment with tag: ${e}`)
      return null
    }
  }

  private issueCommentsCache: Record<number, any[]> = {}

  async listComments(target: number) {
    if (this.issueCommentsCache[target]) {
      return this.issueCommentsCache[target]
    }

    const allComments: any[] = []
    let page = 1
    try {
      for (;;) {
        const {data: comments} = await octokit.issues.listComments({
          owner: repo.owner,
          repo: repo.repo,
          issue_number: target,
          page,
          per_page: 100
        })
        allComments.push(...comments)
        page++
        if (!comments || comments.length < 100) {
          break
        }
      }

      this.issueCommentsCache[target] = allComments
      return allComments
    } catch (e: any) {
      warning(`Failed to list comments: ${e}`)
      return allComments
    }
  }

  async getAllCommitIds(): Promise<string[]> {
    const allCommits = []
    let page = 1
    let commits
    if (context && context.payload && context.payload.pull_request != null) {
      do {
        commits = await octokit.pulls.listCommits({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: context.payload.pull_request.number,
          per_page: 100,
          page
        })

        allCommits.push(...commits.data.map(commit => commit.sha))
        page++
      } while (commits.data.length > 0)
    }

    return allCommits
  }

  private resolveTargetNumber(): number | null {
    if (context.payload.pull_request != null) {
      return context.payload.pull_request.number
    }
    if (context.payload.issue != null) {
      return context.payload.issue.number
    }
    return null
  }

  private composeCommentBody(message: string, tag: string): string {
    const finalTag = tag || COMMENT_TAG
    return `${COMMENT_GREETING}

${message}

${finalTag}`
  }

}
