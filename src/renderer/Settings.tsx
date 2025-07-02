import React, { useState, useEffect, useCallback } from 'react';

interface SettingsProps {
  onClose: () => void;
}

interface AppSettings {
  openaiApiKey?: string;
  windowOpacity: number;
  alwaysOnTop: boolean;
  invisibleToRecording: boolean;
  windowWidth: number;
  windowHeight: number;
  theme: 'dark' | 'light';
  autoStart: boolean;
  showInTray: boolean;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<AppSettings>({
    openaiApiKey: '',
    windowOpacity: 1.0,
    alwaysOnTop: true,
    invisibleToRecording: true,
    windowWidth: 800,
    windowHeight: 600,
    theme: 'dark',
    autoStart: false,
    showInTray: true,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Load settings from main process
    const loadSettings = async () => {
      try {
        const loadedSettings = await window.electron.ipcRenderer.invoke('get-settings');
        if (loadedSettings) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSettingChange = useCallback((key: keyof AppSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('save-settings', settings);
      setHasChanges(false);
      
      // Apply window settings immediately
      await window.electron.ipcRenderer.invoke('apply-window-settings', {
        opacity: settings.windowOpacity,
        alwaysOnTop: settings.alwaysOnTop,
        invisibleToRecording: settings.invisibleToRecording
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({
      openaiApiKey: '',
      windowOpacity: 1.0,
      alwaysOnTop: true,
      invisibleToRecording: true,
      windowWidth: 800,
      windowHeight: 600,
      theme: 'dark',
      autoStart: false,
      showInTray: true,
    });
    setHasChanges(true);
  };

  const handleTestApiKey = async () => {
    if (!settings.openaiApiKey?.trim()) {
      alert('Please enter an API key first');
      return;
    }

    try {
      setIsSaving(true);
      const isValid = await window.electron.ipcRenderer.invoke('test-api-key', settings.openaiApiKey);
      if (isValid) {
        alert('✅ API Key is valid!');
      } else {
        alert('❌ API Key is invalid or has no access to GPT-4o Realtime API');
      }
    } catch (error) {
      alert('❌ Failed to test API key');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-white mt-4">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">Settings</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* API Configuration */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">API Configuration</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                OpenAI API Key *
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.openaiApiKey || ''}
                  onChange={(e) => handleSettingChange('openaiApiKey', e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-20"
                />
                <div className="absolute inset-y-0 right-0 flex items-center space-x-1 pr-3">
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="text-gray-400 hover:text-white"
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                  <button
                    type="button"
                    onClick={handleTestApiKey}
                    disabled={isSaving || !settings.openaiApiKey?.trim()}
                    className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-2 py-1 rounded text-white"
                  >
                    Test
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Required for GPT-4o Realtime API access. Stored securely with encryption.
              </p>
            </div>
          </div>

          {/* Window Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Window Settings</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Window Opacity: {Math.round(settings.windowOpacity * 100)}%
              </label>
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.1"
                value={settings.windowOpacity}
                onChange={(e) => handleSettingChange('windowOpacity', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Width</label>
                <input
                  type="number"
                  min="400"
                  max="2000"
                  value={settings.windowWidth}
                  onChange={(e) => handleSettingChange('windowWidth', parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Height</label>
                <input
                  type="number"
                  min="300"
                  max="1500"
                  value={settings.windowHeight}
                  onChange={(e) => handleSettingChange('windowHeight', parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                />
              </div>
            </div>
          </div>

          {/* Privacy & Behavior */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Privacy & Behavior</h3>
            
            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={settings.alwaysOnTop}
                  onChange={(e) => handleSettingChange('alwaysOnTop', e.target.checked)}
                  className="mr-3 h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <span className="text-white">Always stay on top (even over fullscreen apps)</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={settings.invisibleToRecording}
                  onChange={(e) => handleSettingChange('invisibleToRecording', e.target.checked)}
                  className="mr-3 h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <span className="text-white">Hide from screen recording/sharing</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(e) => handleSettingChange('autoStart', e.target.checked)}
                  className="mr-3 h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <span className="text-white">Start automatically with system</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={settings.showInTray}
                  onChange={(e) => handleSettingChange('showInTray', e.target.checked)}
                  className="mr-3 h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <span className="text-white">Show in system tray</span>
              </label>
            </div>
          </div>

          {/* Theme */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Appearance</h3>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Theme</label>
              <select
                value={settings.theme}
                onChange={(e) => handleSettingChange('theme', e.target.value as 'dark' | 'light')}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-700 flex justify-between">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            Reset to Defaults
          </button>
          
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;