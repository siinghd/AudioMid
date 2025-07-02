// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'audio-start' | 'audio-stop' | 'clear-response' | 'ai-text-update' | 'ai-audio-chunk' | 'audio-status' | 'response-cleared' | 'get-settings' | 'save-settings' | 'test-api-key' | 'apply-window-settings' | 'audio-data' | 'ai-text-complete' | 'transcript-partial' | 'transcript-final' | 'chat-chunk' | 'chat-response' | 'pipeline-error' | 'stt.connected' | 'stt.closed' | 'get-buffered-audio' | 'toggle-privacy-mode' | 'get-privacy-status' | 'privacy-mode-changed';

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

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
