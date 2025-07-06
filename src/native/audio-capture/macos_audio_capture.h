#pragma once

#ifdef MACOS_PLATFORM

#include "audio_capture_base.h"
#include <thread>
#include <atomic>

// Forward declarations for Objective-C types
#ifdef __OBJC__
@class SCStream;
@class AudioStreamDelegate;
#else
typedef struct objc_object SCStream;
typedef struct objc_object AudioStreamDelegate;
#endif

// Forward declaration for Core Audio types
struct AudioStreamBasicDescription;

namespace AudioCapture {

class MacOSAudioCapture : public AudioCaptureBase {
public:
    MacOSAudioCapture();
    ~MacOSAudioCapture() override;
    
    bool Start() override;
    bool Stop() override;
    bool IsCapturing() const override;
    void SetAudioCallback(AudioCallback callback) override;
    AudioFormat GetFormat() const override;
    std::vector<std::string> GetAvailableDevices() override;
    bool SetDevice(const std::string& deviceId) override;
    float GetVolumeLevel() const override;
    std::string GetLastError() const override;
    
    // Helper methods for delegate callbacks
    void UpdateFormat(double sampleRate, uint32_t channels, uint32_t bitsPerSample, bool isFloat, bool isNonInterleaved, uint32_t formatFlags);
    float CalculateRMSLevel(const uint8_t* data, size_t length, const AudioStreamBasicDescription* format);
    void SetVolumeLevel(float level);
    void SetLastError(const std::string& error);
    void OnAudioData(const uint8_t* data, size_t length);
    void SetNoiseGateThreshold(float threshold) override;

private:
    SCStream* stream_;
    AudioStreamDelegate* streamDelegate_;
    std::atomic<bool> shouldStop_;
    float noiseGateThreshold_;
    
    void CleanupResources();
};

} // namespace AudioCapture

#endif // MACOS_PLATFORM