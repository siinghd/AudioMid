// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels =
  | 'audio-start'
  | 'audio-stop'
  | 'clear-response'
  | 'ai-text-update'
  | 'ai-audio-chunk'
  | 'audio-status'
  | 'response-cleared'
  | 'get-settings'
  | 'save-settings'
  | 'test-api-key'
  | 'apply-window-settings'
  | 'audio-data'
  | 'ai-text-complete'
  | 'transcript-partial'
  | 'transcript-final'
  | 'chat-chunk'
  | 'chat-response'
  | 'response-started'
  | 'pipeline-error'
  | 'stt.connected'
  | 'stt.closed'
  | 'get-buffered-audio'
  | 'toggle-privacy-mode'
  | 'get-privacy-status'
  | 'privacy-mode-changed'
  | 'play-recorded-audio'
  | 'play-cached-audio'
  | 'initialization-progress';

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    invoke(channel: Channels, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
};

// Higher-level API for the audio interface
const electronAPI = {
  // Audio recording (using send, not invoke)
  async startRecording() {
    ipcRenderer.send('audio-start');
  },
  async stopRecording() {
    ipcRenderer.send('audio-stop');
  },

  // Message handling
  async sendMessage(message: string) {
    return ipcRenderer.invoke('send-text-message', message);
  },

  // Settings
  async getSettings() {
    return ipcRenderer.invoke('get-settings');
  },
  async saveSettings(settings: any) {
    return ipcRenderer.invoke('save-settings', settings);
  },
  async reInitializeApp() {
    return ipcRenderer.invoke('re-initialize-app');
  },
  async testApiKey(apiKey: string) {
    return ipcRenderer.invoke('test-api-key', apiKey);
  },
  async applyWindowSettings(settings: any) {
    return ipcRenderer.invoke('apply-window-settings', settings);
  },

  // VAD and Audio settings
  async updateVADSettings(vadSettings: any) {
    return ipcRenderer.invoke('update-vad-settings', vadSettings);
  },
  async updateAudioSettings(audioSettings: any) {
    return ipcRenderer.invoke('update-audio-settings', audioSettings);
  },
  async updateDebugSettings(debugSettings: any) {
    return ipcRenderer.invoke('update-debug-settings', debugSettings);
  },
  async initializePipeline(
    apiKey: string,
    systemPrompt?: string,
    provider?: 'openai' | 'gemini',
  ) {
    return ipcRenderer.invoke(
      'initialize-pipeline',
      apiKey,
      systemPrompt,
      provider,
    );
  },

  // Privacy mode
  async setPrivacyMode(enabled: boolean) {
    // For now just toggle, since the handler doesn't take parameters
    return ipcRenderer.invoke('toggle-privacy-mode');
  },

  // Audio playback
  async playRecordedAudio() {
    return ipcRenderer.invoke('play-recorded-audio');
  },

  // Event listeners
  onTranscript(callback: (transcript: string, isPartial: boolean) => void) {
    const partialHandler = (_event: any, transcript: string) => callback(transcript, true);
    const finalHandler = (_event: any, transcript: string) => callback(transcript, false);
    
    ipcRenderer.on('transcript-partial', partialHandler);
    ipcRenderer.on('transcript-final', finalHandler);
    
    return () => {
      ipcRenderer.removeListener('transcript-partial', partialHandler);
      ipcRenderer.removeListener('transcript-final', finalHandler);
    };
  },

  onAudioLevel(callback: (level: number) => void) {
    const audioLevelHandler = (_event: any, data: any) => {
      if (data.level !== undefined) {
        callback(data.level);
      }
    };
    
    ipcRenderer.on('audio-status', audioLevelHandler);
    
    return () => {
      ipcRenderer.removeListener('audio-status', audioLevelHandler);
    };
  },

  onRealtimeUpdate(callback: (update: { type: string; data: any }) => void) {
    // Create named handler functions for proper cleanup
    const responseStartedHandler = (_event: any) =>
      callback({ type: 'responseCreated', data: '' });
    
    const chatChunkHandler = (_event: any, chunkData: any) => {
      // Handle both old string format and new object format
      const chunk = typeof chunkData === 'string' ? chunkData : chunkData.chunk;
      const chunkId = typeof chunkData === 'object' ? chunkData.id : 'unknown';
      callback({ type: 'responseTextDelta', data: chunk });
    };
    
    const audioChunkHandler = (_event: any, data: any) =>
      callback({ type: 'responseAudioDelta', data });
    
    const textCompleteHandler = (_event: any, data: any) =>
      callback({ type: 'responseDone', data });
    
    const errorHandler = (_event: any, error: any) =>
      callback({ type: 'error', data: error });
    
    // Add event listeners
    ipcRenderer.on('response-started', responseStartedHandler);
    ipcRenderer.on('chat-chunk', chatChunkHandler);
    ipcRenderer.on('ai-audio-chunk', audioChunkHandler);
    ipcRenderer.on('ai-text-complete', textCompleteHandler);
    ipcRenderer.on('pipeline-error', errorHandler);
    
    // Return cleanup function for React useEffect
    return () => {
      ipcRenderer.removeListener('response-started', responseStartedHandler);
      ipcRenderer.removeListener('chat-chunk', chatChunkHandler);
      ipcRenderer.removeListener('ai-audio-chunk', audioChunkHandler);
      ipcRenderer.removeListener('ai-text-complete', textCompleteHandler);
      ipcRenderer.removeListener('pipeline-error', errorHandler);
    };
  },

  onFrequencyData(callback: (data: number[]) => void) {
    const audioDataHandler = (_event: any, data: any) => {
      if (data.frequencyData) {
        callback(data.frequencyData);
      }
    };
    
    ipcRenderer.on('audio-data', audioDataHandler);
    
    return () => {
      ipcRenderer.removeListener('audio-data', audioDataHandler);
    };
  },

  onAudioPlaybackState(callback: (playing: boolean) => void) {
    const audioStatusHandler = (_event: any, data: any) => {
      if (data.playing !== undefined) {
        callback(data.playing);
      }
    };
    
    ipcRenderer.on('audio-status', audioStatusHandler);
    
    return () => {
      ipcRenderer.removeListener('audio-status', audioStatusHandler);
    };
  },

  onPipelineStatus(callback: (connected: boolean) => void) {
    const connectedHandler = () => callback(true);
    const closedHandler = () => callback(false);
    
    ipcRenderer.on('stt.connected', connectedHandler);
    ipcRenderer.on('stt.closed', closedHandler);
    
    return () => {
      ipcRenderer.removeListener('stt.connected', connectedHandler);
      ipcRenderer.removeListener('stt.closed', closedHandler);
    };
  },

  onPlayCachedAudio(callback: (audioData: any) => void) {
    const playAudioHandler = (_event: any, audioData: any) => callback(audioData);
    
    ipcRenderer.on('play-cached-audio', playAudioHandler);
    
    return () => {
      ipcRenderer.removeListener('play-cached-audio', playAudioHandler);
    };
  },

  onInitializationProgress(callback: (progress: { step: string; status: string; message: string }) => void) {
    const progressHandler = (_event: any, progress: any) => callback(progress);
    
    ipcRenderer.on('initialization-progress', progressHandler);
    
    return () => {
      ipcRenderer.removeListener('initialization-progress', progressHandler);
    };
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronHandler = typeof electronHandler;
export type ElectronAPI = typeof electronAPI;
