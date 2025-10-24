import {warning} from '@actions/core'
// eslint-disable-next-line camelcase
import {context as github_context} from '@actions/github'

import {type Options} from '../config/options'
import {octokit} from '../github/octokit'

// eslint-disable-next-line camelcase
const context = github_context
const repo = context.repo

type PullRequest = NonNullable<typeof context.payload.pull_request>

type Limit = <T>(fn: () => Promise<T>) => Promise<T>

type FileEntry = {
  filename: string
  patch?: string | null
}

type PatchTuple = [number, number, string]

export interface FileChangesResult {
  filesAndChanges: Array<[string, string, string, PatchTuple[]]>
  ignoredFiles: FileEntry[]
  commits: any[]
}

export class FileProcessor {
  constructor(
    private readonly options: Options,
    private readonly githubConcurrencyLimit: Limit
  ) {}

  async getChangedFiles(
    pullRequest: PullRequest,
    highestReviewedCommitId: string
  ): Promise<{files: FileEntry[]; commits: any[]}> {
    const incrementalDiff = await octokit.repos.compareCommits({
      owner: repo.owner,
      repo: repo.repo,
      base: highestReviewedCommitId,
      head: pullRequest.head.sha
    })

    const targetBranchDiff = await octokit.repos.compareCommits({
      owner: repo.owner,
      repo: repo.repo,
      base: pullRequest.base.sha,
      head: pullRequest.head.sha
    })

    const incrementalFiles = incrementalDiff.data.files
    const targetBranchFiles = targetBranchDiff.data.files

    if (incrementalFiles == null || targetBranchFiles == null) {
      warning('Skipped: files data is missing')
      return {files: [], commits: incrementalDiff.data.commits ?? []}
    }

    const files = targetBranchFiles.filter(targetBranchFile =>
      incrementalFiles.some(
        incrementalFile => incrementalFile.filename === targetBranchFile.filename
      )
    )

    return {
      files: files as FileEntry[],
      commits: incrementalDiff.data.commits ?? []
    }
  }

  filterIgnoredFiles(files: FileEntry[]): {
    selected: FileEntry[]
    ignored: FileEntry[]
  } {
    const selected: FileEntry[] = []
    const ignored: FileEntry[] = []

    for (const file of files) {
      if (!this.options.checkPath(file.filename)) {
        ignored.push(file)
      } else {
        selected.push(file)
      }
    }

    return {selected, ignored}
  }

  async buildFileChanges(
    files: FileEntry[],
    pullRequest: PullRequest
  ): Promise<Array<[string, string, string, PatchTuple[]]>> {
    const results = await Promise.all(
      files.map(file =>
        this.githubConcurrencyLimit(async () => {
          const patches = await this.getFileDiff(file, pullRequest)
          return patches
        })
      )
    )

    return results.filter(
      (
        file
      ): file is [string, string, string, PatchTuple[]] => file !== null
    )
  }

  private async getFileDiff(
    file: FileEntry,
    pullRequest: PullRequest
  ): Promise<[string, string, string, PatchTuple[]] | null> {
    let fileContent = ''
    try {
      const contents = await octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path: file.filename,
        ref: pullRequest.base.sha
      })
      if (contents.data != null && !Array.isArray(contents.data)) {
        if (contents.data.type === 'file' && contents.data.content != null) {
          fileContent = Buffer.from(contents.data.content, 'base64').toString()
        }
      }
    } catch (error: any) {
      warning(
        `Failed to get file contents: ${
          error as string
        }. This is OK if it's a new file.`
      )
    }

    const fileDiff = file.patch ?? ''
    const patches: PatchTuple[] = []

    for (const patch of splitPatch(file.patch)) {
      const patchLines = patchStartEndLine(patch)
      if (patchLines == null) {
        continue
      }
      const hunks = parsePatch(patch)
      if (hunks == null) {
        continue
      }
      const hunksStr = `
---new_hunk---
\`\`\`
${hunks.newHunk}
\`\`\`

---old_hunk---
\`\`\`
${hunks.oldHunk}
\`\`\`
`
      patches.push([
        patchLines.newHunk.startLine,
        patchLines.newHunk.endLine,
        hunksStr
      ])
    }

    if (patches.length === 0) {
      return null
    }

    return [file.filename, fileContent, fileDiff, patches]
  }
}

const splitPatch = (patch: string | null | undefined): string[] => {
  if (patch == null) {
    return []
  }

  const pattern = /(^@@ -(\d+),(\d+) \+(\d+),(\d+) @@).*$/gm

  const result: string[] = []
  let last = -1
  let match: RegExpExecArray | null
  while ((match = pattern.exec(patch)) !== null) {
    if (last === -1) {
      last = match.index
    } else {
      result.push(patch.substring(last, match.index))
      last = match.index
    }
  }

  if (last !== -1) {
    result.push(patch.substring(last))
  }

  return result
}

const patchStartEndLine = (
  patch: string
): {
  newHunk: {startLine: number; endLine: number}
  oldHunk: {startLine: number; endLine: number}
} | null => {
  const patchMatches = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/m.exec(patch)

  if (!patchMatches) {
    return null
  }

  const [newStart, newRange, oldStart, oldRange] = [
    patchMatches[3],
    patchMatches[4],
    patchMatches[1],
    patchMatches[2]
  ].map(Number)

  return {
    newHunk: {
      startLine: newStart,
      endLine: newStart + Math.max(newRange - 1, 0)
    },
    oldHunk: {
      startLine: oldStart,
      endLine: oldStart + Math.max(oldRange - 1, 0)
    }
  }
}

const parsePatch = (
  patch: string
): {newHunk: string; oldHunk: string} | null => {
  const lines = patch.split('\n')

  const oldHunkLines: string[] = []
  const newHunkLines: string[] = []

  let skipStart = 0
  let skipEnd = 0
  let currentLine = 2

  const oldDiff = lines[1]
  if (oldDiff.startsWith('-')) {
    const body = oldDiff.substring(1)
    oldHunkLines.push(body)
    skipStart++
  }

  const newDiff = lines[2]
  let newLine = 0
  if (newDiff.startsWith('+')) {
    const body = newDiff.substring(1)
    newHunkLines.push(`${newLine}: ${body}`)
    newLine++
    skipEnd++
  }

  const removalOnly = newLine === 0

  for (const line of lines) {
    currentLine++
    if (line.startsWith('-')) {
      oldHunkLines.push(`${line.substring(1)}`)
    } else if (line.startsWith('+')) {
      newHunkLines.push(`${newLine}: ${line.substring(1)}`)
      newLine++
    } else {
      oldHunkLines.push(`${line}`)
      if (
        removalOnly ||
        (currentLine > skipStart && currentLine <= lines.length - skipEnd)
      ) {
        newHunkLines.push(`${newLine}: ${line}`)
      } else {
        newHunkLines.push(`${line}`)
      }
      newLine++
    }
  }

  return {
    oldHunk: oldHunkLines.join('\n'),
    newHunk: newHunkLines.join('\n')
  }
}
