# Reval · AI Code Review for Developers

Reval is a GitHub Action that runs a senior‑engineer quality review on every pull request. It reads the diff, understands context, and posts focused comments that help your team ship safer, cleaner code without slowing you down.

## Features
- **Deep code analysis:** Detects bugs, security pitfalls, and maintainability risks directly in the diff.
- **Actionable summaries:** Posts PR digests and optional release notes tailored to your system message.
- **Thread-aware replies:** Tracks follow-up conversations and revisits fixes without repeating itself.
- **Inline apply suggestions:** Offers one-click GitHub suggestions for safe, small fixes discovered during review.
- **Token-smart orchestration:** Batches similar files, trims prompts, and caches results for fast, cost-effective reviews.

## What Reval Does
- **Automated PR reviews:** Inspects changed files, flags risky code, and explains why with actionable suggestions.
- **PR digests & release notes:** Summarizes the change set so reviewers see the big picture immediately.
- **Conversation-aware replies:** Joins review threads to answer follow-up questions and re-check fixes.
- **Token-smart processing:** Batches similar files, trims prompts, and caches results to stay within model limits.

## How It Works
1. **Trigger:** When a PR is opened, updated, or a comment mentions the bot, the workflow invokes Reval’s bundled action (`dist/index.js`).
2. **Provider selection:** Reval can talk to Google Gemini or OpenAI; by default the action selects the best available provider from your secrets, or you can pin one explicitly.
3. **Analysis pipeline:** The action builds prompts with your system message, queues summarization and deep-review passes, and streams results through the chosen LLM.
4. **Feedback delivery:** Once the models respond, Reval applies heuristics to pick the highest-signal comments, posts them to the PR, and logs decisions for traceability.

## Technologies
- **TypeScript + Node.js:** Core action logic, prompt orchestration, and provider integration.
- **Google Gemini 2.5 Flash / OpenAI GPT-3.5:** Large language models that power summaries and reviews; Gemini is the default in our workflow.
- **GitHub Actions Toolkit:** Handles input parsing, logging, and result reporting inside the action runner.
- **Token management utilities:** Shared tokenizer logic ensures prompts stay within model limits and keeps the action fast.

## Quick Start
1. **Add the workflow**: Drop `.github/workflows/ai-review.yml` into your repository (see sample below).
2. **Set secrets**: At minimum, add `GITHUB_TOKEN` (provided automatically) and `GEMINI_API_KEY` or `OPENAI_API_KEY` depending on your provider.
3. **Push a PR**: Reval will review the next pull request and leave inline comments plus a summary.

```yaml
# .github/workflows/ai-review.yml (Gemini default)
name: Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  pull_request_review_comment:
    types: [created]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}
      - uses: DevloperAmanSingh/reval@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        with:
          ai_provider: gemini
          gemini_model: gemini-2.5-flash
          language: en-US
```

Need OpenAI instead? Swap `GEMINI_API_KEY` for `OPENAI_API_KEY` and set `ai_provider: openai`.

## Configuration Highlights
- `system_message`: Tailor the bot’s review persona (security-focused, performance-oriented, etc.).
- `ai_provider`: `gemini`, `openai`, or `auto` (auto picks the first provider with an API key).
- `gemini_model` / `openai_model`: Override the default model per provider.
- `language`: Localize responses (e.g., `en-GB`, `es-ES`).

## Development & Contributing
```bash
npm install
npm run build   # tsc + wasm copy
npm run package # bundle with ncc
```

We welcome issues and PRs—open a ticket describing the enhancement or bug, branch from `main`, and include relevant tests when possible.

---

Built and maintained by [@DevloperAmanSingh](https://github.com/DevloperAmanSingh).
