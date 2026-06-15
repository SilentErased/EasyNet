#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const ZT_BASE: &str = "http://127.0.0.1:9993";
const CENTRAL_BASE: &str = "https://api.zerotier.com/api/v1";

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_idle_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn token_paths() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();

    if let Some(env) = std::env::var_os("ZEROTIER_AUTHTOKEN") {
        if !env.is_empty() {
            v.push(PathBuf::from(env));
        }
    }

    #[cfg(target_os = "windows")]
    {
        v.push(PathBuf::from("C:\\ProgramData\\ZeroTier\\One\\authtoken.secret"));
    }
    #[cfg(target_os = "macos")]
    {
        v.push(PathBuf::from("/Library/Application Support/ZeroTier/One/authtoken.secret"));
    }
    #[cfg(target_os = "linux")]
    {
        v.push(PathBuf::from("/var/lib/zerotier-one/authtoken.secret"));
    }

    if let Some(home) = home_dir() {
        v.push(home.join(".config").join("easynet").join("authtoken.secret"));
        v.push(home.join(".zerotier-authtoken.secret"));
    }

    v
}

fn read_token() -> Result<String, String> {
    for p in token_paths() {
        if let Ok(s) = fs::read_to_string(&p) {
            let t = s.trim().to_string();
            if !t.is_empty() {
                return Ok(t);
            }
        }
    }
    Err("authtoken_not_found".to_string())
}

fn valid_nwid(id: &str) -> bool {
    id.len() == 16 && id.chars().all(|c| c.is_ascii_hexdigit())
}

async fn zt_request(method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let token = read_token()?;
    let mut req = http()
        .request(method, format!("{}{}", ZT_BASE, path))
        .header("X-ZT1-Auth", token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| format!("service_unreachable: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("http_{}: {}", status.as_u16(), text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("parse_error: {}", e))
}

async fn central(method: reqwest::Method, token: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    if token.trim().is_empty() {
        return Err("central_token_missing".to_string());
    }
    let mut req = http()
        .request(method, format!("{}{}", CENTRAL_BASE, path))
        .header("Authorization", format!("token {}", token.trim()))
        .header("Accept", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| format!("central_unreachable: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("central_http_{}: {}", status.as_u16(), text));
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("central_parse_error: {}", e))
}

#[tauri::command]
fn token_available() -> bool {
    read_token().is_ok()
}

#[tauri::command]
fn zt_installed() -> bool {
    #[cfg(target_os = "linux")]
    {
        Path::new("/var/lib/zerotier-one").exists()
            || Path::new("/usr/sbin/zerotier-one").exists()
            || Path::new("/usr/bin/zerotier-cli").exists()
    }
    #[cfg(target_os = "windows")]
    {
        Path::new("C:\\ProgramData\\ZeroTier\\One").exists()
            || Path::new("C:\\Program Files (x86)\\ZeroTier\\One").exists()
    }
    #[cfg(target_os = "macos")]
    {
        Path::new("/Library/Application Support/ZeroTier/One").exists()
    }
}

#[tauri::command]
async fn install_zerotier() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let script = "curl -fsSL https://install.zerotier.com | bash && systemctl enable --now zerotier-one";
        std::process::Command::new("pkexec")
            .arg("bash")
            .arg("-c")
            .arg(script)
            .spawn()
            .map_err(|e| format!("spawn_failed: {}", e))?;
        Ok("started".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let url = "https://download.zerotier.com/dist/ZeroTier%20One.msi";
        let bytes = reqwest::get(url)
            .await
            .map_err(|e| format!("download_failed: {}", e))?
            .bytes()
            .await
            .map_err(|e| format!("download_failed: {}", e))?;
        let mut path = std::env::temp_dir();
        path.push("EasyNet-ZeroTier.msi");
        std::fs::write(&path, &bytes).map_err(|e| format!("write_failed: {}", e))?;
        std::process::Command::new("msiexec")
            .arg("/i")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("spawn_failed: {}", e))?;
        Ok("started".to_string())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        Err("unsupported_platform".to_string())
    }
}

#[tauri::command]
async fn zt_status() -> Result<Value, String> {
    zt_request(reqwest::Method::GET, "/status", None).await
}

#[tauri::command]
async fn list_networks() -> Result<Value, String> {
    zt_request(reqwest::Method::GET, "/network", None).await
}

#[tauri::command]
async fn join_network(nwid: String) -> Result<Value, String> {
    let id = nwid.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    zt_request(reqwest::Method::POST, &format!("/network/{}", id), Some(serde_json::json!({}))).await
}

#[tauri::command]
async fn leave_network(nwid: String) -> Result<Value, String> {
    let id = nwid.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    zt_request(reqwest::Method::DELETE, &format!("/network/{}", id), None).await
}

#[tauri::command]
async fn central_networks_list(token: String) -> Result<Value, String> {
    central(reqwest::Method::GET, &token, "/network", None).await
}

#[tauri::command]
async fn central_members(token: String, network_id: String) -> Result<Value, String> {
    let id = network_id.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    central(reqwest::Method::GET, &token, &format!("/network/{}/member", id), None).await
}

#[tauri::command]
async fn central_update_member(
    token: String,
    network_id: String,
    node_id: String,
    body: Value,
) -> Result<Value, String> {
    let id = network_id.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    central(
        reqwest::Method::POST,
        &token,
        &format!("/network/{}/member/{}", id, node_id.trim()),
        Some(body),
    )
    .await
}

#[tauri::command]
async fn central_create_network(token: String, name: String) -> Result<Value, String> {
    let net_name = if name.trim().is_empty() { "EasyNet".to_string() } else { name.trim().to_string() };
    let oct = random_octet();
    let base = format!("10.147.{}", oct);
    let body = serde_json::json!({
        "config": {
            "name": net_name,
            "private": true,
            "enableBroadcast": true,
            "v4AssignMode": { "zt": true },
            "ipAssignmentPools": [{ "ipRangeStart": format!("{}.1", base), "ipRangeEnd": format!("{}.254", base) }],
            "routes": [{ "target": format!("{}.0/24", base), "via": Value::Null }]
        }
    });
    central(reqwest::Method::POST, &token, "/network", Some(body)).await
}

fn hosts_24(ip: &str) -> Vec<String> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return Vec::new();
    }
    let net = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
    (1..=254).map(|h| format!("{}.{}", net, h)).collect()
}

fn trigger_arp(targets: &[String], iface: &str) {
    let mut kids = Vec::new();
    for ip in targets {
        let mut cmd = std::process::Command::new("ping");
        #[cfg(target_os = "linux")]
        {
            cmd.args(["-c", "1", "-W", "1"]);
            if !iface.is_empty() {
                cmd.args(["-I", iface]);
            }
        }
        #[cfg(target_os = "windows")]
        {
            cmd.args(["-n", "1", "-w", "1000"]);
        }
        #[cfg(target_os = "macos")]
        {
            cmd.args(["-c", "1", "-t", "1"]);
        }
        cmd.arg(ip)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if let Ok(ch) = cmd.spawn() {
            kids.push(ch);
        }
    }
    for mut ch in kids {
        let _ = ch.wait();
    }
}

#[cfg(target_os = "linux")]
fn neighbors(iface: &str, prefix: &str) -> Vec<String> {
    let mut v = Vec::new();
    if let Ok(o) = std::process::Command::new("ip")
        .args(["neigh", "show", "dev", iface])
        .output()
    {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            if !line.contains("lladdr") {
                continue;
            }
            let up = line.to_uppercase();
            if up.contains("FAILED") || up.contains("INCOMPLETE") {
                continue;
            }
            if let Some(ip) = line.split_whitespace().next() {
                if ip.starts_with(prefix) {
                    v.push(ip.to_string());
                }
            }
        }
    }
    v
}

#[cfg(not(target_os = "linux"))]
fn neighbors(_iface: &str, prefix: &str) -> Vec<String> {
    let mut v = Vec::new();
    if let Ok(o) = std::process::Command::new("arp").arg("-a").output() {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            let l = line.trim();
            if !l.to_lowercase().contains("dynamic") {
                continue;
            }
            if let Some(ip) = l.split_whitespace().next() {
                if ip.starts_with(prefix) {
                    v.push(ip.to_string());
                }
            }
        }
    }
    v
}

#[tauri::command]
async fn scan_network(nwid: String) -> Result<Value, String> {
    let id = nwid.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    let net = zt_request(reqwest::Method::GET, &format!("/network/{}", id), None).await?;
    let iface = net.get("portDeviceName").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let cidr = net
        .get("assignedAddresses")
        .and_then(|v| v.as_array())
        .and_then(|a| a.iter().filter_map(|x| x.as_str()).find(|s| s.contains('.')))
        .unwrap_or("")
        .to_string();
    if cidr.is_empty() {
        return Err("no_ip".to_string());
    }
    let your_ip = cidr.split('/').next().unwrap_or("").to_string();
    let parts: Vec<&str> = your_ip.split('.').collect();
    if parts.len() != 4 {
        return Err("no_ip".to_string());
    }
    let prefix = format!("{}.{}.{}.", parts[0], parts[1], parts[2]);
    let targets = hosts_24(&your_ip);

    let iface2 = iface.clone();
    let your2 = your_ip.clone();
    let hosts = tauri::async_runtime::spawn_blocking(move || {
        trigger_arp(&targets, &iface2);
        let mut list = neighbors(&iface2, &prefix);
        if !list.contains(&your2) {
            list.push(your2);
        }
        list.sort_by_key(|ip| ip.split('.').last().and_then(|o| o.parse::<u32>().ok()).unwrap_or(0));
        list.dedup();
        list
    })
    .await
    .map_err(|e| format!("scan_failed: {}", e))?;

    Ok(serde_json::json!({ "iface": iface, "your_ip": your_ip, "hosts": hosts }))
}

fn random_octet() -> u32 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(1);
    (nanos % 254) + 1
}

#[tauri::command]
async fn controller_create(name: String) -> Result<Value, String> {
    let st = zt_request(reqwest::Method::GET, "/status", None).await?;
    let addr = st.get("address").and_then(|v| v.as_str()).ok_or("no_address")?.to_string();
    let net_name = if name.trim().is_empty() { "EasyNet".to_string() } else { name.trim().to_string() };
    let oct = random_octet();
    let base = format!("10.147.{}", oct);
    let body = serde_json::json!({
        "name": net_name,
        "private": true,
        "enableBroadcast": true,
        "v4AssignMode": { "zt": true },
        "ipAssignmentPools": [{ "ipRangeStart": format!("{}.1", base), "ipRangeEnd": format!("{}.254", base) }],
        "routes": [{ "target": format!("{}.0/24", base), "via": Value::Null }]
    });
    zt_request(
        reqwest::Method::POST,
        &format!("/controller/network/{}______", addr),
        Some(body),
    )
    .await
}

#[tauri::command]
async fn controller_members(nwid: String) -> Result<Value, String> {
    let id = nwid.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    let map = zt_request(reqwest::Method::GET, &format!("/controller/network/{}/member", id), None).await?;
    let mut out: Vec<Value> = Vec::new();
    if let Some(obj) = map.as_object() {
        for member in obj.keys() {
            if let Ok(detail) = zt_request(
                reqwest::Method::GET,
                &format!("/controller/network/{}/member/{}", id, member),
                None,
            )
            .await
            {
                out.push(detail);
            }
        }
    }
    Ok(Value::Array(out))
}

#[tauri::command]
async fn controller_authorize(nwid: String, member: String, authorized: bool) -> Result<Value, String> {
    let id = nwid.trim().to_lowercase();
    if !valid_nwid(&id) {
        return Err("invalid_network_id".to_string());
    }
    zt_request(
        reqwest::Method::POST,
        &format!("/controller/network/{}/member/{}", id, member.trim()),
        Some(serde_json::json!({ "authorized": authorized })),
    )
    .await
}

#[tauri::command]
fn grant_token_access() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let home = home_dir().ok_or("no_home")?;
        let dir = home.join(".config").join("easynet");
        let dest = dir.join("authtoken.secret");
        let user = std::env::var("USER").unwrap_or_default();
        let script = format!(
            "mkdir -p '{dir}' && cp /var/lib/zerotier-one/authtoken.secret '{dest}' && chown {user} '{dest}' && chmod 600 '{dest}'",
            dir = dir.display(),
            dest = dest.display(),
            user = user
        );
        let status = std::process::Command::new("pkexec")
            .arg("bash")
            .arg("-c")
            .arg(script)
            .status()
            .map_err(|e| format!("pkexec_failed: {}", e))?;
        if status.success() {
            Ok("ok".to_string())
        } else {
            Err("denied".to_string())
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok("ok".to_string())
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            token_available,
            zt_installed,
            install_zerotier,
            zt_status,
            list_networks,
            join_network,
            leave_network,
            central_networks_list,
            central_members,
            central_update_member,
            central_create_network,
            scan_network,
            grant_token_access,
            controller_create,
            controller_members,
            controller_authorize
        ])
        .run(tauri::generate_context!())
        .expect("error while running EasyNet");
}
