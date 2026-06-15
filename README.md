# EasyNet

A small, friendly GUI for [ZeroTier](https://zerotier.com). Create a network, hit connect, and see who's online — like Radmin VPN, but on top of ZeroTier. No account or paid plan needed.

- One-click connect / disconnect
- Create your own network right in the app (no website)
- Save networks and switch between them
- See online devices and their ZeroTier IP; click any IP to copy it
- Authorize devices you own from the Devices tab
- Install ZeroTier from the Setup tab
- English / Русский / Українська
- Windows and Linux

## Download

Grab a build from [Releases](../../releases):

- Windows — `easynet-1.1.exe` (portable, just run it; Windows 10/11 already has WebView2)
- Linux — `easynet-1.1.AppImage` (`chmod +x` then run)

Install ZeroTier from the **Setup** tab on first run if you don't have it yet.

## Usage

1. **Setup** → on Linux, click **Grant access** once so EasyNet can read the local ZeroTier token.
2. **Networks** → **Create your own network** (you become the owner), or **Add** a network by its 16-digit ID.
3. **Home** → choose a network → **Connect**.
4. **Devices** → **Scan** to see online devices and their ZeroTier IPs. On networks you created, authorize new devices here.

Everything works on the free ZeroTier with no API token. The token field in **Settings** is optional — only used to import networks from a paid account.

## Build from source

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org).

**Linux**
```bash
./build.sh
```

**Windows** (PowerShell)
```powershell
./build.ps1
```

Both scripts install missing dependencies, build the app, and drop the result in `Binaries/`.

Or manually:
```bash
npm install
npm run tauri icon ./icon.png   # first time only
npm run dev                      # run
npm run build                    # package
```

## Notes

- On Linux the ZeroTier token is root-only. The **Grant access** button in the Setup tab copies it to `~/.config/easynet/` so the app reads it without sudo.
- A network you create is hosted by your own machine (built-in ZeroTier controller). Keep it online while friends join, then authorize them in **Devices**.
- The Devices scan shows devices that are online right now.

## License

MIT
