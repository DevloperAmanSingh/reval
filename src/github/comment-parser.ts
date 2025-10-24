import {
  COMMIT_ID_END_TAG,
  COMMIT_ID_START_TAG,
  DESCRIPTION_END_TAG,
  DESCRIPTION_START_TAG,
  IN_PROGRESS_END_TAG,
  IN_PROGRESS_START_TAG,
  RAW_SUMMARY_END_TAG,
  RAW_SUMMARY_START_TAG,
  SHORT_SUMMARY_END_TAG,
  SHORT_SUMMARY_START_TAG
} from './comment-tags'

export class CommentParser {
  getRawSummary(summary: string): string {
    return this.getContentWithinTags(
      summary,
      RAW_SUMMARY_START_TAG,
      RAW_SUMMARY_END_TAG
    )
  }

  getShortSummary(summary: string): string {
    return this.getContentWithinTags(
      summary,
      SHORT_SUMMARY_START_TAG,
      SHORT_SUMMARY_END_TAG
    )
  }

  getDescription(description: string): string {
    return this.removeContentWithinTags(
      description,
      DESCRIPTION_START_TAG,
      DESCRIPTION_END_TAG
    )
  }

  getReleaseNotes(description: string): string {
    const releaseNotes = this.getContentWithinTags(
      description,
      DESCRIPTION_START_TAG,
      DESCRIPTION_END_TAG
    )
    return releaseNotes.replace(/(^|\n)> .*/g, '')
  }

  addInProgressStatus(commentBody: string, statusMsg: string): string {
    const start = commentBody.indexOf(IN_PROGRESS_START_TAG)
    const end = commentBody.indexOf(IN_PROGRESS_END_TAG)
    if (start === -1 || end === -1) {
      return `${IN_PROGRESS_START_TAG}

Reval is reviewing new changes in this PR...

${statusMsg}

${IN_PROGRESS_END_TAG}

---

${commentBody}`
    }
    return commentBody
  }

  removeInProgressStatus(commentBody: string): string {
    const start = commentBody.indexOf(IN_PROGRESS_START_TAG)
    const end = commentBody.indexOf(IN_PROGRESS_END_TAG)
    if (start !== -1 && end !== -1) {
      return (
        commentBody.substring(0, start) +
        commentBody.substring(end + IN_PROGRESS_END_TAG.length)
      )
    }
    return commentBody
  }

  getReviewedCommitIds(commentBody: string): string[] {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return []
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end)
    return ids
      .split('<!--')
      .map(id => id.replace('-->', '').trim())
      .filter(id => id !== '')
  }

  getReviewedCommitIdsBlock(commentBody: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return ''
    }
    return commentBody.substring(start, end + COMMIT_ID_END_TAG.length)
  }

  addReviewedCommitId(commentBody: string, commitId: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return `${commentBody}\n${COMMIT_ID_START_TAG}\n<!-- ${commitId} -->\n${COMMIT_ID_END_TAG}`
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end)
    return `${commentBody.substring(
      0,
      start + COMMIT_ID_START_TAG.length
    )}${ids}<!-- ${commitId} -->\n${commentBody.substring(end)}`
  }

  getHighestReviewedCommitId(
    commitIds: string[],
    reviewedCommitIds: string[]
  ): string {
    for (let i = commitIds.length - 1; i >= 0; i--) {
      if (reviewedCommitIds.includes(commitIds[i])) {
        return commitIds[i]
      }
    }
    return ''
  }

  protected getContentWithinTags(
    content: string,
    startTag: string,
    endTag: string
  ): string {
    const start = content.indexOf(startTag)
    const end = content.indexOf(endTag)
    if (start >= 0 && end >= 0) {
      return content.slice(start + startTag.length, end)
    }
    return ''
  }

  protected removeContentWithinTags(
    content: string,
    startTag: string,
    endTag: string
  ): string {
    const start = content.indexOf(startTag)
    const end = content.lastIndexOf(endTag)
    if (start >= 0 && end >= 0) {
      return content.slice(0, start) + content.slice(end + endTag.length)
    }
    return content
  }
}
