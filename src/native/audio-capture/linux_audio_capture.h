#pragma once

#ifdef LINUX_PLATFORM

#include "audio_capture_base.h"
#include <pulse/simple.h>
#include <thread>
#include <atomic>

namespace AudioCapture {

class LinuxAudioCapture : public AudioCaptureBase {
public:
    LinuxAudioCapture();
    ~LinuxAudioCapture() override;
    
    bool Start() override;
    bool Stop() override;
    bool IsCapturing() const override;
    void SetAudioCallback(AudioCallback callback) override;
    AudioFormat GetFormat() const override;
    std::vector<std::string> GetAvailableDevices() override;
    bool SetDevice(const std::string& deviceId) override;
    float GetVolumeLevel() const override;
    std::string GetLastError() const override;

private:
    pa_simple* stream_;
    std::thread captureThread_;
    std::atomic<bool> shouldStop_;
    
    void CaptureThreadFunction();
    bool InitializePulseAudio();
    void CleanupPulseAudio();
};

} // namespace AudioCapture

#endif // LINUX_PLATFORM