/**
 * Settings component for configuring OpenAI API key and other options
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface AppSettings {
  openaiApiKey?: string;
  systemPrompt?: string;
  windowOpacity: number;
  alwaysOnTop: boolean;
  invisibleToRecording: boolean;
  vadSettings?: {
    releaseMs: number;
    holdMs: number;
    threshold: number;
    adaptiveNoiseFloor: boolean;
  };
  audioSettings?: {
    bufferSizeMs: number;
    enableVAD: boolean;
  };
}

function Settings(): React.ReactElement {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>({
    windowOpacity: 1.0,
    alwaysOnTop: true,
    invisibleToRecording: true,
    vadSettings: {
      releaseMs: 2000,
      holdMs: 200,
      threshold: 0.02,
      adaptiveNoiseFloor: true,
    },
    audioSettings: {
      bufferSizeMs: 1000,
      enableVAD: true,
    },
  });
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = await window.electron.ipcRenderer.invoke('get-settings');
      if (savedSettings) {
        setSettings({
          ...settings,
          ...savedSettings,
          vadSettings: {
            ...settings.vadSettings,
            ...savedSettings.vadSettings,
          },
          audioSettings: {
            ...settings.audioSettings,
            ...savedSettings.audioSettings,
          },
        });
        setApiKey(savedSettings.openaiApiKey || '');
        setSystemPrompt(savedSettings.systemPrompt || 'You are a helpful AI assistant. Respond naturally and concisely to what the user is saying.');
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage('Failed to load settings');
    }
  };

  const saveSettings = async () => {
    setIsLoading(true);
    setMessage('');

    try {
      // Validate API key format
      if (apiKey && !apiKey.startsWith('sk-')) {
        setMessage('❌ Invalid API key format. OpenAI API keys start with "sk-"');
        setIsLoading(false);
        return;
      }

      // Save settings to database
      const success = await window.electron.ipcRenderer.invoke('save-settings', {
        ...settings,
        openaiApiKey: apiKey,
        systemPrompt: systemPrompt,
      });

      if (success) {
        // If API key was provided, initialize the pipeline
        if (apiKey) {
          const pipelineSuccess = await window.electron.ipcRenderer.invoke(
            'initialize-pipeline',
            apiKey,
            systemPrompt
          );
          
          if (pipelineSuccess) {
            setMessage('✅ Settings saved and AI pipeline initialized successfully!');
          } else {
            setMessage('⚠️ Settings saved but AI pipeline initialization failed. Check your API key.');
          }
        } else {
          setMessage('✅ Settings saved successfully!');
        }
      } else {
        setMessage('❌ Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMessage('❌ Failed to save settings');
    } finally {
      setIsLoading(false);
    }
  };

  const testApiKey = async () => {
    if (!apiKey) {
      setMessage('Please enter an API key first');
      return;
    }

    setIsLoading(true);
    setMessage('Testing API key...');

    try {
      const isValid = await window.electron.ipcRenderer.invoke('test-api-key', apiKey);
      if (isValid) {
        setMessage('✅ API key format looks valid');
      } else {
        setMessage('❌ Invalid API key format');
      }
    } catch (error) {
      setMessage('❌ Failed to test API key');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full h-screen bg-gray-900 text-white p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center mb-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mr-4 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold">Settings</h1>
        </div>

        {/* OpenAI API Configuration */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-400">OpenAI Configuration</h2>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              OpenAI API Key
              <span className="text-red-400 ml-1">*</span>
            </label>
            <div className="flex space-x-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={testApiKey}
                disabled={isLoading || !apiKey}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-medium transition-colors"
              >
                Test
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Get your API key from{' '}
              <a 
                href="#" 
                onClick={() => window.electron.shell?.openExternal('https://platform.openai.com/api-keys')}
                className="text-blue-400 hover:underline"
              >
                platform.openai.com/api-keys
              </a>
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful AI assistant..."
              rows={3}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
            />
            <p className="text-xs text-gray-400 mt-1">
              Customize how the AI assistant should behave and respond
            </p>
          </div>
        </div>

        {/* Window Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-purple-400">Window Settings</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Always on Top</label>
              <input
                type="checkbox"
                checked={settings.alwaysOnTop}
                onChange={(e) => setSettings(prev => ({ ...prev, alwaysOnTop: e.target.checked }))}
                className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Invisible to Screen Recording</label>
              <input
                type="checkbox"
                checked={settings.invisibleToRecording}
                onChange={(e) => setSettings(prev => ({ ...prev, invisibleToRecording: e.target.checked }))}
                className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Window Opacity: {Math.round(settings.windowOpacity * 100)}%
              </label>
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.1"
                value={settings.windowOpacity}
                onChange={(e) => setSettings(prev => ({ ...prev, windowOpacity: parseFloat(e.target.value) }))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              />
            </div>
          </div>
        </div>

        {/* Voice Activity Detection (VAD) Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-purple-400">Voice Activity Detection</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2">
                <span>Enable VAD</span>
                <span className="text-gray-400 text-sm">(Voice activity detection)</span>
              </label>
              <input
                type="checkbox"
                checked={settings.audioSettings?.enableVAD ?? true}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  audioSettings: { ...prev.audioSettings, enableVAD: e.target.checked }
                }))}
                className="w-4 h-4 rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Silence Duration (ms)
                <span className="text-gray-400 ml-2">({settings.vadSettings?.releaseMs || 2000}ms)</span>
              </label>
              <input
                type="range"
                min="500"
                max="5000"
                step="100"
                value={settings.vadSettings?.releaseMs || 2000}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, releaseMs: parseInt(e.target.value) }
                }))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0.5s (fast)</span>
                <span>5s (slow)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Voice Hold Duration (ms)
                <span className="text-gray-400 ml-2">({settings.vadSettings?.holdMs || 200}ms)</span>
              </label>
              <input
                type="range"
                min="50"
                max="500"
                step="10"
                value={settings.vadSettings?.holdMs || 200}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, holdMs: parseInt(e.target.value) }
                }))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Detection Threshold
                <span className="text-gray-400 ml-2">({((settings.vadSettings?.threshold || 0.02) * 100).toFixed(0)}%)</span>
              </label>
              <input
                type="range"
                min="0.001"
                max="0.1"
                step="0.001"
                value={settings.vadSettings?.threshold || 0.02}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, threshold: parseFloat(e.target.value) }
                }))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Sensitive</span>
                <span>Less Sensitive</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2">
                <span>Adaptive Noise Floor</span>
                <span className="text-gray-400 text-sm">(Auto-adjust to environment)</span>
              </label>
              <input
                type="checkbox"
                checked={settings.vadSettings?.adaptiveNoiseFloor ?? true}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, adaptiveNoiseFloor: e.target.checked }
                }))}
                className="w-4 h-4 rounded"
              />
            </div>
          </div>
        </div>

        {/* Audio Processing Settings */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-purple-400">Audio Processing</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Audio Buffer Size (ms)
                <span className="text-gray-400 ml-2">({settings.audioSettings?.bufferSizeMs || 1000}ms)</span>
              </label>
              <input
                type="range"
                min="100"
                max="5000"
                step="100"
                value={settings.audioSettings?.bufferSizeMs || 1000}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  audioSettings: { ...prev.audioSettings, bufferSizeMs: parseInt(e.target.value) }
                }))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Low latency</span>
                <span>High quality</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-4">
          <button
            onClick={saveSettings}
            disabled={isLoading}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            {isLoading ? 'Saving...' : 'Save Settings'}
          </button>
          
          <button
            onClick={loadSettings}
            className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Reset
          </button>
        </div>

        {/* Status Message */}
        {message && (
          <div className="mt-4 p-4 bg-gray-700 rounded-lg">
            <p className="text-sm">{message}</p>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 bg-blue-900 bg-opacity-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-2 text-blue-400">Getting Started</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
            <li>Get your OpenAI API key from platform.openai.com</li>
            <li>Paste it into the API Key field above</li>
            <li>Customize the system prompt if desired</li>
            <li>Click "Save Settings" to initialize the AI pipeline</li>
            <li>Go back to the main screen and start recording!</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default Settings;