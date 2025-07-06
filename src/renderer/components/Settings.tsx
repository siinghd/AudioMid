/**
 * Settings component for configuring OpenAI API key and other options
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

interface AppSettings {
  openaiApiKey?: string;
  geminiApiKey?: string;
  aiProvider: 'openai' | 'gemini';
  systemPrompt?: string;
  windowOpacity: number;
  alwaysOnTop: boolean;
  invisibleToRecording: boolean;
  vadSettings?: {
    releaseMs: number;
    holdMs: number;
    threshold: number;
    adaptiveNoiseFloor: boolean;
    aggressiveness: 0 | 1 | 2 | 3;
    noiseFloorAlpha: number;
    noiseFloorRatio: number;
    silenceTimeoutMs: number;
    turnManagementMode: 'internal-vad' | 'external-timeout';
  };
  audioSettings?: {
    bufferSizeMs: number;
    enableVAD: boolean;
  };
  geminiSettings?: {
    model: 'gemini-2.5-flash-preview-native-audio-dialog' | 'gemini-live-2.5-flash-preview' | 'gemini-2.0-flash-live-001';
    audioArchitecture: 'native' | 'half-cascade';
    responseModalities: string[];
  };
  debugSettings?: {
    dumpNativeAudio: boolean;
    dumpOpenAIRawAudio: boolean;
    dumpOpenAIApiAudio: boolean;
  };
  transcriptSettings?: {
    enabled: boolean;
  };
}

function Settings(): React.ReactElement {
  const navigate = useNavigate();
  const { theme, toggleTheme, isDark } = useTheme();
  const [settings, setSettings] = useState<AppSettings>({
    aiProvider: 'openai',
    windowOpacity: 1.0,
    alwaysOnTop: true,
    invisibleToRecording: true,
    vadSettings: {
      releaseMs: 2000,
      holdMs: 200,
      threshold: 0.02,
      adaptiveNoiseFloor: true,
      aggressiveness: 3,
      noiseFloorAlpha: 0.95,
      noiseFloorRatio: 2.0,
      silenceTimeoutMs: 1200,
      turnManagementMode: 'internal-vad',
    },
    audioSettings: {
      bufferSizeMs: 1000,
      enableVAD: true,
    },
    geminiSettings: {
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
      audioArchitecture: 'native',
      responseModalities: ['AUDIO'],
    },
    debugSettings: {
      dumpNativeAudio: false,
      dumpOpenAIRawAudio: false,
      dumpOpenAIApiAudio: false,
    },
    transcriptSettings: {
      enabled: true,
    },
  });
  const [apiKey, setApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = await window.electronAPI.getSettings();
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
          debugSettings: {
            ...settings.debugSettings,
            ...savedSettings.debugSettings,
          },
          transcriptSettings: {
            ...settings.transcriptSettings,
            ...savedSettings.transcriptSettings,
          },
        });
        setApiKey(savedSettings.openaiApiKey || '');
        setGeminiApiKey(savedSettings.geminiApiKey || '');
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
      // Validate API key formats
      if (settings.aiProvider === 'openai' && apiKey && !apiKey.startsWith('sk-')) {
        setMessage('❌ Invalid OpenAI API key format. OpenAI API keys start with "sk-"');
        setIsLoading(false);
        return;
      }
      
      if (settings.aiProvider === 'gemini' && geminiApiKey && !geminiApiKey.startsWith('AI')) {
        setMessage('❌ Invalid Gemini API key format. Gemini API keys typically start with "AI"');
        setIsLoading(false);
        return;
      }

      // Save settings to database
      const success = await window.electronAPI.saveSettings({
        ...settings,
        openaiApiKey: apiKey,
        geminiApiKey: geminiApiKey,
        systemPrompt: systemPrompt,
      });

      if (success) {
        // Apply settings immediately
        let hasWarning = false;
        let warningMessage = '';

        // Apply window settings immediately
        try {
          await window.electronAPI.applyWindowSettings({
            opacity: settings.windowOpacity,
            alwaysOnTop: settings.alwaysOnTop,
            invisibleToRecording: settings.invisibleToRecording
          });
        } catch (error) {
          console.error('Failed to apply window settings:', error);
        }

        // Apply VAD settings immediately if we have them
        if (settings.vadSettings) {
          try {
            const vadResult = await window.electronAPI.updateVADSettings(settings.vadSettings);
            if (!vadResult.success) {
              console.warn('Failed to apply VAD settings:', vadResult.error);
            }
          } catch (error) {
            console.error('Failed to apply VAD settings:', error);
          }
        }

        // Apply audio settings immediately if we have them
        if (settings.audioSettings) {
          try {
            const audioResult = await window.electronAPI.updateAudioSettings(settings.audioSettings);
            if (!audioResult.success) {
              console.warn('Failed to apply audio settings:', audioResult.error);
            } else if (audioResult.restartRequired) {
              hasWarning = true;
              warningMessage = ' Audio buffer changes require app restart to take effect.';
            }
          } catch (error) {
            console.error('Failed to apply audio settings:', error);
          }
        }

        // Apply debug settings immediately if we have them
        if (settings.debugSettings) {
          try {
            const debugResult = await window.electronAPI.updateDebugSettings(settings.debugSettings);
            if (!debugResult.success) {
              console.warn('Failed to apply debug settings:', debugResult.error);
            }
          } catch (error) {
            console.error('Failed to apply debug settings:', error);
          }
        }

        // Reinitialize pipeline if API key was provided
        const currentApiKey = settings.aiProvider === 'openai' ? apiKey : geminiApiKey;
        if (currentApiKey) {
          try {
            const pipelineSuccess = await window.electronAPI.initializePipeline(
              currentApiKey,
              systemPrompt,
              settings.aiProvider
            );
            
            if (pipelineSuccess) {
              setMessage(`✅ Settings saved and ${settings.aiProvider === 'openai' ? 'OpenAI' : 'Gemini'} pipeline initialized successfully!${warningMessage}`);
            } else {
              setMessage(`⚠️ Settings saved but ${settings.aiProvider === 'openai' ? 'OpenAI' : 'Gemini'} pipeline initialization failed. Check your API key.${warningMessage}`);
            }
          } catch (error) {
            console.error('Failed to initialize pipeline:', error);
            setMessage(`✅ Settings saved successfully!${warningMessage} Pipeline initialization failed.`);
          }
        } else {
          setMessage(`✅ Settings saved successfully!${warningMessage}`);
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
    setMessage('Testing OpenAI API key...');

    try {
      const isValid = await window.electronAPI.testApiKey(apiKey);
      if (isValid) {
        setMessage('✅ OpenAI API key format looks valid');
      } else {
        setMessage('❌ Invalid OpenAI API key format');
      }
    } catch (error) {
      setMessage('❌ Failed to test OpenAI API key');
    } finally {
      setIsLoading(false);
    }
  };

  const testGeminiApiKey = async () => {
    if (!geminiApiKey) {
      setMessage('Please enter a Gemini API key first');
      return;
    }

    setIsLoading(true);
    setMessage('Testing Gemini API key...');

    try {
      // For now, just validate the format since we don't have the test function yet
      if (geminiApiKey.length > 20) {
        setMessage('✅ Gemini API key format looks valid');
      } else {
        setMessage('❌ Gemini API key seems too short');
      }
    } catch (error) {
      setMessage('❌ Failed to test Gemini API key');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`w-full h-screen ${isDark ? 'bg-audiomind-black' : 'bg-audiomind-white'} ${isDark ? 'text-audiomind-white' : 'text-audiomind-black'} overflow-y-auto`}>
      <div className="max-w-2xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              type="button"
              onClick={() => navigate('/')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                isDark 
                  ? 'bg-audiomind-gray-900 text-audiomind-gray-300 hover:bg-audiomind-gray-800 hover:text-audiomind-white' 
                  : 'bg-audiomind-gray-100 text-audiomind-gray-700 hover:bg-audiomind-gray-200 hover:text-audiomind-black'
              }`}
            >
              ← Back
            </button>
            <h1 className="text-2xl font-medium">AudioMind Settings</h1>
          </div>
        </div>

        {/* Appearance Settings */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Appearance</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Theme</label>
              <button
                onClick={toggleTheme}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isDark 
                    ? 'bg-audiomind-gray-900 text-audiomind-gray-300 hover:bg-audiomind-gray-800' 
                    : 'bg-audiomind-gray-100 text-audiomind-gray-700 hover:bg-audiomind-gray-200'
                }`}
              >
                <span>{isDark ? 'Dark' : 'Light'}</span>
                {isDark ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* AI Provider Selection */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>AI Provider</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Choose AI Provider</label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setSettings(prev => ({ ...prev, aiProvider: 'openai' }))}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.aiProvider === 'openai'
                      ? isDark
                        ? 'border-audiomind-white bg-audiomind-gray-900 text-audiomind-white'
                        : 'border-audiomind-black bg-audiomind-gray-100 text-audiomind-black'
                      : isDark
                        ? 'border-audiomind-gray-800 text-audiomind-gray-400 hover:border-audiomind-gray-700'
                        : 'border-audiomind-gray-300 text-audiomind-gray-600 hover:border-audiomind-gray-400'
                  }`}
                >
                  <div className="text-left">
                    <div className="font-medium">OpenAI</div>
                    <div className="text-xs mt-1 opacity-75">GPT-4o Realtime API</div>
                  </div>
                </button>
                
                <button
                  onClick={() => setSettings(prev => ({ ...prev, aiProvider: 'gemini' }))}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.aiProvider === 'gemini'
                      ? isDark
                        ? 'border-audiomind-white bg-audiomind-gray-900 text-audiomind-white'
                        : 'border-audiomind-black bg-audiomind-gray-100 text-audiomind-black'
                      : isDark
                        ? 'border-audiomind-gray-800 text-audiomind-gray-400 hover:border-audiomind-gray-700'
                        : 'border-audiomind-gray-300 text-audiomind-gray-600 hover:border-audiomind-gray-400'
                  }`}
                >
                  <div className="text-left">
                    <div className="font-medium">Google Gemini</div>
                    <div className="text-xs mt-1 opacity-75">Live API with native audio</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* AI Configuration */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>
            {settings.aiProvider === 'openai' ? 'OpenAI Configuration' : 'Google Gemini Configuration'}
          </h2>
          
          <div className="space-y-4">
            {settings.aiProvider === 'openai' ? (
              <div>
                <label className="block text-sm font-medium mb-2">
                  OpenAI API Key <span className="text-red-500">*</span>
                </label>
                <div className="flex space-x-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 ${
                      isDark 
                        ? 'bg-audiomind-gray-950 border-audiomind-gray-800 text-audiomind-white placeholder-audiomind-gray-500 focus:ring-audiomind-white' 
                        : 'bg-audiomind-white border-audiomind-gray-300 text-audiomind-black placeholder-audiomind-gray-400 focus:ring-audiomind-black'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={testApiKey}
                    disabled={isLoading || !apiKey}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      isLoading || !apiKey
                        ? 'opacity-50 cursor-not-allowed'
                        : isDark
                          ? 'bg-audiomind-white text-audiomind-black hover:bg-audiomind-gray-100'
                          : 'bg-audiomind-black text-audiomind-white hover:bg-audiomind-gray-900'
                    }`}
                  >
                    Test
                  </button>
                </div>
                <p className={`text-xs mt-2 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                  Get your API key from platform.openai.com/api-keys
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Gemini API Key <span className="text-red-500">*</span>
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="AIza..."
                      className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 ${
                        isDark 
                          ? 'bg-audiomind-gray-950 border-audiomind-gray-800 text-audiomind-white placeholder-audiomind-gray-500 focus:ring-audiomind-white' 
                          : 'bg-audiomind-white border-audiomind-gray-300 text-audiomind-black placeholder-audiomind-gray-400 focus:ring-audiomind-black'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => testGeminiApiKey()}
                      disabled={isLoading || !geminiApiKey}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        isLoading || !geminiApiKey
                          ? 'opacity-50 cursor-not-allowed'
                          : isDark
                            ? 'bg-audiomind-white text-audiomind-black hover:bg-audiomind-gray-100'
                            : 'bg-audiomind-black text-audiomind-white hover:bg-audiomind-gray-900'
                      }`}
                    >
                      Test
                    </button>
                  </div>
                  <p className={`text-xs mt-2 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                    Get your API key from aistudio.google.com
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Gemini Model</label>
                  <select
                    value={settings.geminiSettings?.model || 'gemini-2.5-flash-preview-native-audio-dialog'}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      geminiSettings: {
                        ...prev.geminiSettings!,
                        model: e.target.value as any,
                        audioArchitecture: e.target.value.includes('native-audio') ? 'native' : 'half-cascade'
                      }
                    }))}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 ${
                      isDark 
                        ? 'bg-audiomind-gray-950 border-audiomind-gray-800 text-audiomind-white focus:ring-audiomind-white' 
                        : 'bg-audiomind-white border-audiomind-gray-300 text-audiomind-black focus:ring-audiomind-black'
                    }`}
                  >
                    <option value="gemini-2.5-flash-preview-native-audio-dialog">Gemini 2.5 Flash (Native Audio)</option>
                    <option value="gemini-live-2.5-flash-preview">Gemini Live 2.5 Flash (Half-Cascade)</option>
                    <option value="gemini-2.0-flash-live-001">Gemini 2.0 Flash Live (Half-Cascade)</option>
                  </select>
                  <p className={`text-xs mt-2 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                    Native audio provides more natural speech, half-cascade offers better tool use
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful AI assistant..."
                rows={3}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-vertical ${
                  isDark 
                    ? 'bg-audiomind-gray-950 border-audiomind-gray-800 text-audiomind-white placeholder-audiomind-gray-500 focus:ring-audiomind-white' 
                    : 'bg-audiomind-white border-audiomind-gray-300 text-audiomind-black placeholder-audiomind-gray-400 focus:ring-audiomind-black'
                }`}
              />
              <p className={`text-xs mt-2 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                Customize how the AI assistant should behave and respond
              </p>
            </div>
          </div>
        </div>

        {/* Window Settings */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Window Settings</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Always on Top</label>
              <input
                type="checkbox"
                checked={settings.alwaysOnTop}
                onChange={(e) => setSettings(prev => ({ ...prev, alwaysOnTop: e.target.checked }))}
                className="w-4 h-4 rounded"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Invisible to Screen Recording</label>
              <input
                type="checkbox"
                checked={settings.invisibleToRecording}
                onChange={(e) => setSettings(prev => ({ ...prev, invisibleToRecording: e.target.checked }))}
                className="w-4 h-4 rounded"
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
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Voice Activity Detection */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Voice Activity Detection</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Enable VAD</label>
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
                Silence Duration: {settings.vadSettings?.releaseMs || 2000}ms
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
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Voice Hold Duration: {settings.vadSettings?.holdMs || 200}ms
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
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Detection Threshold: {((settings.vadSettings?.threshold || 0.02) * 100).toFixed(0)}%
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
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Adaptive Noise Floor</label>
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

            <div>
              <label className="block text-sm font-medium mb-2">
                VAD Aggressiveness: {settings.vadSettings?.aggressiveness ?? 3}
              </label>
              <input
                type="range"
                min="0"
                max="3"
                step="1"
                value={settings.vadSettings?.aggressiveness ?? 3}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, aggressiveness: parseInt(e.target.value) as 0 | 1 | 2 | 3 }
                }))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
              <div className={`flex justify-between text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                <span>Conservative</span>
                <span>Most aggressive</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Noise Floor Alpha: {(settings.vadSettings?.noiseFloorAlpha ?? 0.95).toFixed(2)}
              </label>
              <input
                type="range"
                min="0.90"
                max="0.99"
                step="0.01"
                value={settings.vadSettings?.noiseFloorAlpha ?? 0.95}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, noiseFloorAlpha: parseFloat(e.target.value) }
                }))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
              <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                Smoothing factor for noise floor adaptation (higher = slower adaptation)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Noise Floor Ratio: {(settings.vadSettings?.noiseFloorRatio ?? 2.0).toFixed(1)}x
              </label>
              <input
                type="range"
                min="1.5"
                max="3.0"
                step="0.1"
                value={settings.vadSettings?.noiseFloorRatio ?? 2.0}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, noiseFloorRatio: parseFloat(e.target.value) }
                }))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
              <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                Multiplier above noise floor to detect speech
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Silence Timeout: {settings.vadSettings?.silenceTimeoutMs ?? 1200}ms
              </label>
              <input
                type="range"
                min="500"
                max="3000"
                step="100"
                value={settings.vadSettings?.silenceTimeoutMs ?? 1200}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  vadSettings: { ...prev.vadSettings!, silenceTimeoutMs: parseInt(e.target.value) }
                }))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
              <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                Force stop speech detection after this silence duration
              </p>
            </div>

            {/* Only show turn management for OpenAI - Gemini doesn't have external turn management */}
            {settings.aiProvider === 'openai' && (
              <div>
                <label className="block text-sm font-medium mb-2">Turn Management Mode</label>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => setSettings(prev => ({
                      ...prev,
                      vadSettings: { ...prev.vadSettings!, turnManagementMode: 'internal-vad' }
                    }))}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      (settings.vadSettings?.turnManagementMode ?? 'internal-vad') === 'internal-vad'
                        ? isDark
                          ? 'border-audiomind-white bg-audiomind-gray-900 text-audiomind-white'
                          : 'border-audiomind-black bg-audiomind-gray-100 text-audiomind-black'
                        : isDark
                          ? 'border-audiomind-gray-800 text-audiomind-gray-400 hover:border-audiomind-gray-700'
                          : 'border-audiomind-gray-300 text-audiomind-gray-600 hover:border-audiomind-gray-400'
                    }`}
                  >
                    <div className="font-medium">Internal VAD</div>
                    <div className="text-xs mt-1 opacity-75">Use our VAD system for turn management (recommended)</div>
                  </button>
                  
                  <button
                    onClick={() => setSettings(prev => ({
                      ...prev,
                      vadSettings: { ...prev.vadSettings!, turnManagementMode: 'external-timeout' }
                    }))}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      (settings.vadSettings?.turnManagementMode ?? 'internal-vad') === 'external-timeout'
                        ? isDark
                          ? 'border-audiomind-white bg-audiomind-gray-900 text-audiomind-white'
                          : 'border-audiomind-black bg-audiomind-gray-100 text-audiomind-black'
                        : isDark
                          ? 'border-audiomind-gray-800 text-audiomind-gray-400 hover:border-audiomind-gray-700'
                          : 'border-audiomind-gray-300 text-audiomind-gray-600 hover:border-audiomind-gray-400'
                    }`}
                  >
                    <div className="font-medium">OpenAI Server VAD</div>
                    <div className="text-xs mt-1 opacity-75">Let OpenAI's server manage turns with built-in VAD</div>
                  </button>
                </div>
                <p className={`text-xs mt-2 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                  OpenAI supports both internal VAD and server-side turn management
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Transcript Settings */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Speech Recognition</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Enable Live Transcript</label>
                <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                  Show real-time speech-to-text using Whisper AI
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.transcriptSettings?.enabled ?? true}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  transcriptSettings: { ...prev.transcriptSettings, enabled: e.target.checked }
                }))}
                className="w-4 h-4 rounded"
              />
            </div>
            <p className={`text-xs ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
              When enabled, shows your spoken words in real-time for both OpenAI and Gemini. 
              Uses OpenAI's Whisper for high-accuracy transcription.
            </p>
          </div>
        </div>

        {/* Audio Processing */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Audio Processing</h2>
          
          <div>
            <label className="block text-sm font-medium mb-2">
              Audio Buffer Size: {settings.audioSettings?.bufferSizeMs || 1000}ms
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
              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
            />
            <div className={`flex justify-between text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
              <span>Low latency</span>
              <span>High quality</span>
            </div>
          </div>
        </div>

        {/* Audio Debugging */}
        <div className={`border rounded-lg p-6 mb-6 ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'}`}>
          <h2 className={`text-lg font-medium mb-4 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Audio Debugging</h2>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Dump Native Audio</label>
                <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                  Save raw 48kHz stereo float32 audio from native capture
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.debugSettings?.dumpNativeAudio ?? false}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  debugSettings: { ...prev.debugSettings!, dumpNativeAudio: e.target.checked }
                }))}
                className="w-4 h-4 rounded"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Dump OpenAI Raw Audio</label>
                <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                  Save pre-processed audio before resampling to 24kHz
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.debugSettings?.dumpOpenAIRawAudio ?? false}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  debugSettings: { ...prev.debugSettings!, dumpOpenAIRawAudio: e.target.checked }
                }))}
                className="w-4 h-4 rounded"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Dump OpenAI API Audio</label>
                <p className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-600'}`}>
                  Save 24kHz mono PCM16 audio sent to OpenAI API
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.debugSettings?.dumpOpenAIApiAudio ?? false}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  debugSettings: { ...prev.debugSettings!, dumpOpenAIApiAudio: e.target.checked }
                }))}
                className="w-4 h-4 rounded"
              />
            </div>

            <p className={`text-xs mt-4 p-3 rounded ${isDark ? 'bg-audiomind-gray-950 text-audiomind-gray-400' : 'bg-audiomind-gray-50 text-audiomind-gray-600'}`}>
              Audio dumps are saved to the application directory with timestamps. Use ffplay to play them back.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-4 mb-6">
          <button
            onClick={saveSettings}
            disabled={isLoading}
            className={`flex-1 py-3 px-6 rounded-lg font-medium transition-colors ${
              isLoading
                ? 'opacity-50 cursor-not-allowed'
                : isDark
                  ? 'bg-audiomind-white text-audiomind-black hover:bg-audiomind-gray-100'
                  : 'bg-audiomind-black text-audiomind-white hover:bg-audiomind-gray-900'
            }`}
          >
            {isLoading ? 'Saving...' : 'Save Settings'}
          </button>
          
          <button
            onClick={loadSettings}
            className={`py-3 px-6 rounded-lg font-medium transition-colors ${
              isDark 
                ? 'bg-audiomind-gray-900 text-audiomind-gray-300 hover:bg-audiomind-gray-800 hover:text-audiomind-white' 
                : 'bg-audiomind-gray-100 text-audiomind-gray-700 hover:bg-audiomind-gray-200 hover:text-audiomind-black'
            }`}
          >
            Reset
          </button>
        </div>

        {/* Status Message */}
        {message && (
          <div className={`p-4 rounded-lg mb-6 ${
            isDark ? 'bg-audiomind-gray-900' : 'bg-audiomind-gray-100'
          }`}>
            <p className="text-sm">{message}</p>
          </div>
        )}

        {/* Instructions */}
        <div className={`rounded-lg p-6 ${
          isDark ? 'bg-audiomind-gray-950 border border-audiomind-gray-900' : 'bg-audiomind-gray-50 border border-audiomind-gray-200'
        }`}>
          <h3 className={`text-lg font-medium mb-3 ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}>Getting Started</h3>
          <ol className={`list-decimal list-inside space-y-2 text-sm ${isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'}`}>
            <li>Get your OpenAI API key from platform.openai.com</li>
            <li>Paste it into the API Key field above</li>
            <li>Customize the system prompt if desired</li>
            <li>Click "Save Settings" to store your configuration</li>
            <li>Go back to the main screen and start recording!</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default Settings;