#!/usr/bin/env bash
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 builds.
# Off main, a commit whose first line contains [checkpoint] skips. Anywhere, a commit that only
# touches docs, .claude/, .github/, CLAUDE.md, README.md or THIRD_PARTY_NOTICES.md skips.
if [ "$VERCEL_GIT_COMMIT_REF" != "main" ] && git log -1 --format=%s | grep -qF '[checkpoint]'; then
  exit 0
fi
git diff HEAD^ HEAD --quiet -- . ':(exclude).claude' ':(exclude)CLAUDE.md' ':(exclude)docs' \
  ':(exclude).github' ':(exclude)README.md' ':(exclude)THIRD_PARTY_NOTICES.md'
