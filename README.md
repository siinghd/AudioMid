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

Signed macOS builds (`.dmg` and `.zip`) are attached to each release.

> Windows and Linux artefacts are produced but have not been tested on physical machines. Expect issues with audio capture or device permissions.

---

## Building from source

### Requirements

- Node.js ≥ 18 with Corepack (Yarn classic).
- CMake and a C/C++ tool-chain.
- macOS: Xcode Command-Line Tools.  
  Windows: Visual Studio Build Tools.  
  Linux: `build-essential`, ALSA development headers.

### Clone and run in development mode

```bash
git clone https://github.com/siinghd/AudioMid.git
cd AudioMid
corepack enable
yarn install
yarn dev   # starts Electron and React in watch mode
```

The native C++ module for audio capture is compiled automatically during the `yarn install` step. If you need to rebuild it manually, run `yarn build:native`.

### Package binaries

```bash
# Platform-specific
yarn package --mac      # DMG and ZIP
yarn package --win      # NSIS installer
yarn package --linux    # AppImage and DEB

# All supported targets (requires wine + mono for Windows cross-compile)
yarn package
```

The resulting files are written to `release/build/`.

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
