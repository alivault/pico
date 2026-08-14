mod app;
mod assets;
mod client;
mod models;

use anyhow::Result;
use gpui::{WindowBounds, WindowOptions, px, size};

use crate::assets::PicoAssets;
use crate::client::PicoClient;

fn main() -> Result<()> {
    let server_url =
        std::env::var("PICO_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:3141".to_string());
    let context_id =
        std::env::var("PICO_CONTEXT_ID").unwrap_or_else(|_| "gpui-desktop".to_string());
    let initial_directory = std::env::var("PICO_DIRECTORY")
        .ok()
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| ".".into());
    let client = PicoClient::new(&server_url, context_id)?;

    let application = gpui_platform::application().with_assets(PicoAssets);
    application.run(move |cx| {
        gpui_component::init(cx);
        app::apply_saved_theme(cx);
        app::bind_keys(cx);
        cx.activate(true);

        let client = client.clone();
        let initial_directory = initial_directory.clone();
        let window_bounds = WindowBounds::centered(size(px(1440.), px(900.)), cx);
        cx.spawn(async move |cx| {
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(window_bounds),
                    titlebar: Some(gpui::TitlebarOptions {
                        title: Some("Pico".into()),
                        appears_transparent: false,
                        traffic_light_position: None,
                    }),
                    ..WindowOptions::default()
                },
                |window, cx| app::root(client, initial_directory, window, cx),
            )
            .expect("failed to open Pico desktop window");
        })
        .detach();
    });
    Ok(())
}
