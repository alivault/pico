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
    AssistantBlock, ConversationItem, DesktopEvent, DirectorySessionsIndex, SessionListEntry,
    SessionState, UserConversationItem,
};

pub struct PicoDesktop {
    client: PicoClient,
    tx: Sender<DesktopEvent>,
    connected: bool,
    server_label: String,
    directories: Vec<String>,
    selected_directory: String,
    selected_session_id: Option<String>,
    session: SessionState,
    directory_indexes: HashMap<String, DirectorySessionsIndex>,
    files: Vec<String>,
    files_cwd: Option<String>,
    status_message: Option<String>,
    left_sidebar_open: bool,
    right_sidebar_open: bool,
    search: Entity<InputState>,
    composer: Entity<TextareaState>,
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
        let composer = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(2, 8)
                .submit_on_enter(true)
                .placeholder("Ask anything…")
        });
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
            session: SessionState::default(),
            directory_indexes: HashMap::new(),
            files: Vec::new(),
            files_cwd: None,
            status_message: None,
            left_sidebar_open: true,
            right_sidebar_open: true,
            search,
            composer,
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
                    self.client.load_files(cwd, self.tx.clone());
                }
                self.conversation_scroll.scroll_to_bottom();
            }
            DesktopEvent::Sessions(event) => {
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
            DesktopEvent::PromptSent => {
                self.status_message = None;
            }
            DesktopEvent::SessionSelected(session_id) => {
                self.selected_session_id = Some(session_id.clone());
                self.session = SessionState::default();
                self.status_message = Some("Loading session…".into());
                self.restart_events(Some(session_id), None);
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

    fn select_session(&mut self, session_id: String, cx: &mut Context<Self>) {
        if self.selected_session_id.as_deref() == Some(session_id.as_str()) {
            return;
        }
        self.status_message = Some("Loading session…".into());
        self.client.select_session(session_id, self.tx.clone());
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
                        h_flex()
                            .px_2()
                            .py_2()
                            .gap_2()
                            .text_sm()
                            .font_semibold()
                            .child(Icon::new(IconName::Folder).size_4())
                            .child(Self::basename(&self.selected_directory).to_string()),
                    )
                    .children(sessions.into_iter().enumerate().map(|(index, session)| {
                        let session_id = session.id.clone().unwrap_or_default();
                        let is_selected = selected_id.as_deref() == Some(session_id.as_str());
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
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.select_session(session_id.clone(), cx);
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

    fn render_right_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border.opacity(0.72);
        let muted = cx.theme().muted_foreground;
        v_flex()
            .w(px(330.))
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
                            .ghost()
                            .small()
                            .disabled(true)
                            .label("Changes"),
                    )
                    .child(Button::new("files-tab").secondary().small().label("Files")),
            )
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
                    .child(Icon::new(IconName::FolderOpen).size_4()),
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
                            .take(500)
                            .enumerate()
                            .map(|(index, path)| {
                                h_flex()
                                    .id(("file", index))
                                    .px_2()
                                    .py_1p5()
                                    .gap_2()
                                    .rounded_md()
                                    .hover(|this| this.bg(cx.theme().secondary.opacity(0.55)))
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
