use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Context};
use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, Method, Response, StatusCode};
use sha1::{Digest, Sha1};

const MAX_STATIC_FILES: usize = 2_048;
const MAX_STATIC_BYTES: usize = 128 * 1024 * 1024;
const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";
const PUBLIC_CACHE: &str = "public, max-age=3600";
const SHELL_CACHE: &str = "no-cache";

#[derive(Clone)]
struct StaticAsset {
    bytes: Bytes,
    content_type: &'static str,
    cache_control: &'static str,
    etag: String,
}

pub struct StaticAssets {
    root: PathBuf,
    assets: HashMap<String, StaticAsset>,
    shell: StaticAsset,
}

impl StaticAssets {
    pub fn load(root: &Path) -> anyhow::Result<Self> {
        let root = std::fs::canonicalize(root)
            .with_context(|| format!("failed to resolve static web root {}", root.display()))?;
        if !root.is_dir() {
            bail!("static web root is not a directory: {}", root.display());
        }
        let mut assets = HashMap::new();
        let mut paths = vec![root.clone()];
        let mut total_bytes = 0_usize;
        while let Some(directory) = paths.pop() {
            for entry in std::fs::read_dir(&directory).with_context(|| {
                format!("failed to read static directory {}", directory.display())
            })? {
                let entry = entry?;
                let file_type = entry.file_type()?;
                if file_type.is_symlink() {
                    continue;
                }
                let path = entry.path();
                if file_type.is_dir() {
                    paths.push(path);
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }
                if assets.len() >= MAX_STATIC_FILES {
                    bail!("static web root exceeds the {MAX_STATIC_FILES}-file limit");
                }
                let relative = path
                    .strip_prefix(&root)
                    .with_context(|| format!("static path escaped web root: {}", path.display()))?;
                let key = static_key(relative)?;
                let bytes = std::fs::read(&path)
                    .with_context(|| format!("failed to read static asset {}", path.display()))?;
                total_bytes = total_bytes.saturating_add(bytes.len());
                if total_bytes > MAX_STATIC_BYTES {
                    bail!("static web root exceeds the 128 MiB size limit");
                }
                let cache_control = if key == "/_shell.html" {
                    SHELL_CACHE
                } else if key.starts_with("/assets/") {
                    IMMUTABLE_CACHE
                } else {
                    PUBLIC_CACHE
                };
                let content_type = content_type(&path);
                let etag = format!("\"{}\"", hex_digest(&bytes));
                assets.insert(
                    key,
                    StaticAsset {
                        bytes: Bytes::from(bytes),
                        content_type,
                        cache_control,
                        etag,
                    },
                );
            }
        }
        let shell = assets
            .get("/_shell.html")
            .cloned()
            .context("static web root does not contain _shell.html")?;
        Ok(Self {
            root,
            assets,
            shell,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn response(&self, method: &Method, path: &str, headers: &HeaderMap) -> Response<Body> {
        if method != Method::GET && method != Method::HEAD {
            return response_with_status(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
        }
        let normalized = normalize_request_path(path);
        let exact = normalized
            .as_deref()
            .and_then(|normalized| self.assets.get(normalized));
        let asset = exact.or_else(|| {
            normalized
                .as_deref()
                .filter(|normalized| should_serve_shell(normalized, headers))
                .map(|_| &self.shell)
        });
        let Some(asset) = asset else {
            return response_with_status(StatusCode::NOT_FOUND, "Not found");
        };
        if headers
            .get(header::IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(',').any(|etag| etag.trim() == asset.etag))
        {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::ETAG, &asset.etag)
                .header(header::CACHE_CONTROL, asset.cache_control)
                .body(Body::empty())
                .expect("valid static 304 response");
        }
        let body = if method == Method::HEAD {
            Body::empty()
        } else {
            Body::from(asset.bytes.clone())
        };
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, asset.content_type)
            .header(header::CONTENT_LENGTH, asset.bytes.len())
            .header(header::CACHE_CONTROL, asset.cache_control)
            .header(header::ETAG, &asset.etag)
            .header("x-content-type-options", "nosniff")
            .body(body)
            .expect("valid static asset response")
    }
}

fn static_key(relative: &Path) -> anyhow::Result<String> {
    let mut segments = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(segment) => segments.push(
                segment
                    .to_str()
                    .context("static asset path is not valid UTF-8")?,
            ),
            _ => bail!("static asset path contains an unsafe component"),
        }
    }
    Ok(format!("/{}", segments.join("/")))
}

fn normalize_request_path(path: &str) -> Option<String> {
    if !path.starts_with('/') || path.contains('\0') || path.contains('\\') || path.contains('%') {
        return None;
    }
    let mut segments = Vec::new();
    for segment in path.split('/') {
        if segment.is_empty() {
            continue;
        }
        if segment == "." || segment == ".." {
            return None;
        }
        segments.push(segment);
    }
    Some(format!("/{}", segments.join("/")))
}

fn should_serve_shell(path: &str, headers: &HeaderMap) -> bool {
    if path == "/" {
        return true;
    }
    let accepts_html = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|item| item.trim().starts_with("text/html"))
        });
    accepts_html
        || !path
            .rsplit('/')
            .next()
            .is_some_and(|name| name.contains('.'))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha1::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn response_with_status(status: StatusCode, message: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(message))
        .expect("valid static error response")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, StaticAssets) {
        let root = std::env::temp_dir().join(format!(
            "pico-static-assets-{}-{}",
            std::process::id(),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        std::fs::create_dir_all(root.join("assets")).expect("asset directory");
        std::fs::write(
            root.join("_shell.html"),
            "<!doctype html><script src=\"/assets/app-abc.js\"></script>",
        )
        .expect("shell");
        std::fs::write(root.join("assets/app-abc.js"), "console.log('pico')").expect("script");
        let runtime = StaticAssets::load(&root).expect("static runtime");
        (root, runtime)
    }

    #[test]
    fn serves_exact_assets_and_spa_navigation_with_cache_contracts() {
        let (root, runtime) = fixture();
        let headers = HeaderMap::new();
        let asset = runtime.response(&Method::GET, "/assets/app-abc.js", &headers);
        assert_eq!(asset.status(), StatusCode::OK);
        assert_eq!(asset.headers()[header::CACHE_CONTROL], IMMUTABLE_CACHE);
        assert_eq!(
            asset.headers()[header::CONTENT_TYPE],
            "text/javascript; charset=utf-8"
        );
        let shell = runtime.response(&Method::GET, "/session/demo", &headers);
        assert_eq!(shell.status(), StatusCode::OK);
        assert_eq!(shell.headers()[header::CACHE_CONTROL], SHELL_CACHE);
        let missing_asset = runtime.response(&Method::GET, "/assets/missing.js", &headers);
        assert_eq!(missing_asset.status(), StatusCode::NOT_FOUND);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_unsafe_paths_and_honors_etag_and_head() {
        let (root, runtime) = fixture();
        let first = runtime.response(&Method::GET, "/assets/app-abc.js", &HeaderMap::new());
        let etag = first.headers()[header::ETAG].clone();
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, etag);
        assert_eq!(
            runtime
                .response(&Method::GET, "/assets/app-abc.js", &headers)
                .status(),
            StatusCode::NOT_MODIFIED
        );
        assert_eq!(
            runtime
                .response(&Method::HEAD, "/assets/app-abc.js", &HeaderMap::new())
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            runtime
                .response(&Method::GET, "/../secret", &HeaderMap::new())
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            runtime
                .response(&Method::POST, "/", &HeaderMap::new())
                .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
