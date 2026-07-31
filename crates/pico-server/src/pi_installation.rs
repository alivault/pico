use std::path::{Path, PathBuf};

pub fn resolve_pi_binary(requested: PathBuf) -> PathBuf {
    if requested != Path::new("pi") {
        return requested;
    }
    let Ok(executable) = std::env::current_exe() else {
        return requested;
    };
    let Some(directory) = executable.parent() else {
        return requested;
    };
    let candidates = [
        directory.join("pi"),
        directory.join("Pi/pi"),
        directory.join("../Resources/Pi/pi"),
        directory.join("../Resources/PicoServer/pi"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or(requested)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_binary_is_never_rewritten() {
        let requested = PathBuf::from("/custom/pi");
        assert_eq!(resolve_pi_binary(requested.clone()), requested);
    }
}
