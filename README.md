# AudioMid

AudioMid is a desktop application that captures system audio in real time and streams it to Large Language Models (OpenAI GPT-4o or Google Gemini) for transcription or analysis. The project is built with Electron, React, TypeScript and a native C++ audio-capture layer.

---

## Features

- System-wide audio capture (CoreAudio tap on macOS; ALSA/ WASAPI back-ends provided but not fully verified).
- Streaming interface to OpenAI and Gemini with configurable models.
- WebRTC Voice Activity Detection to reduce unnecessary traffic.
- Encrypted SQLite configuration store (API keys are AES-256-CBC encrypted at rest).
- Prompt, VAD parameters and debug options editable at runtime; changes are applied without restarting the application.

---

## Pre-built binaries

Pre-built binaries (`.dmg`, `.zip`, `.exe`, `.AppImage`) are attached to each release.

> Windows and Linux builds are generated automatically but remain untested on physical machines. Expect issues with audio capture or device permissions.

---

## Building from source

### Requirements

- **Node.js** ≥ 18 with Corepack (Yarn classic)
- **CMake** ≥ 3.16 and a C/C++ toolchain
- **Platform-specific dependencies:**
  - **macOS:** Xcode Command-Line Tools
  - **Windows:** Visual Studio Build Tools with C++ workload
  - **Linux:** `build-essential`, `cmake`, `libpulse-dev`, `libx11-dev`

### Clone and setup

```bash
git clone https://github.com/siinghd/AudioMid.git
cd AudioMid
corepack enable
yarn install
```

### Build native modules

The project includes C++ modules for audio capture and window privacy that must be compiled:

```bash
# Build native C++ modules
yarn build:native

# Or build manually with cmake-js
npx cmake-js compile
```

### Development mode

```bash
yarn dev   # starts Electron and React in watch mode
```

### Package binaries

```bash
# Platform-specific builds
yarn package --mac      # Creates DMG and ZIP for macOS
yarn package --win      # Creates NSIS installer for Windows  
yarn package --linux    # Creates AppImage for Linux

# Build for current platform only
yarn package
```

**Build output location:** `release/build/`

### Troubleshooting

**Linux build issues:**
```bash
# Install required dependencies
sudo apt-get update
sudo apt-get install build-essential cmake libpulse-dev libx11-dev
```

**macOS permission issues:**
```bash
# If you get permission errors, ensure Xcode tools are installed
xcode-select --install
```

**Native module rebuild:**
```bash
# If native modules fail to load
yarn build:native
# or
yarn rebuild
```

---

## Configuration files

- Application data: `~/Library/Application Support/AudioMid/` (macOS). Other platforms use the default Electron `app.getPath('userData')` location.
- Default system prompt: `src/common/defaultPrompt.ts`.
- Database schema and migration logic: `src/main/database.ts`.

---

## Contributing

Pull requests are welcome. Please follow the existing code style (`eslint`, `prettier`) and ensure that `yarn lint` and `yarn test` succeed.

---

## License

MIT © Harpreet Singh
