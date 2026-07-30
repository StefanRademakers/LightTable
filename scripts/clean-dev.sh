#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
repo_prefix="${repo_root}/"

stop_lighttable_development_processes() {
  local process_table
  process_table="$(mktemp "${TMPDIR:-/tmp}/lighttable-processes.XXXXXX")"
  trap 'rm -f "$process_table"' RETURN

  ps -axo pid=,ppid=,comm=,args= >"$process_table"

  local cwd_matched_pids
  cwd_matched_pids=""
  if command -v lsof >/dev/null 2>&1; then
    cwd_matched_pids="$(
      lsof -Fn -a -d cwd 2>/dev/null |
        awk -v repo="$repo_root" '
          /^p/ { pid = substr($0, 2); next }
          /^n/ {
            path = substr($0, 2)
            if (path == repo || index(path, repo "/") == 1) {
              print pid
            }
          }
        ' |
        tr '\n' ' '
    )"
  fi

  local matched_pids
  matched_pids="$(
    awk -v repo="$repo_root" -v current_pid="$$" -v cwd_pids="$cwd_matched_pids" '
      BEGIN {
        split(cwd_pids, cwd_ids, "\n")
        for (i in cwd_ids) {
          if (cwd_ids[i] != "") {
            cwd_hit[cwd_ids[i]] = 1
          }
        }
      }

      {
        pid = $1
        ppid = $2
        comm = $3
        args = ""
        for (i = 4; i <= NF; i++) {
          args = args $i " "
        }

        parent[pid] = ppid
        label[pid] = comm "#" pid
        ids[++count] = pid

        searchable = tolower(comm " " args)
        is_lighttable_tool = searchable ~ /(^|[\/[:space:]])(node|npm|electron)([[:space:]\/.]|$)/

        if (pid != current_pid && is_lighttable_tool && (index(args, repo) > 0 || cwd_hit[pid])) {
          matched[pid] = 1
        }
      }

      END {
        changed = 1
        while (changed) {
          changed = 0
          for (i = 1; i <= count; i++) {
            pid = ids[i]
            if (matched[parent[pid]] && !matched[pid]) {
              matched[pid] = 1
              changed = 1
            }
          }
        }

        for (i = 1; i <= count; i++) {
          pid = ids[i]
          if (matched[pid]) {
            print pid
          }
        }
      }
    ' "$process_table"
  )"

  if [ -z "$matched_pids" ]; then
    echo "[LightTable] No existing desktop development process found."
    return
  fi

  local matched_pid_list
  matched_pid_list="$(printf '%s\n' "$matched_pids" | tr '\n' ' ')"

  local labels
  labels="$(
    awk -v pids="$matched_pid_list" '
      BEGIN {
        split(pids, wanted, " ")
        for (i in wanted) {
          if (wanted[i] != "") {
            selected[wanted[i]] = 1
          }
        }
      }
      selected[$1] { print $3 "#" $1 }
    ' "$process_table" | awk '
      NR == 1 { output = $0; next }
      { output = output ", " $0 }
      END { print output }
    '
  )"

  echo "[LightTable] Stopping existing desktop development process tree: $labels"

  # Terminate children before parents by reversing ps order after descendant expansion.
  printf '%s\n' "$matched_pids" |
    awk '{ lines[NR] = $0 } END { for (i = NR; i >= 1; i--) print lines[i] }' |
    xargs kill -TERM 2>/dev/null || true
  sleep 1

  local remaining_pids
  remaining_pids="$(
    printf '%s\n' "$matched_pids" |
      while IFS= read -r pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
          printf '%s\n' "$pid"
        fi
      done
  )"

  if [ -n "$remaining_pids" ]; then
    printf '%s\n' "$remaining_pids" | xargs kill -KILL 2>/dev/null || true
  fi

  echo "[LightTable] Existing desktop development process stopped."
}

clean_generated_path() {
  local relative_path="$1"
  local target_path

  case "$relative_path" in
    /*|*..*)
      echo "[LightTable] Refusing to clean an unsafe relative path: $relative_path" >&2
      exit 1
      ;;
  esac

  target_path="${repo_root}/${relative_path}"

  case "$target_path" in
    "$repo_root"|"$repo_prefix"*) ;;
    *)
      echo "[LightTable] Refusing to clean a path outside the LightTable repository: $target_path" >&2
      exit 1
      ;;
  esac

  if [ ! -e "$target_path" ]; then
    echo "[LightTable] Already clean: $relative_path"
    return
  fi

  rm -rf "$target_path"
  echo "[LightTable] Removed: $relative_path"
}

stop_lighttable_development_processes

clean_generated_path "apps/desktop/.vite"
clean_generated_path "node_modules/.vite"
clean_generated_path "apps/desktop/node_modules/.vite"
clean_generated_path "apps/web/node_modules/.vite"
clean_generated_path "packages/lighttable-app/node_modules/.vite"

echo "[LightTable] Development caches are clean."
