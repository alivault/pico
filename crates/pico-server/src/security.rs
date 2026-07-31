use std::net::IpAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{HOST, ORIGIN};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use url::Url;

#[derive(Debug, Clone)]
pub struct RequestPolicy {
    bind_host: IpAddr,
    bind_port: u16,
    allowed_origins: Vec<String>,
}

impl RequestPolicy {
    pub fn new(bind_host: IpAddr, bind_port: u16, allowed_origins: Vec<String>) -> Self {
        Self {
            bind_host,
            bind_port,
            allowed_origins: allowed_origins
                .into_iter()
                .map(|origin| origin.trim_end_matches('/').to_string())
                .collect(),
        }
    }

    fn allows_host(&self, authority: &str) -> bool {
        let host = authority_host(authority);
        if self.bind_host.is_loopback() {
            return matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1");
        }
        host == self.bind_host.to_string()
            || self.allowed_origins.iter().any(|origin| {
                Url::parse(origin)
                    .ok()
                    .and_then(|url| url.host_str().map(str::to_string))
                    .is_some_and(|allowed| allowed == host)
            })
    }

    fn allows_origin(&self, origin: &str, request_authority: &str) -> bool {
        let normalized = origin.trim_end_matches('/');
        if self
            .allowed_origins
            .iter()
            .any(|allowed| allowed == normalized)
        {
            return true;
        }
        let Ok(url) = Url::parse(origin) else {
            return false;
        };
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some_and(|origin_host| {
                origin_host == authority_host(request_authority)
                    && url.port_or_known_default()
                        == authority_port(request_authority).or(Some(self.bind_port))
            })
    }
}

pub async fn validate_request(
    State(policy): State<Arc<RequestPolicy>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let authority = request
        .headers()
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if authority.is_empty() || !policy.allows_host(authority) {
        return rejection(StatusCode::BAD_REQUEST, "Host is not allowed");
    }

    if let Some(origin) = request
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        if !policy.allows_origin(origin, authority) {
            return rejection(StatusCode::FORBIDDEN, "Origin is not allowed");
        }
    }

    next.run(request).await
}

fn rejection(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "ok": false, "error": message }))).into_response()
}

fn authority_host(authority: &str) -> String {
    if let Some(bracketed) = authority.strip_prefix('[') {
        return bracketed
            .split_once(']')
            .map(|(host, _)| host.to_ascii_lowercase())
            .unwrap_or_else(|| authority.to_ascii_lowercase());
    }
    authority
        .rsplit_once(':')
        .filter(|(_, port)| port.parse::<u16>().is_ok())
        .map(|(host, _)| host)
        .unwrap_or(authority)
        .to_ascii_lowercase()
}

fn authority_port(authority: &str) -> Option<u16> {
    if authority.starts_with('[') {
        return authority
            .split_once("]:")
            .and_then(|(_, port)| port.parse().ok());
    }
    authority
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn loopback_policy_rejects_dns_rebinding_hosts() {
        let policy = RequestPolicy::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 3141, Vec::new());
        assert!(policy.allows_host("localhost:3141"));
        assert!(policy.allows_host("127.0.0.1:3141"));
        assert!(policy.allows_host("[::1]:3141"));
        assert!(!policy.allows_host("attacker.example"));
    }

    #[test]
    fn same_origin_and_explicit_origins_are_allowed() {
        let policy = RequestPolicy::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            3141,
            vec!["https://trusted.example".into()],
        );
        assert!(policy.allows_origin("http://localhost:3141", "localhost:3141"));
        assert!(policy.allows_origin("https://trusted.example", "localhost:3141"));
        assert!(!policy.allows_origin("https://attacker.example", "localhost:3141"));
        assert!(!policy.allows_origin("null", "localhost:3141"));
    }
}
