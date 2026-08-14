use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use anyhow::Result as AnyResult;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use gpui::{
    Anchor, App, AppContext as _, ClipboardItem, Context, Entity, FocusHandle, Focusable,
    FollowMode, InteractiveElement as _, IntoElement, KeyBinding, Keystroke, ListAlignment,
    ListState, ParentElement as _, PathPromptOptions, Pixels, Render, SharedString,
    StatefulInteractiveElement as _, Styled as _, Subscription, Task, Window, div,
    prelude::FluentBuilder as _, px,
};
use gpui_base::actions::{SelectDown, SelectUp};
use gpui_component::{
    ActiveTheme as _, Disableable as _, Icon, IconName, IndexPath, Root, Selectable as _,
    Sizable as _, StyledExt as _, Theme, ThemeMode,
    button::{Button, ButtonVariants as _},
    h_flex,
    input::{
        CompletionProvider, Input, InputBaseState, InputEvent, InputState, Rope, RopeExt, Textarea,
        TextareaState,
    },
    kbd::Kbd,
    list::{List, ListDelegate, ListEvent, ListItem, ListState as ComponentListState},
    menu::{DropdownMenu as _, PopupMenuItem},
    scroll::ScrollableElement as _,
    text::{TextView, TextViewState},
    tooltip::Tooltip,
    v_flex,
};
use gpui_ghostty_terminal::view::{
    Copy as TerminalCopy, Paste as TerminalPaste, SelectAll as TerminalSelectAll, TerminalInput,
    TerminalView,
};
use gpui_ghostty_terminal::{TerminalConfig, TerminalSession};
use lsp_types::{
    CompletionContext, CompletionItem, CompletionItemKind, CompletionResponse, CompletionTextEdit,
    InsertReplaceEdit,
};
use serde::{Deserialize, Serialize};
use smol::channel::{Receiver, Sender};

use crate::assets::PicoIcon;
use crate::client::{PicoClient, TerminalTransportCommand};
use crate::models::{
    AssistantBlock, AuthProvider, ConversationItem, DesktopEvent, DirectorySessionsIndex,
    FlatTreeNode, ForkableMessage, GitChangeFile, GitLocalBranch, GitStatusSummary,
    SessionListEntry, SessionState, SkillOption, UiRequest,
};

gpui::actions!(
    pico_desktop,
    [
        NewSession,
        ToggleLeftSidebar,
        ToggleRightSidebar,
        ToggleTerminal,
        OpenSettings,
        FocusSessionSearch,
        FocusComposer,
        AbortSession,
    ]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-n", NewSession, None),
        KeyBinding::new("cmd-b", ToggleLeftSidebar, None),
        KeyBinding::new("cmd-shift-b", ToggleRightSidebar, None),
        KeyBinding::new("cmd-j", ToggleTerminal, None),
        KeyBinding::new("cmd-,", OpenSettings, None),
        KeyBinding::new("cmd-k", FocusSessionSearch, None),
        KeyBinding::new("cmd-l", FocusComposer, None),
        KeyBinding::new("cmd-.", AbortSession, None),
        KeyBinding::new("ctrl-j", SelectDown, Some("List")),
        KeyBinding::new("ctrl-k", SelectUp, Some("List")),
        KeyBinding::new("cmd-c", TerminalCopy, Some("Terminal")),
        KeyBinding::new("cmd-v", TerminalPaste, Some("Terminal")),
        KeyBinding::new("cmd-a", TerminalSelectAll, Some("Terminal")),
    ]);
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPreferences {
    #[serde(default)]
    directories: Vec<String>,
    #[serde(default = "default_true")]
    notifications_enabled: bool,
    #[serde(default)]
    hide_tools: bool,
    #[serde(default = "default_true")]
    left_sidebar_open: bool,
    #[serde(default = "default_true")]
    right_sidebar_open: bool,
    #[serde(default)]
    dark_theme: bool,
    #[serde(default)]
    drafts: HashMap<String, String>,
    #[serde(default)]
    collapsed_directories: HashSet<String>,
}

fn default_true() -> bool {
    true
}

fn preferences_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    #[cfg(target_os = "macos")]
    let path =
        PathBuf::from(home).join("Library/Application Support/Pico/desktop-preferences.json");
    #[cfg(not(target_os = "macos"))]
    let path = PathBuf::from(home).join(".config/pico/desktop-preferences.json");
    Some(path)
}

fn load_preferences() -> DesktopPreferences {
    preferences_path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

pub fn apply_saved_theme(cx: &mut App) {
    if load_preferences().dark_theme {
        Theme::change(ThemeMode::Dark, None, cx);
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum RightWorkspaceTab {
    #[default]
    Changes,
    Files,
    History,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum ComposerStreamingBehavior {
    Steer,
    #[default]
    FollowUp,
}

impl ComposerStreamingBehavior {
    fn api_value(self) -> String {
        match self {
            Self::Steer => "steer".into(),
            Self::FollowUp => "followUp".into(),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Steer => "Steer",
            Self::FollowUp => "Follow up",
        }
    }
}

const BUILTIN_SLASH_COMMANDS: &[(&str, &str)] = &[
    ("login", "Configure provider authentication"),
    ("logout", "Remove provider authentication"),
    ("compact", "Summarize the session to reduce context size"),
    ("clone", "Duplicate the current session"),
    ("delete", "Delete the current session"),
    ("fork", "Create a session from a previous message"),
    ("tree", "Navigate the current session tree"),
    ("rename", "Rename the current session"),
    ("hide-thinking", "Hide assistant thinking blocks"),
    ("show-thinking", "Show assistant thinking blocks"),
    ("hide-tools", "Hide assistant tool calls"),
    ("show-tools", "Show assistant tool calls"),
];

fn is_slash_menu_input(value: &str) -> bool {
    let value = value.trim_start();
    value.starts_with('/') && !value.chars().any(char::is_whitespace)
}

fn slash_menu_capacity(viewport_height: Pixels) -> usize {
    // gpui-component's completion overlay currently always opens below the
    // cursor. Keep the visible result set within half of the viewport so the
    // composer can reserve just enough room instead of letting it clip.
    let max_height = (viewport_height.as_f32() * 0.5).clamp(48., 248.);
    (((max_height - 8.) / 20.).floor() as usize).max(2)
}

fn terminal_device_attribute_responses(tail: &mut Vec<u8>, output: &[u8]) -> Vec<&'static [u8]> {
    const PRIMARY_REQUESTS: [&[u8]; 2] = [b"\x1b[c", b"\x1b[0c"];
    const SECONDARY_REQUESTS: [&[u8]; 2] = [b"\x1b[>c", b"\x1b[>0c"];
    const PRIMARY_RESPONSE: &[u8] = b"\x1b[?62;22c";
    const SECONDARY_RESPONSE: &[u8] = b"\x1b[>1;10;0c";

    tail.extend_from_slice(output);
    let mut matches = Vec::new();
    for request in PRIMARY_REQUESTS {
        matches.extend(
            tail.windows(request.len())
                .filter(|window| *window == request)
                .map(|_| PRIMARY_RESPONSE),
        );
    }
    for request in SECONDARY_REQUESTS {
        matches.extend(
            tail.windows(request.len())
                .filter(|window| *window == request)
                .map(|_| SECONDARY_RESPONSE),
        );
    }

    let pending_suffix_length = PRIMARY_REQUESTS
        .into_iter()
        .chain(SECONDARY_REQUESTS)
        .flat_map(|request| 1..request.len())
        .filter(|length| {
            if tail.len() < *length {
                return false;
            }
            let suffix = &tail[tail.len() - *length..];
            let mut requests = PRIMARY_REQUESTS.into_iter().chain(SECONDARY_REQUESTS);
            !requests.clone().any(|request| suffix == request)
                && requests.any(|request| request.len() > *length && suffix == &request[..*length])
        })
        .max()
        .unwrap_or(0);
    if pending_suffix_length == 0 {
        tail.clear();
    } else {
        tail.drain(..tail.len() - pending_suffix_length);
    }
    matches
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct GitActionVisibility {
    stage_all: bool,
    unstage_all: bool,
    commit: bool,
    discard_all: bool,
    push: bool,
    force_push: bool,
    pull: bool,
}

fn git_file_can_stage(file: &GitChangeFile) -> bool {
    let mut status = file.status.chars();
    let index_status = status.next().unwrap_or(' ');
    let worktree_status = status.next().unwrap_or(' ');
    worktree_status != ' ' || index_status == '?'
}

fn git_file_can_unstage(file: &GitChangeFile) -> bool {
    let index_status = file.status.chars().next().unwrap_or(' ');
    index_status != ' ' && index_status != '?'
}

fn git_action_visibility(
    status: Option<&GitStatusSummary>,
    files: &[GitChangeFile],
) -> GitActionVisibility {
    let has_changes = status.is_some_and(|status| status.dirty) || !files.is_empty();
    let can_use_remote = status.is_some_and(|status| !status.detached);
    let ahead = status.map_or(0, |status| status.ahead);
    let behind = status.map_or(0, |status| status.behind);

    GitActionVisibility {
        stage_all: files.iter().any(git_file_can_stage),
        unstage_all: files.iter().any(git_file_can_unstage),
        commit: has_changes,
        discard_all: !files.is_empty(),
        push: can_use_remote && ahead > 0,
        force_push: can_use_remote && ahead > 0 && behind > 0,
        pull: can_use_remote && behind > 0,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DesktopPaletteCommand {
    NewSession,
    SearchSessions,
    ProjectFiles,
    GitChanges,
    ToggleTerminal,
    CloneSession,
    Settings,
}

impl DesktopPaletteCommand {
    const ALL: [Self; 7] = [
        Self::NewSession,
        Self::SearchSessions,
        Self::ProjectFiles,
        Self::GitChanges,
        Self::ToggleTerminal,
        Self::CloneSession,
        Self::Settings,
    ];

    fn title(self) -> &'static str {
        match self {
            Self::NewSession => "New session",
            Self::SearchSessions => "Search all sessions",
            Self::ProjectFiles => "Open project files",
            Self::GitChanges => "Open Git changes",
            Self::ToggleTerminal => "Toggle terminal panel",
            Self::CloneSession => "Clone current session",
            Self::Settings => "Open settings",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::NewSession => "Start a new conversation in the current directory",
            Self::SearchSessions => "Find a session across your project directories",
            Self::ProjectFiles => "Browse files in the current project",
            Self::GitChanges => "Review working tree changes and repository status",
            Self::ToggleTerminal => "Show or hide the terminal panel",
            Self::CloneSession => "Duplicate the selected session and its history",
            Self::Settings => "Configure appearance, providers, and performance",
        }
    }

    fn section(self) -> usize {
        match self {
            Self::NewSession | Self::SearchSessions => 0,
            Self::ProjectFiles | Self::GitChanges | Self::ToggleTerminal => 1,
            Self::CloneSession => 2,
            Self::Settings => 3,
        }
    }

    fn icon(self) -> IconName {
        match self {
            Self::NewSession => IconName::Plus,
            Self::SearchSessions => IconName::Search,
            Self::ProjectFiles => IconName::Folder,
            Self::GitChanges => IconName::File,
            Self::ToggleTerminal => IconName::SquareTerminal,
            Self::CloneSession => IconName::Copy,
            Self::Settings => IconName::Settings,
        }
    }

    fn shortcut(self) -> Option<&'static str> {
        match self {
            Self::NewSession => Some("cmd-n"),
            Self::ToggleTerminal => Some("cmd-j"),
            Self::Settings => Some("cmd-,"),
            _ => None,
        }
    }

    fn matches(self, query: &str) -> bool {
        let query = query.trim().to_lowercase();
        query.is_empty()
            || self.title().to_lowercase().contains(&query)
            || self.description().to_lowercase().contains(&query)
    }
}

struct CommandPaletteDelegate {
    sections: Vec<Vec<DesktopPaletteCommand>>,
    selected_index: Option<IndexPath>,
    has_selected_session: bool,
    query_active: bool,
}

impl CommandPaletteDelegate {
    const SECTION_TITLES: [&'static str; 4] = ["General", "Workspace", "Session", "Settings"];

    fn new(has_selected_session: bool) -> Self {
        let mut delegate = Self {
            sections: vec![Vec::new(); Self::SECTION_TITLES.len()],
            selected_index: None,
            has_selected_session,
            query_active: false,
        };
        delegate.filter("");
        delegate
    }

    fn filter(&mut self, query: &str) {
        self.query_active = !query.trim().is_empty();
        self.sections = vec![Vec::new(); Self::SECTION_TITLES.len()];
        for command in DesktopPaletteCommand::ALL {
            if command == DesktopPaletteCommand::CloneSession && !self.has_selected_session {
                continue;
            }
            if command.matches(query) {
                let section = if self.query_active {
                    0
                } else {
                    command.section()
                };
                self.sections[section].push(command);
            }
        }
    }

    fn reset(&mut self, has_selected_session: bool) {
        self.has_selected_session = has_selected_session;
        self.selected_index = Some(IndexPath::default());
        self.filter("");
    }

    fn command(&self, index: IndexPath) -> Option<DesktopPaletteCommand> {
        self.sections
            .get(index.section)
            .and_then(|commands| commands.get(index.row))
            .copied()
    }
}

impl ListDelegate for CommandPaletteDelegate {
    type Item = ListItem;

    fn sections_count(&self, _: &App) -> usize {
        Self::SECTION_TITLES.len()
    }

    fn items_count(&self, section: usize, _: &App) -> usize {
        self.sections.get(section).map_or(0, Vec::len)
    }

    fn perform_search(
        &mut self,
        query: &str,
        _: &mut Window,
        _: &mut Context<ComponentListState<Self>>,
    ) -> Task<()> {
        self.filter(query);
        Task::ready(())
    }

    fn render_item(
        &mut self,
        index: IndexPath,
        _: &mut Window,
        cx: &mut Context<ComponentListState<Self>>,
    ) -> Option<Self::Item> {
        let command = self.command(index)?;
        let shortcut = command
            .shortcut()
            .and_then(|shortcut| Keystroke::parse(shortcut).ok())
            .map(Kbd::new);

        Some(
            ListItem::new(index).h(px(58.)).px_3().child(
                h_flex()
                    .size_full()
                    .min_w_0()
                    .gap_3()
                    .child(
                        div()
                            .size_8()
                            .flex_none()
                            .rounded_md()
                            .bg(cx.theme().secondary.opacity(0.55))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(Icon::new(command.icon()).size_4()),
                    )
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .gap_0p5()
                            .child(
                                div()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .text_sm()
                                    .font_medium()
                                    .child(command.title()),
                            )
                            .child(
                                div()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(command.description()),
                            ),
                    )
                    .when_some(shortcut, |this, shortcut| this.child(shortcut)),
            ),
        )
    }

    fn render_section_header(
        &mut self,
        section: usize,
        _: &mut Window,
        cx: &mut Context<ComponentListState<Self>>,
    ) -> Option<impl IntoElement> {
        Some(
            div()
                .h(px(30.))
                .px_3()
                .pt_2()
                .text_xs()
                .font_semibold()
                .text_color(cx.theme().muted_foreground)
                .child(if self.query_active {
                    "Commands"
                } else {
                    Self::SECTION_TITLES
                        .get(section)
                        .copied()
                        .unwrap_or_default()
                }),
        )
    }

    fn render_empty(
        &mut self,
        _: &mut Window,
        cx: &mut Context<ComponentListState<Self>>,
    ) -> impl IntoElement {
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_2()
            .text_color(cx.theme().muted_foreground)
            .child(Icon::new(IconName::Search).size_5())
            .child(div().text_sm().child("No commands found."))
    }

    fn set_selected_index(
        &mut self,
        index: Option<IndexPath>,
        _: &mut Window,
        _: &mut Context<ComponentListState<Self>>,
    ) {
        self.selected_index = index;
    }
}

#[derive(Clone, Default)]
struct SlashCompletionProvider {
    skills: Rc<RefCell<Vec<SkillOption>>>,
}

impl SlashCompletionProvider {
    fn set_skills(&self, skills: Vec<SkillOption>) {
        *self.skills.borrow_mut() = skills;
    }

    fn completion_item(
        rope: &Rope,
        start: usize,
        end: usize,
        label: String,
        description: String,
    ) -> CompletionItem {
        let range =
            lsp_types::Range::new(rope.offset_to_position(start), rope.offset_to_position(end));
        CompletionItem {
            label: label.clone(),
            detail: Some(description.clone()),
            kind: Some(CompletionItemKind::FUNCTION),
            filter_text: Some(label.clone()),
            text_edit: Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
                new_text: format!("{label} "),
                insert: range,
                replace: range,
            })),
            ..CompletionItem::default()
        }
    }

    fn matching_options(&self, value: &str) -> Vec<(String, String)> {
        if !is_slash_menu_input(value) {
            return Vec::new();
        }

        let query = value.trim_start().to_lowercase();
        let mut options = BUILTIN_SLASH_COMMANDS
            .iter()
            .filter_map(|(name, description)| {
                let label = format!("/{name}");
                label
                    .to_lowercase()
                    .contains(&query)
                    .then(|| (label, (*description).into()))
            })
            .collect::<Vec<_>>();

        options.extend(self.skills.borrow().iter().filter_map(|skill| {
            let label = format!("/skill:{}", skill.name);
            let description = skill
                .description
                .clone()
                .unwrap_or_else(|| "Use this skill".into());
            let search = format!("{label} {description}").to_lowercase();
            search.contains(&query).then_some((label, description))
        }));

        options
    }

    fn reserved_height(&self, value: &str, viewport_height: Pixels) -> Pixels {
        let visible_items = self
            .matching_options(value)
            .len()
            .min(slash_menu_capacity(viewport_height));
        if visible_items == 0 {
            return px(0.);
        }

        px(visible_items as f32 * 20. + 8.)
    }
}

impl CompletionProvider for SlashCompletionProvider {
    fn completions(
        &self,
        rope: &Rope,
        offset: usize,
        _: CompletionContext,
        window: &mut Window,
        _: &mut Context<InputBaseState>,
    ) -> Task<AnyResult<CompletionResponse>> {
        let prefix = rope.slice(..offset).to_string();
        let trimmed = prefix.trim_start();
        let leading_chars = prefix.chars().count() - trimmed.chars().count();
        let items = self
            .matching_options(trimmed)
            .into_iter()
            .take(slash_menu_capacity(window.viewport_size().height))
            .map(|(label, description)| {
                Self::completion_item(rope, leading_chars, offset, label, description)
            })
            .collect();

        Task::ready(Ok(CompletionResponse::Array(items)))
    }

    fn is_completion_trigger(&self, _: usize, _: &str, _: &mut Context<InputBaseState>) -> bool {
        true
    }
}

#[derive(Clone)]
struct PromptSubmission {
    message: String,
    images: Vec<(String, serde_json::Value)>,
    streaming_behavior: ComposerStreamingBehavior,
}

struct CachedConversationMarkdown {
    item_index: usize,
    source: String,
    state: Entity<TextViewState>,
}

#[derive(Clone, Debug)]
enum ConversationRow {
    User {
        key: String,
        item_index: usize,
    },
    AssistantBlock {
        key: String,
        item_index: usize,
        block_index: usize,
    },
}

impl ConversationRow {
    fn key(&self) -> &str {
        match self {
            Self::User { key, .. } | Self::AssistantBlock { key, .. } => key,
        }
    }

    fn item_index(&self) -> usize {
        match self {
            Self::User { item_index, .. } | Self::AssistantBlock { item_index, .. } => *item_index,
        }
    }
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
    rename_session_target: Option<SessionListEntry>,
    delete_session_target: Option<SessionListEntry>,
    cleanup_directory_target: Option<String>,
    session: SessionState,
    directory_indexes: HashMap<String, DirectorySessionsIndex>,
    files: Vec<String>,
    files_cwd: Option<String>,
    workspace_error: Option<String>,
    active_right_tab: RightWorkspaceTab,
    selected_file_path: Option<String>,
    selected_file_content: Option<String>,
    git_status: Option<GitStatusSummary>,
    git_files: Vec<GitChangeFile>,
    git_branches: Vec<GitLocalBranch>,
    git_commits: Vec<String>,
    selected_git_path: Option<String>,
    selected_git_diff: Option<String>,
    selected_commit_hash: Option<String>,
    pending_commit_action: Option<String>,
    pending_discard_path: Option<String>,
    pending_discard_all: bool,
    streaming_behavior: ComposerStreamingBehavior,
    composer_images: Vec<(String, serde_json::Value)>,
    pending_submission: Option<PromptSubmission>,
    failed_submission: Option<PromptSubmission>,
    preferences: DesktopPreferences,
    hide_tools: bool,
    expanded_tool_blocks: HashSet<String>,
    conversation_markdown: HashMap<String, CachedConversationMarkdown>,
    conversation_markdown_subscriptions: HashMap<String, Subscription>,
    conversation_rows: Vec<ConversationRow>,
    settings_open: bool,
    command_palette_open: bool,
    command_palette: Entity<ComponentListState<CommandPaletteDelegate>>,
    command_palette_previous_focus: Option<FocusHandle>,
    add_directory_dialog_open: bool,
    reset_directory_input_on_open: bool,
    auth_providers: Vec<AuthProvider>,
    selected_auth_provider: Option<AuthProvider>,
    ui_request: Option<UiRequest>,
    terminal_id: Option<String>,
    terminal_view: Entity<TerminalView>,
    terminal_focus_handle: FocusHandle,
    terminal_transport: Arc<Mutex<Option<Sender<TerminalTransportCommand>>>>,
    terminal_label: String,
    terminal_query_tail: Vec<u8>,
    terminal_cols: u16,
    terminal_rows: u16,
    terminal_panel_open: bool,
    tree_nodes: Vec<FlatTreeNode>,
    tree_leaf_id: Option<String>,
    forkable_messages: Vec<ForkableMessage>,
    generated_commit_message: Option<String>,
    commit_dialog_open: bool,
    commit_in_flight: bool,
    commit_message_generating: bool,
    pending_commit_after_generation: Option<(bool, bool)>,
    reset_commit_message_on_open: bool,
    pi_transport: String,
    pi_cache_retention: String,
    performance_restart_required: bool,
    notifications_enabled: bool,
    seen_completion_ids: HashSet<String>,
    status_message: Option<String>,
    left_sidebar_open: bool,
    right_sidebar_open: bool,
    search: Entity<InputState>,
    directory_input: Entity<InputState>,
    session_name_input: Entity<InputState>,
    composer: Entity<TextareaState>,
    slash_completion_provider: Rc<SlashCompletionProvider>,
    commit_message: Entity<TextareaState>,
    auth_value: Entity<InputState>,
    git_comment_input: Entity<InputState>,
    focus_handle: FocusHandle,
    conversation_list: ListState,
    _event_task: gpui::Task<()>,
    _subscriptions: Vec<Subscription>,
}

impl PicoDesktop {
    fn new_conversation_list(item_count: usize) -> ListState {
        let list = ListState::new(item_count, ListAlignment::Top, px(2048.));
        list.set_follow_mode(FollowMode::Tail);
        list
    }

    fn conversation_rows_for_items(items: &[ConversationItem]) -> Vec<ConversationRow> {
        let mut rows = Vec::new();
        for (item_index, item) in items.iter().enumerate() {
            match item {
                ConversationItem::User(user) => {
                    let item_key = user
                        .item_key
                        .clone()
                        .unwrap_or_else(|| format!("index:{item_index}"));
                    rows.push(ConversationRow::User {
                        key: format!("user:{item_key}"),
                        item_index,
                    });
                }
                ConversationItem::Assistant(assistant) => {
                    let item_key = assistant
                        .item_key
                        .clone()
                        .unwrap_or_else(|| format!("index:{item_index}"));
                    for (block_index, block) in assistant.blocks.iter().enumerate() {
                        let kind = match block {
                            AssistantBlock::Text(_) => "text",
                            AssistantBlock::Thinking(_) => "thinking",
                            AssistantBlock::Tool(_) => "tool",
                            AssistantBlock::Compaction(_) => "compaction",
                        };
                        let block_key = match block {
                            AssistantBlock::Tool(block) => {
                                block.call_id.as_deref().or(block.block_key.as_deref())
                            }
                            _ => block.block_key(),
                        }
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| format!("index:{block_index}"));
                        rows.push(ConversationRow::AssistantBlock {
                            key: format!("assistant:{item_key}:{kind}:{block_key}"),
                            item_index,
                            block_index,
                        });
                    }
                }
            }
        }
        rows
    }

    fn conversation_rows(&self) -> Vec<ConversationRow> {
        Self::conversation_rows_for_items(&self.session.items)
    }

    fn sync_conversation_rows(
        &mut self,
        reset: bool,
        changed_items: Option<std::ops::Range<usize>>,
    ) {
        let new_rows = self.conversation_rows();
        if reset {
            self.conversation_list.reset(new_rows.len());
            self.conversation_rows = new_rows;
            self.conversation_list.scroll_to_end();
            return;
        }

        let mut prefix = 0;
        while prefix < self.conversation_rows.len()
            && prefix < new_rows.len()
            && self.conversation_rows[prefix].key() == new_rows[prefix].key()
        {
            prefix += 1;
        }

        let mut suffix = 0;
        while suffix < self.conversation_rows.len().saturating_sub(prefix)
            && suffix < new_rows.len().saturating_sub(prefix)
            && self.conversation_rows[self.conversation_rows.len() - 1 - suffix].key()
                == new_rows[new_rows.len() - 1 - suffix].key()
        {
            suffix += 1;
        }

        let old_end = self.conversation_rows.len() - suffix;
        let new_end = new_rows.len() - suffix;
        if prefix != old_end || prefix != new_end {
            self.conversation_list
                .splice(prefix..old_end, new_end - prefix);
        }
        self.conversation_rows = new_rows;

        if let Some(changed_items) = changed_items {
            let changed_rows = self
                .conversation_rows
                .iter()
                .enumerate()
                .filter_map(|(index, row)| {
                    changed_items.contains(&row.item_index()).then_some(index)
                })
                .collect::<Vec<_>>();
            if let (Some(first), Some(last)) = (changed_rows.first(), changed_rows.last()) {
                self.conversation_list.remeasure_items(*first..*last + 1);
            }
        }
    }

    fn conversation_markdown_key(
        item_index: usize,
        item_key: Option<&str>,
        block_index: usize,
        block_key: Option<&str>,
        kind: &str,
    ) -> String {
        format!(
            "{kind}:{}:{}",
            item_key
                .map(|key| format!("item-key:{key}"))
                .unwrap_or_else(|| format!("item-index:{item_index}")),
            block_key
                .map(|key| format!("block-key:{key}"))
                .unwrap_or_else(|| format!("block-index:{block_index}")),
        )
    }

    fn conversation_markdown_descriptors(
        &self,
        range: std::ops::Range<usize>,
    ) -> Vec<(usize, String, String)> {
        let mut descriptors = Vec::new();
        for item_index in range {
            let Some(ConversationItem::Assistant(assistant)) = self.session.items.get(item_index)
            else {
                continue;
            };
            for (block_index, block) in assistant.blocks.iter().enumerate() {
                let (kind, block_key, source) = match block {
                    AssistantBlock::Text(block) => {
                        ("text", block.block_key.as_deref(), block.text.as_str())
                    }
                    AssistantBlock::Thinking(block) => {
                        ("thinking", block.block_key.as_deref(), block.text.as_str())
                    }
                    AssistantBlock::Compaction(block) => (
                        "compaction",
                        block.block_key.as_deref(),
                        block.summary.as_str(),
                    ),
                    AssistantBlock::Tool(_) => continue,
                };
                descriptors.push((
                    item_index,
                    Self::conversation_markdown_key(
                        item_index,
                        assistant.item_key.as_deref(),
                        block_index,
                        block_key,
                        kind,
                    ),
                    source.to_string(),
                ));
            }
        }
        descriptors
    }

    fn conversation_markdown_keys(&self, range: std::ops::Range<usize>) -> HashSet<String> {
        let mut keys = HashSet::new();
        for item_index in range {
            let Some(ConversationItem::Assistant(assistant)) = self.session.items.get(item_index)
            else {
                continue;
            };
            for (block_index, block) in assistant.blocks.iter().enumerate() {
                let kind = match block {
                    AssistantBlock::Text(_) => "text",
                    AssistantBlock::Thinking(_) => "thinking",
                    AssistantBlock::Compaction(_) => "compaction",
                    AssistantBlock::Tool(_) => continue,
                };
                keys.insert(Self::conversation_markdown_key(
                    item_index,
                    assistant.item_key.as_deref(),
                    block_index,
                    block.block_key(),
                    kind,
                ));
            }
        }
        keys
    }

    fn sync_conversation_markdown(
        &mut self,
        descriptors: Vec<(usize, String, String)>,
        cx: &mut Context<Self>,
    ) {
        for (item_index, key, source) in descriptors {
            if let Some(cached) = self.conversation_markdown.get_mut(&key) {
                cached.item_index = item_index;
                if cached.source == source {
                    continue;
                }
                if let Some(suffix) = source.strip_prefix(&cached.source) {
                    cached
                        .state
                        .update(cx, |state, cx| state.push_str(suffix, cx));
                } else {
                    cached
                        .state
                        .update(cx, |state, cx| state.set_text(&source, cx));
                }
                cached.source = source;
            } else {
                let initial_source = source.clone();
                let state = cx.new(|cx| TextViewState::markdown(&initial_source, cx));
                let observer_key = key.clone();
                let subscription = cx.observe(&state, move |this, _, cx| {
                    if let Some(cached) = this.conversation_markdown.get(&observer_key) {
                        this.remeasure_conversation_item(cached.item_index);
                    }
                    cx.notify();
                });
                self.conversation_markdown.insert(
                    key.clone(),
                    CachedConversationMarkdown {
                        item_index,
                        source,
                        state,
                    },
                );
                self.conversation_markdown_subscriptions
                    .insert(key, subscription);
            }
        }
    }

    fn remeasure_conversation_item(&self, item_index: usize) {
        let rows = self
            .conversation_rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| (row.item_index() == item_index).then_some(index))
            .collect::<Vec<_>>();
        if let (Some(first), Some(last)) = (rows.first(), rows.last()) {
            self.conversation_list.remeasure_items(*first..*last + 1);
        }
    }

    fn markdown_view(&self, key: String, fallback_source: &str) -> TextView {
        self.conversation_markdown
            .get(&key)
            .map(|cached| TextView::new(&cached.state))
            .unwrap_or_else(|| TextView::markdown(key, fallback_source.to_string()))
    }

    fn conversation_row_is_visible(&self, index: usize) -> bool {
        match self.conversation_rows.get(index) {
            Some(ConversationRow::User { item_index, .. }) => {
                matches!(
                    self.session.items.get(*item_index),
                    Some(ConversationItem::User(_))
                )
            }
            Some(ConversationRow::AssistantBlock {
                item_index,
                block_index,
                ..
            }) => {
                let Some(ConversationItem::Assistant(assistant)) =
                    self.session.items.get(*item_index)
                else {
                    return false;
                };
                match assistant.blocks.get(*block_index) {
                    Some(AssistantBlock::Thinking(_)) => !self.session.hide_thinking_block,
                    Some(AssistantBlock::Tool(_)) => !self.hide_tools,
                    Some(_) => true,
                    None => false,
                }
            }
            None => false,
        }
    }

    fn previous_visible_conversation_row(&self, index: usize) -> Option<&ConversationRow> {
        (0..index)
            .rev()
            .find(|candidate| self.conversation_row_is_visible(*candidate))
            .and_then(|candidate| self.conversation_rows.get(candidate))
    }

    fn has_visible_conversation_row_after(&self, index: usize) -> bool {
        (index + 1..self.conversation_rows.len())
            .any(|candidate| self.conversation_row_is_visible(candidate))
    }

    fn terminal_grid_size(window: &mut Window, left_sidebar_open: bool) -> (u16, u16) {
        let width =
            f32::from(window.viewport_size().width) - if left_sidebar_open { 300. } else { 0. };
        let height = 242.;
        let font = gpui_ghostty_terminal::default_terminal_font();
        let mut style = window.text_style();
        style.font_family = font.family.clone();
        style.font_features = gpui_ghostty_terminal::default_terminal_font_features();
        style.font_fallbacks = font.fallbacks.clone();
        let rem_size = window.rem_size();
        let font_size = style.font_size.to_pixels(rem_size);
        let line_height = style.line_height.to_pixels(style.font_size, rem_size);
        let cell_width = window
            .text_system()
            .shape_text(
                SharedString::from("M"),
                font_size,
                &[style.to_run(1)],
                None,
                Some(1),
            )
            .ok()
            .and_then(|lines| lines.first().map(|line| f32::from(line.width())))
            .unwrap_or(8.)
            .max(1.);
        let cell_height = f32::from(line_height).max(1.);
        (
            (width / cell_width).floor().clamp(20., 500.) as u16,
            (height / cell_height).floor().clamp(5., 200.) as u16,
        )
    }

    pub fn new(
        client: PicoClient,
        initial_directory: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut preferences = load_preferences();
        if !preferences.directories.contains(&initial_directory) {
            preferences.directories.push(initial_directory.clone());
        }
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search sessions…"));
        let command_palette = cx.new(|cx| {
            ComponentListState::new(CommandPaletteDelegate::new(false), window, cx).searchable(true)
        });
        let directory_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Add project directory…"));
        let session_name_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Rename selected session…"));
        let initial_draft = preferences
            .drafts
            .get(&format!("directory:{initial_directory}"))
            .cloned()
            .unwrap_or_default();
        let composer = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(2, 8)
                .submit_on_enter(true)
                .placeholder("Ask anything…")
                .default_value(initial_draft)
        });
        let slash_completion_provider = Rc::new(SlashCompletionProvider::default());
        let composer_base_state = composer.read(cx).base_state().clone();
        composer_base_state.update(cx, |state, _| {
            state.lsp.completion_provider = Some(slash_completion_provider.clone())
        });
        let commit_message = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(4, 8)
                .placeholder("Leave blank to autogenerate a commit message")
        });
        let auth_value =
            cx.new(|cx| InputState::new(window, cx).placeholder("API key or response"));
        let git_comment_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Comment on this diff…"));
        let (tx, rx) = smol::channel::unbounded();
        let (terminal_cols, terminal_rows) =
            Self::terminal_grid_size(window, preferences.left_sidebar_open);
        let terminal_transport = Arc::new(Mutex::new(None::<Sender<TerminalTransportCommand>>));
        let terminal_input_transport = terminal_transport.clone();
        let terminal_focus_handle = cx.focus_handle();
        let terminal_view_focus_handle = terminal_focus_handle.clone();
        let terminal_view = cx.new(move |_cx| {
            let session = TerminalSession::new(TerminalConfig {
                cols: terminal_cols,
                rows: terminal_rows,
                update_window_title: false,
                ..TerminalConfig::default()
            })
            .expect("failed to initialize libghostty terminal");
            let input = TerminalInput::new(move |bytes| {
                let transport = terminal_input_transport
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clone();
                if let Some(transport) = transport {
                    let _ = transport.try_send(TerminalTransportCommand::Input(bytes.to_vec()));
                }
            });
            TerminalView::new_with_input(session, terminal_view_focus_handle, input)
        });

        client.connect(tx.clone());
        client.start_events(None, None, preferences.directories.clone(), tx.clone());

        let _event_task = Self::listen_for_events(rx, cx);
        let _subscriptions = vec![
            cx.observe_window_bounds(window, |this, window, cx| {
                if this.terminal_panel_open {
                    this.sync_terminal_grid_size(window, cx);
                }
            }),
            cx.subscribe_in(&search, window, |_, _, event, _, cx| {
                if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
            cx.subscribe_in(&composer, window, |this, _, event, window, cx| {
                if matches!(event, InputEvent::PressEnter { shift: false, .. }) {
                    this.submit_prompt(window, cx);
                } else if matches!(event, InputEvent::Change) {
                    this.persist_current_draft(cx);
                    cx.notify();
                }
            }),
            cx.subscribe_in(&directory_input, window, |this, _, event, _, cx| {
                if this.add_directory_dialog_open
                    && matches!(event, InputEvent::PressEnter { shift: false, .. })
                {
                    this.add_directory(cx);
                } else if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
            cx.subscribe_in(
                &command_palette,
                window,
                |this, state, event, window, cx| match event {
                    ListEvent::Confirm(index) => {
                        let command = state.read(cx).delegate().command(*index);
                        if let Some(command) = command {
                            this.execute_palette_command(command, window, cx);
                        }
                    }
                    ListEvent::Cancel => this.close_command_palette(window, cx),
                    ListEvent::Select(_) => {}
                },
            ),
        ];

        Self {
            client,
            tx,
            connected: false,
            server_label: "Connecting…".into(),
            directories: preferences.directories.clone(),
            selected_directory: initial_directory,
            selected_session_id: None,
            selected_session_path: None,
            selected_session_unread: false,
            rename_session_target: None,
            delete_session_target: None,
            cleanup_directory_target: None,
            session: SessionState::default(),
            directory_indexes: HashMap::new(),
            files: Vec::new(),
            files_cwd: None,
            workspace_error: None,
            active_right_tab: RightWorkspaceTab::Changes,
            selected_file_path: None,
            selected_file_content: None,
            git_status: None,
            git_files: Vec::new(),
            git_branches: Vec::new(),
            git_commits: Vec::new(),
            selected_git_path: None,
            selected_git_diff: None,
            selected_commit_hash: None,
            pending_commit_action: None,
            pending_discard_path: None,
            pending_discard_all: false,
            streaming_behavior: ComposerStreamingBehavior::FollowUp,
            composer_images: Vec::new(),
            pending_submission: None,
            failed_submission: None,
            hide_tools: preferences.hide_tools,
            expanded_tool_blocks: HashSet::new(),
            conversation_markdown: HashMap::new(),
            conversation_markdown_subscriptions: HashMap::new(),
            conversation_rows: Vec::new(),
            preferences: preferences.clone(),
            settings_open: false,
            command_palette_open: false,
            command_palette,
            command_palette_previous_focus: None,
            add_directory_dialog_open: false,
            reset_directory_input_on_open: false,
            auth_providers: Vec::new(),
            selected_auth_provider: None,
            ui_request: None,
            terminal_id: None,
            terminal_view,
            terminal_focus_handle,
            terminal_transport,
            terminal_label: "Terminal".into(),
            terminal_query_tail: Vec::new(),
            terminal_cols,
            terminal_rows,
            terminal_panel_open: false,
            tree_nodes: Vec::new(),
            tree_leaf_id: None,
            forkable_messages: Vec::new(),
            generated_commit_message: None,
            commit_dialog_open: false,
            commit_in_flight: false,
            commit_message_generating: false,
            pending_commit_after_generation: None,
            reset_commit_message_on_open: false,
            pi_transport: "auto".into(),
            pi_cache_retention: "standard".into(),
            performance_restart_required: false,
            notifications_enabled: preferences.notifications_enabled,
            seen_completion_ids: HashSet::new(),
            status_message: None,
            left_sidebar_open: preferences.left_sidebar_open,
            right_sidebar_open: preferences.right_sidebar_open,
            search,
            directory_input,
            session_name_input,
            composer,
            slash_completion_provider,
            commit_message,
            auth_value,
            git_comment_input,
            focus_handle: cx.focus_handle(),
            conversation_list: Self::new_conversation_list(0),
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

    fn draft_key(&self) -> String {
        if let Some(path) = self.selected_session_path.as_deref() {
            format!("session:{path}")
        } else if let Some(key) = self.session.session_key.as_deref() {
            format!("draft:{key}")
        } else {
            format!("directory:{}", self.selected_directory)
        }
    }

    fn persist_current_draft(&mut self, cx: &App) {
        let key = self.draft_key();
        let value = self.composer.read(cx).value().to_string();
        if value.is_empty() {
            self.preferences.drafts.remove(&key);
        } else {
            self.preferences.drafts.insert(key, value);
        }
        self.persist_preferences();
    }

    fn persist_preferences(&mut self) {
        self.preferences.directories = self.directories.clone();
        self.preferences.notifications_enabled = self.notifications_enabled;
        self.preferences.hide_tools = self.hide_tools;
        self.preferences.left_sidebar_open = self.left_sidebar_open;
        self.preferences.right_sidebar_open = self.right_sidebar_open;
        let Some(path) = preferences_path() else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(data) = serde_json::to_vec_pretty(&self.preferences) {
            let temporary = path.with_extension("json.tmp");
            if std::fs::write(&temporary, data).is_ok() {
                let _ = std::fs::rename(temporary, path);
            }
        }
    }

    fn restore_draft_for_current_scope(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let value = self
            .preferences
            .drafts
            .get(&self.draft_key())
            .cloned()
            .unwrap_or_default();
        self.composer.update(cx, |state, cx| {
            state.set_value(value, window, cx);
        });
    }

    fn apply_event(&mut self, event: DesktopEvent, cx: &mut Context<Self>) {
        match event {
            DesktopEvent::Connected(manifest) => {
                self.connected = true;
                self.server_label = format!("{} {}", manifest.display_name, manifest.version);
                self.status_message = None;
            }
            DesktopEvent::ConnectionChanged(connected) => {
                self.connected = connected;
                if !connected {
                    self.server_label = "Reconnecting…".into();
                }
            }
            DesktopEvent::State(sync) => {
                let had_full_items = sync.items.is_some();
                let conversation_visibility_changed = sync.hide_thinking_block.is_some();
                let item_patch = sync
                    .items_patch
                    .as_ref()
                    .map(|patch| (patch.start, patch.delete_count, patch.items.len()));
                let old_item_count = self.session.items.len();
                let replaced_markdown_keys = item_patch
                    .map(|(start, delete_count, _)| {
                        self.conversation_markdown_keys(
                            start.min(old_item_count)..(start + delete_count).min(old_item_count),
                        )
                    })
                    .unwrap_or_default();
                let patch_applied = self.session.apply(sync);
                if !patch_applied {
                    self.status_message = Some("Resynchronizing conversation…".into());
                    self.restart_events(
                        self.selected_session_id.clone(),
                        self.session.session_key.clone(),
                    );
                    cx.notify();
                    return;
                }
                let new_item_count = self.session.items.len();
                if had_full_items {
                    self.sync_conversation_rows(true, None);
                    self.conversation_markdown.clear();
                    self.conversation_markdown_subscriptions.clear();
                    let descriptors = self.conversation_markdown_descriptors(0..new_item_count);
                    self.sync_conversation_markdown(descriptors, cx);
                } else if let Some((start, _delete_count, inserted_count)) = item_patch {
                    let inserted_end = (start + inserted_count).min(new_item_count);
                    self.sync_conversation_rows(
                        false,
                        Some(start.min(new_item_count)..inserted_end),
                    );
                    let descriptors = self
                        .conversation_markdown_descriptors(start.min(new_item_count)..inserted_end);
                    let inserted_keys = descriptors
                        .iter()
                        .map(|(_, key, _)| key.clone())
                        .collect::<HashSet<_>>();
                    for key in replaced_markdown_keys.difference(&inserted_keys) {
                        self.conversation_markdown.remove(key);
                        self.conversation_markdown_subscriptions.remove(key);
                    }
                    self.sync_conversation_markdown(descriptors, cx);
                } else if conversation_visibility_changed {
                    self.conversation_list.remeasure();
                }
                self.slash_completion_provider
                    .set_skills(self.session.available_skills.clone());
                if self.session.session_file.is_some() {
                    self.selected_session_path = self.session.session_file.clone();
                }
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
                    self.reset_workspace_scope();
                    self.files_cwd = Some(cwd.clone());
                    self.client.load_files(cwd.clone(), self.tx.clone());
                    self.client.load_git(cwd, self.tx.clone());
                    if self.terminal_panel_open {
                        self.client.create_terminal(
                            self.selected_session_id.clone(),
                            self.session.session_key.clone(),
                            self.terminal_cols,
                            self.terminal_rows,
                            self.tx.clone(),
                        );
                    }
                }
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
                if self.selected_session_path.is_none() {
                    self.selected_session_path = event.active_session_path;
                }
                if self.session.session_key.is_none() {
                    self.session.session_key = event.active_session_key;
                }
                self.expand_selected_session_directory();
            }
            DesktopEvent::Delta(event) => {
                if self.selected_session_id.as_deref() == Some(event.session_id.as_str())
                    || self.session.session_id.as_deref() == Some(event.session_id.as_str())
                {
                    let changed_index = self
                        .session
                        .items
                        .iter()
                        .rposition(
                            |item| matches!(item, ConversationItem::Assistant(item) if item.streaming),
                        )
                        .unwrap_or(self.session.items.len());
                    self.session.apply_delta(event);
                    let new_item_count = self.session.items.len();
                    if changed_index < new_item_count {
                        self.sync_conversation_rows(false, Some(changed_index..changed_index + 1));
                        let descriptors = self
                            .conversation_markdown_descriptors(changed_index..changed_index + 1);
                        self.sync_conversation_markdown(descriptors, cx);
                    }
                }
            }
            DesktopEvent::Files { cwd, paths } => {
                if self.files_cwd.as_deref() == Some(cwd.as_str()) {
                    self.files = paths;
                }
            }
            DesktopEvent::WorkspaceUnavailable { cwd, error } => {
                if self.files_cwd.as_deref() == Some(cwd.as_str()) {
                    self.files.clear();
                    self.git_status = None;
                    self.git_files.clear();
                    self.git_branches.clear();
                    self.git_commits.clear();
                    self.workspace_error = Some(error);
                }
            }
            DesktopEvent::FileRead { cwd, response } => {
                if self.files_cwd.as_deref() != Some(cwd.as_str()) {
                    return;
                }
                self.selected_file_path = Some(response.path);
                self.selected_file_content = Some(response.content);
                self.status_message = None;
            }
            DesktopEvent::GitStatus { cwd, status } => {
                if self.files_cwd.as_deref() == Some(cwd.as_str()) {
                    self.git_status = status;
                }
            }
            DesktopEvent::GitChanges { cwd, response } => {
                if self.files_cwd.as_deref() != Some(cwd.as_str()) {
                    return;
                }
                self.git_files = response.files.unwrap_or_default();
                self.git_branches = response.local_branches.unwrap_or_default();
                self.git_commits = response.commits.unwrap_or_default();
                self.status_message = None;
            }
            DesktopEvent::GitDiff { cwd, response } => {
                if self.files_cwd.as_deref() != Some(cwd.as_str()) {
                    return;
                }
                self.selected_git_path = Some(response.path);
                self.selected_git_diff = Some(response.patch);
                self.selected_commit_hash = None;
                self.status_message = None;
            }
            DesktopEvent::GitCommitDiff { cwd, response } => {
                if self.files_cwd.as_deref() != Some(cwd.as_str()) {
                    return;
                }
                self.selected_git_path = Some(response.title);
                self.selected_git_diff = Some(response.patch);
                self.selected_commit_hash = Some(response.commit);
                self.status_message = None;
            }
            DesktopEvent::GitMutation(message) => {
                self.status_message = Some(message);
                self.pending_discard_path = None;
                self.pending_discard_all = false;
                self.pending_commit_action = None;
                if self.commit_in_flight {
                    self.commit_in_flight = false;
                    self.commit_message_generating = false;
                    self.commit_dialog_open = false;
                    self.generated_commit_message = None;
                    self.reset_commit_message_on_open = true;
                }
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
            DesktopEvent::PendingMessages(messages) => {
                self.session.pending_messages = messages;
                self.status_message = None;
            }
            DesktopEvent::AuthProviders(response) => {
                self.auth_providers = response
                    .oauth_providers
                    .into_iter()
                    .chain(response.api_key_providers)
                    .collect();
                self.status_message = None;
            }
            DesktopEvent::AuthChanged(message) => {
                self.status_message = Some(message);
                self.selected_auth_provider = None;
                self.client.load_auth_providers(self.tx.clone());
            }
            DesktopEvent::UiRequest(request) => {
                self.ui_request = Some(request);
                self.settings_open = true;
            }
            DesktopEvent::UiRequestResolved => {
                self.ui_request = None;
                self.status_message = None;
            }
            DesktopEvent::Notification(message) => {
                self.status_message = Some(message);
            }
            DesktopEvent::TerminalCreated(terminal) => {
                self.terminal_label = format!(
                    "Terminal · {} · {}",
                    terminal.shell,
                    Self::basename(&terminal.cwd)
                );
                self.terminal_id = Some(terminal.id.clone());
                self.terminal_view.update(cx, |view, cx| {
                    view.feed_output_bytes(b"\x1bc", cx);
                });
                let transport = self.client.start_terminal_transport(
                    terminal.id,
                    self.selected_session_id.clone(),
                    self.session.session_key.clone(),
                    self.tx.clone(),
                );
                *self
                    .terminal_transport
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(transport);
                self.status_message = None;
            }
            DesktopEvent::TerminalOutput(output) => {
                self.respond_to_terminal_queries(output.as_bytes());
                self.terminal_view.update(cx, |view, cx| {
                    view.queue_output_bytes(output.as_bytes(), cx)
                });
            }
            DesktopEvent::SessionTree(response) => {
                self.tree_leaf_id = response.leaf_id;
                self.tree_nodes.clear();
                for node in response.tree {
                    node.flatten(0, &mut self.tree_nodes);
                }
                self.status_message = None;
            }
            DesktopEvent::ForkableMessages(messages) => {
                self.forkable_messages = messages;
                self.status_message = None;
            }
            DesktopEvent::CommitMessage(message) => {
                self.commit_message_generating = false;
                if let Some((push, force_push)) = self.pending_commit_after_generation.take() {
                    if let Some(cwd) = self.files_cwd.clone() {
                        self.client
                            .commit_git(cwd, message, push, force_push, self.tx.clone());
                        self.commit_in_flight = true;
                        self.status_message = Some("Committing changes…".into());
                    }
                } else {
                    self.generated_commit_message = Some(message);
                    self.status_message = None;
                }
            }
            DesktopEvent::PerformanceSettings(settings) => {
                self.pi_transport = settings.transport;
                self.pi_cache_retention = settings.cache_retention;
                self.performance_restart_required =
                    settings.applies_to_active_session_after_restart;
                self.status_message = None;
            }
            DesktopEvent::SessionStatus(status) => {
                for index in self.directory_indexes.values_mut() {
                    if let Some(session) = index.sessions.iter_mut().find(|session| {
                        status.session_id.as_deref() == session.id.as_deref()
                            || status.session_path.as_deref() == session.path.as_deref()
                    }) {
                        if let Some(streaming) = status.streaming {
                            session.streaming = streaming;
                        }
                        if let Some(unread) = status.unread {
                            session.unread = unread;
                        }
                    }
                }
                if status.session_id.as_deref() == self.selected_session_id.as_deref()
                    || status.session_path.as_deref() == self.selected_session_path.as_deref()
                {
                    if let Some(unread) = status.unread {
                        self.selected_session_unread = unread;
                    }
                }
            }
            DesktopEvent::SessionDone(done) => {
                if !self.seen_completion_ids.insert(done.id) {
                    return;
                }
                let title = done.title.unwrap_or_else(|| "Pico session".into());
                let outcome = done.outcome.unwrap_or_else(|| "success".into());
                self.status_message = Some(format!("Completed: {title} ({outcome})"));
                if self.notifications_enabled && done.reason == "agent" {
                    std::thread::spawn(move || {
                        let _ = notify_rust::Notification::new()
                            .summary("Pico")
                            .body(&format!("{title} finished ({outcome})"))
                            .show();
                    });
                }
            }
            DesktopEvent::PromptSent => {
                self.status_message = None;
            }
            DesktopEvent::PromptAcknowledged => {
                self.pending_submission = None;
                self.status_message = None;
            }
            DesktopEvent::SessionSelected(session_id) => {
                self.reset_workspace_scope();
                self.expanded_tool_blocks.clear();
                self.conversation_markdown.clear();
                self.conversation_markdown_subscriptions.clear();
                self.conversation_rows.clear();
                self.selected_session_id = Some(session_id.clone());
                self.session = SessionState::default();
                self.conversation_list = Self::new_conversation_list(0);
                self.status_message = Some("Loading session…".into());
                self.restart_events(Some(session_id), None);
            }
            DesktopEvent::DirectoryResolved(directory) => {
                if !self.directories.contains(&directory) {
                    self.directories.push(directory.clone());
                }
                self.selected_directory = directory;
                self.add_directory_dialog_open = false;
                self.reset_directory_input_on_open = true;
                self.persist_preferences();
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
                self.delete_session_target = None;
                if clear_selection {
                    self.expanded_tool_blocks.clear();
                    self.conversation_markdown.clear();
                    self.conversation_markdown_subscriptions.clear();
                    self.conversation_rows.clear();
                    self.selected_session_id = None;
                    self.selected_session_path = None;
                    self.session = SessionState::default();
                    self.conversation_list = Self::new_conversation_list(0);
                    self.restart_events(None, None);
                }
            }
            DesktopEvent::SessionMoved { path, cwd } => {
                self.selected_session_path = Some(path);
                self.selected_directory = cwd;
                self.status_message = Some("Moved session".into());
            }
            DesktopEvent::SessionCreated { session_key, cwd } => {
                self.reset_workspace_scope();
                self.expanded_tool_blocks.clear();
                self.conversation_markdown.clear();
                self.conversation_markdown_subscriptions.clear();
                self.conversation_rows.clear();
                self.selected_session_id = None;
                self.session = SessionState {
                    session_key: Some(session_key.clone()),
                    cwd: Some(cwd),
                    draft: true,
                    ..SessionState::default()
                };
                self.conversation_list = Self::new_conversation_list(0);
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
                if self.pending_submission.is_some() {
                    self.failed_submission = self.pending_submission.take();
                }
                self.commit_in_flight = false;
                self.commit_message_generating = false;
                self.pending_commit_after_generation = None;
                self.status_message = Some(error);
            }
        }
        cx.notify();
    }

    fn open_settings(&mut self, cx: &mut Context<Self>) {
        self.settings_open = true;
        self.client.load_auth_providers(self.tx.clone());
        self.client.load_performance_settings(
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn cycle_pi_transport(&mut self, cx: &mut Context<Self>) {
        self.pi_transport = match self.pi_transport.as_str() {
            "auto" => "sse",
            "sse" => "websocket",
            "websocket" => "websocket-cached",
            _ => "auto",
        }
        .into();
        self.save_performance_settings(cx);
    }

    fn toggle_pi_cache_retention(&mut self, cx: &mut Context<Self>) {
        self.pi_cache_retention = if self.pi_cache_retention == "long" {
            "standard"
        } else {
            "long"
        }
        .into();
        self.save_performance_settings(cx);
    }

    fn save_performance_settings(&mut self, cx: &mut Context<Self>) {
        self.client.set_performance_settings(
            self.pi_transport.clone(),
            self.pi_cache_retention.clone(),
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        self.status_message = Some("Saving Pi performance settings…".into());
        cx.notify();
    }

    fn close_settings(&mut self, cx: &mut Context<Self>) {
        self.settings_open = false;
        self.selected_auth_provider = None;
        cx.notify();
    }

    fn open_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.command_palette_previous_focus = window.focused(cx);
        self.command_palette_open = true;
        let has_selected_session = self.selected_session_id.is_some();
        self.command_palette.update(cx, |list, cx| {
            list.delegate_mut().reset(has_selected_session);
            list.set_query("", window, cx);
            list.set_selected_index(Some(IndexPath::default()), window, cx);
            list.focus(window, cx);
        });
        cx.notify();
    }

    fn close_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.command_palette_open = false;
        if let Some(previous_focus) = self.command_palette_previous_focus.take() {
            previous_focus.focus(window, cx);
        } else {
            self.focus_handle.focus(window, cx);
        }
        cx.notify();
    }

    fn toggle_command_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.command_palette_open {
            self.close_command_palette(window, cx);
        } else {
            self.open_command_palette(window, cx);
        }
    }

    fn execute_palette_command(
        &mut self,
        command: DesktopPaletteCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_command_palette(window, cx);
        match command {
            DesktopPaletteCommand::NewSession => self.create_session(cx),
            DesktopPaletteCommand::SearchSessions => {
                self.left_sidebar_open = true;
                self.search.update(cx, |state, cx| state.focus(window, cx));
                cx.notify();
            }
            DesktopPaletteCommand::ProjectFiles => {
                self.right_sidebar_open = true;
                self.active_right_tab = RightWorkspaceTab::Files;
                cx.notify();
            }
            DesktopPaletteCommand::GitChanges => {
                self.right_sidebar_open = true;
                self.active_right_tab = RightWorkspaceTab::Changes;
                cx.notify();
            }
            DesktopPaletteCommand::ToggleTerminal => self.toggle_terminal(window, cx),
            DesktopPaletteCommand::CloneSession => self.clone_selected_session(cx),
            DesktopPaletteCommand::Settings => self.open_settings(cx),
        }
    }

    fn toggle_theme(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mode = if cx.theme().mode.is_dark() {
            ThemeMode::Light
        } else {
            ThemeMode::Dark
        };
        Theme::change(mode, Some(window), cx);
        self.preferences.dark_theme = mode.is_dark();
        self.persist_preferences();
        cx.refresh_windows();
    }

    fn toggle_notifications(&mut self, cx: &mut Context<Self>) {
        self.notifications_enabled = !self.notifications_enabled;
        self.persist_preferences();
        cx.notify();
    }

    fn select_auth_provider(
        &mut self,
        provider: AuthProvider,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if provider.configured {
            self.client.logout_provider(provider.id, self.tx.clone());
            self.status_message = Some("Logging out provider…".into());
        } else if provider.auth_type == "oauth" {
            self.client.login_oauth(provider.id, self.tx.clone());
            self.status_message = Some("Starting provider login…".into());
        } else {
            self.auth_value.update(cx, |state, cx| {
                state.set_value("", window, cx);
            });
            self.selected_auth_provider = Some(provider);
        }
        cx.notify();
    }

    fn submit_api_key(&mut self, cx: &mut Context<Self>) {
        let Some(provider) = self.selected_auth_provider.clone() else {
            return;
        };
        let key = self.auth_value.read(cx).value().trim().to_string();
        if key.is_empty() {
            self.status_message = Some("Enter an API key.".into());
            cx.notify();
            return;
        }
        self.client.save_api_key(provider.id, key, self.tx.clone());
        self.status_message = Some("Saving API key…".into());
        cx.notify();
    }

    fn resolve_ui_request(&mut self, body: serde_json::Value, cx: &mut Context<Self>) {
        let Some(request) = self.ui_request.take() else {
            return;
        };
        self.client
            .resolve_ui_request(request.id, body, self.tx.clone());
        cx.notify();
    }

    fn sync_terminal_grid_size(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (cols, rows) = Self::terminal_grid_size(window, self.left_sidebar_open);
        if (cols, rows) == (self.terminal_cols, self.terminal_rows) {
            return;
        }
        self.terminal_cols = cols;
        self.terminal_rows = rows;
        self.terminal_view
            .update(cx, |view, cx| view.resize_terminal(cols, rows, cx));
        let transport = self
            .terminal_transport
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(transport) = transport {
            let _ = transport.try_send(TerminalTransportCommand::Resize { cols, rows });
        }
    }

    fn respond_to_terminal_queries(&mut self, output: &[u8]) {
        let responses = terminal_device_attribute_responses(&mut self.terminal_query_tail, output);
        if responses.is_empty() {
            return;
        }
        let transport = self
            .terminal_transport
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(transport) = transport {
            for response in responses {
                let _ = transport.try_send(TerminalTransportCommand::Input(response.to_vec()));
            }
        }
    }

    fn open_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.terminal_panel_open = true;
        self.sync_terminal_grid_size(window, cx);
        self.terminal_focus_handle.focus(window, cx);
        let focus_handle = self.terminal_focus_handle.clone();
        window.defer(cx, move |window, cx| focus_handle.focus(window, cx));
        if self.terminal_id.is_none() {
            self.status_message = Some("Starting terminal…".into());
            self.client.create_terminal(
                self.selected_session_id.clone(),
                self.session.session_key.clone(),
                self.terminal_cols,
                self.terminal_rows,
                self.tx.clone(),
            );
        }
        cx.notify();
    }

    fn close_terminal(&mut self, cx: &mut Context<Self>) {
        self.terminal_panel_open = false;
        cx.notify();
    }

    fn toggle_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.terminal_panel_open {
            self.close_terminal(cx);
        } else {
            self.open_terminal(window, cx);
        }
    }

    fn open_history(&mut self, cx: &mut Context<Self>) {
        self.active_right_tab = RightWorkspaceTab::History;
        self.status_message = Some("Loading session history…".into());
        self.client.load_session_history_tools(
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn navigate_tree(&mut self, target_id: String, cx: &mut Context<Self>) {
        self.client.navigate_session_tree(
            target_id,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        self.status_message = Some("Navigating session history…".into());
        cx.notify();
    }

    fn fork_at(&mut self, entry_id: String, cx: &mut Context<Self>) {
        self.client.fork_session(
            entry_id,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        self.status_message = Some("Forking session…".into());
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

    fn reset_workspace_scope(&mut self) {
        self.files.clear();
        self.workspace_error = None;
        self.selected_file_path = None;
        self.selected_file_content = None;
        self.git_status = None;
        self.git_files.clear();
        self.git_branches.clear();
        self.git_commits.clear();
        self.selected_git_path = None;
        self.selected_git_diff = None;
        self.selected_commit_hash = None;
        self.terminal_id = None;
        self.terminal_label = "Terminal".into();
        self.terminal_query_tail.clear();
        *self
            .terminal_transport
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        self.tree_nodes.clear();
        self.forkable_messages.clear();
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
        if let Some(cwd) = session.cwd.as_ref()
            && self.directories.contains(cwd)
        {
            self.selected_directory = cwd.clone();
            self.preferences.collapsed_directories.remove(cwd);
            self.persist_preferences();
        }
        self.session_name_input.update(cx, |state, cx| {
            state.set_value(session.name.unwrap_or(session.title), window, cx);
        });
        self.restore_draft_for_current_scope(window, cx);
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

    fn open_add_directory_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.reset_directory_input_on_open {
            self.directory_input.update(cx, |state, cx| {
                state.set_value("", window, cx);
            });
            self.reset_directory_input_on_open = false;
        }
        self.add_directory_dialog_open = true;
        self.directory_input
            .update(cx, |state, cx| state.focus(window, cx));
        cx.notify();
    }

    fn close_add_directory_dialog(&mut self, cx: &mut Context<Self>) {
        self.add_directory_dialog_open = false;
        cx.notify();
    }

    fn toggle_all_directories(&mut self, cx: &mut Context<Self>) {
        if self.directories.is_empty() {
            return;
        }
        let all_collapsed = self
            .directories
            .iter()
            .all(|directory| self.preferences.collapsed_directories.contains(directory));
        if all_collapsed {
            for directory in &self.directories {
                self.preferences.collapsed_directories.remove(directory);
            }
        } else {
            self.preferences
                .collapsed_directories
                .extend(self.directories.iter().cloned());
        }
        self.persist_preferences();
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
        self.preferences.collapsed_directories.remove(&directory);
        if self.selected_directory == directory {
            self.selected_directory = self.directories[0].clone();
        }
        self.restart_events(
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
        );
        self.persist_preferences();
        cx.notify();
    }

    fn toggle_directory(&mut self, directory: String, cx: &mut Context<Self>) {
        self.selected_directory = directory.clone();
        if !self.preferences.collapsed_directories.remove(&directory) {
            self.preferences.collapsed_directories.insert(directory);
        }
        self.persist_preferences();
        cx.notify();
    }

    fn create_session_in_directory(&mut self, directory: String, cx: &mut Context<Self>) {
        self.selected_directory = directory.clone();
        self.status_message = Some("Creating session…".into());
        self.client.create_session(directory, self.tx.clone());
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
            self.persist_preferences();
            cx.notify();
        }
    }

    fn selected_session_entry(&self) -> Option<SessionListEntry> {
        self.directory_indexes
            .values()
            .flat_map(|index| index.sessions.iter())
            .find(|session| {
                (self.selected_session_id.is_some()
                    && session.id.as_deref() == self.selected_session_id.as_deref())
                    || (self.selected_session_path.is_some()
                        && session.path.as_deref() == self.selected_session_path.as_deref())
            })
            .cloned()
    }

    fn expand_selected_session_directory(&mut self) {
        let directory = self
            .directory_indexes
            .iter()
            .find_map(|(directory, index)| {
                index
                    .sessions
                    .iter()
                    .any(|session| {
                        (self.selected_session_id.is_some()
                            && session.id.as_deref() == self.selected_session_id.as_deref())
                            || (self.selected_session_path.is_some()
                                && session.path.as_deref() == self.selected_session_path.as_deref())
                    })
                    .then(|| directory.clone())
            });
        if let Some(directory) = directory
            && self.preferences.collapsed_directories.remove(&directory)
        {
            self.persist_preferences();
        }
    }

    fn begin_rename_session(
        &mut self,
        session: SessionListEntry,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let name = session
            .name
            .clone()
            .unwrap_or_else(|| session.title.clone());
        self.session_name_input.update(cx, |state, cx| {
            state.set_value(name, window, cx);
            state.focus(window, cx);
        });
        self.rename_session_target = Some(session);
        cx.notify();
    }

    fn confirm_rename_session(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self
            .rename_session_target
            .as_ref()
            .and_then(|session| session.path.clone())
        else {
            return;
        };
        let name = self.session_name_input.read(cx).value().trim().to_string();
        if name.is_empty() {
            return;
        }
        self.client.rename_session(path, name, self.tx.clone());
        self.rename_session_target = None;
        self.status_message = Some("Renaming session…".into());
        cx.notify();
    }

    fn generate_session_name(&mut self, session: SessionListEntry, cx: &mut Context<Self>) {
        let Some(path) = session.path else {
            return;
        };
        self.client
            .generate_and_rename_session(path, self.tx.clone());
        self.status_message = Some("Generating session name…".into());
        cx.notify();
    }

    fn request_delete_session(&mut self, session: SessionListEntry, cx: &mut Context<Self>) {
        self.delete_session_target = Some(session);
        cx.notify();
    }

    fn confirm_delete_session(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self
            .delete_session_target
            .take()
            .and_then(|session| session.path)
        else {
            return;
        };
        self.client.delete_session(path, self.tx.clone());
        self.status_message = Some("Deleting session…".into());
        cx.notify();
    }

    fn request_cleanup_directory(&mut self, directory: String, cx: &mut Context<Self>) {
        self.cleanup_directory_target = Some(directory);
        cx.notify();
    }

    fn confirm_cleanup_directory(&mut self, cx: &mut Context<Self>) {
        let Some(directory) = self.cleanup_directory_target.take() else {
            return;
        };
        self.client.cleanup_directory(directory, self.tx.clone());
        self.status_message = Some("Cleaning old sessions…".into());
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

    fn clone_session(&mut self, session: SessionListEntry, cx: &mut Context<Self>) {
        let Some(session_id) = session.id else {
            return;
        };
        self.client.clone_session(session_id, self.tx.clone());
        self.status_message = Some("Cloning session…".into());
        cx.notify();
    }

    fn toggle_session_read(&mut self, session: SessionListEntry, cx: &mut Context<Self>) {
        let Some(path) = session.path else {
            return;
        };
        let unread = !session.unread;
        for index in self.directory_indexes.values_mut() {
            if let Some(entry) = index
                .sessions
                .iter_mut()
                .find(|entry| entry.path.as_deref() == Some(path.as_str()))
            {
                entry.unread = unread;
            }
        }
        if self.selected_session_path.as_deref() == Some(path.as_str()) {
            self.selected_session_unread = unread;
        }
        self.client
            .set_session_unread(path, unread, self.tx.clone());
        cx.notify();
    }

    fn move_session(&mut self, session: SessionListEntry, cwd: String, cx: &mut Context<Self>) {
        let Some(path) = session.path else {
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
        if message.is_empty() && self.composer_images.is_empty() {
            return;
        }
        self.composer.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
        if self.composer_images.is_empty() && self.run_builtin_slash_command(&message, cx) {
            return;
        }
        let submission = PromptSubmission {
            message: message.clone(),
            images: std::mem::take(&mut self.composer_images),
            streaming_behavior: self.streaming_behavior,
        };
        self.pending_submission = Some(submission.clone());
        self.failed_submission = None;
        self.status_message = Some("Sending…".into());
        self.conversation_list.scroll_to_end();
        self.client.submit_prompt(
            message,
            self.streaming_behavior.api_value(),
            submission
                .images
                .into_iter()
                .map(|(_, image)| image)
                .collect(),
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

    fn run_builtin_slash_command(&mut self, message: &str, cx: &mut Context<Self>) -> bool {
        let Some(command) = message.strip_prefix('/') else {
            return false;
        };
        let mut parts = command.splitn(2, char::is_whitespace);
        let name = parts.next().unwrap_or_default();
        let args = parts.next().unwrap_or_default().trim().to_string();
        match name {
            "login" | "logout" => self.open_settings(cx),
            "compact" => {
                self.client.run_slash_command(
                    "compact".into(),
                    args,
                    self.selected_session_id.clone(),
                    self.session.session_key.clone(),
                    self.tx.clone(),
                );
                self.status_message = Some("Compacting context…".into());
            }
            "clone" => self.clone_selected_session(cx),
            "fork" | "tree" => self.open_history(cx),
            "rename" => {
                let Some(path) = self.selected_session_path.clone() else {
                    self.status_message = Some("Start the session before renaming it.".into());
                    cx.notify();
                    return true;
                };
                if args.is_empty() {
                    self.status_message = Some("Enter a name after /rename.".into());
                } else {
                    self.client.rename_session(path, args, self.tx.clone());
                    self.status_message = Some("Renaming session…".into());
                }
            }
            "delete" => {
                if let Some(session) = self.selected_session_entry() {
                    self.delete_session_target = Some(session);
                } else {
                    self.status_message = Some("Start the session before deleting it.".into());
                }
            }
            "hide-thinking" | "show-thinking" => {
                let hidden = name == "hide-thinking";
                self.session.hide_thinking_block = hidden;
                self.client.set_hide_thinking(
                    hidden,
                    self.selected_session_id.clone(),
                    self.session.session_key.clone(),
                    self.tx.clone(),
                );
                self.status_message = None;
            }
            "hide-tools" | "show-tools" => {
                self.hide_tools = name == "hide-tools";
                self.conversation_list.remeasure();
                self.persist_preferences();
                self.status_message = None;
            }
            _ => return false,
        }
        cx.notify();
        true
    }

    fn restore_failed_submission(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(submission) = self.failed_submission.take() else {
            return;
        };
        self.streaming_behavior = submission.streaming_behavior;
        self.composer_images = submission.images;
        self.composer.update(cx, |state, cx| {
            state.set_value(submission.message, window, cx);
            state.focus(window, cx);
        });
        self.status_message = None;
        cx.notify();
    }

    fn pick_images(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("Select up to 8 images".into()),
        });
        let view = cx.entity();
        cx.spawn_in(window, async move |_, window| {
            let paths = prompt.await.ok()?.ok()??;
            let attachments = smol::unblock(move || {
                paths
                    .iter()
                    .take(8)
                    .filter_map(|path| {
                        let data = std::fs::read(path).ok()?;
                        if data.len() > 10 * 1024 * 1024 {
                            return None;
                        }
                        let extension = path
                            .extension()
                            .and_then(|extension| extension.to_str())
                            .unwrap_or_default()
                            .to_ascii_lowercase();
                        let mime_type = match extension.as_str() {
                            "jpg" | "jpeg" => "image/jpeg",
                            "gif" => "image/gif",
                            "webp" => "image/webp",
                            "png" => "image/png",
                            _ => return None,
                        };
                        Some((
                            path.file_name()?.to_string_lossy().to_string(),
                            serde_json::json!({
                                "type": "image",
                                "mimeType": mime_type,
                                "data": BASE64.encode(data),
                            }),
                        ))
                    })
                    .collect::<Vec<_>>()
            })
            .await;
            window
                .update(|_, cx| {
                    view.update(cx, |this, cx| {
                        let available = 8usize.saturating_sub(this.composer_images.len());
                        this.composer_images
                            .extend(attachments.into_iter().take(available));
                        cx.notify();
                    })
                })
                .ok()
        })
        .detach();
    }

    fn remove_composer_image(&mut self, index: usize, cx: &mut Context<Self>) {
        if index < self.composer_images.len() {
            self.composer_images.remove(index);
            cx.notify();
        }
    }

    fn context_usage_label(&self) -> Option<String> {
        let usage = self.session.context_usage.as_ref()?;
        let percent = usage.get("percent").and_then(serde_json::Value::as_f64);
        let tokens = usage.get("tokens").and_then(serde_json::Value::as_u64);
        let window = usage
            .get("contextWindow")
            .and_then(serde_json::Value::as_u64);
        match (percent, tokens, window) {
            (Some(percent), _, _) => Some(format!("Context {:.0}%", percent)),
            (_, Some(tokens), Some(window)) => Some(format!("Context {tokens}/{window}")),
            _ => None,
        }
    }

    fn toggle_streaming_behavior(&mut self, cx: &mut Context<Self>) {
        self.streaming_behavior = match self.streaming_behavior {
            ComposerStreamingBehavior::Steer => ComposerStreamingBehavior::FollowUp,
            ComposerStreamingBehavior::FollowUp => ComposerStreamingBehavior::Steer,
        };
        cx.notify();
    }

    fn move_pending_message(&mut self, index: usize, offset: isize, cx: &mut Context<Self>) {
        let next = (index as isize + offset).clamp(
            0,
            self.session.pending_messages.len().saturating_sub(1) as isize,
        ) as usize;
        if next == index {
            return;
        }
        self.session.pending_messages.swap(index, next);
        self.client.reorder_pending_messages(
            self.session.pending_messages.clone(),
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn remove_pending_message(&mut self, pending_id: String, cx: &mut Context<Self>) {
        self.session
            .pending_messages
            .retain(|message| message.pending_id != pending_id);
        self.client.remove_pending_message(
            pending_id,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn start_pending_messages(&mut self, cx: &mut Context<Self>) {
        self.client.start_pending_messages(
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        self.status_message = Some("Starting queued prompts…".into());
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

    fn select_model(&mut self, model: crate::models::ModelOption, cx: &mut Context<Self>) {
        self.status_message = Some(format!("Switching to {}…", model.label()));
        self.client.set_model(
            model,
            self.selected_session_id.clone(),
            self.session.session_key.clone(),
            self.tx.clone(),
        );
        cx.notify();
    }

    fn select_thinking_level(&mut self, level: String, cx: &mut Context<Self>) {
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
            self.workspace_error = None;
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

    fn reference_project_file(
        &mut self,
        path: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let current = self.composer.read(cx).value().to_string();
        let spacer =
            if current.is_empty() || current.chars().last().is_some_and(char::is_whitespace) {
                ""
            } else {
                " "
            };
        self.composer.update(cx, |state, cx| {
            state.set_value(format!("{current}{spacer}@{path} "), window, cx);
            state.focus(window, cx);
        });
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

    fn open_commit_diff(&mut self, commit: String, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.client.load_commit_diff(cwd, commit, self.tx.clone());
        self.status_message = Some("Loading commit diff…".into());
        cx.notify();
    }

    fn apply_commit_action(&mut self, action: String, cx: &mut Context<Self>) {
        let (Some(cwd), Some(commit)) = (self.files_cwd.clone(), self.selected_commit_hash.clone())
        else {
            return;
        };
        if self.pending_commit_action.as_deref() != Some(action.as_str()) {
            self.pending_commit_action = Some(action);
            self.status_message = Some("Click the commit action again to confirm.".into());
            cx.notify();
            return;
        }
        self.client
            .commit_action(cwd, commit, action, self.tx.clone());
        self.status_message = Some("Applying commit action…".into());
        cx.notify();
    }

    fn attach_git_comment(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let comment = self.git_comment_input.read(cx).value().trim().to_string();
        let Some(path) = self.selected_git_path.clone() else {
            return;
        };
        if comment.is_empty() {
            self.status_message = Some("Enter a diff comment first.".into());
            cx.notify();
            return;
        }
        let current = self.composer.read(cx).value().to_string();
        let attachment = format!("\n\nDiff comments:\n- {path}: {comment}");
        self.composer.update(cx, |state, cx| {
            state.set_value(format!("{}{attachment}", current.trim_end()), window, cx);
        });
        self.git_comment_input.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
        self.status_message = Some("Attached diff comment to the prompt.".into());
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

    fn discard_all(&mut self, nuke: bool, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        if !self.pending_discard_all {
            self.pending_discard_all = true;
            self.status_message = Some("Click Discard all again to confirm.".into());
            cx.notify();
            return;
        }
        self.client.discard_git_all(cwd, nuke, self.tx.clone());
        self.status_message = Some(if nuke {
            "Nuking working tree…".into()
        } else {
            "Discarding all changes…".into()
        });
        cx.notify();
    }

    fn generate_commit_message(&mut self, cx: &mut Context<Self>) {
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        self.commit_message_generating = true;
        self.client.generate_commit_message(cwd, self.tx.clone());
        self.status_message = Some("Generating commit message…".into());
        cx.notify();
    }

    fn open_commit_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.reset_commit_message_on_open {
            self.commit_message.update(cx, |state, cx| {
                state.set_value("", window, cx);
            });
            self.reset_commit_message_on_open = false;
        }
        self.commit_dialog_open = true;
        self.generated_commit_message = None;
        self.commit_message
            .update(cx, |state, cx| state.focus(window, cx));
        cx.notify();
    }

    fn close_commit_dialog(&mut self, cx: &mut Context<Self>) {
        if self.commit_in_flight || self.pending_commit_after_generation.is_some() {
            return;
        }
        self.commit_dialog_open = false;
        cx.notify();
    }

    fn use_generated_commit_message(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(message) = self.generated_commit_message.take() else {
            return;
        };
        self.commit_message.update(cx, |state, cx| {
            state.set_value(message, window, cx);
        });
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

    fn commit(&mut self, push: bool, force_push: bool, cx: &mut Context<Self>) {
        let message = self.commit_message.read(cx).value().trim().to_string();
        let Some(cwd) = self.files_cwd.clone() else {
            return;
        };
        if message.is_empty() {
            self.pending_commit_after_generation = Some((push, force_push));
            self.commit_message_generating = true;
            self.client.generate_commit_message(cwd, self.tx.clone());
            self.status_message = Some("Generating commit message…".into());
            cx.notify();
            return;
        }
        self.client
            .commit_git(cwd, message, push, force_push, self.tx.clone());
        self.commit_in_flight = true;
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

    fn basename(path: &str) -> &str {
        path.trim_end_matches('/')
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or(path)
    }

    fn sidebar_sessions(&self, directory: &str, query: &str) -> Vec<SessionListEntry> {
        self.directory_indexes
            .get(directory)
            .map(|index| {
                index
                    .sessions
                    .iter()
                    .filter(|session| {
                        query.is_empty()
                            || session.title.to_lowercase().contains(query)
                            || session
                                .last_message_preview
                                .as_deref()
                                .unwrap_or_default()
                                .to_lowercase()
                                .contains(query)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    fn render_session_actions(
        &self,
        id: String,
        session: SessionListEntry,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let view = cx.entity();
        let move_targets = self
            .directories
            .iter()
            .filter(|directory| Some(directory.as_str()) != session.cwd.as_deref())
            .cloned()
            .collect::<Vec<_>>();
        let has_path = session.path.is_some();
        let has_id = session.id.is_some();

        Button::new(id)
            .ghost()
            .xsmall()
            .icon(IconName::Ellipsis)
            .tooltip("Session actions")
            .dropdown_menu_with_anchor(Anchor::TopRight, move |menu, window, cx| {
                let read_session = session.clone();
                let read_label = if session.unread {
                    "Mark as read"
                } else {
                    "Mark as unread"
                };
                let mut menu = menu.min_w(190.).item(
                    PopupMenuItem::new(read_label).disabled(!has_path).on_click(
                        window.listener_for(&view, move |this, _, _, cx| {
                            this.toggle_session_read(read_session.clone(), cx)
                        }),
                    ),
                );

                if !move_targets.is_empty() && session.path.is_some() {
                    let submenu_view = view.clone();
                    let submenu_session = session.clone();
                    let submenu_targets = move_targets.clone();
                    menu = menu.submenu("Move to…", window, cx, move |menu, window, _| {
                        submenu_targets.iter().fold(menu, |menu, directory| {
                            let target = directory.clone();
                            let target_session = submenu_session.clone();
                            menu.item(
                                PopupMenuItem::new(Self::basename(directory).to_string()).on_click(
                                    window.listener_for(&submenu_view, move |this, _, _, cx| {
                                        this.move_session(
                                            target_session.clone(),
                                            target.clone(),
                                            cx,
                                        )
                                    }),
                                ),
                            )
                        })
                    });
                }

                let rename_session = session.clone();
                let auto_name_session = session.clone();
                let clone_session = session.clone();
                let delete_session = session.clone();
                menu.item(PopupMenuItem::new("Rename…").disabled(!has_path).on_click(
                    window.listener_for(&view, move |this, _, window, cx| {
                        this.begin_rename_session(rename_session.clone(), window, cx)
                    }),
                ))
                .item(
                    PopupMenuItem::new("Generate name")
                        .disabled(!has_path)
                        .on_click(window.listener_for(&view, move |this, _, _, cx| {
                            this.generate_session_name(auto_name_session.clone(), cx)
                        })),
                )
                .item(PopupMenuItem::new("Clone").disabled(!has_id).on_click(
                    window.listener_for(&view, move |this, _, _, cx| {
                        this.clone_session(clone_session.clone(), cx)
                    }),
                ))
                .separator()
                .item(PopupMenuItem::new("Delete…").disabled(!has_path).on_click(
                    window.listener_for(&view, move |this, _, _, cx| {
                        this.request_delete_session(delete_session.clone(), cx)
                    }),
                ))
            })
            .into_any_element()
    }

    fn render_sidebar_session(
        &self,
        directory_index: usize,
        session_index: usize,
        session: SessionListEntry,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let selected = cx.theme().secondary;
        let muted = cx.theme().muted_foreground;
        let session_id = session.id.clone().unwrap_or_default();
        let is_selected = self.selected_session_id.as_deref() == Some(session_id.as_str());
        let session_for_select = session.clone();
        let preview = session.last_message_preview.clone().unwrap_or_default();

        h_flex()
            .id(("session-row", directory_index * 10_000 + session_index))
            .mx_1()
            .rounded_lg()
            .when(is_selected, |this| this.bg(selected))
            .when(!is_selected, |this| {
                this.hover(|this| this.bg(selected.opacity(0.5)))
            })
            .child(
                h_flex()
                    .id(("session-select", directory_index * 10_000 + session_index))
                    .flex_1()
                    .min_w_0()
                    .px_2()
                    .py_2()
                    .gap_2()
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_session(session_for_select.clone(), window, cx)
                    }))
                    .when(session.streaming || session.unread, |this| {
                        this.child(div().size(px(7.)).flex_shrink_0().rounded_full().bg(
                            if session.streaming {
                                cx.theme().primary
                            } else {
                                cx.theme().warning
                            },
                        ))
                    })
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .gap_1()
                            .child(
                                div()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .text_sm()
                                    .font_medium()
                                    .child(session.title.clone()),
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
                            }),
                    ),
            )
            .child(self.render_session_actions(
                format!("session-actions-{directory_index}-{session_index}"),
                session,
                cx,
            ))
            .into_any_element()
    }

    fn render_directory_actions(
        &self,
        index: usize,
        directory: String,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let view = cx.entity();
        let can_move_up = index > 0;
        let can_move_down = index + 1 < self.directories.len();
        let can_remove = self.directories.len() > 1;

        Button::new(format!("directory-actions-{index}"))
            .ghost()
            .xsmall()
            .icon(IconName::Ellipsis)
            .tooltip("Directory actions")
            .dropdown_menu_with_anchor(Anchor::TopRight, move |menu, window, _| {
                let up_directory = directory.clone();
                let down_directory = directory.clone();
                let cleanup_directory = directory.clone();
                let remove_directory = directory.clone();
                menu.min_w(190.)
                    .item(
                        PopupMenuItem::new("Move up")
                            .disabled(!can_move_up)
                            .on_click(window.listener_for(&view, move |this, _, _, cx| {
                                this.move_directory(up_directory.clone(), -1, cx)
                            })),
                    )
                    .item(
                        PopupMenuItem::new("Move down")
                            .disabled(!can_move_down)
                            .on_click(window.listener_for(&view, move |this, _, _, cx| {
                                this.move_directory(down_directory.clone(), 1, cx)
                            })),
                    )
                    .separator()
                    .item(
                        PopupMenuItem::new("Delete old sessions…").on_click(window.listener_for(
                            &view,
                            move |this, _, _, cx| {
                                this.request_cleanup_directory(cleanup_directory.clone(), cx)
                            },
                        )),
                    )
                    .item(
                        PopupMenuItem::new("Remove from sidebar")
                            .disabled(!can_remove)
                            .on_click(window.listener_for(&view, move |this, _, _, cx| {
                                this.remove_directory(remove_directory.clone(), cx)
                            })),
                    )
            })
            .into_any_element()
    }

    fn render_left_sidebar(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border.opacity(0.72);
        let muted = cx.theme().muted_foreground;
        let query = self.search.read(cx).value().trim().to_lowercase();
        let search_active = !query.is_empty();
        let all_directories_collapsed = !self.directories.is_empty()
            && self
                .directories
                .iter()
                .all(|directory| self.preferences.collapsed_directories.contains(directory));
        let collapse_tooltip = if all_directories_collapsed {
            "Expand all directories"
        } else {
            "Collapse all directories"
        };
        let directories = self.directories.clone();
        let visible_directories = directories
            .iter()
            .cloned()
            .enumerate()
            .filter_map(|(index, directory)| {
                let sessions = self.sidebar_sessions(&directory, &query);
                (!search_active || !sessions.is_empty()).then_some((index, directory, sessions))
            })
            .collect::<Vec<_>>();
        let new_session_kbd = Kbd::binding_for_action(&NewSession, None, window);
        let commands_kbd = Kbd::binding_for_action(&FocusSessionSearch, None, window);
        let settings_kbd = Kbd::binding_for_action(&OpenSettings, None, window);

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
                            .child(
                                h_flex()
                                    .w_full()
                                    .min_w_0()
                                    .gap_2()
                                    .child(Icon::new(IconName::Plus).size_4().flex_none())
                                    .child(
                                        div().flex_1().min_w_0().text_left().child("New session"),
                                    )
                                    .when_some(new_session_kbd, |this, kbd| this.child(kbd)),
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.create_session(cx))),
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
                            .text_sm()
                            .text_color(muted)
                            .justify_between()
                            .child("Directories")
                            .child(
                                h_flex()
                                    .gap_1()
                                    .child(
                                        Button::new("toggle-all-directories")
                                            .ghost()
                                            .small()
                                            .w(px(28.))
                                            .px_0()
                                            .disabled(search_active || directories.is_empty())
                                            .tooltip(collapse_tooltip)
                                            .when(all_directories_collapsed, |this| {
                                                this.icon(IconName::ChevronsUpDown)
                                            })
                                            .when(!all_directories_collapsed, |this| {
                                                this.icon(PicoIcon::ChevronsDownUp)
                                            })
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.toggle_all_directories(cx)
                                            })),
                                    )
                                    .child(
                                        Button::new("open-add-directory")
                                            .ghost()
                                            .small()
                                            .w(px(28.))
                                            .px_0()
                                            .tooltip("Add directory")
                                            .icon(PicoIcon::FolderPlus)
                                            .on_click(cx.listener(|this, _, window, cx| {
                                                this.open_add_directory_dialog(window, cx)
                                            })),
                                    ),
                            ),
                    )
                    .child(
                        v_flex()
                            .gap_1()
                            .children(visible_directories.into_iter().map(
                                |(index, directory, sessions)| {
                                    let collapsed = query.is_empty()
                                        && self
                                            .preferences
                                            .collapsed_directories
                                            .contains(&directory);
                                    let toggle_directory = directory.clone();
                                    let new_session_directory = directory.clone();
                                    v_flex()
                                        .id(("directory-group", index))
                                        .py_1()
                                        .child(
                                            h_flex()
                                                .px_1()
                                                .gap_1()
                                                .child(
                                                    h_flex()
                                                        .id(("directory-toggle", index))
                                                        .flex_1()
                                                        .min_w_0()
                                                        .px_1()
                                                        .py_1()
                                                        .gap_2()
                                                        .rounded_md()
                                                        .cursor_pointer()
                                                        .hover(|this| {
                                                            this.bg(cx
                                                                .theme()
                                                                .secondary
                                                                .opacity(0.5))
                                                        })
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                this.toggle_directory(
                                                                    toggle_directory.clone(),
                                                                    cx,
                                                                )
                                                            },
                                                        ))
                                                        .child(
                                                            Icon::new(if collapsed {
                                                                IconName::ChevronRight
                                                            } else {
                                                                IconName::ChevronDown
                                                            })
                                                            .size_3(),
                                                        )
                                                        .child(Icon::new(IconName::Folder).size_4())
                                                        .child(
                                                            div()
                                                                .flex_1()
                                                                .min_w_0()
                                                                .overflow_hidden()
                                                                .whitespace_nowrap()
                                                                .text_ellipsis()
                                                                .text_sm()
                                                                .font_semibold()
                                                                .child(
                                                                    Self::basename(&directory)
                                                                        .to_string(),
                                                                ),
                                                        ),
                                                )
                                                .child(
                                                    Button::new(("directory-new-session", index))
                                                        .ghost()
                                                        .xsmall()
                                                        .icon(IconName::Plus)
                                                        .tooltip("New session in this directory")
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                this.create_session_in_directory(
                                                                    new_session_directory.clone(),
                                                                    cx,
                                                                )
                                                            },
                                                        )),
                                                )
                                                .child(self.render_directory_actions(
                                                    index, directory, cx,
                                                )),
                                        )
                                        .when(!collapsed, |this| {
                                            this.child(
                                                v_flex()
                                                    .when(sessions.is_empty(), |this| {
                                                        this.child(
                                                            div()
                                                                .px_8()
                                                                .py_2()
                                                                .text_xs()
                                                                .text_color(muted)
                                                                .child(if query.is_empty() {
                                                                    "No sessions yet"
                                                                } else {
                                                                    "No matching sessions"
                                                                }),
                                                        )
                                                    })
                                                    .children(
                                                        sessions.into_iter().enumerate().map(
                                                            |(session_index, session)| {
                                                                self.render_sidebar_session(
                                                                    index,
                                                                    session_index,
                                                                    session,
                                                                    cx,
                                                                )
                                                            },
                                                        ),
                                                    ),
                                            )
                                        })
                                },
                            )),
                    ),
            )
            .child(
                v_flex()
                    .p_2()
                    .gap_1()
                    .border_t_1()
                    .border_color(border)
                    .child(
                        Button::new("commands")
                            .ghost()
                            .w_full()
                            .child(
                                h_flex()
                                    .w_full()
                                    .min_w_0()
                                    .gap_2()
                                    .child(Icon::new(IconName::Search).size_4().flex_none())
                                    .child(div().flex_1().min_w_0().text_left().child("Commands"))
                                    .when_some(commands_kbd, |this, kbd| this.child(kbd)),
                            )
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.toggle_command_palette(window, cx)
                            })),
                    )
                    .child(
                        Button::new("settings")
                            .ghost()
                            .w_full()
                            .child(
                                h_flex()
                                    .w_full()
                                    .min_w_0()
                                    .gap_2()
                                    .child(Icon::new(IconName::Settings).size_4().flex_none())
                                    .child(div().flex_1().min_w_0().text_left().child("Settings"))
                                    .when_some(settings_kbd, |this, kbd| this.child(kbd)),
                            )
                            .on_click(cx.listener(|this, _, _, cx| this.open_settings(cx))),
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
                    .tooltip("Toggle session sidebar")
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.left_sidebar_open = !this.left_sidebar_open;
                        if this.terminal_panel_open {
                            this.sync_terminal_grid_size(window, cx);
                        }
                        this.persist_preferences();
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
                h_flex()
                    .gap_1()
                    .child(
                        Button::new("toggle-terminal")
                            .ghost()
                            .small()
                            .icon(IconName::SquareTerminal)
                            .selected(self.terminal_panel_open)
                            .tooltip_with_action("Toggle terminal panel", &ToggleTerminal, None)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.toggle_terminal(window, cx)),
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
                            .tooltip("Toggle project sidebar")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.right_sidebar_open = !this.right_sidebar_open;
                                this.persist_preferences();
                                cx.notify();
                            })),
                    ),
            )
    }

    fn render_conversation_item(
        &mut self,
        index: usize,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let muted = cx.theme().muted_foreground;
        let secondary = cx.theme().secondary;
        let border = cx.theme().border.opacity(0.72);
        let Some(row) = self.conversation_rows.get(index).cloned() else {
            return div().into_any_element();
        };
        if !self.conversation_row_is_visible(index) {
            return div().into_any_element();
        }
        let previous_row = self.previous_visible_conversation_row(index);
        let continues_assistant = matches!(
            (&row, previous_row),
            (
                ConversationRow::AssistantBlock { item_index, .. },
                Some(ConversationRow::AssistantBlock {
                    item_index: previous_item_index,
                    ..
                })
            ) if item_index == previous_item_index
        );
        let is_first_visible_row = previous_row.is_none();
        let is_last_visible_row = !self.has_visible_conversation_row_after(index);

        h_flex()
            .w_full()
            .px_5()
            .when(is_first_visible_row, |this| this.pt_8())
            .when(!is_first_visible_row && continues_assistant, |this| {
                this.pt_3()
            })
            .when(!is_first_visible_row && !continues_assistant, |this| {
                this.pt_6()
            })
            .when(is_last_visible_row, |this| this.pb_8())
            .justify_center()
            .child(div().w_full().max_w(px(920.)).child(match row {
                ConversationRow::User { item_index, .. } => {
                    let Some(ConversationItem::User(user)) = self.session.items.get(item_index)
                    else {
                        return div().into_any_element();
                    };
                    h_flex()
                        .w_full()
                        .justify_end()
                        .child(
                            v_flex()
                                .max_w(px(680.))
                                .px_4()
                                .py_3()
                                .gap_1()
                                .rounded_xl()
                                .bg(cx.theme().primary)
                                .text_color(cx.theme().primary_foreground)
                                .text_sm()
                                .when(!user.text.is_empty(), |this| this.child(user.text.clone()))
                                .when(!user.images.is_empty(), |this| {
                                    this.child(div().text_xs().child(format!(
                                        "{} image attachment{}",
                                        user.images.len(),
                                        if user.images.len() == 1 { "" } else { "s" }
                                    )))
                                })
                                .when(user.queued, |this| {
                                    this.child(div().text_xs().child("Queued"))
                                }),
                        )
                        .into_any_element()
                }
                ConversationRow::AssistantBlock {
                    item_index,
                    block_index,
                    ..
                } => {
                    let Some(ConversationItem::Assistant(assistant)) =
                        self.session.items.get(item_index)
                    else {
                        return div().into_any_element();
                    };
                    let Some(block) = assistant.blocks.get(block_index) else {
                        return div().into_any_element();
                    };
                    match block {
                        AssistantBlock::Text(block) => self
                            .markdown_view(
                                Self::conversation_markdown_key(
                                    item_index,
                                    assistant.item_key.as_deref(),
                                    block_index,
                                    block.block_key.as_deref(),
                                    "text",
                                ),
                                &block.text,
                            )
                            .selectable(true)
                            .text_sm()
                            .line_height(gpui::relative(1.55))
                            .into_any_element(),
                        AssistantBlock::Thinking(_) if self.session.hide_thinking_block => {
                            div().into_any_element()
                        }
                        AssistantBlock::Thinking(block) => v_flex()
                            .w_full()
                            .p_3()
                            .gap_2()
                            .rounded_lg()
                            .border_1()
                            .border_color(border)
                            .bg(secondary.opacity(0.45))
                            .child(
                                div().text_xs().font_semibold().text_color(muted).child(
                                    block
                                        .summary_label
                                        .clone()
                                        .unwrap_or_else(|| "Thinking".into()),
                                ),
                            )
                            .child(
                                self.markdown_view(
                                    Self::conversation_markdown_key(
                                        item_index,
                                        assistant.item_key.as_deref(),
                                        block_index,
                                        block.block_key.as_deref(),
                                        "thinking",
                                    ),
                                    &block.text,
                                )
                                .selectable(true)
                                .text_sm(),
                            )
                            .into_any_element(),
                        AssistantBlock::Tool(_) if self.hide_tools => div().into_any_element(),
                        AssistantBlock::Tool(block) => {
                            let disclosure_key = if let Some(call_id) = block.call_id.as_deref() {
                                format!("tool:call:{call_id}")
                            } else if let Some(block_key) = block.block_key.as_deref() {
                                format!("tool:block:{block_key}")
                            } else {
                                format!("tool:item:{index}:block:{block_index}")
                            };
                            let is_open = self.expanded_tool_blocks.contains(&disclosure_key);
                            let toggle_key = disclosure_key.clone();
                            let name = block.name.clone().unwrap_or_else(|| "Tool".into());
                            let has_content =
                                block.args.is_some() || !block.output.trim().is_empty();

                            v_flex()
                                .id(format!("tool-accordion-{index}-{block_index}"))
                                .w_full()
                                .rounded_lg()
                                .border_1()
                                .border_color(border)
                                .bg(secondary.opacity(0.3))
                                .when(block.running, |this| {
                                    this.border_color(gpui::rgb(0xd97706))
                                        .bg(gpui::rgba(0xd9770610))
                                })
                                .when(block.is_error, |this| {
                                    this.border_color(gpui::rgb(0xdc2626))
                                        .bg(gpui::rgba(0xdc262610))
                                })
                                .child(
                                    h_flex()
                                        .id(format!("tool-accordion-header-{index}-{block_index}"))
                                        .min_w_0()
                                        .p_2()
                                        .gap_2()
                                        .when(has_content, |this| {
                                            this.cursor_pointer().on_click(cx.listener(
                                                move |this, _, _, cx| {
                                                    if is_open {
                                                        this.expanded_tool_blocks
                                                            .remove(&toggle_key);
                                                    } else {
                                                        this.expanded_tool_blocks
                                                            .insert(toggle_key.clone());
                                                    }
                                                    this.conversation_list
                                                        .remeasure_items(index..index + 1);
                                                    cx.notify();
                                                },
                                            ))
                                        })
                                        .child(
                                            Icon::new(if has_content {
                                                if is_open {
                                                    IconName::ChevronDown
                                                } else {
                                                    IconName::ChevronRight
                                                }
                                            } else {
                                                IconName::SquareTerminal
                                            })
                                            .size_4()
                                            .flex_none(),
                                        )
                                        .child(
                                            Icon::new(if block.running {
                                                IconName::LoaderCircle
                                            } else {
                                                IconName::SquareTerminal
                                            })
                                            .size_4()
                                            .flex_none(),
                                        )
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .overflow_hidden()
                                                .whitespace_nowrap()
                                                .text_ellipsis()
                                                .font_semibold()
                                                .child(name),
                                        )
                                        .when(block.running, |this| {
                                            this.child(
                                                div()
                                                    .text_xs()
                                                    .text_color(gpui::rgb(0xd97706))
                                                    .child("Running"),
                                            )
                                        })
                                        .when(block.is_error, |this| {
                                            this.child(
                                                div()
                                                    .text_xs()
                                                    .text_color(gpui::rgb(0xdc2626))
                                                    .child("Error"),
                                            )
                                        }),
                                )
                                .when(is_open && has_content, |this| {
                                    this.child(
                                        v_flex()
                                            .w_full()
                                            .p_3()
                                            .gap_3()
                                            .border_t_1()
                                            .border_color(border)
                                            .when_some(block.args.clone(), |this, args| {
                                                this.child(
                                                    div()
                                                        .font_family("Menlo")
                                                        .text_xs()
                                                        .text_color(muted)
                                                        .child(
                                                            serde_json::to_string_pretty(&args)
                                                                .unwrap_or_default(),
                                                        ),
                                                )
                                            })
                                            .when(!block.output.trim().is_empty(), |this| {
                                                this.child(
                                                    div()
                                                        .max_h(px(260.))
                                                        .overflow_y_scrollbar()
                                                        .font_family("Menlo")
                                                        .text_xs()
                                                        .child(block.output.clone()),
                                                )
                                            }),
                                    )
                                })
                                .into_any_element()
                        }
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
                                self.markdown_view(
                                    Self::conversation_markdown_key(
                                        item_index,
                                        assistant.item_key.as_deref(),
                                        block_index,
                                        block.block_key.as_deref(),
                                        "compaction",
                                    ),
                                    &block.summary,
                                )
                                .text_sm(),
                            )
                            .into_any_element(),
                    }
                }
            }))
            .into_any_element()
    }

    fn render_conversation(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let muted = cx.theme().muted_foreground;
        let is_working = self.session.streaming || self.session.compacting;

        if self.conversation_rows.is_empty() {
            return v_flex()
                .id("conversation")
                .flex_1()
                .min_h_0()
                .w_full()
                .justify_center()
                .items_center()
                .gap_4()
                .child(
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
                .into_any_element();
        }

        let conversation_list = self.conversation_list.clone();
        let view = cx.entity().clone();

        v_flex()
            .id("conversation")
            .flex_1()
            .min_h_0()
            .w_full()
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .child(
                        gpui::list(conversation_list.clone(), move |index, _, cx| {
                            view.update(cx, |this, cx| this.render_conversation_item(index, cx))
                        })
                        .size_full(),
                    )
                    .vertical_scrollbar(&conversation_list),
            )
            .when(is_working, |this| {
                this.child(
                    h_flex().w_full().justify_center().px_5().pb_3().child(
                        h_flex()
                            .w_full()
                            .max_w(px(920.))
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
                    ),
                )
            })
            .into_any_element()
    }

    fn render_pending_messages(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let muted = cx.theme().muted_foreground;
        let count = self.session.pending_messages.len();
        v_flex()
            .w_full()
            .max_w(px(920.))
            .mb_2()
            .p_2()
            .gap_1()
            .rounded_lg()
            .border_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().secondary.opacity(0.2))
            .child(
                h_flex()
                    .px_2()
                    .justify_between()
                    .child(
                        div()
                            .text_xs()
                            .font_semibold()
                            .child(format!("QUEUED PROMPTS ({count})")),
                    )
                    .child(
                        Button::new("start-queue")
                            .secondary()
                            .xsmall()
                            .label("Start now")
                            .on_click(
                                cx.listener(|this, _, _, cx| this.start_pending_messages(cx)),
                            ),
                    ),
            )
            .children(
                self.session
                    .pending_messages
                    .iter()
                    .enumerate()
                    .map(|(index, message)| {
                        let remove_id = message.pending_id.clone();
                        h_flex()
                            .px_2()
                            .py_1()
                            .gap_1()
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .text_sm()
                                    .child(message.text.clone()),
                            )
                            .when(!message.images.is_empty(), |this| {
                                this.child(
                                    div()
                                        .text_xs()
                                        .text_color(muted)
                                        .child(format!("{} images", message.images.len())),
                                )
                            })
                            .child(
                                Button::new(("pending-up", index))
                                    .ghost()
                                    .xsmall()
                                    .disabled(index == 0)
                                    .icon(IconName::ArrowUp)
                                    .tooltip("Move message up")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.move_pending_message(index, -1, cx)
                                    })),
                            )
                            .child(
                                Button::new(("pending-down", index))
                                    .ghost()
                                    .xsmall()
                                    .disabled(index + 1 == count)
                                    .icon(IconName::ArrowDown)
                                    .tooltip("Move message down")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.move_pending_message(index, 1, cx)
                                    })),
                            )
                            .child(
                                Button::new(("pending-remove", index))
                                    .ghost()
                                    .xsmall()
                                    .icon(IconName::Close)
                                    .tooltip("Remove pending message")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.remove_pending_message(remove_id.clone(), cx)
                                    })),
                            )
                    }),
            )
            .into_any_element()
    }

    fn render_composer(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        let selected_model = self.session.model.clone();
        let selected_thinking = self.session.thinking_level.clone();
        let available_models = self.session.available_models.clone();
        let available_thinking_levels = self.session.available_thinking_levels.clone();
        let model_view = cx.entity();
        let thinking_view = model_view.clone();
        let slash_menu_height = self.slash_completion_provider.reserved_height(
            self.composer.read(cx).value().as_ref(),
            window.viewport_size().height,
        );
        let busy = self.session.streaming || self.session.compacting;
        let context_usage = self.context_usage_label();

        v_flex()
            .w_full()
            .items_center()
            .px_5()
            .pb_5()
            .when(!self.session.pending_messages.is_empty(), |this| {
                this.child(self.render_pending_messages(cx))
            })
            .child(
                v_flex()
                    .w_full()
                    .max_w(px(920.))
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().secondary.opacity(0.3))
                    .overflow_hidden()
                    .when(!self.composer_images.is_empty(), |this| {
                        this.child(
                            h_flex().p_2().gap_1().flex_wrap().children(
                                self.composer_images.iter().enumerate().map(
                                    |(index, (name, _))| {
                                        Button::new(("composer-image", index))
                                            .secondary()
                                            .xsmall()
                                            .label(format!("{name} ×"))
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.remove_composer_image(index, cx)
                                            }))
                                    },
                                ),
                            ),
                        )
                    })
                    .child(Textarea::new(&self.composer).appearance(false).p_3())
                    .when(slash_menu_height > px(0.), |this| {
                        this.child(div().h(slash_menu_height).flex_shrink_0())
                    })
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
                                        Button::new("attach-images")
                                            .ghost()
                                            .small()
                                            .icon(IconName::Plus)
                                            .tooltip("Attach images")
                                            .disabled(self.composer_images.len() >= 8)
                                            .on_click(cx.listener(|this, _, window, cx| {
                                                this.pick_images(window, cx)
                                            })),
                                    )
                                    .child(
                                        Button::new("model")
                                            .ghost()
                                            .small()
                                            .label(model_label)
                                            .tooltip("Choose model")
                                            .disabled(available_models.is_empty())
                                            .dropdown_menu_with_anchor(
                                                Anchor::BottomLeft,
                                                move |menu, window, _| {
                                                    available_models.iter().fold(
                                                        menu.min_w(260.),
                                                        |menu, model| {
                                                            let option = model.clone();
                                                            let checked = selected_model
                                                                .as_ref()
                                                                .is_some_and(|selected| {
                                                                    selected.id == model.id
                                                                        && selected.provider
                                                                            == model.provider
                                                                });
                                                            menu.item(
                                                                PopupMenuItem::new(
                                                                    model.label().to_string(),
                                                                )
                                                                .checked(checked)
                                                                .on_click(window.listener_for(
                                                                    &model_view,
                                                                    move |this, _, _, cx| {
                                                                        this.select_model(
                                                                            option.clone(),
                                                                            cx,
                                                                        )
                                                                    },
                                                                )),
                                                            )
                                                        },
                                                    )
                                                },
                                            ),
                                    )
                                    .child(
                                        Button::new("thinking")
                                            .ghost()
                                            .small()
                                            .label(thinking_label)
                                            .tooltip("Choose thinking level")
                                            .disabled(available_thinking_levels.is_empty())
                                            .dropdown_menu_with_anchor(
                                                Anchor::BottomLeft,
                                                move |menu, window, _| {
                                                    available_thinking_levels.iter().fold(
                                                        menu.min_w(180.),
                                                        |menu, level| {
                                                            let option = level.clone();
                                                            menu.item(
                                                                PopupMenuItem::new(level.clone())
                                                                    .checked(
                                                                        selected_thinking
                                                                            .as_ref()
                                                                            == Some(level),
                                                                    )
                                                                    .on_click(
                                                                        window.listener_for(
                                                                            &thinking_view,
                                                                            move |this,
                                                                                  _,
                                                                                  _,
                                                                                  cx| {
                                                                                this.select_thinking_level(
                                                                                    option.clone(),
                                                                                    cx,
                                                                                )
                                                                            },
                                                                        ),
                                                                    ),
                                                            )
                                                        },
                                                    )
                                                },
                                            ),
                                    )
                                    .when(busy, |this| {
                                        this.child(
                                            Button::new("streaming-behavior")
                                                .ghost()
                                                .small()
                                                .label(self.streaming_behavior.label())
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    this.toggle_streaming_behavior(cx)
                                                })),
                                        )
                                    })
                                    .when_some(context_usage, |this, usage| {
                                        this.child(
                                            div()
                                                .px_2()
                                                .text_xs()
                                                .text_color(cx.theme().muted_foreground)
                                                .child(usage),
                                        )
                                    }),
                            )
                            .child(
                                h_flex()
                                    .gap_1()
                                    .when(busy, |this| {
                                        this.child(
                                            Button::new("abort")
                                                .danger()
                                                .small()
                                                .icon(IconName::Close)
                                                .tooltip("Stop response")
                                                .on_click(
                                                    cx.listener(|this, _, _, cx| this.abort(cx)),
                                                ),
                                        )
                                    })
                                    .child(
                                        Button::new("send")
                                            .primary()
                                            .small()
                                            .icon(IconName::ArrowUp)
                                            .tooltip("Send message")
                                            .on_click(cx.listener(|this, _, window, cx| {
                                                this.submit_prompt(window, cx)
                                            })),
                                    ),
                            ),
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
                                .tooltip("Back to project files")
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
                        )
                        .child(
                            Button::new("reference-file")
                                .secondary()
                                .small()
                                .label("Reference")
                                .on_click({
                                    let path = path.clone();
                                    cx.listener(move |this, _, window, cx| {
                                        this.reference_project_file(path.clone(), window, cx)
                                    })
                                }),
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
                                        .tooltip("Back to changes")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.selected_git_path = None;
                                            this.selected_git_diff = None;
                                            this.selected_commit_hash = None;
                                            this.pending_commit_action = None;
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
                        .when_some(self.selected_commit_hash.clone(), |this, _| {
                            this.child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        Button::new("revert-commit")
                                            .danger()
                                            .small()
                                            .label(
                                                if self.pending_commit_action.as_deref()
                                                    == Some("revert")
                                                {
                                                    "Confirm revert"
                                                } else {
                                                    "Revert"
                                                },
                                            )
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.apply_commit_action("revert".into(), cx)
                                            })),
                                    )
                                    .child(
                                        Button::new("cherry-pick-commit")
                                            .secondary()
                                            .small()
                                            .label(
                                                if self.pending_commit_action.as_deref()
                                                    == Some("cherry-pick")
                                                {
                                                    "Confirm cherry-pick"
                                                } else {
                                                    "Cherry-pick"
                                                },
                                            )
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.apply_commit_action("cherry-pick".into(), cx)
                                            })),
                                    ),
                            )
                        })
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
                        })
                        .child(
                            h_flex()
                                .gap_2()
                                .child(Input::new(&self.git_comment_input).cleanable(true))
                                .child(
                                    Button::new("attach-git-comment")
                                        .secondary()
                                        .small()
                                        .label("Attach")
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.attach_git_comment(window, cx)
                                        })),
                                ),
                        ),
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
        let actions = git_action_visibility(self.git_status.as_ref(), &self.git_files);
        let show_toolbar_actions = actions.commit
            || actions.stage_all
            || actions.unstage_all
            || actions.push
            || actions.force_push
            || actions.pull
            || actions.discard_all;
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
                    .when(show_toolbar_actions, |this| {
                        this.child(
                            h_flex()
                                .gap_1()
                                .when(actions.commit, |this| {
                                    this.child(
                                        Button::new("open-commit-dialog")
                                            .secondary()
                                            .small()
                                            .label("Commit…")
                                            .on_click(cx.listener(|this, _, window, cx| {
                                                this.open_commit_dialog(window, cx)
                                            })),
                                    )
                                })
                                .when(actions.stage_all, |this| {
                                    this.child(
                                        Button::new("stage-all")
                                            .secondary()
                                            .small()
                                            .label("Stage all")
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.stage_all(false, cx)
                                            })),
                                    )
                                })
                                .when(actions.unstage_all, |this| {
                                    this.child(
                                        Button::new("unstage-all")
                                            .ghost()
                                            .small()
                                            .label("Unstage all")
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.stage_all(true, cx)
                                            })),
                                    )
                                })
                                .when(actions.pull, |this| {
                                    this.child(
                                        Button::new("pull")
                                            .ghost()
                                            .small()
                                            .label("Pull")
                                            .on_click(cx.listener(|this, _, _, cx| this.pull(cx))),
                                    )
                                })
                                .when(actions.push, |this| {
                                    this.child(
                                        Button::new("push").ghost().small().label("Push").on_click(
                                            cx.listener(|this, _, _, cx| this.push(false, cx)),
                                        ),
                                    )
                                })
                                .when(actions.force_push, |this| {
                                    this.child(
                                        Button::new("force-push")
                                            .ghost()
                                            .small()
                                            .label("Force push")
                                            .on_click(
                                                cx.listener(|this, _, _, cx| this.push(true, cx)),
                                            ),
                                    )
                                })
                                .when(actions.discard_all, |this| {
                                    this.child(
                                        Button::new("discard-all")
                                            .danger()
                                            .small()
                                            .label(if self.pending_discard_all {
                                                "Confirm discard"
                                            } else {
                                                "Discard all"
                                            })
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.discard_all(false, cx)
                                            })),
                                    )
                                }),
                        )
                    }),
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
                        .children(
                            self.git_commits
                                .iter()
                                .take(20)
                                .enumerate()
                                .map(|(index, commit)| {
                                    let hash = commit
                                        .split(['\t', '\u{1f}'])
                                        .next()
                                        .unwrap_or(commit)
                                        .to_string();
                                    let label = commit
                                        .split('\u{1f}')
                                        .next_back()
                                        .unwrap_or(commit)
                                        .to_string();
                                    Button::new(("commit-row", index))
                                        .ghost()
                                        .small()
                                        .w_full()
                                        .justify_start()
                                        .child(
                                            div()
                                                .w_full()
                                                .overflow_hidden()
                                                .whitespace_nowrap()
                                                .text_ellipsis()
                                                .text_left()
                                                .child(label),
                                        )
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.open_commit_diff(hash.clone(), cx)
                                        }))
                                }),
                        )
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
                    )
                    .child(
                        Button::new("history-tab")
                            .small()
                            .when(
                                self.active_right_tab == RightWorkspaceTab::History,
                                |this| this.secondary(),
                            )
                            .when(
                                self.active_right_tab != RightWorkspaceTab::History,
                                |this| this.ghost(),
                            )
                            .label("History")
                            .on_click(cx.listener(|this, _, _, cx| this.open_history(cx))),
                    ),
            )
            .when_some(self.workspace_error.clone(), |this, error| {
                let error_to_copy = error.clone();
                this.child(
                    h_flex()
                        .id("workspace-error")
                        .min_w_0()
                        .px_3()
                        .py_2()
                        .gap_2()
                        .border_b_1()
                        .border_color(border)
                        .bg(cx.theme().warning.opacity(0.12))
                        .cursor_pointer()
                        .tooltip(|window, cx| Tooltip::new("Click to copy error").build(window, cx))
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(error_to_copy.clone()));
                        })
                        .child(Icon::new(IconName::Info).size_4().flex_none())
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_xs()
                                .child(error),
                        ),
                )
            })
            .child(match self.active_right_tab {
                RightWorkspaceTab::Changes => self.render_git_workspace(cx),
                RightWorkspaceTab::Files => self.render_file_workspace(cx),
                RightWorkspaceTab::History => self.render_history(cx),
            })
    }

    fn render_history(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let border = cx.theme().border.opacity(0.72);
        let muted = cx.theme().muted_foreground;
        v_flex()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .child(
                v_flex()
                    .p_3()
                    .gap_1()
                    .border_b_1()
                    .border_color(border)
                    .child(div().text_sm().font_semibold().child("Session tree"))
                    .child(
                        div()
                            .text_xs()
                            .text_color(muted)
                            .child("Select an earlier point to navigate the active branch."),
                    )
                    .children(self.tree_nodes.iter().enumerate().map(|(index, node)| {
                        let target_id = node.id.clone();
                        Button::new(("tree-node", index))
                            .ghost()
                            .small()
                            .w_full()
                            .justify_start()
                            .disabled(self.tree_leaf_id.as_deref() == Some(node.id.as_str()))
                            .label(format!("{}{}", "  ".repeat(node.depth), node.text))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.navigate_tree(target_id.clone(), cx)
                            }))
                    })),
            )
            .child(
                v_flex()
                    .p_3()
                    .gap_1()
                    .child(div().text_sm().font_semibold().child("Fork from message"))
                    .children(
                        self.forkable_messages
                            .iter()
                            .enumerate()
                            .map(|(index, message)| {
                                let entry_id = message.entry_id.clone();
                                Button::new(("fork-message", index))
                                    .secondary()
                                    .small()
                                    .w_full()
                                    .justify_start()
                                    .label(message.text.clone())
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.fork_at(entry_id.clone(), cx)
                                    }))
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_terminal(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        v_flex()
            .h(px(280.))
            .w_full()
            .flex_shrink_0()
            .min_h_0()
            .border_t_1()
            .border_color(cx.theme().border.opacity(0.72))
            .bg(gpui::rgb(0x111111))
            .text_color(gpui::rgb(0xeeeeee))
            .child(
                h_flex()
                    .h(px(38.))
                    .flex_shrink_0()
                    .px_3()
                    .justify_between()
                    .border_b_1()
                    .border_color(gpui::rgb(0x333333))
                    .child(
                        div()
                            .text_sm()
                            .font_semibold()
                            .child(self.terminal_label.clone()),
                    )
                    .child(
                        Button::new("close-terminal")
                            .ghost()
                            .xsmall()
                            .label("Close")
                            .on_click(cx.listener(|this, _, _, cx| this.close_terminal(cx))),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .child(self.terminal_view.clone()),
            )
            .into_any_element()
    }

    fn render_settings(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let border = cx.theme().border.opacity(0.72);
        let muted = cx.theme().muted_foreground;
        let request = self.ui_request.clone();
        v_flex()
            .absolute()
            .inset_0()
            .bg(cx.theme().background)
            .child(
                h_flex()
                    .h(px(56.))
                    .px_4()
                    .justify_between()
                    .border_b_1()
                    .border_color(border)
                    .child(div().text_lg().font_semibold().child("Settings"))
                    .child(
                        Button::new("close-settings")
                            .ghost()
                            .small()
                            .icon(IconName::Close)
                            .tooltip("Close settings")
                            .on_click(cx.listener(|this, _, _, cx| this.close_settings(cx))),
                    ),
            )
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .justify_center()
                    .child(
                        v_flex()
                            .w(px(720.))
                            .max_h_full()
                            .p_6()
                            .gap_5()
                            .overflow_y_scrollbar()
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(div().font_semibold().child("Pico server"))
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(muted)
                                            .child(self.server_label.clone()),
                                    ),
                            )
                            .child(
                                h_flex()
                                    .justify_between()
                                    .child(
                                        v_flex()
                                            .child(div().font_semibold().child("Appearance"))
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(muted)
                                                    .child("Follow Pico's light or dark workspace"),
                                            ),
                                    )
                                    .child(
                                        Button::new("toggle-theme")
                                            .secondary()
                                            .small()
                                            .label(if cx.theme().mode.is_dark() {
                                                "Use light theme"
                                            } else {
                                                "Use dark theme"
                                            })
                                            .on_click(cx.listener(|this, _, window, cx| {
                                                this.toggle_theme(window, cx)
                                            })),
                                    ),
                            )
                            .child(
                                h_flex()
                                    .justify_between()
                                    .child(
                                        v_flex()
                                            .child(div().font_semibold().child("Notifications"))
                                            .child(
                                                div()
                                                    .text_xs()
                                                    .text_color(muted)
                                                    .child("Notify when agent work completes"),
                                            ),
                                    )
                                    .child(
                                        Button::new("toggle-notifications")
                                            .secondary()
                                            .small()
                                            .label(if self.notifications_enabled {
                                                "Enabled"
                                            } else {
                                                "Disabled"
                                            })
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.toggle_notifications(cx)
                                            })),
                                    ),
                            )
                            .child(
                                v_flex()
                                    .gap_2()
                                    .child(div().font_semibold().child("Pi performance"))
                                    .child(
                                        h_flex()
                                            .justify_between()
                                            .child(
                                                v_flex()
                                                    .child(div().text_sm().child("Transport"))
                                                    .child(
                                                        div()
                                                            .text_xs()
                                                            .text_color(muted)
                                                            .child("RPC event transport for Pi sessions"),
                                                    ),
                                            )
                                            .child(
                                                Button::new("pi-transport")
                                                    .secondary()
                                                    .small()
                                                    .label(self.pi_transport.clone())
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.cycle_pi_transport(cx)
                                                    })),
                                            ),
                                    )
                                    .child(
                                        h_flex()
                                            .justify_between()
                                            .child(
                                                v_flex()
                                                    .child(div().text_sm().child("Cache retention"))
                                                    .child(
                                                        div()
                                                            .text_xs()
                                                            .text_color(muted)
                                                            .child("Keep transport caches longer"),
                                                    ),
                                            )
                                            .child(
                                                Button::new("pi-cache")
                                                    .secondary()
                                                    .small()
                                                    .label(self.pi_cache_retention.clone())
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.toggle_pi_cache_retention(cx)
                                                    })),
                                            ),
                                    )
                                    .when(self.performance_restart_required, |this| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(cx.theme().warning)
                                                .child(
                                                    "The active session applies this after restart.",
                                                ),
                                        )
                                    }),
                            )
                            .child(
                                v_flex()
                                    .gap_2()
                                    .child(div().font_semibold().child("Provider authentication"))
                                    .children(self.auth_providers.iter().enumerate().map(
                                        |(index, provider)| {
                                            let provider_for_action = provider.clone();
                                            h_flex()
                                                .p_3()
                                                .justify_between()
                                                .rounded_lg()
                                                .border_1()
                                                .border_color(border)
                                                .child(
                                                    v_flex()
                                                        .gap_0p5()
                                                        .child(
                                                            div()
                                                                .text_sm()
                                                                .font_semibold()
                                                                .child(provider.name.clone()),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_xs()
                                                                .text_color(muted)
                                                                .child(if provider.configured {
                                                                    "Configured"
                                                                } else if provider.auth_type
                                                                    == "oauth"
                                                                {
                                                                    "OAuth"
                                                                } else {
                                                                    "API key"
                                                                }),
                                                        ),
                                                )
                                                .child(
                                                    Button::new(("auth-provider", index))
                                                        .secondary()
                                                        .small()
                                                        .label(if provider.configured {
                                                            "Log out"
                                                        } else {
                                                            "Configure"
                                                        })
                                                        .on_click(cx.listener(
                                                            move |this, _, window, cx| {
                                                                this.select_auth_provider(
                                                                    provider_for_action.clone(),
                                                                    window,
                                                                    cx,
                                                                )
                                                            },
                                                        )),
                                                )
                                        },
                                    ))
                                    .when_some(self.selected_auth_provider.clone(), |this, provider| {
                                        this.child(
                                            v_flex()
                                                .p_3()
                                                .gap_2()
                                                .rounded_lg()
                                                .bg(cx.theme().secondary.opacity(0.35))
                                                .child(
                                                    div()
                                                        .text_sm()
                                                        .font_semibold()
                                                        .child(format!("{} API key", provider.name)),
                                                )
                                                .child(Input::new(&self.auth_value))
                                                .child(
                                                    Button::new("save-api-key")
                                                        .primary()
                                                        .small()
                                                        .label("Save key")
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.submit_api_key(cx)
                                                        })),
                                                ),
                                        )
                                    }),
                            )
                            .when_some(request, |this, request| {
                                let title = request.title.clone().unwrap_or_else(|| "Pico request".into());
                                let message = request.message.clone().unwrap_or_default();
                                this.child(
                                    v_flex()
                                        .p_4()
                                        .gap_3()
                                        .rounded_lg()
                                        .border_1()
                                        .border_color(cx.theme().primary)
                                        .child(div().font_semibold().child(title))
                                        .when(!message.is_empty(), |this| {
                                            this.child(TextView::markdown("ui-request", message))
                                        })
                                .when_some(request.auth_url.clone(), |this, url| {
                                    let auth_url = url.clone();
                                    this.child(
                                        v_flex()
                                            .gap_2()
                                            .child(
                                                div()
                                                    .p_2()
                                                    .rounded_md()
                                                    .bg(cx.theme().secondary)
                                                    .font_family("Menlo")
                                                    .text_xs()
                                                    .child(url),
                                            )
                                            .child(
                                                Button::new("open-auth-url")
                                                    .primary()
                                                    .small()
                                                    .label("Open authentication page")
                                                    .on_click(move |_, _, cx| {
                                                        cx.open_url(&auth_url)
                                                    }),
                                            ),
                                    )
                                })
                                        .when(!request.options.is_empty(), |this| {
                                            this.children(request.options.iter().enumerate().map(
                                                |(index, option)| {
                                                    let value = option.value().to_string();
                                                    Button::new(("ui-option", index))
                                                        .secondary()
                                                        .small()
                                                        .justify_start()
                                                        .label(option.label().to_string())
                                                        .on_click(cx.listener(move |this, _, _, cx| {
                                                            this.resolve_ui_request(
                                                                serde_json::json!({ "value": value }),
                                                                cx,
                                                            )
                                                        }))
                                                },
                                            ))
                                        })
                                        .when(request.options.is_empty() && request.method != "confirm", |this| {
                                            this.child(Input::new(&self.auth_value))
                                        })
                                        .child(
                                            h_flex()
                                                .gap_2()
                                                .child(
                                                    Button::new("ui-cancel")
                                                        .ghost()
                                                        .small()
                                                        .label("Cancel")
                                                        .on_click(cx.listener(|this, _, _, cx| {
                                                            this.resolve_ui_request(
                                                                serde_json::json!({ "cancelled": true }),
                                                                cx,
                                                            )
                                                        })),
                                                )
                                                .when(request.method == "confirm", |this| {
                                                    this.child(
                                                        Button::new("ui-confirm")
                                                            .primary()
                                                            .small()
                                                            .label("Confirm")
                                                            .on_click(cx.listener(|this, _, _, cx| {
                                                                this.resolve_ui_request(
                                                                    serde_json::json!({ "confirmed": true }),
                                                                    cx,
                                                                )
                                                            })),
                                                    )
                                                })
                                                .when(
                                                    request.options.is_empty()
                                                        && request.method != "confirm",
                                                    |this| {
                                                        this.child(
                                                            Button::new("ui-submit")
                                                                .primary()
                                                                .small()
                                                                .label("Submit")
                                                                .on_click(cx.listener(
                                                                    |this, _, _, cx| {
                                                                        let value = this
                                                                            .auth_value
                                                                            .read(cx)
                                                                            .value()
                                                                            .to_string();
                                                                        this.resolve_ui_request(
                                                                            serde_json::json!({ "value": value }),
                                                                            cx,
                                                                        )
                                                                    },
                                                                )),
                                                        )
                                                    },
                                                ),
                                        ),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_add_directory_dialog(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let can_add = !self.directory_input.read(cx).value().trim().is_empty();

        v_flex()
            .absolute()
            .inset_0()
            .items_center()
            .justify_center()
            .bg(cx.theme().background.opacity(0.82))
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    this.close_add_directory_dialog(cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                v_flex()
                    .w(px(520.))
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().popover)
                    .shadow_lg()
                    .overflow_hidden()
                    .child(
                        v_flex()
                            .p_4()
                            .gap_1()
                            .border_b_1()
                            .border_color(cx.theme().border.opacity(0.72))
                            .child(div().text_lg().font_semibold().child("Add directory"))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(cx.theme().muted_foreground)
                                    .child("Enter a project directory to add to the sidebar."),
                            ),
                    )
                    .child(
                        v_flex()
                            .p_4()
                            .gap_2()
                            .child(div().text_sm().font_semibold().child("Directory path"))
                            .child(Input::new(&self.directory_input).cleanable(true)),
                    )
                    .child(
                        h_flex()
                            .p_4()
                            .gap_2()
                            .justify_end()
                            .border_t_1()
                            .border_color(cx.theme().border.opacity(0.72))
                            .child(
                                Button::new("cancel-add-directory")
                                    .ghost()
                                    .label("Cancel")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.close_add_directory_dialog(cx)
                                    })),
                            )
                            .child(
                                Button::new("confirm-add-directory")
                                    .primary()
                                    .label("Add directory")
                                    .disabled(!can_add)
                                    .on_click(cx.listener(|this, _, _, cx| this.add_directory(cx))),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_commit_dialog(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let file_count = self.git_files.len();
        let additions = self
            .git_files
            .iter()
            .filter_map(|file| file.lines_added)
            .sum::<usize>();
        let deletions = self
            .git_files
            .iter()
            .filter_map(|file| file.lines_deleted)
            .sum::<usize>();
        let branch = self
            .git_status
            .as_ref()
            .map(|status| {
                if status.detached {
                    format!("Detached {}", status.revision.as_deref().unwrap_or("HEAD"))
                } else {
                    status
                        .branch
                        .clone()
                        .unwrap_or_else(|| "Unknown branch".into())
                }
            })
            .unwrap_or_else(|| "Unknown branch".into());
        let can_force_push = self
            .git_status
            .as_ref()
            .is_some_and(|status| !status.detached && status.ahead > 0 && status.behind > 0);
        let busy = self.commit_in_flight
            || self.commit_message_generating
            || self.pending_commit_after_generation.is_some();

        v_flex()
            .absolute()
            .inset_0()
            .items_center()
            .justify_center()
            .bg(cx.theme().background.opacity(0.82))
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    this.close_commit_dialog(cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                v_flex()
                    .w(px(620.))
                    .max_h(px(680.))
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().popover)
                    .shadow_lg()
                    .overflow_hidden()
                    .child(
                        h_flex()
                            .p_4()
                            .gap_3()
                            .justify_between()
                            .border_b_1()
                            .border_color(cx.theme().border.opacity(0.72))
                            .child(
                                v_flex()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_lg()
                                            .font_semibold()
                                            .child("Commit your changes"),
                                    )
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(cx.theme().muted_foreground)
                                            .child("Edit the message and choose whether to push."),
                                    ),
                            )
                            .child(
                                Button::new("close-commit-dialog")
                                    .ghost()
                                    .small()
                                    .label("Close")
                                    .disabled(busy)
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.close_commit_dialog(cx)),
                                    ),
                            ),
                    )
                    .child(
                        v_flex()
                            .p_4()
                            .gap_4()
                            .child(
                                v_flex()
                                    .gap_2()
                                    .child(
                                        h_flex()
                                            .justify_between()
                                            .text_sm()
                                            .child(div().font_semibold().child("Branch"))
                                            .child(
                                                div()
                                                    .text_color(cx.theme().muted_foreground)
                                                    .child(branch),
                                            ),
                                    )
                                    .child(
                                        h_flex()
                                            .justify_between()
                                            .text_sm()
                                            .child(div().font_semibold().child("Changes"))
                                            .child(
                                                h_flex()
                                                    .gap_2()
                                                    .text_color(cx.theme().muted_foreground)
                                                    .child(format!(
                                                        "{file_count} file{}",
                                                        if file_count == 1 { "" } else { "s" }
                                                    ))
                                                    .when(additions > 0, |this| {
                                                        this.child(
                                                            div()
                                                                .text_color(cx.theme().success)
                                                                .child(format!("+{additions}")),
                                                        )
                                                    })
                                                    .when(deletions > 0, |this| {
                                                        this.child(
                                                            div()
                                                                .text_color(cx.theme().danger)
                                                                .child(format!("−{deletions}")),
                                                        )
                                                    }),
                                            ),
                                    ),
                            )
                            .child(
                                v_flex()
                                    .gap_2()
                                    .child(
                                        h_flex()
                                            .justify_between()
                                            .child(div().text_sm().font_semibold().child("Message"))
                                            .child(
                                                Button::new("generate-dialog-commit-message")
                                                    .ghost()
                                                    .small()
                                                    .label("Generate")
                                                    .disabled(busy || file_count == 0)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.generate_commit_message(cx)
                                                    })),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .rounded_xl()
                                            .border_1()
                                            .border_color(cx.theme().border)
                                            .bg(cx.theme().secondary.opacity(0.2))
                                            .child(
                                                Textarea::new(&self.commit_message)
                                                    .appearance(false)
                                                    .disabled(busy)
                                                    .p_3(),
                                            ),
                                    )
                                    .when_some(
                                        self.generated_commit_message.clone(),
                                        |this, message| {
                                            this.child(
                                                h_flex()
                                                    .p_2()
                                                    .gap_2()
                                                    .rounded_md()
                                                    .bg(cx.theme().secondary.opacity(0.45))
                                                    .child(
                                                        div()
                                                            .flex_1()
                                                            .text_xs()
                                                            .child(message),
                                                    )
                                                    .child(
                                                        Button::new(
                                                            "use-dialog-commit-message",
                                                        )
                                                        .secondary()
                                                        .xsmall()
                                                        .label("Use")
                                                        .disabled(busy)
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.use_generated_commit_message(
                                                                    window, cx,
                                                                )
                                                            },
                                                        )),
                                                    ),
                                            )
                                        },
                                    ),
                            ),
                    )
                    .child(
                        h_flex()
                            .p_4()
                            .gap_2()
                            .justify_end()
                            .border_t_1()
                            .border_color(cx.theme().border.opacity(0.72))
                            .child(
                                Button::new("cancel-commit-dialog")
                                    .ghost()
                                    .label("Cancel")
                                    .disabled(busy)
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.close_commit_dialog(cx)),
                                    ),
                            )
                            .child(
                                Button::new("commit-dialog-commit")
                                    .primary()
                                    .label(if busy { "Working…" } else { "Commit" })
                                    .disabled(busy || file_count == 0)
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.commit(false, false, cx)),
                                    ),
                            )
                            .child(
                                Button::new("commit-dialog-push")
                                    .secondary()
                                    .label("Commit & push")
                                    .disabled(busy || file_count == 0)
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.commit(true, false, cx)),
                                    ),
                            )
                            .when(can_force_push, |this| {
                                this.child(
                                    Button::new("commit-dialog-force-push")
                                        .danger()
                                        .label("Commit & force push")
                                        .disabled(busy || file_count == 0)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.commit(true, true, cx)
                                        })),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_rename_session_dialog(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let title = self
            .rename_session_target
            .as_ref()
            .map(|session| session.title.clone())
            .unwrap_or_else(|| "Session".into());
        v_flex()
            .absolute()
            .inset_0()
            .items_center()
            .justify_center()
            .bg(cx.theme().background.opacity(0.82))
            .child(
                v_flex()
                    .w(px(440.))
                    .p_4()
                    .gap_3()
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().popover)
                    .shadow_lg()
                    .child(div().text_lg().font_semibold().child("Rename session"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().muted_foreground)
                            .child(title),
                    )
                    .child(Input::new(&self.session_name_input).cleanable(true))
                    .child(
                        h_flex()
                            .justify_end()
                            .gap_2()
                            .child(
                                Button::new("cancel-session-rename")
                                    .ghost()
                                    .label("Cancel")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.rename_session_target = None;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("confirm-session-rename")
                                    .primary()
                                    .label("Rename")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.confirm_rename_session(cx)
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_delete_session_dialog(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let title = self
            .delete_session_target
            .as_ref()
            .map(|session| session.title.clone())
            .unwrap_or_else(|| "this session".into());
        v_flex()
            .absolute()
            .inset_0()
            .items_center()
            .justify_center()
            .bg(cx.theme().background.opacity(0.82))
            .child(
                v_flex()
                    .w(px(440.))
                    .p_4()
                    .gap_3()
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().popover)
                    .shadow_lg()
                    .child(div().text_lg().font_semibold().child("Delete session?"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("Delete “{title}”? This cannot be undone.")),
                    )
                    .child(
                        h_flex()
                            .justify_end()
                            .gap_2()
                            .child(
                                Button::new("cancel-session-delete")
                                    .ghost()
                                    .label("Cancel")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.delete_session_target = None;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("confirm-session-delete")
                                    .danger()
                                    .label("Delete")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.confirm_delete_session(cx)
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_cleanup_directory_dialog(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let directory = self.cleanup_directory_target.as_deref().unwrap_or_default();
        v_flex()
            .absolute()
            .inset_0()
            .items_center()
            .justify_center()
            .bg(cx.theme().background.opacity(0.82))
            .child(
                v_flex()
                    .w(px(460.))
                    .p_4()
                    .gap_3()
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().popover)
                    .shadow_lg()
                    .child(div().text_lg().font_semibold().child("Delete old sessions?"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!(
                                "Delete sessions in {} that have been inactive for more than 30 days?",
                                Self::basename(directory)
                            )),
                    )
                    .child(
                        h_flex()
                            .justify_end()
                            .gap_2()
                            .child(
                                Button::new("cancel-directory-cleanup")
                                    .ghost()
                                    .label("Cancel")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.cleanup_directory_target = None;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("confirm-directory-cleanup")
                                    .danger()
                                    .label("Delete old sessions")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.confirm_cleanup_directory(cx)
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_command_palette(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let up = Kbd::new(Keystroke::parse("up").expect("valid palette key"));
        let down = Kbd::new(Keystroke::parse("down").expect("valid palette key"));
        let control_k = Kbd::new(Keystroke::parse("ctrl-k").expect("valid palette key"));
        let control_j = Kbd::new(Keystroke::parse("ctrl-j").expect("valid palette key"));
        let enter = Kbd::new(Keystroke::parse("enter").expect("valid palette key"));
        let escape = Kbd::new(Keystroke::parse("escape").expect("valid palette key"));

        v_flex()
            .key_context("CommandPalette")
            .absolute()
            .inset_0()
            .items_center()
            .pt(px(96.))
            .bg(cx.theme().background.opacity(0.82))
            .child(
                v_flex()
                    .w(px(640.))
                    .h(px(520.))
                    .max_h(px(520.))
                    .overflow_hidden()
                    .rounded_xl()
                    .border_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().popover)
                    .shadow_lg()
                    .child(
                        List::new(&self.command_palette)
                            .search_placeholder("Search commands")
                            .scrollbar_visible(true)
                            .flex_1()
                            .min_h_0(),
                    )
                    .child(
                        h_flex()
                            .flex_none()
                            .min_h(px(42.))
                            .px_3()
                            .py_2()
                            .gap_4()
                            .border_t_1()
                            .border_color(cx.theme().border.opacity(0.72))
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(
                                h_flex()
                                    .gap_1()
                                    .child(up)
                                    .child(down)
                                    .child(div().px_0p5().child("or"))
                                    .child(control_k)
                                    .child(control_j)
                                    .child("Navigate"),
                            )
                            .child(h_flex().gap_1().child(enter).child("Run"))
                            .child(h_flex().gap_1().child(escape).child("Close")),
                    ),
            )
            .into_any_element()
    }
}

impl Render for PicoDesktop {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let status = self.status_message.clone();
        let has_failed_submission = self.failed_submission.is_some();
        h_flex()
            .id("pico-desktop")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(|this, _: &NewSession, _, cx| this.create_session(cx)))
            .on_action(cx.listener(|this, _: &ToggleLeftSidebar, window, cx| {
                this.left_sidebar_open = !this.left_sidebar_open;
                if this.terminal_panel_open {
                    this.sync_terminal_grid_size(window, cx);
                }
                this.persist_preferences();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleRightSidebar, _, cx| {
                this.right_sidebar_open = !this.right_sidebar_open;
                this.persist_preferences();
                cx.notify();
            }))
            .on_action(
                cx.listener(|this, _: &ToggleTerminal, window, cx| {
                    this.toggle_terminal(window, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &OpenSettings, _, cx| this.open_settings(cx)))
            .on_action(cx.listener(|this, _: &FocusSessionSearch, window, cx| {
                this.toggle_command_palette(window, cx);
            }))
            .on_action(cx.listener(|this, _: &FocusComposer, window, cx| {
                this.composer
                    .update(cx, |state, cx| state.focus(window, cx));
            }))
            .on_action(cx.listener(|this, _: &AbortSession, _, cx| this.abort(cx)))
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .when(self.left_sidebar_open, |this| {
                this.child(self.render_left_sidebar(window, cx))
            })
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .child(
                        h_flex()
                            .flex_1()
                            .min_h_0()
                            .w_full()
                            .child(
                                v_flex()
                                    .flex_1()
                                    .min_w_0()
                                    .h_full()
                                    .child(self.render_header(cx))
                                    .when_some(status, |this, status| {
                                        let status_to_copy = status.clone();
                                        this.child(
                                            h_flex()
                                                .id("status-message")
                                                .min_w_0()
                                                .px_4()
                                                .py_2()
                                                .gap_2()
                                                .bg(cx.theme().warning.opacity(0.12))
                                                .text_sm()
                                                .cursor_pointer()
                                                .tooltip(|window, cx| {
                                                    Tooltip::new("Click to copy error")
                                                        .build(window, cx)
                                                })
                                                .on_click(move |_, _, cx| {
                                                    cx.write_to_clipboard(
                                                        ClipboardItem::new_string(
                                                            status_to_copy.clone(),
                                                        ),
                                                    );
                                                })
                                                .child(
                                                    Icon::new(IconName::Info).size_4().flex_none(),
                                                )
                                                .child(
                                                    div()
                                                        .flex_1()
                                                        .min_w_0()
                                                        .overflow_hidden()
                                                        .whitespace_nowrap()
                                                        .text_ellipsis()
                                                        .child(status),
                                                )
                                                .when(has_failed_submission, |this| {
                                                    this.child(
                                                        Button::new("restore-prompt")
                                                            .secondary()
                                                            .small()
                                                            .label("Restore prompt")
                                                            .on_click(cx.listener(
                                                                |this, _, window, cx| {
                                                                    this.restore_failed_submission(
                                                                        window, cx,
                                                                    )
                                                                },
                                                            )),
                                                    )
                                                }),
                                        )
                                    })
                                    .child(self.render_conversation(cx))
                                    .child(self.render_composer(window, cx)),
                            )
                            .when(self.right_sidebar_open, |this| {
                                this.child(self.render_right_sidebar(cx))
                            }),
                    )
                    .when(self.terminal_panel_open, |this| {
                        this.child(self.render_terminal(cx))
                    }),
            )
            .when(self.settings_open, |this| {
                this.child(self.render_settings(cx))
            })
            .when(self.command_palette_open, |this| {
                this.child(self.render_command_palette(cx))
            })
            .when(self.rename_session_target.is_some(), |this| {
                this.child(self.render_rename_session_dialog(cx))
            })
            .when(self.delete_session_target.is_some(), |this| {
                this.child(self.render_delete_session_dialog(cx))
            })
            .when(self.cleanup_directory_target.is_some(), |this| {
                this.child(self.render_cleanup_directory_dialog(cx))
            })
            .when(self.add_directory_dialog_open, |this| {
                this.child(self.render_add_directory_dialog(cx))
            })
            .when(self.commit_dialog_open, |this| {
                this.child(self.render_commit_dialog(cx))
            })
    }
}

impl Focusable for PicoDesktop {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

pub fn root(
    client: PicoClient,
    initial_directory: String,
    window: &mut Window,
    cx: &mut App,
) -> Entity<Root> {
    let view = cx.new(|cx| PicoDesktop::new(client, initial_directory, window, cx));
    let focus_handle = view.focus_handle(cx);
    window.defer(cx, move |window, cx| {
        if window.focused(cx).is_none() {
            focus_handle.focus(window, cx);
        }
    });
    cx.new(|cx| Root::new(view, window, cx).bg(cx.theme().background))
}

#[cfg(test)]
mod tests {
    use super::{
        CommandPaletteDelegate, ConversationRow, DesktopPaletteCommand, PicoDesktop,
        git_action_visibility, is_slash_menu_input, slash_menu_capacity,
        terminal_device_attribute_responses,
    };
    use crate::models::{ConversationItem, GitChangeFile, GitStatusSummary};
    use gpui::px;

    fn git_file(status: &str) -> GitChangeFile {
        GitChangeFile {
            status: status.into(),
            path: "src/main.rs".into(),
            ..GitChangeFile::default()
        }
    }

    #[test]
    fn slash_menu_only_opens_for_a_command_without_arguments() {
        assert!(is_slash_menu_input("/"));
        assert!(is_slash_menu_input("  /skill:cupertino"));
        assert!(!is_slash_menu_input("hello /skill:cupertino"));
        assert!(!is_slash_menu_input("/skill:cupertino review this"));
    }

    #[test]
    fn slash_menu_capacity_adapts_to_the_window_height() {
        assert_eq!(slash_menu_capacity(px(240.)), 5);
        assert_eq!(slash_menu_capacity(px(480.)), 11);
        assert_eq!(slash_menu_capacity(px(900.)), 12);
    }

    #[test]
    fn terminal_answers_device_attribute_queries_across_output_chunks() {
        let mut tail = Vec::new();
        assert!(terminal_device_attribute_responses(&mut tail, b"\x1b[").is_empty());
        assert_eq!(
            terminal_device_attribute_responses(&mut tail, b"c"),
            vec![b"\x1b[?62;22c".as_slice()]
        );
        assert_eq!(
            terminal_device_attribute_responses(&mut tail, b"\x1b[>0c"),
            vec![b"\x1b[>1;10;0c".as_slice()]
        );
        assert!(terminal_device_attribute_responses(&mut tail, b"plain text").is_empty());
    }

    #[test]
    fn conversation_projection_virtualizes_each_assistant_block() {
        let items: Vec<ConversationItem> = serde_json::from_value(serde_json::json!([
            {
                "kind": "user",
                "itemKey": "user-1",
                "text": "hello"
            },
            {
                "kind": "assistant",
                "itemKey": "assistant-1",
                "blocks": [
                    { "type": "text", "blockKey": "text-1", "text": "answer" },
                    {
                        "type": "tool",
                        "blockKey": "tool-1",
                        "callId": "call-1",
                        "name": "read",
                        "output": "large output"
                    },
                    {
                        "type": "thinking",
                        "blockKey": "thought-1",
                        "text": "reasoning"
                    },
                    {
                        "type": "compaction",
                        "blockKey": "compact-1",
                        "summary": "summary"
                    }
                ]
            }
        ]))
        .unwrap();

        let rows = PicoDesktop::conversation_rows_for_items(&items);

        assert_eq!(rows.len(), 5);
        assert!(matches!(
            rows[0],
            ConversationRow::User { item_index: 0, .. }
        ));
        assert!(
            rows[1..]
                .iter()
                .all(|row| matches!(row, ConversationRow::AssistantBlock { item_index: 1, .. }))
        );
        assert!(rows[2].key().contains("tool:call-1"));
    }

    #[test]
    fn command_palette_search_flattens_matches_for_keyboard_selection() {
        let mut delegate = CommandPaletteDelegate::new(true);
        assert_eq!(delegate.sections[0].len(), 2);
        assert_eq!(
            delegate.sections[2],
            vec![DesktopPaletteCommand::CloneSession]
        );

        delegate.filter("terminal");

        assert_eq!(
            delegate.sections[0],
            vec![DesktopPaletteCommand::ToggleTerminal]
        );
        assert!(delegate.sections[1..].iter().all(Vec::is_empty));
    }

    #[test]
    fn git_working_tree_actions_follow_file_statuses() {
        let status = GitStatusSummary {
            dirty: true,
            ..GitStatusSummary::default()
        };

        let unstaged = git_action_visibility(Some(&status), &[git_file(" M")]);
        assert!(unstaged.stage_all);
        assert!(!unstaged.unstage_all);
        assert!(unstaged.commit);
        assert!(unstaged.discard_all);

        let staged = git_action_visibility(Some(&status), &[git_file("M ")]);
        assert!(!staged.stage_all);
        assert!(staged.unstage_all);

        let untracked = git_action_visibility(Some(&status), &[git_file("??")]);
        assert!(untracked.stage_all);
        assert!(!untracked.unstage_all);
    }

    #[test]
    fn git_remote_actions_follow_sync_and_detached_state() {
        let diverged = GitStatusSummary {
            ahead: 2,
            behind: 3,
            ..GitStatusSummary::default()
        };
        let actions = git_action_visibility(Some(&diverged), &[]);
        assert!(actions.push);
        assert!(actions.force_push);
        assert!(actions.pull);
        assert!(!actions.commit);

        let detached = GitStatusSummary {
            detached: true,
            ahead: 2,
            behind: 3,
            ..GitStatusSummary::default()
        };
        let actions = git_action_visibility(Some(&detached), &[]);
        assert!(!actions.push);
        assert!(!actions.force_push);
        assert!(!actions.pull);
    }
}
