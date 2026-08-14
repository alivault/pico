use std::borrow::Cow;

use gpui::{AssetSource, Result, SharedString};
use gpui_component::IconNamed;
use gpui_component_assets::Assets;

const CHEVRONS_DOWN_UP_PATH: &str = "pico-icons/chevrons-down-up.svg";
const FOLDER_PLUS_PATH: &str = "pico-icons/folder-plus.svg";
const PICO_ASSET_PATHS: [&str; 2] = [CHEVRONS_DOWN_UP_PATH, FOLDER_PLUS_PATH];

pub struct PicoAssets;

impl AssetSource for PicoAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match path {
            CHEVRONS_DOWN_UP_PATH => Ok(Some(Cow::Borrowed(include_bytes!(
                "../assets/icons/chevrons-down-up.svg"
            )))),
            FOLDER_PLUS_PATH => Ok(Some(Cow::Borrowed(include_bytes!(
                "../assets/icons/folder-plus.svg"
            )))),
            _ => Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut paths = Assets.list(path)?;
        paths.extend(
            PICO_ASSET_PATHS
                .into_iter()
                .filter(|asset_path| asset_path.starts_with(path))
                .map(SharedString::from),
        );
        Ok(paths)
    }
}

#[derive(Clone, Copy)]
pub enum PicoIcon {
    ChevronsDownUp,
    FolderPlus,
}

impl IconNamed for PicoIcon {
    fn path(self) -> SharedString {
        match self {
            Self::ChevronsDownUp => CHEVRONS_DOWN_UP_PATH.into(),
            Self::FolderPlus => FOLDER_PLUS_PATH.into(),
        }
    }
}
