use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};

use reqwest::Url;

use crate::utils::errors::WeaveError;

/// Outbound network guard for `web.fetch` / `http.request`.
///
/// Prevents SSRF: the model could otherwise be tricked (or trick the user)
/// into hitting loopback services (the local Ollama server, Docker, Redis,
/// databases) or cloud metadata endpoints such as 169.254.169.254.
///
/// The guard rejects:
/// - any scheme other than http/https
/// - URLs with embedded credentials
/// - hosts that resolve (even partially) to private/reserved/loopback IPs
/// - redirects to any host failing the same checks
///
/// Note: DNS lookups are validated at request time and again per redirect
/// hop. A determined rebinding attack is possible in theory; the approval
/// gate on the frontend is the defense in depth for that case.
pub fn validate_outbound_url(url: &Url) -> Result<(), WeaveError> {
    match url.scheme() {
        "http" | "https" => {}
        other => {
            return Err(WeaveError::PermissionDenied(format!(
                "Network access denied: unsupported scheme '{}'",
                other
            )))
        }
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(WeaveError::PermissionDenied(
            "Network access denied: URLs with embedded credentials are not allowed".to_string(),
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| WeaveError::PluginError("URL has no host".to_string()))?;
    if host.is_empty() {
        return Err(WeaveError::PluginError("URL has no host".to_string()));
    }

    Ok(())
}

/// Blocked address ranges: loopback, RFC1918, link-local, CGNAT, multicast,
/// documentation ranges, and the IPv4/IPv6 reserved space.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_ipv4(v4),
        IpAddr::V6(v6) => is_private_ipv6(v6),
    }
}

fn ipv4_in(ip: u32, network: u32, prefix: u32) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    (ip & mask) == (network & mask)
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    let value = u32::from_be_bytes(octets);
    // 0.0.0.0/8
    ipv4_in(value, 0x0000_0000, 8)
        // 10.0.0.0/8
        || ipv4_in(value, 0x0A00_0000, 8)
        // 100.64.0.0/10 (CGNAT)
        || ipv4_in(value, 0x6440_0000, 10)
        // 127.0.0.0/8 (loopback)
        || ipv4_in(value, 0x7F00_0000, 8)
        // 169.254.0.0/16 (link-local, incl. cloud metadata)
        || ipv4_in(value, 0xA9FE_0000, 16)
        // 172.16.0.0/12
        || ipv4_in(value, 0xAC10_0000, 12)
        // 192.0.0.0/24
        || ipv4_in(value, 0xC000_0000, 24)
        // 192.0.2.0/24 (TEST-NET-1)
        || ipv4_in(value, 0xC000_0200, 24)
        // 192.168.0.0/16
        || ipv4_in(value, 0xC0A8_0000, 16)
        // 198.18.0.0/15 (benchmarking)
        || ipv4_in(value, 0xC612_0000, 15)
        // 198.51.100.0/24 (TEST-NET-2)
        || ipv4_in(value, 0xC633_6400, 24)
        // 203.0.113.0/24 (TEST-NET-3)
        || ipv4_in(value, 0xCB00_7100, 24)
        // 224.0.0.0/4 (multicast)
        || ipv4_in(value, 0xE000_0000, 4)
        // 240.0.0.0/4 (reserved)
        || ipv4_in(value, 0xF000_0000, 4)
}

fn ipv6_in(ip: u128, network: u128, prefix: u32) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix)
    };
    (ip & mask) == (network & mask)
}

fn is_private_ipv6(ip: Ipv6Addr) -> bool {
    // IPv4-mapped addresses: check the embedded IPv4 address.
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_private_ipv4(v4);
    }
    let value = u128::from_be_bytes(ip.octets());
    // :: (unspecified)
    ipv6_in(value, 0x0000_0000_0000_0000_0000_0000_0000_0000, 128)
        // ::1 (loopback)
        || ipv6_in(value, 0x0000_0000_0000_0000_0000_0000_0000_0001, 128)
        // fc00::/7 (unique local)
        || ipv6_in(value, 0xFC00_0000_0000_0000_0000_0000_0000_0000, 7)
        // fe80::/10 (link-local)
        || ipv6_in(value, 0xFE80_0000_0000_0000_0000_0000_0000_0000, 10)
        // ff00::/8 (multicast)
        || ipv6_in(value, 0xFF00_0000_0000_0000_0000_0000_0000_0000, 8)
}

/// Resolve `host` and require every resolved address to be public.
pub async fn ensure_public_host(host: &str) -> Result<(), WeaveError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(private_host_error(host));
        }
        return Ok(());
    }

    let addresses = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|e| WeaveError::PluginError(format!("Failed to resolve host {}: {}", host, e)))?;

    let mut seen_any = false;
    for address in addresses {
        seen_any = true;
        if is_private_ip(address.ip()) {
            return Err(private_host_error(host));
        }
    }
    if !seen_any {
        return Err(WeaveError::PluginError(format!(
            "Failed to resolve host: {}",
            host
        )));
    }
    Ok(())
}

/// Blocking variant used inside reqwest's redirect policy.
pub fn ensure_public_host_sync(host: &str) -> Result<(), WeaveError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(private_host_error(host));
        }
        return Ok(());
    }

    let addresses = (host, 443)
        .to_socket_addrs()
        .map_err(|e| WeaveError::PluginError(format!("Failed to resolve host {}: {}", host, e)))?;

    let mut seen_any = false;
    for address in addresses {
        seen_any = true;
        if is_private_ip(address.ip()) {
            return Err(private_host_error(host));
        }
    }
    if !seen_any {
        return Err(WeaveError::PluginError(format!(
            "Failed to resolve host: {}",
            host
        )));
    }
    Ok(())
}

fn private_host_error(host: &str) -> WeaveError {
    WeaveError::PermissionDenied(format!(
        "Network access denied: host '{}' resolves to a private or reserved address",
        host
    ))
}

/// Full async validation for an outbound request URL.
pub async fn ensure_safe_url(url: &str) -> Result<Url, WeaveError> {
    let parsed = Url::parse(url)
        .map_err(|e| WeaveError::PluginError(format!("Invalid URL '{}': {}", url, e)))?;
    validate_outbound_url(&parsed)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| WeaveError::PluginError("URL has no host".to_string()))?;
    ensure_public_host(host).await?;
    Ok(parsed)
}

/// Synchronous validation for a redirect target.
pub fn ensure_safe_url_sync(url: &Url) -> Result<(), WeaveError> {
    validate_outbound_url(url)?;
    let host = url
        .host_str()
        .ok_or_else(|| WeaveError::PluginError("URL has no host".to_string()))?;
    ensure_public_host_sync(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ipv4_ranges() {
        for ip in [
            "127.0.0.1",
            "127.255.255.255",
            "10.0.0.1",
            "10.255.255.255",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
        ] {
            assert!(is_private_ip(ip.parse().unwrap()), "{} should be private", ip);
        }
    }

    #[test]
    fn public_ipv4_ranges() {
        for ip in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"] {
            assert!(!is_private_ip(ip.parse().unwrap()), "{} should be public", ip);
        }
    }

    #[test]
    fn private_ipv6_ranges() {
        for ip in ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"] {
            assert!(is_private_ip(ip.parse().unwrap()), "{} should be private", ip);
        }
    }

    #[test]
    fn public_ipv6_ranges() {
        for ip in ["2606:2800:220:1::1", "2a00:1450:4001::1"] {
            assert!(!is_private_ip(ip.parse().unwrap()), "{} should be public", ip);
        }
    }

    #[test]
    fn rejects_bad_schemes_and_credentials() {
        let url = Url::parse("file:///etc/passwd").unwrap();
        assert!(validate_outbound_url(&url).is_err());

        let url = Url::parse("http://user:pass@example.com/").unwrap();
        assert!(validate_outbound_url(&url).is_err());

        let url = Url::parse("https://example.com/").unwrap();
        assert!(validate_outbound_url(&url).is_ok());
    }

    #[test]
    fn literal_private_hosts_rejected_without_dns() {
        // These parse as literal IPs, so the guard rejects them before any DNS.
        for host in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"] {
            assert!(
                ensure_public_host_sync(host).is_err(),
                "{} should be rejected",
                host
            );
        }
        assert!(ensure_public_host_sync("8.8.8.8").is_ok());
        assert!(ensure_public_host_sync("1.1.1.1").is_ok());
    }

    #[test]
    fn cloud_metadata_and_loopback_urls_denied() {
        // The canonical SSRF targets: cloud metadata and the local model server.
        let meta = Url::parse("http://169.254.169.254/latest/meta-data/iam/security-credentials").unwrap();
        assert!(ensure_safe_url_sync(&meta).is_err(), "cloud metadata must be denied");
        let loopback = Url::parse("http://127.0.0.1:11434/api/chat").unwrap();
        assert!(ensure_safe_url_sync(&loopback).is_err(), "local model endpoint must be denied");
    }

    #[test]
    fn redirect_targets_are_revalidated() {
        // The security claim is that every redirect hop is re-checked — a
        // redirect to a private/reserved target must fail the sync guard just
        // like the original request would.
        let redirect_to_private = Url::parse("http://169.254.169.254/latest/meta-data/").unwrap();
        assert!(ensure_safe_url_sync(&redirect_to_private).is_err());
        let redirect_to_loopback = Url::parse("http://localhost:8080/admin").unwrap();
        // "localhost" is a name, not a literal IP — resolve it and require
        // it to be private (the loopback ranges cover 127.0.0.0/8 / ::1).
        assert!(ensure_safe_url_sync(&redirect_to_loopback).is_err());
    }
}
