use std::collections::HashMap;

use gpui::{
    App, AppContext as _, Context, Entity, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, ScrollHandle, StatefulInteractiveElement as _, Styled as _,
    Subscription, Window, div, prelude::FluentBuilder as _, px,
};
use gpui_component::{
    ActiveTheme as _, Disableable as _, Icon, IconName, Root, Sizable as _, StyledExt as _,
    button::{Button, ButtonVariants as _},
    h_flex,
    input::{Input, InputEvent, InputState, Textarea, TextareaState},
    scroll::ScrollableElement as _,
    text::TextView,
    v_flex,
};
use smol::channel::{Receiver, Sender};

use crate::client::PicoClient;
use crate::models::{
    AssistantBlock, ConversationItem, DesktopEvent, DirectorySessionsIndex, GitChangeFile,
    GitLocalBranch, GitStatusSummary, SessionListEntry, SessionState, UserConversationItem,
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum RightWorkspaceTab {
    #[default]
    Changes,
    Files,
}

pub struct PicoDesktop {
    client: PicoClient,
    tx: Sender<DesktopEvent>,
    connected: bool,
    server_label: String,
    directories: Vec<String>,
    selected_directory: String,
    selected_session_id: Option<String>,
    selected_session_path: Option<String>,
    selected_session_unread: bool,
    confirm_delete_session: bool,
    session: SessionState,
    directory_indexes: HashMap<String, DirectorySessionsIndex>,
    files: Vec<String>,
    files_cwd: Option<String>,
    active_right_tab: RightWorkspaceTab,
    selected_file_path: Option<String>,
    selected_file_content: Option<String>,
    git_status: Option<GitStatusSummary>,
    git_files: Vec<GitChangeFile>,
    git_branches: Vec<GitLocalBranch>,
    git_commits: Vec<String>,
    selected_git_path: Option<String>,
    selected_git_diff: Option<String>,
    pending_discard_path: Option<String>,
    status_message: Option<String>,
    left_sidebar_open: bool,
    right_sidebar_open: bool,
    search: Entity<InputState>,
    directory_input: Entity<InputState>,
    session_name_input: Entity<InputState>,
    composer: Entity<TextareaState>,
    commit_message: Entity<InputState>,
    conversation_scroll: ScrollHandle,
    _event_task: gpui::Task<()>,
    _subscriptions: Vec<Subscription>,
}

impl PicoDesktop {
    pub fn new(
        client: PicoClient,
        initial_directory: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search sessions…"));
        let directory_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Add project directory…"));
        let session_name_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Rename selected session…"));
        let composer = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(2, 8)
                .submit_on_enter(true)
                .placeholder("Ask anything…")
        });
        let commit_message = cx.new(|cx| InputState::new(window, cx).placeholder("Commit message"));
        let (tx, rx) = smol::channel::unbounded();

        client.connect(tx.clone());
        client.start_events(None, None, vec![initial_directory.clone()], tx.clone());

        let _event_task = Self::listen_for_events(rx, cx);
        let _subscriptions = vec![
            cx.subscribe_in(&search, window, |_, _, event, _, cx| {
                if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
            cx.subscribe_in(&composer, window, |this, _, event, window, cx| {
                if matches!(event, InputEvent::PressEnter { shift: false, .. }) {
                    this.submit_prompt(window, cx);
                }
            }),
        ];

        Self {
            client,
            tx,
            connected: false,
            server_label: "Connecting…".into(),
            directories: vec![initial_directory.clone()],
            selected_directory: initial_directory,
            selected_session_id: None,
            selected_session_path: None,
            selected_session_unread: false,
            confirm_delete_session: false,
            session: SessionState::default(),
            directory_indexes: HashMap::new(),
            files: Vec::new(),
            files_cwd: None,
            active_right_tab: RightWorkspaceTab::Changes,
            selected_file_path: None,
            selected_file_content: None,
            git_status: None,
            git_files: Vec::new(),
            git_branches: Vec::new(),
            git_commits: Vec::new(),
            selected_git_path: None,
            selected_git_diff: None,
            pending_discard_path: None,
            status_message: None,
            left_sidebar_open: true,
            right_sidebar_open: true,
            search,
            directory_input,
            session_name_input,
            composer,
            commit_message,
            conversation_scroll: ScrollHandle::new(),
            _event_task,
            _subscriptions,
        }
    }

    fn listen_for_events(rx: Receiver<DesktopEvent>, cx: &mut Context<Self>) -> gpui::Task<()> {
        cx.spawn(async move |this, cx| {
            while let Ok(event) = rx.recv().await {
                if this
                    .update(cx, |this, cx| {
                        this.apply_event(event, cx);
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
    }

    fn apply_event(&mut self, event: DesktopEvent, cx: &mut Context<Self>) {
        match event {
            DesktopEvent::Connected(manifest) => {
                self.connected = true;
                self.server_label = format!("{} {}", manifest.display_name, manifest.version);
                self.status_message = None;
            }
            DesktopEvent::State(sync) => {
                self.session.apply(sync);
                self.status_message = None;
                if self.selected_session_id.is_none() {
                    self.selected_session_id = self.session.session_id.clone();
                }
                let cwd = self
                    .session
                    .cwd
                    .clone()
                    .unwrap_or_else(|| self.selected_directory.clone());
                if self.files_cwd.as_deref() != Some(&cwd) {
                    self.files_cwd = Some(cwd.clone());
                    self.client.load_files(cwd.clone(), self.tx.clone());
                    self.client.load_git(cwd, self.tx.clone());
                }
                self.conversation_scroll.scroll_to_bottom();
            }
            DesktopEvent::Sessions(event) => {
                if !event.directories.is_empty() {
                    self.directories = event.directories;
                }
                self.directory_indexes.extend(event.directory_indexes);
                if let Some(active_session_id) = event.active_session_id
                    && self.selected_session_id.is_none()
                {
                    self.selected_session_id = Some(active_session_id);
                }
            }
            DesktopEvent::Delta(event) => {
                if self.selected_session_id.as_deref() == Some(event.session_id.as_str())
                    || self.session.session_id.as_deref() == Some(event.session_id.as_str())
                {
                    self.session.apply_delta(event);
                    self.conversation_scroll.scroll_to_bottom();
                }
            }
            DesktopEvent::Files(paths) => self.files = paths,
            DesktopEvent::FileRead(response) => {
                self.selected_file_path = Some(response.path);
                self.selected_file_content = Some(response.content);
                self.status_message = None;
            }
            DesktopEvent::GitStatus(status) => self.git_status = status,
            DesktopEvent::GitChanges(response) => {
                self.git_files = response.files.unwrap_or_default();
                self.git_branches = response.local_branches.unwrap_or_default();
                self.git_commits = response.commits.unwrap_or_default();
                self.status_message = None;
            }
            DesktopEvent::GitDiff(response) => {
                self.selected_git_path = Some(response.path);
                self.selected_git_diff = Some(response.patch);
                self.status_message = None;
            }
            DesktopEvent::GitMutation(message) => {
                self.status_message = Some(message);
                self.pending_discard_path = None;
                if let Some(cwd) = self.files_cwd.clone() {
                    self.client.load_files(cwd.clone(), self.tx.clone());
                    self.client.load_git(cwd, self.tx.clone());
                }
            }
            DesktopEvent::GitRefresh(cwd) => {
                if self.files_cwd.as_deref() == Some(cwd.as_str()) {
                    self.client.load_files(cwd.clone(), self.tx.clone());
                    self.client.load_git(cwd, self.tx.clone());
                }
            }
            DesktopEvent::PromptSent => {
                self.status_message = None;
            }
            DesktopEvent::SessionSelected(session_id) => {
                self.selected_session_id = Some(session_id.clone());
                self.session = SessionState::default();
                self.status_message = Some("Loading session…".into());
                self.restart_events(Some(session_id), None);
            }
            DesktopEvent::DirectoryResolved(directory) => {
                if !self.directories.contains(&directory) {
                    self.directories.push(directory.clone());
                }
                self.selected_directory = directory;
                self.status_message = None;
                self.restart_events(
                    self.selected_session_id.clone(),
                    self.session.session_key.clone(),
                );
            }
            DesktopEvent::SessionAction {
                message,
                clear_selection,
            } => {
                self.status_message = Some(message);
                self.confirm_delete_session = false;
                if clear_selection {
                    self.selected_session_id = None;
                    self.selected_session_path = None;
                    self.session = SessionState::default();
                    self.restart_events(None, None);
                }
            }
            DesktopEvent::SessionMoved { path, cwd } => {
                self.selected_session_path = Some(path);
                self.selected_directory = cwd;
                self.status_message = Some("Moved session".into());
            }
            DesktopEvent::SessionCreated { session_key, cwd } => {
                self.selected_session_id = None;
                self.session = SessionState {
                    session_key: Some(session_key.clone()),
                    cwd: Some(cwd),
                    draft: true,
                    ..SessionState::default()
                };
                self.restart_events(None, Some(session_key));
            }
            DesktopEvent::ModelChanged(model) => {
                self.session.model = Some(model);
                self.status_message = None;
            }
            DesktopEvent::ThinkingChanged(level) => {
                self.session.thinking_level = Some(level);
                self.status_message = None;
            }
            DesktopEvent::Error(error) => {
                self.status_message = Some(error);
            }
        }
        cx.notify();
    }

    fn restart_events(&self, session_id: Option<String>, session_key: Option<String>) {
        self.client.start_events(
            session_id,
            session_key,
            self.directories.clone(),
            self.tx.clone(),
        );
    }

    fn select_session(
        &mut self,
        session: SessionListEntry,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(session_id) = session.id.clone() else {
            return;
        };
        if self.selected_session_id.as_deref() == Some(session_id.as_str()) {
            return;
        }
        self.selected_session_path = session.path.clone();
        self.selected_session_unread = session.unread;
        self.confirm_delete_session = false;
        self.session_name_input.update(cx, |state, cx| {
            state.set_value(session.name.unwrap_or(session.title), window, cx);
        });
        self.status_message = Some("Loading session…".into());
        self.client
            .select_session(session_id, session.path, self.tx.clone());
        cx.notify();
    }

    fn add_directory(&mut self, cx: &mut Context<Self>) {
        let path = self.directory_input.read(cx).value().trim().to_string();
        if path.is_empty() {
            return;
        }
        self.status_message = Some("Resolving directory…".into());
        self.client.resolve_directory(path, self.tx.clone());
        cx.notify();
    }

    fn remove_directory(&mut self, directory: String, cx: &mut Context<Self>) {
        if self.directories.len() <= 1 {
            self.status_message = Some("Keep at least one project directory.".into());
            cx.notify();
            return;
        }
        self.directories.retain(|candidate| candidate != &directory);
        self.directory_indexes.remove(&directory);
        if self.selected_directory == directory {
            self.selected_directory = self.directories[0].clone();
        }
        self.restart_events(
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
        );
        cx.notify();
    }

    fn select_directory(&mut self, directory: String, cx: &mut Context<Self>) {
        self.selected_directory = directory;
        cx.notify();
    }

    fn move_directory(&mut self, directory: String, offset: isize, cx: &mut Context<Self>) {
        let Some(index) = self
            .directories
            .iter()
            .position(|candidate| candidate == &directory)
        else {
            return;
        };
        let next = (index as isize + offset)
            .clamp(0, self.directories.len().saturating_sub(1) as isize)
            as usize;
        if next != index {
            self.directories.swap(index, next);
            self.restart_events(
                self.selected_session_id.clone(),
                self.session.session_key.clone(),
            );
            cx.notify();
        }
    }

    fn rename_selected_session(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self.selected_session_path.clone() else {
            return;
        };
        let name = self.session_name_input.read(cx).value().trim().to_string();
        if name.is_empty() {
            return;
        }
        self.client.rename_session(path, name, self.tx.clone());
        self.status_message = Some("Renaming session…".into());
        cx.notify();
    }

    fn delete_selected_session(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self.selected_session_path.clone() else {
            return;
        };
        if !self.confirm_delete_session {
            self.confirm_delete_session = true;
            self.status_message = Some("Click Delete again to confirm.".into());
            cx.notify();
            return;
        }
        self.client.delete_session(path, self.tx.clone());
        self.status_message = Some("Deleting session…".into());
        cx.notify();
    }

    fn clone_selected_session(&mut self, cx: &mut Context<Self>) {
        let Some(session_id) = self.selected_session_id.clone() else {
            return;
        };
        self.client.clone_session(session_id, self.tx.clone());
        self.status_message = Some("Cloning session…".into());
        cx.notify();
    }

    fn toggle_selected_session_read(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self.selected_session_path.clone() else {
            return;
        };
        let unread = !self.selected_session_unread;
        self.selected_session_unread = unread;
        self.client
            .set_session_unread(path, unread, self.tx.clone());
        cx.notify();
    }

    fn move_selected_session(&mut self, cwd: String, cx: &mut Context<Self>) {
        let Some(path) = self.selected_session_path.clone() else {
            return;
        };
        self.client.move_session(path, cwd, self.tx.clone());
        self.status_message = Some("Moving session…".into());
        cx.notify();
    }

    fn create_session(&mut self, cx: &mut Context<Self>) {
        self.status_message = Some("Creating session…".into());
        self.client
            .create_session(self.selected_directory.clone(), self.tx.clone());
        cx.notify();
    }

    fn submit_prompt(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let message = self.composer.read(cx).value().trim().to_string();
        if message.is_empty() {
            return;
        }
        self.composer.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
        self.session
            .items
            .push(ConversationItem::User(UserConversationItem {
                item_key: Some(format!("optimistic-{}", self.session.items.len())),
                text: message.clone(),
            }));
        self.status_message = Some("Sending…".into());
        self.conversation_scroll.scroll_to_bottom();
        self.client.submit_prompt(
            message,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.session
                .cwd
                .clone()
                .or_else(|| Some(self.selected_directory.clone())),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn abort(&mut self, cx: &mut Context<Self>) {
        self.client.abort(
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        self.status_message = Some("Stopping…".into());
        cx.notify();
    }

    fn cycle_model(&mut self, cx: &mut Context<Self>) {
        let models = &self.session.available_models;
        if models.is_empty() {
            return;
        }
        let index = self
            .session
            .model
            .as_ref()
            .and_then(|model| models.iter().position(|candidate| candidate.id == model.id))
            .map(|index| (index + 1) % models.len())
            .unwrap_or(0);
        let model = models[index].clone();
        self.status_message = Some(format!("Switching to {}…", model.label()));
        self.client.set_model(
            model,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn cycle_thinking(&mut self, cx: &mut Context<Self>) {
        let levels = &self.session.available_thinking_levels;
        if levels.is_empty() {
            return;
        }
        let index = self
            .session
            .thinking_level
            .as_ref()
            .and_then(|level| levels.iter().position(|candidate| candidate == level))
            .map(|index| (index + 1) % levels.len())
            .unwrap_or(0);
        let level = levels[index].clone();
        self.status_message = Some(format!("Setting thinking to {level}…"));
        self.client.set_thinking(
            level,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn refresh_right_workspace(&mut self, cx: &mut Context<Self>) {
        if let Some(cwd) = self.files_cwd.clone() {
            self.status_message = Some("Refreshing project…".into());
            self.client.load_files(cwd.clone(), self.tx.clone());
            self.client.load_git(cwd, self.tx.clone());
            cx.notify();
        }
    }

    fn open_project_file(&mut self, path: String, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.status_message = Some(format!("Opening {path}…"));
        self.client.load_file(cwd, path, self.tx.clone());
        cx.notify();
    }

    fn open_git_diff(&mut self, path: String, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.status_message = Some(format!("Loading diff for {path}…"));
        self.client.load_git_diff(cwd, path, self.tx.clone());
        cx.notify();
    }

    fn stage_all(&mut self, unstage: bool, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.status_message = Some(if unstage {
            "Unstaging changes…".into()
        } else {
            "Staging changes…".into()
        });
        self.client.stage_git_all(cwd, unstage, self.tx.clone());
        cx.notify();
    }

    fn stage_file(&mut self, file: GitChangeFile, unstage: bool, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.client
            .stage_git_file(cwd, file.path, file.previous_path, unstage, self.tx.clone());
        self.status_message = Some(if unstage {
            "Unstaging file…".into()
        } else {
            "Staging file…".into()
        });
        cx.notify();
    }

    fn discard_file(&mut self, file: GitChangeFile, cx: &mut Context<Self>) {
        if self.pending_discard_path.as_deref() != Some(file.path.as_str()) {
            self.pending_discard_path = Some(file.path);
            self.status_message = Some("Click Discard again to confirm.".into());
            cx.notify();
            return;
        }
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.client.discard_git_file(
            cwd,
            file.path,
            file.previous_path,
            file.status,
            self.tx.clone(),
        );
        self.status_message = Some("Discarding file changes…".into());
        cx.notify();
    }

    fn commit(&mut self, push: bool, cx: &mut Context<Self>) {
        let message = self.commit_message.read(cx).value().trim().to_string();
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        if message.is_empty() {
            self.status_message = Some("Enter a commit message first.".into());
            cx.notify();
            return;
        }
        self.client.commit_git(cwd, message, push, self.tx.clone());
        self.status_message = Some("Committing changes…".into());
        cx.notify();
    }

    fn push(&mut self, force: bool, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.client.push_git(cwd, force, self.tx.clone());
        self.status_message = Some("Pushing changes…".into());
        cx.notify();
    }

    fn pull(&mut self, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.client.pull_git(cwd, self.tx.clone());
        self.status_message = Some("Pulling changes…".into());
        cx.notify();
    }

    fn checkout_branch(&mut self, branch: String, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.client.checkout_branch(cwd, branch, self.tx.clone());
        self.status_message = Some("Checking out branch…".into());
        cx.notify();
    }

    fn sessions(&self, cx: &App) -> Vec<SessionListEntry> {
        let query = self.search.read(cx).value().trim().to_lowercase();
        self.directory_indexes
            .get(&self.selected_directory)
            .map(|index| {
                index
                    .sessions
                    .iter()
                    .filter(|session| {
                        query.is_empty()
                            || session.title.to_lowercase().contains(&query)
                            || session
                                .last_message_preview
                                .as_deref()
                                .unwrap_or_default()
                                .to_lowercase()
                                .contains(&query)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    fn basename(path: &str) -> &str {
        path.trim_end_matches('/')
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or(path)
    }

    fn render_left_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border.opacity(0.72);
        let foreground = cx.theme().foreground;
        let muted = cx.theme().muted_foreground;
        let selected = cx.theme().secondary;
        let selected_id = self.selected_session_id.clone();
        let sessions = self.sessions(cx);

        v_flex()
            .w(px(300.))
            .h_full()
            .flex_shrink_0()
            .border_r_1()
            .border_color(border)
            .bg(cx.theme().sidebar)
            .child(
                v_flex()
                    .p_3()
                    .gap_2()
                    .border_b_1()
                    .border_color(border)
                    .child(
                        Input::new(&self.search)
                            .cleanable(true)
                            .prefix(Icon::new(IconName::Search).size_4()),
                    )
                    .child(
                        Button::new("new-session")
                            .ghost()
                            .w_full()
                            .justify_start()
                            .icon(IconName::Plus)
                            .label("New session")
                            .on_click(cx.listener(|this, _, _, cx| this.create_session(cx))),
                    )
                    .child(
                        h_flex()
                            .gap_1()
                            .child(Input::new(&self.directory_input).cleanable(true))
                            .child(
                                Button::new("add-directory")
                                    .secondary()
                                    .small()
                                    .icon(IconName::Plus)
                                    .on_click(cx.listener(|this, _, _, cx| this.add_directory(cx))),
                            ),
                    ),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_h_0()
                    .p_2()
                    .gap_1()
                    .overflow_y_scrollbar()
                    .child(
                        h_flex()
                            .px_2()
                            .py_2()
                            .justify_between()
                            .text_sm()
                            .text_color(muted)
                            .child("Directories")
                            .child(
                                Icon::new(IconName::FolderOpen)
                                    .size_4()
                                    .text_color(foreground),
                            ),
                    )
                    .child(
                        v_flex()
                            .max_h(px(230.))
                            .flex_shrink_0()
                            .overflow_y_scrollbar()
                            .children(self.directories.iter().enumerate().map(
                                |(index, directory)| {
                                    let select_directory = directory.clone();
                                    let move_up_directory = directory.clone();
                                    let move_down_directory = directory.clone();
                                    let remove_directory = directory.clone();
                                    let is_selected = directory == &self.selected_directory;
                                    h_flex()
                                        .id(("directory", index))
                                        .px_2()
                                        .py_1()
                                        .gap_1()
                                        .rounded_md()
                                        .when(is_selected, |this| this.bg(selected))
                                        .child(
                                            h_flex()
                                                .id(("directory-select", index))
                                                .flex_1()
                                                .min_w_0()
                                                .gap_2()
                                                .cursor_pointer()
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.select_directory(
                                                        select_directory.clone(),
                                                        cx,
                                                    );
                                                }))
                                                .child(Icon::new(IconName::Folder).size_4())
                                                .child(
                                                    div()
                                                        .overflow_hidden()
                                                        .whitespace_nowrap()
                                                        .text_ellipsis()
                                                        .text_sm()
                                                        .font_semibold()
                                                        .child(
                                                            Self::basename(directory).to_string(),
                                                        ),
                                                ),
                                        )
                                        .child(
                                            Button::new(("directory-up", index))
                                                .ghost()
                                                .xsmall()
                                                .disabled(index == 0)
                                                .label("↑")
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.move_directory(
                                                        move_up_directory.clone(),
                                                        -1,
                                                        cx,
                                                    );
                                                })),
                                        )
                                        .child(
                                            Button::new(("directory-down", index))
                                                .ghost()
                                                .xsmall()
                                                .disabled(index + 1 == self.directories.len())
                                                .label("↓")
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.move_directory(
                                                        move_down_directory.clone(),
                                                        1,
                                                        cx,
                                                    );
                                                })),
                                        )
                                        .child(
                                            Button::new(("directory-remove", index))
                                                .ghost()
                                                .xsmall()
                                                .label("×")
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    this.remove_directory(
                                                        remove_directory.clone(),
                                                        cx,
                                                    );
                                                })),
                                        )
                                },
                            )),
                    )
                    .children(sessions.into_iter().enumerate().map(|(index, session)| {
                        let session_id = session.id.clone().unwrap_or_default();
                        let is_selected = selected_id.as_deref() == Some(session_id.as_str());
                        let session_for_select = session.clone();
                        let preview = session.last_message_preview.unwrap_or_default();
                        v_flex()
                            .id(("session", index))
                            .mx_1()
                            .px_3()
                            .py_2()
                            .gap_1()
                            .rounded_lg()
                            .cursor_pointer()
                            .when(is_selected, |this| this.bg(selected))
                            .when(!is_selected, |this| {
                                this.hover(|this| this.bg(selected.opacity(0.55)))
                            })
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.select_session(session_for_select.clone(), window, cx);
                            }))
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        div()
                                            .flex_1()
                                            .overflow_hidden()
                                            .whitespace_nowrap()
                                            .text_ellipsis()
                                            .text_sm()
                                            .font_medium()
                                            .child(session.title),
                                    )
                                    .when(session.streaming, |this| {
                                        this.child(
                                            div()
                                                .size(px(7.))
                                                .rounded_full()
                                                .bg(cx.theme().primary),
                                        )
                                    })
                                    .when(session.unread, |this| {
                                        this.child(
                                            div()
                                                .size(px(7.))
                                                .rounded_full()
                                                .bg(cx.theme().warning),
                                        )
                                    }),
                            )
                            .when(!preview.is_empty(), |this| {
                                this.child(
                                    div()
                                        .overflow_hidden()
                                        .whitespace_nowrap()
                                        .text_ellipsis()
                                        .text_xs()
                                        .text_color(muted)
                                        .child(preview),
                                )
                            })
                    })),
            )
            .when(self.selected_session_path.is_some(), |this| {
                this.child(
                    v_flex()
                        .p_2()
                        .gap_2()
                        .border_t_1()
                        .border_color(border)
                        .child(Input::new(&self.session_name_input).cleanable(true))
                        .child(
                            h_flex()
                                .gap_1()
                                .child(
                                    Button::new("rename-session")
                                        .secondary()
                                        .xsmall()
                                        .label("Rename")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.rename_selected_session(cx)
                                        })),
                                )
                                .child(
                                    Button::new("clone-session")
                                        .ghost()
                                        .xsmall()
                                        .label("Clone")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.clone_selected_session(cx)
                                        })),
                                )
                                .child(
                                    Button::new("read-session")
                                        .ghost()
                                        .xsmall()
                                        .label(if self.selected_session_unread {
                                            "Mark read"
                                        } else {
                                            "Mark unread"
                                        })
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.toggle_selected_session_read(cx)
                                        })),
                                )
                                .child(
                                    Button::new("delete-session")
                                        .danger()
                                        .xsmall()
                                        .label(if self.confirm_delete_session {
                                            "Confirm"
                                        } else {
                                            "Delete"
                                        })
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.delete_selected_session(cx)
                                        })),
                                ),
                        )
                        .when(self.directories.len() > 1, |this| {
                            this.child(
                                div()
                                    .text_xs()
                                    .font_semibold()
                                    .text_color(muted)
                                    .child("MOVE TO"),
                            )
                            .children(
                                self.directories
                                    .iter()
                                    .filter(|directory| *directory != &self.selected_directory)
                                    .enumerate()
                                    .map(|(index, directory)| {
                                        let target = directory.clone();
                                        Button::new(("move-session", index))
                                            .ghost()
                                            .xsmall()
                                            .w_full()
                                            .justify_start()
                                            .label(Self::basename(directory).to_string())
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.move_selected_session(target.clone(), cx)
                                            }))
                                    }),
                            )
                        }),
                )
            })
            .child(
                v_flex().p_2().border_t_1().border_color(border).child(
                    Button::new("settings")
                        .ghost()
                        .disabled(true)
                        .w_full()
                        .justify_start()
                        .icon(IconName::Settings)
                        .label(self.server_label.clone()),
                ),
            )
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .h(px(52.))
            .w_full()
            .flex_shrink_0()
            .px_3()
            .border_b_1()
            .border_color(cx.theme().border.opacity(0.72))
            .justify_between()
            .child(
                Button::new("toggle-left")
                    .ghost()
                    .small()
                    .icon(if self.left_sidebar_open {
                        IconName::PanelLeftClose
                    } else {
                        IconName::PanelLeftOpen
                    })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.left_sidebar_open = !this.left_sidebar_open;
                        cx.notify();
                    })),
            )
            .child(
                v_flex()
                    .items_center()
                    .gap_0p5()
                    .child(div().text_sm().font_semibold().child(self.session.title()))
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(
                                Self::basename(
                                    self.session
                                        .cwd
                                        .as_deref()
                                        .unwrap_or(&self.selected_directory),
                                )
                                .to_string(),
                            ),
                    ),
            )
            .child(
                Button::new("toggle-right")
                    .ghost()
                    .small()
                    .icon(if self.right_sidebar_open {
                        IconName::PanelRightClose
                    } else {
                        IconName::PanelRightOpen
                    })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.right_sidebar_open = !this.right_sidebar_open;
                        cx.notify();
                    })),
            )
    }

    fn render_conversation(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let secondary = cx.theme().secondary;
        let border = cx.theme().border.opacity(0.72);

        v_flex()
            .id("conversation")
            .flex_1()
            .min_h_0()
            .w_full()
            .items_center()
            .track_scroll(&self.conversation_scroll)
            .overflow_y_scrollbar()
            .child(
                v_flex()
                    .w_full()
                    .max_w(px(920.))
                    .px_5()
                    .py_8()
                    .gap_6()
                    .when(self.session.items.is_empty(), |this| {
                        this.flex_1().justify_center().items_center().child(
                            v_flex()
                                .items_center()
                                .gap_2()
                                .child(
                                    div()
                                        .text_xl()
                                        .font_semibold()
                                        .child("What are we building?"),
                                )
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(muted)
                                        .child("Start a session in this project."),
                                ),
                        )
                    })
                    .children(self.session.items.iter().enumerate().map(|(index, item)| {
                        match item {
                            ConversationItem::User(user) => h_flex()
                                .w_full()
                                .justify_end()
                                .child(
                                    div()
                                        .max_w(px(680.))
                                        .px_4()
                                        .py_3()
                                        .rounded_xl()
                                        .bg(cx.theme().primary)
                                        .text_color(cx.theme().primary_foreground)
                                        .text_sm()
                                        .child(user.text.clone()),
                                )
                                .into_any_element(),
                            ConversationItem::Assistant(assistant) => v_flex()
                                .w_full()
                                .gap_3()
                                .children(assistant.blocks.iter().enumerate().map(
                                    |(block_index, block)| {
                                        match block {
                                            AssistantBlock::Text(block) => TextView::markdown(
                                                format!("assistant-{index}-{block_index}"),
                                                block.text.clone(),
                                            )
                                            .selectable(true)
                                            .text_sm()
                                            .line_height(gpui::relative(1.55))
                                            .into_any_element(),
                                            AssistantBlock::Thinking(block) => v_flex()
                                                .w_full()
                                                .p_3()
                                                .gap_2()
                                                .rounded_lg()
                                                .border_1()
                                                .border_color(border)
                                                .bg(secondary.opacity(0.45))
                                                .child(
                                                    div()
                                                        .text_xs()
                                                        .font_semibold()
                                                        .text_color(muted)
                                                        .child(
                                                            block
                                                                .summary_label
                                                                .clone()
                                                                .unwrap_or_else(|| {
                                                                    "Thinking".into()
                                                                }),
                                                        ),
                                                )
                                                .child(
                                                    TextView::markdown(
                                                        format!("thinking-{index}-{block_index}"),
                                                        block.text.clone(),
                                                    )
                                                    .selectable(true)
                                                    .text_sm(),
                                                )
                                                .into_any_element(),
                                            AssistantBlock::Tool(block) => v_flex()
                                                .w_full()
                                                .rounded_lg()
                                                .border_1()
                                                .border_color(border)
                                                .overflow_hidden()
                                                .child(
                                                    h_flex()
                                                        .px_3()
                                                        .py_2()
                                                        .gap_2()
                                                        .bg(secondary.opacity(0.5))
                                                        .child(
                                                            Icon::new(if block.running {
                                                                IconName::LoaderCircle
                                                            } else {
                                                                IconName::SquareTerminal
                                                            })
                                                            .size_4(),
                                                        )
                                                        .child(
                                                            div().text_sm().font_semibold().child(
                                                                block.name.clone().unwrap_or_else(
                                                                    || "Tool".into(),
                                                                ),
                                                            ),
                                                        ),
                                                )
                                                .when(!block.output.trim().is_empty(), |this| {
                                                    this.child(
                                                        div()
                                                            .p_3()
                                                            .max_h(px(260.))
                                                            .overflow_y_scrollbar()
                                                            .font_family("Menlo")
                                                            .text_xs()
                                                            .child(block.output.clone()),
                                                    )
                                                })
                                                .into_any_element(),
                                            AssistantBlock::Compaction(block) => v_flex()
                                                .w_full()
                                                .p_3()
                                                .rounded_lg()
                                                .border_1()
                                                .border_color(border)
                                                .child(
                                                    div()
                                                        .text_xs()
                                                        .font_semibold()
                                                        .text_color(muted)
                                                        .child("Context compacted"),
                                                )
                                                .child(
                                                    TextView::markdown(
                                                        format!("compaction-{index}-{block_index}"),
                                                        block.summary.clone(),
                                                    )
                                                    .text_sm(),
                                                )
                                                .into_any_element(),
                                        }
                                    },
                                ))
                                .into_any_element(),
                        }
                    }))
                    .when(self.session.streaming || self.session.compacting, |this| {
                        this.child(
                            h_flex()
                                .gap_2()
                                .text_sm()
                                .text_color(muted)
                                .child(Icon::new(IconName::LoaderCircle).size_4())
                                .child(
                                    self.session
                                        .working_message
                                        .clone()
                                        .unwrap_or_else(|| "Working…".into()),
                                ),
                        )
                    }),
            )
    }

    fn render_composer(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let model_label = self
            .session
            .model
            .as_ref()
            .map(|model| model.label().to_string())
            .unwrap_or_else(|| "Model".into());
        let thinking_label = self
            .session
            .thinking_level
            .clone()
            .unwrap_or_else(|| "Thinking".into());
        let busy = self.session.streaming || self.session.compacting;

        v_flex().w_full().items_center().px_5().pb_5().child(
            v_flex()
                .w_full()
                .max_w(px(920.))
                .rounded_xl()
                .border_1()
                .border_color(cx.theme().border)
                .bg(cx.theme().secondary.opacity(0.3))
                .overflow_hidden()
                .child(Textarea::new(&self.composer).appearance(false).p_3())
                .child(
                    h_flex()
                        .h(px(46.))
                        .px_2()
                        .border_t_1()
                        .border_color(cx.theme().border.opacity(0.72))
                        .justify_between()
                        .child(
                            h_flex()
                                .gap_1()
                                .child(
                                    Button::new("model")
                                        .ghost()
                                        .small()
                                        .label(model_label)
                                        .on_click(
                                            cx.listener(|this, _, _, cx| this.cycle_model(cx)),
                                        ),
                                )
                                .child(
                                    Button::new("thinking")
                                        .ghost()
                                        .small()
                                        .label(thinking_label)
                                        .on_click(
                                            cx.listener(|this, _, _, cx| this.cycle_thinking(cx)),
                                        ),
                                ),
                        )
                        .child(if busy {
                            Button::new("abort")
                                .danger()
                                .small()
                                .icon(IconName::Close)
                                .on_click(cx.listener(|this, _, _, cx| this.abort(cx)))
                        } else {
                            Button::new("send")
                                .primary()
                                .small()
                                .icon(IconName::ArrowUp)
                                .on_click(
                                    cx.listener(|this, _, window, cx| {
                                        this.submit_prompt(window, cx)
                                    }),
                                )
                        }),
                ),
        )
    }

    fn render_file_workspace(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border.opacity(0.72);
        if let (Some(path), Some(content)) = (
            self.selected_file_path.as_ref(),
            self.selected_file_content.as_ref(),
        ) {
            let rendered = if path.ends_with(".md") || path.ends_with(".markdown") {
                content.clone()
            } else {
                format!("````text\n{content}\n````")
            };
            return v_flex()
                .flex_1()
                .min_h_0()
                .child(
                    h_flex()
                        .h(px(48.))
                        .px_2()
                        .gap_2()
                        .border_b_1()
                        .border_color(border)
                        .child(
                            Button::new("close-file")
                                .ghost()
                                .small()
                                .icon(IconName::ArrowLeft)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.selected_file_path = None;
                                    this.selected_file_content = None;
                                    cx.notify();
                                })),
                        )
                        .child(
                            div()
                                .flex_1()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_sm()
                                .font_semibold()
                                .child(path.clone()),
                        ),
                )
                .child(
                    v_flex()
                        .id("file-preview")
                        .flex_1()
                        .min_h_0()
                        .p_3()
                        .overflow_scroll()
                        .child(TextView::markdown("project-file", rendered).selectable(true)),
                )
                .into_any_element();
        }

        v_flex()
            .flex_1()
            .min_h_0()
            .child(
                h_flex()
                    .h(px(48.))
                    .px_3()
                    .justify_between()
                    .border_b_1()
                    .border_color(border)
                    .child(
                        div()
                            .text_xs()
                            .font_semibold()
                            .text_color(muted)
                            .child(format!("{} FILES", self.files.len())),
                    )
                    .child(
                        Button::new("refresh-files")
                            .ghost()
                            .small()
                            .label("Refresh")
                            .on_click(
                                cx.listener(|this, _, _, cx| this.refresh_right_workspace(cx)),
                            ),
                    ),
            )
            .child(
                v_flex()
                    .id("files")
                    .flex_1()
                    .min_h_0()
                    .p_2()
                    .overflow_y_scrollbar()
                    .children(
                        self.files
                            .iter()
                            .take(1000)
                            .enumerate()
                            .map(|(index, path)| {
                                let path_to_open = path.clone();
                                h_flex()
                                    .id(("file", index))
                                    .px_2()
                                    .py_1p5()
                                    .gap_2()
                                    .rounded_md()
                                    .cursor_pointer()
                                    .hover(|this| this.bg(cx.theme().secondary.opacity(0.55)))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.open_project_file(path_to_open.clone(), cx);
                                    }))
                                    .child(Icon::new(IconName::File).size_4().text_color(muted))
                                    .child(
                                        div()
                                            .overflow_hidden()
                                            .whitespace_nowrap()
                                            .text_ellipsis()
                                            .text_sm()
                                            .child(path.clone()),
                                    )
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_git_workspace(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border.opacity(0.72);
        if let (Some(path), Some(diff)) = (
            self.selected_git_path.as_ref(),
            self.selected_git_diff.as_ref(),
        ) {
            let selected_file = self
                .git_files
                .iter()
                .find(|file| &file.path == path)
                .cloned();
            let can_unstage = selected_file
                .as_ref()
                .and_then(|file| file.status.chars().next())
                .is_some_and(|status| status != ' ' && status != '?');
            return v_flex()
                .flex_1()
                .min_h_0()
                .child(
                    v_flex()
                        .p_2()
                        .gap_2()
                        .border_b_1()
                        .border_color(border)
                        .child(
                            h_flex()
                                .gap_2()
                                .child(
                                    Button::new("close-diff")
                                        .ghost()
                                        .small()
                                        .icon(IconName::ArrowLeft)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.selected_git_path = None;
                                            this.selected_git_diff = None;
                                            cx.notify();
                                        })),
                                )
                                .child(
                                    div()
                                        .flex_1()
                                        .overflow_hidden()
                                        .whitespace_nowrap()
                                        .text_ellipsis()
                                        .text_sm()
                                        .font_semibold()
                                        .child(path.clone()),
                                ),
                        )
                        .when_some(selected_file, |this, file| {
                            let stage_file = file.clone();
                            let discard_file = file.clone();
                            this.child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        Button::new("stage-selected")
                                            .secondary()
                                            .small()
                                            .label(if can_unstage { "Unstage" } else { "Stage" })
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.stage_file(
                                                    stage_file.clone(),
                                                    can_unstage,
                                                    cx,
                                                );
                                            })),
                                    )
                                    .child(
                                        Button::new("discard-selected")
                                            .danger()
                                            .small()
                                            .label(
                                                if self.pending_discard_path.as_deref()
                                                    == Some(file.path.as_str())
                                                {
                                                    "Confirm discard"
                                                } else {
                                                    "Discard"
                                                },
                                            )
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.discard_file(discard_file.clone(), cx);
                                            })),
                                    ),
                            )
                        }),
                )
                .child(
                    v_flex()
                        .id("git-diff")
                        .flex_1()
                        .min_h_0()
                        .p_3()
                        .overflow_scroll()
                        .child(
                            TextView::markdown(
                                "git-diff-content",
                                format!("````diff\n{diff}\n````"),
                            )
                            .selectable(true),
                        ),
                )
                .into_any_element();
        }

        let branch = self
            .git_status
            .as_ref()
            .and_then(|status| status.branch.clone())
            .unwrap_or_else(|| "No repository".into());
        let status_detail = self
            .git_status
            .as_ref()
            .map(|status| status.inline.clone())
            .unwrap_or_default();
        v_flex()
            .flex_1()
            .min_h_0()
            .child(
                v_flex()
                    .p_3()
                    .gap_2()
                    .border_b_1()
                    .border_color(border)
                    .child(
                        h_flex()
                            .justify_between()
                            .child(div().text_sm().font_semibold().child(branch))
                            .child(
                                Button::new("refresh-git")
                                    .ghost()
                                    .small()
                                    .label("Refresh")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.refresh_right_workspace(cx)
                                    })),
                            ),
                    )
                    .when(!status_detail.is_empty(), |this| {
                        this.child(div().text_xs().text_color(muted).child(status_detail))
                    })
                    .child(
                        h_flex()
                            .gap_1()
                            .child(
                                Button::new("stage-all")
                                    .secondary()
                                    .small()
                                    .label("Stage all")
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.stage_all(false, cx)),
                                    ),
                            )
                            .child(
                                Button::new("unstage-all")
                                    .ghost()
                                    .small()
                                    .label("Unstage")
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.stage_all(true, cx)),
                                    ),
                            )
                            .child(
                                Button::new("pull")
                                    .ghost()
                                    .small()
                                    .label("Pull")
                                    .on_click(cx.listener(|this, _, _, cx| this.pull(cx))),
                            )
                            .child(
                                Button::new("push")
                                    .ghost()
                                    .small()
                                    .label("Push")
                                    .on_click(cx.listener(|this, _, _, cx| this.push(false, cx))),
                            ),
                    )
                    .child(Input::new(&self.commit_message).cleanable(true))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("commit")
                                    .primary()
                                    .small()
                                    .label("Commit")
                                    .on_click(cx.listener(|this, _, _, cx| this.commit(false, cx))),
                            )
                            .child(
                                Button::new("commit-push")
                                    .secondary()
                                    .small()
                                    .label("Commit & push")
                                    .on_click(cx.listener(|this, _, _, cx| this.commit(true, cx))),
                            ),
                    ),
            )
            .child(
                v_flex()
                    .id("git-changes")
                    .flex_1()
                    .min_h_0()
                    .p_2()
                    .overflow_y_scrollbar()
                    .child(
                        div()
                            .px_2()
                            .py_2()
                            .text_xs()
                            .font_semibold()
                            .text_color(muted)
                            .child(format!("{} CHANGED FILES", self.git_files.len())),
                    )
                    .children(self.git_files.iter().enumerate().map(|(index, file)| {
                        let path = file.path.clone();
                        let additions = file.lines_added.unwrap_or_default();
                        let deletions = file.lines_deleted.unwrap_or_default();
                        h_flex()
                            .id(("git-file", index))
                            .px_2()
                            .py_2()
                            .gap_2()
                            .rounded_md()
                            .cursor_pointer()
                            .hover(|this| this.bg(cx.theme().secondary.opacity(0.55)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_git_diff(path.clone(), cx);
                            }))
                            .child(
                                div()
                                    .w(px(22.))
                                    .text_xs()
                                    .font_semibold()
                                    .text_color(muted)
                                    .child(file.status.clone()),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .text_sm()
                                    .child(file.path.clone()),
                            )
                            .when(additions > 0 || deletions > 0, |this| {
                                this.child(
                                    div()
                                        .text_xs()
                                        .text_color(muted)
                                        .child(format!("+{additions} −{deletions}")),
                                )
                            })
                    }))
                    .when(!self.git_branches.is_empty(), |this| {
                        this.child(
                            div()
                                .px_2()
                                .pt_4()
                                .pb_2()
                                .text_xs()
                                .font_semibold()
                                .text_color(muted)
                                .child("BRANCHES"),
                        )
                        .children(
                            self.git_branches
                                .iter()
                                .take(20)
                                .enumerate()
                                .map(|(index, branch)| {
                                    let branch_name = branch.name.clone();
                                    Button::new(("branch", index))
                                        .ghost()
                                        .small()
                                        .w_full()
                                        .justify_start()
                                        .disabled(branch.current)
                                        .label(if branch.current {
                                            format!("✓ {}", branch.name)
                                        } else {
                                            branch.name.clone()
                                        })
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.checkout_branch(branch_name.clone(), cx);
                                        }))
                                }),
                        )
                    })
                    .when(!self.git_commits.is_empty(), |this| {
                        this.child(
                            div()
                                .px_2()
                                .pt_4()
                                .pb_2()
                                .text_xs()
                                .font_semibold()
                                .text_color(muted)
                                .child("RECENT COMMITS"),
                        )
                        .children(self.git_commits.iter().take(20).map(|commit| {
                            div()
                                .px_2()
                                .py_1p5()
                                .font_family("Menlo")
                                .text_xs()
                                .child(commit.clone())
                        }))
                    }),
            )
            .into_any_element()
    }

    fn render_right_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border.opacity(0.72);
        v_flex()
            .w(px(390.))
            .h_full()
            .flex_shrink_0()
            .border_l_1()
            .border_color(border)
            .child(
                h_flex()
                    .h(px(52.))
                    .px_3()
                    .gap_2()
                    .border_b_1()
                    .border_color(border)
                    .child(
                        Button::new("changes-tab")
                            .small()
                            .when(
                                self.active_right_tab == RightWorkspaceTab::Changes,
                                |this| this.secondary(),
                            )
                            .when(
                                self.active_right_tab != RightWorkspaceTab::Changes,
                                |this| this.ghost(),
                            )
                            .label("Changes")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_right_tab = RightWorkspaceTab::Changes;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("files-tab")
                            .small()
                            .when(self.active_right_tab == RightWorkspaceTab::Files, |this| {
                                this.secondary()
                            })
                            .when(self.active_right_tab != RightWorkspaceTab::Files, |this| {
                                this.ghost()
                            })
                            .label("Files")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.active_right_tab = RightWorkspaceTab::Files;
                                cx.notify();
                            })),
                    ),
            )
            .child(match self.active_right_tab {
                RightWorkspaceTab::Changes => self.render_git_workspace(cx),
                RightWorkspaceTab::Files => self.render_file_workspace(cx),
            })
    }
}

impl Render for PicoDesktop {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let status = self.status_message.clone();
        h_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .when(self.left_sidebar_open, |this| {
                this.child(self.render_left_sidebar(cx))
            })
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .child(self.render_header(cx))
                    .when_some(status, |this, status| {
                        this.child(
                            h_flex()
                                .px_4()
                                .py_2()
                                .gap_2()
                                .bg(cx.theme().warning.opacity(0.12))
                                .text_sm()
                                .child(Icon::new(IconName::Info).size_4())
                                .child(status),
                        )
                    })
                    .child(self.render_conversation(cx))
                    .child(self.render_composer(cx)),
            )
            .when(self.right_sidebar_open, |this| {
                this.child(self.render_right_sidebar(cx))
            })
    }
}

pub fn root(
    client: PicoClient,
    initial_directory: String,
    window: &mut Window,
    cx: &mut App,
) -> Entity<Root> {
    let view = cx.new(|cx| PicoDesktop::new(client, initial_directory, window, cx));
    cx.new(|cx| Root::new(view, window, cx).bg(cx.theme().background))
}
