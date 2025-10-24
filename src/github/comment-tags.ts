import {getInput} from '@actions/core'

const defaultBotIcon = getInput('bot_icon') || '🤖'

export const COMMENT_GREETING = `${defaultBotIcon}   Reval`

export const COMMENT_TAG =
  '<!-- This is an auto-generated comment by Reval AI -->'

export const COMMENT_REPLY_TAG =
  '<!-- This is an auto-generated reply by Reval AI -->'

export const SUMMARIZE_TAG =
  '<!-- This is an auto-generated comment: summarize by Reval AI -->'

export const IN_PROGRESS_START_TAG =
  '<!-- This is an auto-generated comment: summarize review in progress by Reval AI -->'

export const IN_PROGRESS_END_TAG =
  '<!-- end of auto-generated comment: summarize review in progress by Reval AI -->'

export const DESCRIPTION_START_TAG =
  '<!-- This is an auto-generated comment: release notes by Reval AI -->'
export const DESCRIPTION_END_TAG =
  '<!-- end of auto-generated comment: release notes by Reval AI -->'

export const RAW_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: raw summary by Reval AI -->
<!--
`
export const RAW_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: raw summary by Reval AI -->`

export const SHORT_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: short summary by Reval AI -->
<!--
`

export const SHORT_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: short summary by Reval AI -->`

export const COMMIT_ID_START_TAG = '<!-- commit_ids_reviewed_start -->'
export const COMMIT_ID_END_TAG = '<!-- commit_ids_reviewed_end -->'
