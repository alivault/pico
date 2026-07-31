use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock};

use crate::event_hub::EventHub;

const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
const CACHE_TTL: Duration = Duration::from_millis(750);
const DEFAULT_COMMITS_LIMIT: usize = 50;
const MAX_COMMITS_LIMIT: usize = 500;

#[derive(Debug, Clone)]
pub struct GitCommandOutput {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Default)]
pub struct GitRuntime {
    watched: RwLock<HashMap<PathBuf, String>>,
}

impl GitRuntime {
    pub async fn watch(&self, cwd: PathBuf) {
        self.watched.write().await.entry(cwd).or_default();
    }

    pub fn spawn_watcher(runtime: &Arc<Self>, event_hub: EventHub) {
        let runtime = Arc::downgrade(runtime);
        tokio::spawn(async move {
            watch_loop(runtime, event_hub).await;
        });
    }
}

struct CachedValue {
    expires_at: Instant,
    value: Value,
}

static CACHE: OnceLock<Mutex<HashMap<String, CachedValue>>> = OnceLock::new();

pub async fn status(cwd: &Path) -> io::Result<Option<Value>> {
    let key = format!("status:{}", cwd.display());
    cached(key, || async move { status_uncached(cwd).await }).await
}

pub async fn changes(
    cwd: &Path,
    scope: &str,
    commits_limit: Option<usize>,
) -> io::Result<Option<Value>> {
    if !inside_work_tree(cwd).await? {
        return Ok(None);
    }
    let limit = commits_limit
        .unwrap_or(DEFAULT_COMMITS_LIMIT)
        .clamp(1, MAX_COMMITS_LIMIT);
    let key = format!("changes:{}:{scope}:{limit}", cwd.display());
    cached(key, || async move {
        let files = if matches!(scope, "all" | "files") {
            files(cwd).await?
        } else {
            Vec::new()
        };
        let (local_branches, remote_branches) = if matches!(scope, "all" | "branches") {
            branches(cwd).await?
        } else {
            (Vec::new(), Vec::new())
        };
        let (commits, has_more, unpushed) = if matches!(scope, "all" | "commits") {
            commits(cwd, limit).await?
        } else {
            (Vec::new(), false, Vec::new())
        };
        Ok(Some(json!({
          "files": files,
          "localBranches": local_branches,
          "remoteBranches": remote_branches,
          "commits": commits,
          "commitsHasMore": has_more,
          "commitsLimit": if matches!(scope, "all" | "commits") { limit } else { 0 },
          "unpushedCommitHashes": unpushed
        })))
    })
    .await
}

pub async fn file_diff(cwd: &Path, path: &str) -> io::Result<String> {
    let path = validate_relative(path)?;
    let mut output = git(
        cwd,
        &["diff", "--no-ext-diff", "--", &path],
        Duration::from_secs(10),
    )
    .await?;
    if output.stdout.is_empty() {
        output = git(
            cwd,
            &["diff", "--cached", "--no-ext-diff", "--", &path],
            Duration::from_secs(10),
        )
        .await?;
    }
    if output.stdout.is_empty() {
        let status = git_allow_failure(
            cwd,
            &["status", "--porcelain=v1", "--", &path],
            Duration::from_secs(5),
        )
        .await?;
        if status.stdout.starts_with("??") {
            output = git_allow_failure(
                cwd,
                &[
                    "diff",
                    "--no-index",
                    "--no-ext-diff",
                    "--",
                    "/dev/null",
                    &path,
                ],
                Duration::from_secs(10),
            )
            .await?;
        }
    }
    Ok(output.stdout)
}

pub async fn file_review(
    cwd: &Path,
    path: &str,
    previous_path: Option<&str>,
) -> io::Result<(String, Option<String>, String, String)> {
    let path = validate_relative(path)?;
    let previous = previous_path.map(validate_relative).transpose()?;
    let old_path = previous.as_deref().unwrap_or(&path);
    let old = git_allow_failure(
        cwd,
        &["show", &format!("HEAD:{old_path}")],
        Duration::from_secs(10),
    )
    .await?;
    let full_path = cwd.join(&path);
    let new_content = match std::fs::read(&full_path) {
        Ok(bytes) if !bytes.contains(&0) && bytes.len() <= 4 * 1024 * 1024 => {
            String::from_utf8(bytes).unwrap_or_default()
        }
        _ => String::new(),
    };
    Ok((path, previous, old.stdout, new_content))
}

pub async fn commit_files(cwd: &Path, commit: &str) -> io::Result<Vec<Value>> {
    validate_revision(commit)?;
    let output = git(
        cwd,
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-M",
            commit,
        ],
        Duration::from_secs(10),
    )
    .await?;
    Ok(parse_name_status(&output.stdout))
}

pub async fn commit_diff(
    cwd: &Path,
    commit: &str,
    mode: &str,
    path: Option<&str>,
    previous_path: Option<&str>,
) -> io::Result<(String, String, Option<String>, Option<String>)> {
    validate_revision(commit)?;
    let path = path.map(validate_relative).transpose()?;
    let previous = previous_path.map(validate_relative).transpose()?;
    let title = match mode {
        "head" => format!("Changes since {commit}"),
        "previous" => format!("Changes in {commit}"),
        _ => commit_title(cwd, commit)
            .await
            .unwrap_or_else(|_| commit.to_string()),
    };
    let mut args = match mode {
        "head" => vec![
            "diff".into(),
            format!("{commit}..HEAD"),
            "--no-ext-diff".into(),
        ],
        "previous" => vec![
            "diff".into(),
            format!("{commit}^"),
            commit.into(),
            "--no-ext-diff".into(),
        ],
        _ => vec![
            "show".into(),
            "--format=fuller".into(),
            "--stat".into(),
            "--patch".into(),
            "--no-ext-diff".into(),
            commit.into(),
        ],
    };
    if path.is_some() || previous.is_some() {
        args.push("--".into());
        if let Some(previous) = &previous {
            args.push(previous.clone());
        }
        if let Some(path) = &path {
            if previous.as_ref() != Some(path) {
                args.push(path.clone());
            }
        }
    }
    let references = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = git(cwd, &references, Duration::from_secs(15)).await?;
    Ok((title, output.stdout, path, previous))
}

pub async fn commit_remote_url(cwd: &Path, commit: &str) -> io::Result<String> {
    validate_revision(commit)?;
    let hash = git(cwd, &["rev-parse", commit], Duration::from_secs(5))
        .await?
        .stdout
        .trim()
        .to_string();
    let remote = git(
        cwd,
        &["remote", "get-url", "origin"],
        Duration::from_secs(5),
    )
    .await?
    .stdout
    .trim()
    .to_string();
    remote_commit_url(&remote, &hash).ok_or_else(|| invalid("No remote URL found"))
}

pub async fn stage(
    cwd: &Path,
    action: &str,
    all: bool,
    path: Option<&str>,
    previous_path: Option<&str>,
) -> io::Result<GitCommandOutput> {
    let mut paths = action_paths(path, previous_path)?;
    let output = if action == "unstage-all" {
        git(cwd, &["reset", "--", "."], Duration::from_secs(15)).await?
    } else if action == "unstage" {
        let mut args = vec!["reset", "HEAD", "--"];
        args.extend(paths.iter().map(String::as_str));
        git(cwd, &args, Duration::from_secs(15)).await?
    } else if all || action == "stage-all" {
        git(cwd, &["add", "-A"], Duration::from_secs(15)).await?
    } else {
        let mut args = vec!["add", "--"];
        args.extend(paths.iter().map(String::as_str));
        git(cwd, &args, Duration::from_secs(15)).await?
    };
    paths.clear();
    invalidate_cache().await;
    Ok(output)
}

pub async fn discard(
    cwd: &Path,
    action: &str,
    all: bool,
    path: Option<&str>,
    previous_path: Option<&str>,
    status: Option<&str>,
) -> io::Result<GitCommandOutput> {
    let paths = action_paths(path, previous_path)?;
    let mut outputs = Vec::new();
    if action == "nuke-working-tree" {
        outputs.push(git(cwd, &["reset", "--hard", "HEAD"], Duration::from_secs(20)).await?);
        outputs.push(git(cwd, &["clean", "-fd"], Duration::from_secs(20)).await?);
    } else if all || action == "discard-all" {
        outputs.push(
            git(
                cwd,
                &["restore", "--staged", "--worktree", "."],
                Duration::from_secs(20),
            )
            .await?,
        );
        outputs.push(git(cwd, &["clean", "-fd"], Duration::from_secs(20)).await?);
    } else if status.is_some_and(|status| status == "??") {
        let mut args = vec!["clean", "-f", "--"];
        args.extend(paths.iter().map(String::as_str));
        outputs.push(git(cwd, &args, Duration::from_secs(15)).await?);
    } else {
        let mut args = vec!["restore", "--staged", "--worktree", "--"];
        args.extend(paths.iter().map(String::as_str));
        outputs.push(git(cwd, &args, Duration::from_secs(15)).await?);
    }
    invalidate_cache().await;
    Ok(combine(outputs))
}

pub async fn checkout(
    cwd: &Path,
    branch: &str,
    create: bool,
    start_point: Option<&str>,
    track: bool,
) -> io::Result<GitCommandOutput> {
    validate_ref_name(branch)?;
    if let Some(start_point) = start_point {
        validate_revision(start_point)?;
    }
    let mut args = vec!["switch"];
    if create {
        args.push("-c");
    }
    if track {
        args.push("--track");
    }
    args.push(branch);
    if let Some(start_point) = start_point.filter(|value| !value.is_empty()) {
        args.push(start_point);
    }
    let output = git(cwd, &args, Duration::from_secs(20)).await?;
    invalidate_cache().await;
    Ok(output)
}

pub async fn commit(
    cwd: &Path,
    message: &str,
    include_unstaged: bool,
    push: bool,
    force_push: bool,
) -> io::Result<GitCommandOutput> {
    if message.trim().is_empty() {
        return Err(invalid("commit message is required"));
    }
    let mut outputs = Vec::new();
    if include_unstaged {
        outputs.push(git(cwd, &["add", "-A"], Duration::from_secs(20)).await?);
    }
    outputs.push(git(cwd, &["commit", "-m", message], Duration::from_secs(60)).await?);
    if push {
        outputs.push(push_changes(cwd, force_push).await?);
    }
    invalidate_cache().await;
    Ok(combine(outputs))
}

pub async fn push_changes(cwd: &Path, force: bool) -> io::Result<GitCommandOutput> {
    let args = if force {
        vec!["push", "--force-with-lease"]
    } else {
        vec!["push"]
    };
    let output = git(cwd, &args, Duration::from_secs(120)).await?;
    invalidate_cache().await;
    Ok(output)
}

pub async fn pull_changes(cwd: &Path) -> io::Result<GitCommandOutput> {
    let output = git(cwd, &["pull", "--ff-only"], Duration::from_secs(120)).await?;
    invalidate_cache().await;
    Ok(output)
}

pub async fn commit_action(
    cwd: &Path,
    action: &str,
    commit: &str,
    tag_name: Option<&str>,
    reset_mode: Option<&str>,
    message: Option<&str>,
) -> io::Result<GitCommandOutput> {
    validate_revision(commit)?;
    let output = match action {
        "checkout" => {
            git(
                cwd,
                &["switch", "--detach", commit],
                Duration::from_secs(30),
            )
            .await?
        }
        "cherry-pick" => git(cwd, &["cherry-pick", commit], Duration::from_secs(60)).await?,
        "revert" => {
            git(
                cwd,
                &["revert", "--no-edit", commit],
                Duration::from_secs(60),
            )
            .await?
        }
        "tag" => {
            let tag = tag_name
                .filter(|tag| !tag.trim().is_empty())
                .ok_or_else(|| invalid("tagName is required"))?;
            validate_ref_name(tag)?;
            git(cwd, &["tag", tag, commit], Duration::from_secs(20)).await?
        }
        "reset" => {
            let mode = match reset_mode.unwrap_or("mixed") {
                "soft" => "--soft",
                "hard" => "--hard",
                _ => "--mixed",
            };
            git(cwd, &["reset", mode, commit], Duration::from_secs(30)).await?
        }
        "rebase" => git(cwd, &["rebase", commit], Duration::from_secs(120)).await?,
        "drop" => {
            let parent = format!("{commit}^");
            git(
                cwd,
                &["rebase", "--onto", &parent, commit],
                Duration::from_secs(120),
            )
            .await?
        }
        "squash" => {
            let message = message
                .filter(|message| !message.trim().is_empty())
                .ok_or_else(|| invalid("message is required"))?;
            let parent = format!("{commit}^");
            let reset = git(cwd, &["reset", "--soft", &parent], Duration::from_secs(30)).await?;
            let committed = git(cwd, &["commit", "-m", message], Duration::from_secs(60)).await?;
            combine(vec![reset, committed])
        }
        _ => return Err(invalid("unsupported commit action")),
    };
    invalidate_cache().await;
    Ok(output)
}

pub async fn commit_message_context(cwd: &Path) -> io::Result<String> {
    let staged = git_allow_failure(
        cwd,
        &["diff", "--cached", "--stat", "--patch", "--no-ext-diff"],
        Duration::from_secs(15),
    )
    .await?;
    let working = git_allow_failure(
        cwd,
        &["diff", "--stat", "--patch", "--no-ext-diff"],
        Duration::from_secs(15),
    )
    .await?;
    let status = git_allow_failure(cwd, &["status", "--short"], Duration::from_secs(10)).await?;
    let context = format!(
        "STATUS:\n{}\n\nSTAGED DIFF:\n{}\n\nWORKING DIFF:\n{}",
        status.stdout, staged.stdout, working.stdout
    );
    Ok(context.chars().take(24_000).collect())
}

pub async fn heuristic_commit_message(cwd: &Path) -> io::Result<String> {
    let changed = files(cwd).await?;
    if changed.is_empty() {
        return Err(invalid("No changes to commit"));
    }
    if changed.len() == 1 {
        let path = changed[0]
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("file");
        return Ok(format!("Update {path}"));
    }
    Ok(format!("Update {} files", changed.len()))
}

async fn status_uncached(cwd: &Path) -> io::Result<Option<Value>> {
    if !inside_work_tree(cwd).await? {
        return Ok(None);
    }
    let porcelain = git(cwd, &["status", "--porcelain=v1"], Duration::from_secs(10)).await?;
    let changed = porcelain
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .count();
    let branch_output = git_allow_failure(
        cwd,
        &["symbolic-ref", "--short", "-q", "HEAD"],
        Duration::from_secs(5),
    )
    .await?;
    let branch = branch_output.stdout.trim();
    let revision = git_allow_failure(
        cwd,
        &["rev-parse", "--short", "HEAD"],
        Duration::from_secs(5),
    )
    .await?
    .stdout
    .trim()
    .to_string();
    let detached = branch.is_empty();
    let label = if detached {
        revision.clone()
    } else {
        branch.to_string()
    };
    let ahead_behind = git_allow_failure(
        cwd,
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        Duration::from_secs(5),
    )
    .await?;
    let counts = ahead_behind
        .stdout
        .split_whitespace()
        .filter_map(|value| value.parse::<usize>().ok())
        .collect::<Vec<_>>();
    let behind = counts.first().copied().unwrap_or(0);
    let ahead = counts.get(1).copied().unwrap_or(0);
    let mut inline_parts = vec![label.clone()];
    if changed > 0 {
        inline_parts.push(format!(
            "{changed} {}",
            if changed == 1 { "change" } else { "changes" }
        ));
    }
    if ahead > 0 {
        inline_parts.push(format!("↑{ahead}"));
    }
    if behind > 0 {
        inline_parts.push(format!("↓{behind}"));
    }
    let mut title_parts = vec![label.clone()];
    if changed > 0 {
        title_parts.push(format!(
            "{changed} changed {}",
            if changed == 1 { "file" } else { "files" }
        ));
    }
    if ahead > 0 {
        title_parts.push(format!(
            "{ahead} {} ahead",
            if ahead == 1 { "commit" } else { "commits" }
        ));
    }
    if behind > 0 {
        title_parts.push(format!(
            "{behind} {} behind",
            if behind == 1 { "commit" } else { "commits" }
        ));
    }
    Ok(Some(json!({
      "branch": (!branch.is_empty()).then_some(branch),
      "detached": detached,
      "revision": (!revision.is_empty()).then_some(revision),
      "dirty": changed > 0,
      "changedFileCount": changed,
      "ahead": ahead,
      "behind": behind,
      "inline": inline_parts.join(" · "),
      "label": label,
      "title": title_parts.join(", ")
    })))
}

async fn files(cwd: &Path) -> io::Result<Vec<Value>> {
    let output = git(
        cwd,
        &["status", "--porcelain=v1", "-z"],
        Duration::from_secs(10),
    )
    .await?;
    let records = output
        .stdout
        .split('\0')
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        if record.len() < 3 {
            index += 1;
            continue;
        }
        let status = &record[..2];
        let path = record[3..].to_string();
        let renamed = status.contains('R') || status.contains('C');
        let previous = renamed.then(|| records.get(index + 1).copied()).flatten();
        files.push(json!({
          "status": status.trim(),
          "path": path,
          "previousPath": previous
        }));
        index += if renamed { 2 } else { 1 };
    }
    Ok(files)
}

async fn branches(cwd: &Path) -> io::Result<(Vec<Value>, Vec<Value>)> {
    let local = git(cwd, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(objectname:short)%1f%(subject)%1f%(committerdate:relative)%1f%(committerdate:iso-strict)", "refs/heads"], Duration::from_secs(10)).await?;
    let remote = git(cwd, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%1f%(objectname:short)%1f%(subject)%1f%(committerdate:relative)%1f%(committerdate:iso-strict)", "refs/remotes"], Duration::from_secs(10)).await?;
    let local = local
        .stdout
        .lines()
        .filter_map(|line| {
            let fields = line.split('\u{1f}').collect::<Vec<_>>();
            (fields.len() >= 8).then(|| {
                let track = fields[3];
                json!({
                  "name": fields[0],
                  "current": fields[1] == "*",
                  "upstream": nonempty(fields[2]),
                  "ahead": parse_track(track, "ahead"),
                  "behind": parse_track(track, "behind"),
                  "upstreamGone": track.contains("gone"),
                  "hash": nonempty(fields[4]),
                  "subject": nonempty(fields[5]),
                  "relativeDate": nonempty(fields[6]),
                  "committerDate": nonempty(fields[7])
                })
            })
        })
        .collect();
    let remote =
        remote
            .stdout
            .lines()
            .filter_map(|line| {
                let fields = line.split('\u{1f}').collect::<Vec<_>>();
                (fields.len() >= 5 && !fields[0].ends_with("/HEAD")).then(|| json!({
          "name": fields[0], "hash": nonempty(fields[1]), "subject": nonempty(fields[2]),
          "relativeDate": nonempty(fields[3]), "committerDate": nonempty(fields[4])
        }))
            })
            .collect();
    Ok((local, remote))
}

async fn commits(cwd: &Path, limit: usize) -> io::Result<(Vec<String>, bool, Vec<String>)> {
    let output = git(
        cwd,
        &[
            "log",
            "--pretty=format:%h%x09%H%x1f%P%x1f%an%x1f%ar%x1f%aI%x1f%s",
            "--date-order",
            "-n",
            &(limit + 1).to_string(),
            "--no-color",
            "HEAD",
        ],
        Duration::from_secs(15),
    )
    .await?;
    let mut lines = output
        .stdout
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let has_more = lines.len() > limit;
    lines.truncate(limit);
    let unpushed = git_allow_failure(
        cwd,
        &["rev-list", "@{upstream}..HEAD"],
        Duration::from_secs(10),
    )
    .await?
    .stdout
    .lines()
    .map(str::to_string)
    .collect();
    Ok((lines, has_more, unpushed))
}

async fn commit_title(cwd: &Path, commit: &str) -> io::Result<String> {
    Ok(git(
        cwd,
        &["show", "-s", "--format=%h %s", commit],
        Duration::from_secs(5),
    )
    .await?
    .stdout
    .trim()
    .to_string())
}

async fn inside_work_tree(cwd: &Path) -> io::Result<bool> {
    let output = git_allow_failure(
        cwd,
        &["rev-parse", "--is-inside-work-tree"],
        Duration::from_secs(5),
    )
    .await?;
    Ok(output.stdout.trim() == "true")
}

async fn cached<F, Fut>(key: String, load: F) -> io::Result<Option<Value>>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = io::Result<Option<Value>>>,
{
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(value) = cache
        .lock()
        .await
        .get(&key)
        .filter(|cached| cached.expires_at > Instant::now())
        .map(|cached| cached.value.clone())
    {
        return Ok(Some(value));
    }
    let value = load().await?;
    if let Some(value) = &value {
        cache.lock().await.insert(
            key,
            CachedValue {
                expires_at: Instant::now() + CACHE_TTL,
                value: value.clone(),
            },
        );
    }
    Ok(value)
}

async fn invalidate_cache() {
    if let Some(cache) = CACHE.get() {
        cache.lock().await.clear();
    }
}

async fn git(cwd: &Path, args: &[&str], timeout: Duration) -> io::Result<GitCommandOutput> {
    run_git(cwd, args, timeout, false).await
}

async fn git_allow_failure(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> io::Result<GitCommandOutput> {
    run_git(cwd, args, timeout, true).await
}

async fn run_git(
    cwd: &Path,
    args: &[&str],
    timeout_duration: Duration,
    allow_failure: bool,
) -> io::Result<GitCommandOutput> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(timeout_duration, command.output())
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "git command timed out"))??;
    let stdout = truncate_output(output.stdout);
    let stderr = truncate_output(output.stderr);
    if !allow_failure && !output.status.success() {
        return Err(invalid(if stderr.trim().is_empty() {
            "git command failed"
        } else {
            stderr.trim()
        }));
    }
    if allow_failure && !output.status.success() {
        return Ok(GitCommandOutput { stdout, stderr });
    }
    Ok(GitCommandOutput { stdout, stderr })
}

async fn watch_loop(runtime: Weak<GitRuntime>, event_hub: EventHub) {
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    loop {
        interval.tick().await;
        let Some(runtime) = runtime.upgrade() else {
            return;
        };
        let directories = runtime
            .watched
            .read()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for cwd in directories {
            let signature = git_signature(&cwd).await.unwrap_or_default();
            let previous = runtime
                .watched
                .write()
                .await
                .insert(cwd.clone(), signature.clone());
            if previous.is_some_and(|previous| !previous.is_empty() && previous != signature) {
                invalidate_cache().await;
                let repository_root = git_allow_failure(
                    &cwd,
                    &["rev-parse", "--show-toplevel"],
                    Duration::from_secs(5),
                )
                .await
                .ok()
                .map(|output| output.stdout.trim().to_string());
                event_hub.push(None, None, json!({
                  "type": "git_changed",
                  "cwd": cwd,
                  "repositoryRoot": repository_root,
                  "changedAt": time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000,
                  "scopes": ["status", "files", "refs"]
                }));
            }
        }
    }
}

async fn git_signature(cwd: &Path) -> io::Result<String> {
    let status = git_allow_failure(
        cwd,
        &["status", "--porcelain=v1", "-uno"],
        Duration::from_secs(5),
    )
    .await?;
    let head = git_allow_failure(cwd, &["rev-parse", "HEAD"], Duration::from_secs(5)).await?;
    Ok(format!("{}\0{}", head.stdout, status.stdout))
}

fn parse_name_status(output: &str) -> Vec<Value> {
    output
        .lines()
        .filter_map(|line| {
            let fields = line.split('\t').collect::<Vec<_>>();
            if fields.len() < 2 {
                return None;
            }
            let renamed = fields[0].starts_with(['R', 'C']) && fields.len() >= 3;
            Some(json!({
              "status": fields[0],
              "path": if renamed { fields[2] } else { fields[1] },
              "previousPath": renamed.then_some(fields[1])
            }))
        })
        .collect()
}

fn action_paths(path: Option<&str>, previous_path: Option<&str>) -> io::Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    for path in [path, previous_path]
        .into_iter()
        .flatten()
        .filter(|path| !path.trim().is_empty())
    {
        let path = validate_relative(path)?;
        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }
    if paths.is_empty() {
        return Err(invalid("file path is required"));
    }
    Ok(paths)
}

fn validate_relative(path: &str) -> io::Result<String> {
    let path = path.trim().replace('\\', "/");
    let parsed = Path::new(&path);
    if path.is_empty()
        || parsed.is_absolute()
        || parsed.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(invalid("git path must stay inside the repository"));
    }
    Ok(path)
}

fn validate_revision(revision: &str) -> io::Result<()> {
    if revision.trim().is_empty()
        || revision.starts_with('-')
        || revision.contains(['\0', '\n', '\r'])
    {
        return Err(invalid("invalid git revision"));
    }
    Ok(())
}

fn validate_ref_name(reference: &str) -> io::Result<()> {
    validate_revision(reference)?;
    if reference.contains([' ', '~', '^', ':', '?', '*', '[', '\\'])
        || reference.contains("..")
        || reference.ends_with('.')
    {
        return Err(invalid("invalid git ref name"));
    }
    Ok(())
}

fn remote_commit_url(remote: &str, hash: &str) -> Option<String> {
    let base = if let Some(path) = remote.strip_prefix("git@") {
        let (host, path) = path.split_once(':')?;
        format!("https://{host}/{path}")
    } else if remote.starts_with("http://") || remote.starts_with("https://") {
        remote.to_string()
    } else if let Some(path) = remote.strip_prefix("ssh://git@") {
        let (host, path) = path.split_once('/')?;
        format!("https://{host}/{path}")
    } else {
        return None;
    };
    Some(format!(
        "{}/commit/{hash}",
        base.trim_end_matches('/').trim_end_matches(".git")
    ))
}

fn parse_track(value: &str, name: &str) -> usize {
    let marker = format!("{name} ");
    value
        .find(&marker)
        .and_then(|index| value[index + marker.len()..].split([',', ']']).next())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn nonempty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}

fn combine(outputs: Vec<GitCommandOutput>) -> GitCommandOutput {
    GitCommandOutput {
        stdout: outputs
            .iter()
            .map(|output| output.stdout.trim())
            .filter(|output| !output.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        stderr: outputs
            .iter()
            .map(|output| output.stderr.trim())
            .filter(|output| !output.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn truncate_output(bytes: Vec<u8>) -> String {
    let bytes = if bytes.len() > OUTPUT_LIMIT {
        &bytes[bytes.len() - OUTPUT_LIMIT..]
    } else {
        &bytes
    };
    String::from_utf8_lossy(bytes).into_owned()
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    async fn repository() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pico-git-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&root).expect("repo");
        git(&root, &["init", "-b", "main"], Duration::from_secs(10))
            .await
            .expect("init");
        git(
            &root,
            &["config", "user.email", "pico@example.com"],
            Duration::from_secs(10),
        )
        .await
        .expect("email");
        git(
            &root,
            &["config", "user.name", "Pico Test"],
            Duration::from_secs(10),
        )
        .await
        .expect("name");
        std::fs::write(root.join("README.md"), "one\n").expect("write");
        git(&root, &["add", "README.md"], Duration::from_secs(10))
            .await
            .expect("add");
        git(&root, &["commit", "-m", "Initial"], Duration::from_secs(10))
            .await
            .expect("commit");
        root
    }

    #[tokio::test]
    async fn status_diff_and_mutations_work_in_disposable_repository() {
        let root = repository().await;
        std::fs::write(root.join("README.md"), "one\ntwo\n").expect("change");
        let status = status(&root).await.expect("status").expect("repo");
        assert_eq!(status["branch"], "main");
        assert_eq!(status["dirty"], true);
        assert!(file_diff(&root, "README.md")
            .await
            .expect("diff")
            .contains("+two"));
        stage(&root, "stage", false, Some("README.md"), None)
            .await
            .expect("stage");
        commit(&root, "Update readme", false, false, false)
            .await
            .expect("commit");
        assert_eq!(
            commit_files(&root, "HEAD").await.expect("files")[0]["path"],
            "README.md"
        );
        std::fs::remove_dir_all(root).expect("remove repo");
    }

    #[tokio::test]
    async fn watcher_emits_scoped_change_events() {
        let root = repository().await;
        let runtime = Arc::new(GitRuntime::default());
        let hub = EventHub::default();
        let mut events = hub.subscribe();
        runtime.watch(root.clone()).await;
        GitRuntime::spawn_watcher(&runtime, hub);
        tokio::time::sleep(Duration::from_millis(1_200)).await;
        std::fs::write(root.join("README.md"), "watch change\n").expect("change");
        let event = tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                let event = events.recv().await.expect("event");
                if event.payload["type"] == "git_changed" {
                    break event;
                }
            }
        })
        .await
        .expect("watch event timeout");
        assert_eq!(event.payload["cwd"], root.to_string_lossy().as_ref());
        std::fs::remove_dir_all(root).expect("remove repo");
    }

    #[test]
    fn validates_paths_revisions_and_remote_urls() {
        assert!(validate_relative("../secret").is_err());
        assert!(validate_revision("--help").is_err());
        assert!(validate_ref_name("bad branch").is_err());
        assert_eq!(
            remote_commit_url("git@github.com:alivault/pico.git", "abc").as_deref(),
            Some("https://github.com/alivault/pico/commit/abc")
        );
    }
}
