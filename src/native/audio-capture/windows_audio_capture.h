#pragma once

#ifdef WINDOWS_PLATFORM

#include "audio_capture_base.h"
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <thread>
#include <atomic>
#include <mutex>
#include <comdef.h>

namespace AudioCapture {

class WindowsAudioCapture : public AudioCaptureBase {
public:
    WindowsAudioCapture();
    ~WindowsAudioCapture() override;
    
    bool Start() override;
    bool Stop() override;
    bool IsCapturing() const override;
    void SetAudioCallback(AudioCallback callback) override;
    AudioFormat GetFormat() const override;
    std::vector<std::string> GetAvailableDevices() override;
    bool SetDevice(const std::string& deviceId) override;
    float GetVolumeLevel() const override;
    std::string GetLastError() const override;
    void SetNoiseGateThreshold(float threshold) override;

private:
    // COM interfaces
    IMMDeviceEnumerator* deviceEnumerator_;
    IMMDevice* device_;
    IAudioClient* audioClient_;
    IAudioCaptureClient* captureClient_;
    IAudioEndpointVolume* endpointVolume_;
    
    // Capture thread
    std::thread captureThread_;
    std::atomic<bool> shouldStop_;
    std::mutex callbackMutex_;
    
    // Audio format
    WAVEFORMATEX* deviceFormat_;
    
    // Helper methods
    bool InitializeCOM();
    bool InitializeDevice();
    bool InitializeAudioClient();
    void CaptureThreadFunction();
    void CleanupCOM();
    AudioFormat WaveFormatToAudioFormat(const WAVEFORMATEX* wf);
    std::string GetCOMErrorString(HRESULT hr);
    void UpdateVolumeLevel();
    
    // Constants
    static constexpr DWORD CAPTURE_BUFFER_SIZE_MS = 100;
    static constexpr DWORD POLL_INTERVAL_MS = 10;
};

} // namespace AudioCapture

#endif // WINDOWS_PLATFORM