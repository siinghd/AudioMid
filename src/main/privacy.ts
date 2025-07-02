import { BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'path';

export class PrivacyManager {
  private window: BrowserWindow | null = null;
  private isPrivacyEnabled = true; // Privacy ON by default
  private windowPrivacy: any = null;

  constructor() {
    // Initialize privacy manager
    
    // Load native module if available
    const candidatePaths: string[] = [
      // Development paths - webpack bundles to .erb/dll
      path.join(__dirname, '../../../build/window_privacy.node'),
      path.join(__dirname, '../../../../build/window_privacy.node'),
      // Standard paths
      path.join(__dirname, '../../build/window_privacy.node'),
      path.join(__dirname, '../../build/Release/window_privacy.node'),
      path.join(__dirname, '../../build/Debug/window_privacy.node'),
      path.join(__dirname, '../..', 'build/window_privacy.node'),
      // Absolute paths
      path.resolve(process.cwd(), 'build/window_privacy.node'),
      path.resolve(process.cwd(), 'build/Release/window_privacy.node'),
    ];

    /* eslint-disable no-restricted-syntax */
    const fs = require('fs');
    for (const p of candidatePaths) {
      try {
        // Check if file exists first
        if (fs.existsSync(p)) {
          // Found window_privacy.node
          // eslint-disable-next-line global-require, import/no-dynamic-require
          const nativeModule = require(p);
          if (nativeModule?.WindowPrivacy) {
            this.windowPrivacy = new nativeModule.WindowPrivacy();
            // Native window privacy module loaded
            break;
          }
        }
      } catch (e: any) {
        // Only log non-MODULE_NOT_FOUND errors
        if (e.code !== 'MODULE_NOT_FOUND') {
          console.warn(`Failed to load window_privacy module at ${p}:`, e);
        }
      }
    }
    /* eslint-enable no-restricted-syntax */

    if (!this.windowPrivacy) {
      console.warn(
        '⚠️ Native window privacy module not available, using fallback methods',
      );
    }

    // Register IPC handlers
    ipcMain.handle('toggle-privacy-mode', () => this.togglePrivacyMode());
    ipcMain.handle('get-privacy-status', () => this.isPrivacyEnabled);
  }

  setWindow(window: BrowserWindow) {
    this.window = window;

    // Enable privacy by default
    this.enablePrivacy().then(() => {
      // Privacy mode enabled by default
    });

    // Register global shortcut for quick toggle (Cmd/Ctrl + Shift + H)
    const shortcut =
      process.platform === 'darwin' ? 'Cmd+Shift+H' : 'Ctrl+Shift+H';
    globalShortcut.register(shortcut, () => {
      this.togglePrivacyMode();
    });
  }

  async togglePrivacyMode() {
    if (!this.window) return false;

    if (this.isPrivacyEnabled) {
      this.disablePrivacy();
    } else {
      await this.enablePrivacy();
    }

    return this.isPrivacyEnabled;
  }

  private async enablePrivacy() {
    if (!this.window || this.window.isDestroyed()) return;

    try {
      // Try native module first
      if (this.windowPrivacy) {
        const hwnd = this.window.getNativeWindowHandle();
        const result = this.windowPrivacy.setInvisibleToCapture(hwnd);
        if (result) {
          this.isPrivacyEnabled = true;
          this.window.webContents.send('privacy-mode-changed', true);
          // Privacy mode enabled via native module
          return;
        }
      }

      // Fallback to platform-specific methods
      if (process.platform === 'darwin') {
        await this.setMacOSPrivacy(true);
      } else if (process.platform === 'win32') {
        await this.setWindowsPrivacy(true);
      } else {
        await this.setLinuxPrivacy(true);
      }

      this.isPrivacyEnabled = true;
      this.window.webContents.send('privacy-mode-changed', true);
      // Privacy mode enabled - window is invisible to screen capture
    } catch (error) {
      console.error('Failed to enable privacy mode:', error);
    }
  }

  private disablePrivacy() {
    if (!this.window || this.window.isDestroyed()) return;

    try {
      // Try native module first
      if (this.windowPrivacy) {
        const hwnd = this.window.getNativeWindowHandle();
        const result = this.windowPrivacy.restoreVisibility(hwnd);
        if (result) {
          this.isPrivacyEnabled = false;
          this.window.webContents.send('privacy-mode-changed', false);
          // Privacy mode disabled via native module
          return;
        }
      }

      // Fallback to platform-specific methods
      if (process.platform === 'darwin') {
        this.setMacOSPrivacy(false);
      } else if (process.platform === 'win32') {
        this.setWindowsPrivacy(false);
      } else {
        this.setLinuxPrivacy(false);
      }

      this.isPrivacyEnabled = false;
      this.window.webContents.send('privacy-mode-changed', false);
      // Privacy mode disabled - window is visible in screen capture
    } catch (error) {
      console.error('Failed to disable privacy mode:', error);
    }
  }

  private async setMacOSPrivacy(enable: boolean): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;

    try {
      // Use Electron's built-in content protection API (macOS 10.14+)
      // This is the official way to exclude windows from screen capture
      (this.window as any).setContentProtection(enable);
      console.log(`✅ Content protection ${enable ? 'enabled' : 'disabled'} - window is ${enable ? 'invisible' : 'visible'} to screen capture`);
      
      // Optional: Keep window on top for better visibility
      if (enable) {
        this.window.setAlwaysOnTop(true, 'floating');
      } else {
        this.window.setAlwaysOnTop(false);
      }
    } catch (error: any) {
      // Only log error if it's not due to destroyed window
      if (!error.message?.includes('Object has been destroyed')) {
        console.error('Failed to set content protection:', error);
      }
      
      // Fallback for older Electron versions (only if window still exists)
      if (!this.window.isDestroyed()) {
        try {
          if (enable) {
            this.window.setAlwaysOnTop(true, 'screen-saver', 1);
            this.window.setVisibleOnAllWorkspaces(true, {
              visibleOnFullScreen: true,
            });
          } else {
            this.window.setAlwaysOnTop(false);
            this.window.setVisibleOnAllWorkspaces(false);
          }
        } catch (fallbackError) {
          // Ignore errors during cleanup
        }
      }
    }
  }

  private async setWindowsPrivacy(enable: boolean): Promise<void> {
    if (!this.window) return;

    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const handle = this.window.getNativeWindowHandle();
      const hwnd = handle.readBigUInt64LE();

      if (enable) {
        // Use WDA_EXCLUDEFROMCAPTURE (0x11) on Windows 10 2004+
        // This makes window invisible to screen capture but visible to user
        const script = `
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
            
            public const uint WDA_NONE = 0x00;
            public const uint WDA_MONITOR = 0x01;
            public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
          }
"@
          
          $hwnd = [IntPtr]${hwnd}
          $result = [Win32]::SetWindowDisplayAffinity($hwnd, [Win32]::WDA_EXCLUDEFROMCAPTURE)
          
          if (-not $result) {
            # Fallback to WDA_MONITOR for older Windows
            [Win32]::SetWindowDisplayAffinity($hwnd, [Win32]::WDA_MONITOR)
          }
        `;

        await execAsync(`powershell -Command "${script}"`);
      } else {
        // Restore normal visibility
        const script = `
          Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity); }'
          [Win32]::SetWindowDisplayAffinity([IntPtr]${hwnd}, 0)
        `;

        await execAsync(`powershell -Command "${script}"`);
      }
    } catch (error) {
      console.warn('Failed to set Windows privacy:', error);
    }
  }

  private async setLinuxPrivacy(enable: boolean): Promise<void> {
    if (!this.window) return;

    if (enable) {
      // Linux: Use a combination of techniques
      // Store original bounds
      const bounds = this.window.getBounds();
      (this.window as any).__originalBounds = bounds;

      // Try to make window skip taskbar and pager
      this.window.setSkipTaskbar(true);

      // Move to a corner with minimal size
      this.window.setBounds({
        x: -1,
        y: -1,
        width: 1,
        height: 1,
      });

      // Keep it on top but try to be invisible
      this.window.setAlwaysOnTop(true, 'dock');
    } else {
      // Restore normal behavior
      this.window.setSkipTaskbar(false);
      this.window.setAlwaysOnTop(false);

      // Restore original bounds
      const originalBounds = (this.window as any).__originalBounds;
      if (originalBounds) {
        this.window.setBounds(originalBounds);
        delete (this.window as any).__originalBounds;
      } else {
        this.window.center();
      }
    }
  }

  cleanup() {
    // Restore window visibility before cleanup
    if (this.isPrivacyEnabled) {
      this.disablePrivacy();
    }

    // Unregister shortcuts
    globalShortcut.unregisterAll();
  }
}
