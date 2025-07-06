/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * AI Audio Assistant - Electron main process
 * Captures system audio and processes it with GPT-4o Realtime API
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

// Import database and settings management
import DatabaseManager, { AppSettings } from './database';

// Import audio capture and AI pipeline modules
import {
  AudioProviderFactory,
  ProviderFactoryConfig,
} from '../audio/audio-provider-factory';
import { BaseAudioProvider } from '../audio/audio-provider-interface';
import AudioPipeline from '../audio/pipeline';
import { AudioCapture } from './audio-capture';
import { PrivacyManager } from './privacy';

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;
let database: DatabaseManager | null = null;
let audioCapture: AudioCapture | null = null;
let audioPipeline: AudioPipeline | BaseAudioProvider | null = null;
let privacyManager: PrivacyManager | null = null;

// IPC handlers for audio controls
ipcMain.on('audio-start', async (event) => {
  // Starting audio capture and AI pipeline

  if (!audioCapture || !audioPipeline) {
    console.error('Audio capture or pipeline not initialized');
    event.reply('audio-status', {
      recording: false,
      error: 'Audio system not initialized',
    });
    return;
  }

  try {
    // Start the AI pipeline first
    if (!audioPipeline.isReady()) {
      await audioPipeline.initialize();
    }
    audioPipeline.start();

    // Then start audio capture
    const success = await audioCapture.start();
    event.reply('audio-status', { recording: success });

    if (!success) {
      console.error(
        'Failed to start audio capture:',
        audioCapture.getLastError(),
      );
      audioPipeline.stop();
    }
  } catch (error) {
    console.error('Failed to start audio pipeline:', error);
    event.reply('audio-status', {
      recording: false,
      error: 'Failed to start AI pipeline',
    });
  }
});

ipcMain.on('audio-stop', async (event) => {
  // Stopping audio capture and AI pipeline

  if (audioPipeline) {
    // Flush any remaining audio for Gemini Live API
    if (audioPipeline.flushAudio) {
      audioPipeline.flushAudio();
    }
    audioPipeline.stop();
  }

  if (!audioCapture) {
    event.reply('audio-status', { recording: false });
    return;
  }

  const success = await audioCapture.stop();
  event.reply('audio-status', { recording: false });

  if (!success) {
    console.error('Failed to stop audio capture:', audioCapture.getLastError());
  }
});

ipcMain.on('clear-response', async (event) => {
  // Clearing AI response

  // Clear audio buffer if available
  if (audioCapture) {
    audioCapture.clearBuffer();
  }

  // Clear transcript history
  if (audioPipeline) {
    audioPipeline.clearTranscriptHistory();
  }

  event.reply('response-cleared');
});

// Settings IPC handlers
ipcMain.handle('get-settings', async () => {
  if (!database) return null;
  return database.getSettings();
});

ipcMain.handle(
  'save-settings',
  async (event, settings: Partial<AppSettings>) => {
    console.log('💾 [Settings] Saving settings:', settings);
    if (!database) return false;
    try {
      database.saveSettings(settings);

      // If OpenAI API key was updated, reinitialize the pipeline
      if (settings.openaiApiKey && !audioPipeline) {
        console.log('🔧 [Settings] Initializing OpenAI pipeline after settings save...');
        await initializeAudioPipeline(
          settings.openaiApiKey,
          settings.systemPrompt,
        );
      }

      console.log('✅ [Settings] Settings saved successfully');
      return true;
    } catch (error) {
      console.error('❌ [Settings] Failed to save settings:', error);
      return false;
    }
  },
);

// Add handler for re-initialization
ipcMain.handle('re-initialize-app', async (event) => {
  console.log('🔄 [Settings] Re-initialization requested...');
  try {
    // Reset initialization state
    const settings = database?.getSettings();
    
    // Start the initialization process again
    if (mainWindow) {
      // Trigger the same initialization that happens on app startup
      const { systemPreferences } = require('electron');
      
      // Re-initialize audio capture if needed
      console.log('🚀 [ReInit] Starting complete app re-initialization...');
      
      // Request permissions on macOS (if needed)
      if (process.platform === 'darwin') {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        if (micStatus !== 'granted') {
          const micGranted = await systemPreferences.askForMediaAccess('microphone');
        }
      }

      // Notify renderer about initialization progress
      console.log('🔧 [ReInit] Starting audio capture initialization...');
      mainWindow.webContents.send('initialization-progress', {
        step: 'audio-capture',
        status: 'initializing',
        message: 'Initializing audio capture...'
      });

      // Audio capture should already be initialized, so mark as completed
      console.log('✅ [ReInit] Audio capture initialization completed');
      mainWindow.webContents.send('initialization-progress', {
        step: 'audio-capture',
        status: 'completed',
        message: 'Audio capture initialized successfully'
      });

      // Initialize AI pipeline with current settings
      const aiProvider = settings?.aiProvider || 'openai';
      const apiKey = aiProvider === 'openai' ? settings?.openaiApiKey : settings?.geminiApiKey;

      if (apiKey) {
        console.log(`🔧 [ReInit] Starting ${aiProvider.toUpperCase()} pipeline initialization...`);
        mainWindow.webContents.send('initialization-progress', {
          step: 'ai-pipeline',
          status: 'initializing',
          message: `Initializing ${aiProvider.toUpperCase()} pipeline...`
        });
        
        try {
          // Clean up existing pipeline first
          if (audioPipeline) {
            audioPipeline.disconnect();
            audioPipeline = null;
          }
          
          await initializeAudioPipeline(
            apiKey,
            settings?.systemPrompt,
            aiProvider,
          );
          
          console.log(`✅ [ReInit] ${aiProvider.toUpperCase()} pipeline initialization completed`);
          mainWindow.webContents.send('initialization-progress', {
            step: 'ai-pipeline',
            status: 'completed',
            message: `${aiProvider.toUpperCase()} pipeline initialized successfully`
          });
        } catch (error) {
          console.error(`❌ [ReInit] ${aiProvider.toUpperCase()} pipeline initialization failed:`, error);
          mainWindow.webContents.send('initialization-progress', {
            step: 'ai-pipeline',
            status: 'error',
            message: `Failed to initialize ${aiProvider.toUpperCase()} pipeline`
          });
          return false;
        }
      } else {
        console.log('⏭️ [ReInit] AI pipeline skipped - no API key');
        mainWindow.webContents.send('initialization-progress', {
          step: 'ai-pipeline',
          status: 'skipped',
          message: `No API key found - please configure in settings`
        });
      }

      // Signal that initialization is complete
      console.log('🎉 [ReInit] All re-initialization completed successfully');
      mainWindow.webContents.send('initialization-progress', {
        step: 'complete',
        status: 'completed',
        message: 'Initialization complete'
      });
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('💥 [ReInit] CRITICAL: Re-initialization failed:', error);
    
    // Send error to renderer
    if (mainWindow) {
      mainWindow.webContents.send('initialization-progress', {
        step: 'error',
        status: 'error',
        message: `Re-initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
    
    return false;
  }
});

ipcMain.handle('test-api-key', async (event, apiKey: string) => {
  // TODO: Implement actual API key validation with OpenAI
  // For now, just check if it starts with 'sk-' and has reasonable length
  return apiKey.startsWith('sk-') && apiKey.length > 20;
});

// Pipeline status and control
ipcMain.handle('get-pipeline-stats', async () => {
  if (!audioPipeline) return null;
  return audioPipeline.getStats();
});

ipcMain.handle('get-current-transcript', async () => {
  if (!audioPipeline) return '';
  return audioPipeline.getCurrentTranscript();
});

ipcMain.handle('update-system-prompt', async (event, prompt: string) => {
  if (!audioPipeline) return false;
  try {
    audioPipeline.updateSystemPrompt(prompt);
    return true;
  } catch (error) {
    console.error('Failed to update system prompt:', error);
    return false;
  }
});

ipcMain.handle(
  'configure-vad',
  async (event, enabled: boolean, threshold: number) => {
    if (!audioPipeline) return false;
    try {
      audioPipeline.setVADConfig(enabled, threshold);
      return true;
    } catch (error) {
      console.error('Failed to configure VAD:', error);
      return false;
    }
  },
);

// Update VAD settings in real-time
ipcMain.handle('update-vad-settings', async (event, vadSettings: any) => {
  if (!audioPipeline)
    return { success: false, error: 'Audio pipeline not initialized' };

  try {
    // Update the pipeline with new VAD settings
    audioPipeline.setVADConfig(vadSettings.enableVAD, vadSettings.threshold);
    
    // Update audio capture VAD aggressiveness if available
    if (audioCapture && vadSettings.aggressiveness !== undefined) {
      // Check if VAD is initialized and update aggressiveness
      if (audioCapture.isVADInitialized()) {
        audioCapture.setVADMode(vadSettings.aggressiveness);
        console.log(`🔧 Updated VAD aggressiveness to ${vadSettings.aggressiveness}`);
      } else {
        // Re-create VAD with new aggressiveness
        audioCapture.createVAD(48000, vadSettings.aggressiveness);
        console.log(`🔧 Re-created VAD with aggressiveness ${vadSettings.aggressiveness}`);
      }
    }
    
    console.log('🔧 Updated VAD settings:', vadSettings);
    return { success: true };
  } catch (error) {
    console.error('Failed to update VAD settings:', error);
    return { success: false, error: 'Failed to update VAD settings' };
  }
});

// Update audio buffer settings in real-time
ipcMain.handle('update-audio-settings', async (event, audioSettings: any) => {
  if (!audioPipeline)
    return { success: false, error: 'Audio pipeline not initialized' };

  try {
    // For buffer size changes, we would need to restart the pipeline
    // But we can update other audio settings immediately
    console.log(
      '🔧 Audio settings updated (restart required for buffer changes):',
      audioSettings,
    );
    return { success: true, restartRequired: true };
  } catch (error) {
    console.error('Failed to update audio settings:', error);
    return { success: false, error: 'Failed to update audio settings' };
  }
});

ipcMain.handle(
  'initialize-pipeline',
  async (
    event,
    apiKey: string,
    systemPrompt?: string,
    provider?: 'openai' | 'gemini',
  ) => {
    try {
      if (audioPipeline) {
        // Disconnect existing pipeline first
        audioPipeline.disconnect();
        audioPipeline = null;
      }

      await initializeAudioPipeline(apiKey, systemPrompt, provider);
      return true;
    } catch (error) {
      console.error('Failed to initialize pipeline:', error);
      return false;
    }
  },
);

ipcMain.handle(
  'apply-window-settings',
  async (
    event,
    windowSettings: {
      opacity: number;
      alwaysOnTop: boolean;
      invisibleToRecording: boolean;
    },
  ) => {
    if (!mainWindow) return false;

    try {
      // Apply opacity
      mainWindow.setOpacity(windowSettings.opacity);

      // Apply always on top
      mainWindow.setAlwaysOnTop(windowSettings.alwaysOnTop, 'screen-saver');

      // Apply invisibility to recording (platform-specific)
      await setWindowInvisibleToRecording(
        mainWindow,
        windowSettings.invisibleToRecording,
      );

      return true;
    } catch (error) {
      console.error('Failed to apply window settings:', error);
      return false;
    }
  },
);

// Handle debug settings updates
ipcMain.handle('update-debug-settings', async (event, debugSettings: any) => {
  try {
    // Update audio capture debug settings
    if (audioCapture && debugSettings.dumpNativeAudio !== undefined) {
      audioCapture.setDebugSettings({ dumpNativeAudio: debugSettings.dumpNativeAudio });
    }

    // Update audio provider debug settings if pipeline exists
    if (audioPipeline && (debugSettings.dumpOpenAIRawAudio !== undefined || debugSettings.dumpOpenAIApiAudio !== undefined)) {
      audioPipeline.setDebugSettings({
        dumpRawAudio: debugSettings.dumpOpenAIRawAudio,
        dumpApiAudio: debugSettings.dumpOpenAIApiAudio
      });
      console.log('🔧 Updated audio provider debug settings:', debugSettings);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to update debug settings:', error);
    return { success: false, error: 'Failed to update debug settings' };
  }
});

// Handle sending text messages to the AI
ipcMain.handle('send-text-message', async (event, message: string) => {
  if (!audioPipeline) {
    return { success: false, error: 'Audio pipeline not initialized' };
  }

  try {
    // For now, just emit the transcript event to trigger AI response
    audioPipeline.emit('transcript.final', message);
    return { success: true };
  } catch (error) {
    console.error('Failed to send text message:', error);
    return { success: false, error: 'Failed to send message' };
  }
});

// Removed duplicate setupOpenAIEventHandlers - now using unified handlers for all providers

// Set up unified event handlers that work with all audio providers
function setupUnifiedEventHandlers(pipeline: BaseAudioProvider): void {
  // User transcript events
  pipeline.on('transcript.final', (text: string) => {
    if (mainWindow) {
      mainWindow.webContents.send('transcript-final', text);
    }
  });

  // AI response events
  pipeline.on('chat.response', (response: any) => {
    if (mainWindow) {
      mainWindow.webContents.send('chat-response', response);
    }
  });

  pipeline.on('ai.response_started', () => {
    if (mainWindow) {
      mainWindow.webContents.send('response-started');
    }
  });

  pipeline.on('chat.chunk', (chunk: string) => {
    const chunkId = Math.random().toString(36).substr(2, 5);
    if (mainWindow) {
      mainWindow.webContents.send('chat-chunk', { chunk, id: chunkId });
    }
  });

  // All AI text updates now use chat.chunk for consistency

  pipeline.on('ai.text_complete', (text: string) => {
    if (mainWindow) {
      mainWindow.webContents.send('ai-text-complete', text);
    }
  });

  pipeline.on('ai.audio_transcript_done', (transcript: string) => {
    if (mainWindow) {
      mainWindow.webContents.send('ai-text-complete', transcript);
    }
  });

  // Audio events for AI responses
  pipeline.on('ai.audio_chunk', (audioBuffer: Buffer | ArrayBuffer) => {
    if (mainWindow) {
      mainWindow.webContents.send('ai-audio-chunk', audioBuffer);
    }
  });

  pipeline.on('ai.audio_done', () => {
    if (mainWindow) {
      mainWindow.webContents.send('ai-audio-done');
    }
  });

  // Speech detection events
  pipeline.on('user.speech_started', () => {
    if (mainWindow) {
      mainWindow.webContents.send('user-speech-started');
    }
  });

  pipeline.on('user.speech_stopped', () => {
    if (mainWindow) {
      mainWindow.webContents.send('user-speech-stopped');
    }
  });

  // Connection and error events
  pipeline.on('stt.connected', () => {
    if (mainWindow) {
      mainWindow.webContents.send('stt.connected');
    }
  });

  pipeline.on('stt.closed', (code: number, reason: string) => {
    if (mainWindow) {
      mainWindow.webContents.send('stt.closed', code, reason);
    }
  });

  pipeline.on('stt.error', (error: Error) => {
    console.error('Pipeline error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('pipeline-error', error.message);
    }
  });

  // Audio processing events
  pipeline.on('audio.processed', (info: any) => {
    // Optional: could send processing stats to renderer if needed
  });

  pipeline.on('audio.error', (error: Error) => {
    console.error('Audio processing error:', error);
    if (mainWindow) {
      mainWindow.webContents.send(
        'pipeline-error',
        `Audio processing error: ${error.message}`,
      );
    }
  });
}

// Initialize audio pipeline with API key - now supports multiple providers using unified system
async function initializeAudioPipeline(
  apiKey: string,
  systemPrompt?: string,
  provider?: 'openai' | 'gemini',
): Promise<void> {
  try {
    // Get saved settings from database
    const savedSettings = database?.getSettings();
    const aiProvider = provider || savedSettings?.aiProvider || 'openai';
    const vadSettings = savedSettings?.vadSettings || {
      releaseMs: 2000,
      holdMs: 200,
      threshold: 0.02,
      adaptiveNoiseFloor: true,
    };
    const audioSettings = savedSettings?.audioSettings || {
      bufferSizeMs: 1000,
      enableVAD: true,
    };
    const geminiSettings = {
      model: 'gemini-live-2.5-flash-preview',
      audioArchitecture: 'half-cascade',
      ...(savedSettings?.geminiSettings || {}),
      responseModalities: ['TEXT'], // Force TEXT mode (override any cached setting)
    };

    console.log('🔧 Initializing unified audio provider:', {
      provider: aiProvider,
      vadSettings,
      audioSettings,
      geminiSettings: aiProvider === 'gemini' ? geminiSettings : undefined,
      systemPrompt,
    });

    // Use unified system for ALL providers (OpenAI and Gemini)
    const providerConfig: ProviderFactoryConfig = {
      provider: aiProvider,
      apiKey,
      systemPrompt:
        systemPrompt ||
        'You are a helpful AI assistant. Respond naturally and concisely to what the user is saying.',
      vadSettings: {
        enableVAD: audioSettings.enableVAD,
        threshold: vadSettings.threshold,
        holdMs: vadSettings.holdMs,
        releaseMs: vadSettings.releaseMs,
        adaptiveNoiseFloor: vadSettings.adaptiveNoiseFloor,
      },
      audioSettings,
      providerSpecific: aiProvider === 'gemini' ? geminiSettings : {},
    };

    const validation = AudioProviderFactory.validateConfig(providerConfig);
    if (!validation.valid) {
      throw new Error(
        `Invalid provider configuration: ${validation.errors.join(', ')}`,
      );
    }

    audioPipeline = AudioProviderFactory.createProvider(providerConfig);

    if (audioCapture) {
      audioPipeline.setAudioCapture(audioCapture);
    }

    setupUnifiedEventHandlers(audioPipeline);
    await audioPipeline.initialize();

    // Apply debug settings if they exist
    if (savedSettings?.debugSettings) {
      audioPipeline.setDebugSettings({
        dumpRawAudio: savedSettings.debugSettings.dumpOpenAIRawAudio,
        dumpApiAudio: savedSettings.debugSettings.dumpOpenAIApiAudio
      });
      console.log('🔧 Applied debug settings to audio provider:', savedSettings.debugSettings);
    }

    console.log(
      `✅ ${aiProvider.toUpperCase()} audio provider initialized successfully (unified system)`,
    );

    // Original AudioPipeline is still available at src/audio/pipeline.ts as reference/fallback
  } catch (error) {
    console.error('❌ Failed to initialize AI pipeline:', error);
    audioPipeline = null;
    throw error;
  }
}

// Platform-specific window invisibility
async function setWindowInvisibleToRecording(
  window: BrowserWindow,
  invisible: boolean,
) {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: Use SetWindowDisplayAffinity
    const { exec } = require('child_process');
    const windowId = window.getNativeWindowHandle().readBigUInt64LE();

    if (invisible) {
      // WDA_MONITOR = 0x00000001 - Excludes window from capture
      exec(
        `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\"user32.dll\\")] public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity); }'; [Win32]::SetWindowDisplayAffinity(${windowId}, 1)"`,
      );
    } else {
      exec(
        `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\"user32.dll\\")] public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity); }'; [Win32]::SetWindowDisplayAffinity(${windowId}, 0)"`,
      );
    }
  } else if (platform === 'darwin') {
    // macOS: Use window level manipulation for screen capture exclusion
    if (invisible) {
      // First, try Electron's built-in method for macOS 10.14+
      if (process.platform === 'darwin') {
        try {
          // This is the official Electron API for excluding windows from capture
          (window as any).setContentProtection(true);
          // Applied content protection to exclude window from capture
        } catch (e) {
          console.log(
            '⚠️ setContentProtection not available, using fallback method',
          );
        }
      }

      // Set window to screen-saver level (typically excluded from capture)
      window.setAlwaysOnTop(true, 'screen-saver', 1);
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

      // IMPORTANT: On macOS, the most reliable way to hide from screen capture
      // is to use a private window level that's excluded from capture
      try {
        const { exec } = require('child_process');

        // Use Objective-C runtime to set private window properties
        // This sets the window to a special level that's excluded from screen capture
        const objcScript = `
          #import <Cocoa/Cocoa.h>
          #import <QuartzCore/QuartzCore.h>
          
          int main(int argc, char *argv[]) {
            @autoreleasepool {
              // Get all windows
              NSArray *windows = [[NSApplication sharedApplication] windows];
              for (NSWindow *window in windows) {
                if ([window.title isEqualToString:@"${window.getTitle()}"]) {
                  // Set window to be excluded from screen capture
                  // Use kCGScreenSaverWindowLevel which is typically excluded from capture
                  [window setLevel:kCGScreenSaverWindowLevel + 1];
                  
                  // Set sharing type to none - this is the key for macOS 10.14+
                  if (@available(macOS 10.14, *)) {
                    [window setSharingType:NSWindowSharingNone];
                  }
                  
                  // Set collection behavior to stay on all spaces but be excluded from Exposé
                  [window setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces | 
                                               NSWindowCollectionBehaviorStationary | 
                                               NSWindowCollectionBehaviorIgnoresCycle |
                                               NSWindowCollectionBehaviorFullScreenAuxiliary];
                  
                  // Make the window still interactive despite the high level
                  [window setIgnoresMouseEvents:NO];
                  [window makeKeyAndOrderFront:nil];
                  
                  // Additional privacy settings for macOS 12+
                  if (@available(macOS 12.0, *)) {
                    // Try to exclude from screen capture APIs
                    [window setValue:@YES forKey:@"excludedFromWindowsMenu"];
                  }
                  
                  NSLog(@"Successfully set window to be invisible to screen capture");
                  break;
                }
              }
            }
            return 0;
          }
        `;

        // Write to a temporary file and compile/run it
        const fs = require('fs');
        const path = require('path');
        const tmpFile = path.join(app.getPath('temp'), 'hide-window.m');
        fs.writeFileSync(tmpFile, objcScript);

        exec(
          `clang -framework Cocoa -framework QuartzCore -framework ApplicationServices -x objective-c ${tmpFile} -o ${tmpFile}.out && ${tmpFile}.out`,
          (error: any) => {
            if (error) {
              console.warn('Failed to set macOS window level:', error);

              // Fallback: Try using accessibility APIs
              const fallbackScript = `
              tell application "System Events"
                tell process "${app.getName()}"
                  try
                    set value of attribute "AXWindowLevel" of window 1 to 2147483631
                  end try
                end tell
              end tell
            `;

              exec(`osascript -e '${fallbackScript.replace(/'/g, "\\'")}'`);
            } else {
              // Successfully applied macOS screen capture exclusion
            }

            // Clean up temp files
            try {
              fs.unlinkSync(tmpFile);
              fs.unlinkSync(`${tmpFile}.out`);
            } catch (e) {}
          },
        );
      } catch (error) {
        console.warn(
          'Failed to apply macOS screen recording exclusion:',
          error,
        );
      }
    } else {
      // Restore normal visibility
      try {
        (window as any).setContentProtection(false);
      } catch (e) {}

      window.setAlwaysOnTop(false);
      window.setVisibleOnAllWorkspaces(false);

      // Reset to normal window level
      try {
        const { exec } = require('child_process');
        exec(
          `osascript -e 'tell application "System Events" to tell process "${app.getName()}" to set value of attribute "AXWindowLevel" of window 1 to 0'`,
        );
      } catch (error) {}
    }
  } else if (platform === 'linux') {
    // Linux: Use X11 override-redirect or Wayland protocols
    if (invisible) {
      // Additional Linux-specific code would go here
    }
  }
}

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  // Initialize database first
  database = new DatabaseManager();
  const settings = database.getSettings();

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: settings?.windowWidth || 1400,
    height: settings?.windowHeight || 900,
    minWidth: 1200,
    minHeight: 700,
    x: settings?.windowX,
    y: settings?.windowY,
    icon: getAssetPath('icon.png'),
    frame: true,
    alwaysOnTop: settings?.alwaysOnTop ?? true,
    transparent: false,
    opacity: settings?.windowOpacity || 1.0,
    // macOS specific settings for better always-on-top behavior
    ...(process.platform === 'darwin'
      ? {
          visibleOnAllWorkspaces: true,
          fullscreenWindowTitle: true,
          hasShadow: true,
          roundedCorners: true,
        }
      : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }

    // Initialize privacy manager
    privacyManager = new PrivacyManager();
    privacyManager.setWindow(mainWindow);

    // Apply initial window settings
    if (settings?.invisibleToRecording) {
      setWindowInvisibleToRecording(mainWindow, true);
    }

    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  // Save window position and size when moved or resized
  mainWindow.on('moved', () => {
    if (mainWindow && database) {
      const [x, y] = mainWindow.getPosition();
      database.saveSettings({ windowX: x, windowY: y });
    }
  });

  mainWindow.on('resized', () => {
    if (mainWindow && database) {
      const [width, height] = mainWindow.getSize();
      database.saveSettings({ windowWidth: width, windowHeight: height });
    }
  });

  mainWindow.on('closed', () => {
    // Clean up privacy manager
    if (privacyManager) {
      privacyManager.cleanup();
      privacyManager = null;
    }
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    // Set app name to match production build for permissions
    if (process.env.NODE_ENV === 'development') {
      app.setName('AI Audio Assistant');
    }

    await createWindow();

    // Initialize audio capture
    try {
      console.log('🚀 [Init] Starting complete app initialization...');
      // Initialize audio capture

      // Request permissions on macOS
      if (process.platform === 'darwin') {
        const { systemPreferences } = require('electron');

        // Check and request microphone permission
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        // Microphone permission status checked
        if (micStatus !== 'granted') {
          const micGranted =
            await systemPreferences.askForMediaAccess('microphone');
          // Microphone permission granted
        }

        // Check screen recording permission (macOS 10.15+)
        try {
          const screenStatus = systemPreferences.getMediaAccessStatus('screen');
          // Screen recording permission status checked
        } catch (err) {
          console.log(
            'Screen recording permission check not available on this macOS version',
          );
        }

        // Trigger screen recording permission by attempting screen capture
        // Trigger screen recording permission
        const { desktopCapturer } = require('electron');
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1, height: 1 },
          });
          // Screen recording permission triggered

          // Also try to get audio sources to trigger audio capture permission
          const audioSources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1, height: 1 },
            fetchWindowIcons: false,
          });
          // Audio sources checked
        } catch (err) {
          console.log(
            'Screen recording permission prompt triggered via error:',
            err,
          );
        }

        // Give user time to grant permission
        // Wait for permission grant
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Notify renderer about initialization progress
      console.log('🔧 [Init] Starting audio capture initialization...');
      mainWindow?.webContents.send('initialization-progress', {
        step: 'audio-capture',
        status: 'initializing',
        message: 'Initializing audio capture...'
      });

      audioCapture = new AudioCapture();

      // Initialize WebRTC VAD embedded in the audio capture module
      // Mode 3 is more aggressive (less false positives) for system audio
      const vadAlreadyInitialized = audioCapture.isVADInitialized();
      console.log(
        `🔍 [Debug] VAD already initialized: ${vadAlreadyInitialized}`,
      );

      // Initialize VAD with settings-based aggressiveness
      const settings = database?.getSettings();
      const vadAggressiveness = settings?.vadSettings?.aggressiveness ?? 3;
      
      if (!vadAlreadyInitialized && audioCapture.createVAD(48000, vadAggressiveness)) {
        // VAD creation success is already logged in AudioCapture.createVAD()

        // Disable native noise gate to allow VAD to process all audio (including silence)
        audioCapture.setNoiseGateThreshold(0.0);
        console.log(
          `🔧 Native noise gate disabled - VAD will process all audio including silence (aggressiveness: ${vadAggressiveness})`,
        );
        
        console.log('✅ [Init] Audio capture initialization completed');
        mainWindow?.webContents.send('initialization-progress', {
          step: 'audio-capture',
          status: 'completed',
          message: 'Audio capture initialized successfully'
        });
      } else {
        console.warn(
          '⚠️ WebRTC VAD initialization failed - using simple VAD fallback',
        );
        
        console.log('✅ [Init] Audio capture initialization completed (fallback mode)');
        mainWindow?.webContents.send('initialization-progress', {
          step: 'audio-capture',
          status: 'completed',
          message: 'Audio capture initialized (fallback mode)'
        });
      }

      // Initialize AI pipeline with settings if API key is available  
      const aiProvider = settings?.aiProvider || 'openai';
      const apiKey =
        aiProvider === 'gemini'
          ? settings?.geminiApiKey
          : settings?.openaiApiKey;

      // Apply debug settings on startup
      if (settings?.debugSettings) {
        audioCapture.setDebugSettings(settings.debugSettings);
        console.log('🔧 Applied debug settings on startup:', settings.debugSettings);
      }

      if (apiKey) {
        console.log(`🔧 [Init] Starting ${aiProvider.toUpperCase()} pipeline initialization...`);
        mainWindow?.webContents.send('initialization-progress', {
          step: 'ai-pipeline',
          status: 'initializing',
          message: `Initializing ${aiProvider.toUpperCase()} pipeline...`
        });
        
        try {
          await initializeAudioPipeline(
            apiKey,
            settings?.systemPrompt,
            aiProvider,
          );
          
          console.log(`✅ [Init] ${aiProvider.toUpperCase()} pipeline initialization completed`);
          mainWindow?.webContents.send('initialization-progress', {
            step: 'ai-pipeline',
            status: 'completed',
            message: `${aiProvider.toUpperCase()} pipeline initialized successfully`
          });
        } catch (error) {
          console.error(
            'Failed to initialize AI pipeline during startup:',
            error,
          );
          
          console.error(`❌ [Init] ${aiProvider.toUpperCase()} pipeline initialization failed:`, error);
          mainWindow?.webContents.send('initialization-progress', {
            step: 'ai-pipeline',
            status: 'error',
            message: `Failed to initialize ${aiProvider.toUpperCase()} pipeline`
          });
        }
      } else {
        console.log(
          `No ${aiProvider === 'gemini' ? 'Gemini' : 'OpenAI'} API key found - AI pipeline disabled (can be enabled in settings)`,
        );
        
        console.log('⏭️ [Init] AI pipeline skipped - no API key');
        mainWindow?.webContents.send('initialization-progress', {
          step: 'ai-pipeline',
          status: 'skipped',
          message: `No API key found - please configure in settings`
        });
      }

      // Signal that initialization is complete
      console.log('🎉 [Init] All initialization completed successfully');
      mainWindow?.webContents.send('initialization-progress', {
        step: 'complete',
        status: 'completed',
        message: 'Initialization complete'
      });

      // Set up audio event handlers
      audioCapture.on('audio', (sample) => {
        // Audio event received

        if (mainWindow) {
          // Send raw audio data to renderer for visualization
          const volumeLevel = audioCapture!.getVolumeLevel();

          // Calculate frequency data for better visualization using correct data type
          const audioData = new Int16Array(
            sample.data.buffer,
            sample.data.byteOffset,
            sample.data.length / 2,
          );
          const fftSize = 128;
          const frequencyData = new Float32Array(fftSize);

          // Simple frequency analysis for visualization (normalize int16 to float)
          for (let i = 0; i < fftSize && i < audioData.length; i++) {
            frequencyData[i] = Math.abs(audioData[i]) / 32768.0;
          }

          mainWindow.webContents.send('audio-data', {
            volume: volumeLevel,
            timestamp: sample.timestamp,
            format: sample.format,
            frequencyData: Array.from(frequencyData),
          });
        }

        // Send float32 audio to AI pipeline for processing
        if (audioPipeline && audioPipeline.isReady() && audioCapture) {
          // Get the latest float32 audio chunk from native capture (destructive read)
          const float32Data = audioCapture.getBufferedFloat32Audio() as any;
          if (float32Data && float32Data.length > 0) {
            // Send to AI pipeline
            audioPipeline.processAudioChunk(float32Data);
          }
        }
      });

      // Check if audio capture is supported
      const isSupported = await AudioCapture.isAudioCaptureSupported();
      if (isSupported) {
        console.log('Native audio capture is available');
      } else {
        console.log('Native audio capture not available - using mock mode');
      }

      // Audio capture initialized successfully
    } catch (error) {
      console.error('💥 [Init] CRITICAL: Failed to initialize app:', error);
      
      // Send error to renderer
      mainWindow?.webContents.send('initialization-progress', {
        step: 'error',
        status: 'error',
        message: `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
