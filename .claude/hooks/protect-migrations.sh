#!/usr/bin/env bash
# Blocks Edit/Write on a migration that is already on main: applied migrations are never edited.
# New migration files (not yet on main) can still be written and edited.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
path=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.tool_input&&j.tool_input.file_path)||"")}catch{console.log("")}})')
rel=${path#"$PWD"/}
case "$rel" in
  migrations/*.sql)
    if git cat-file -e "origin/main:$rel" 2>/dev/null || git cat-file -e "main:$rel" 2>/dev/null; then
      echo "$rel is already on main, so it counts as applied. Add a new numbered migration instead." >&2
      exit 2
    fi ;;
esac
exit 0
