#ifdef LINUX_PLATFORM

#include "linux_audio_capture.h"
#include <pulse/error.h>
#include <cstring>

namespace AudioCapture {

LinuxAudioCapture::LinuxAudioCapture()
    : stream_(nullptr)
    , shouldStop_(false) {
    
    // Initialize default format
    currentFormat_.sampleRate = 48000;
    currentFormat_.channels = 2;
    currentFormat_.bitsPerSample = 32;
    currentFormat_.bytesPerFrame = 8;
    currentFormat_.blockAlign = 8;
}

LinuxAudioCapture::~LinuxAudioCapture() {
    Stop();
    CleanupPulseAudio();
}

bool LinuxAudioCapture::Start() {
    if (isCapturing_) return true;
    
    // TODO: Implement PulseAudio monitor capture
    // For now, return a stub implementation
    lastError_ = "Linux audio capture not yet implemented";
    return false;
    
    /*
    // Future implementation will use PulseAudio:
    
    if (!InitializePulseAudio()) {
        return false;
    }
    
    shouldStop_ = false;
    captureThread_ = std::thread(&LinuxAudioCapture::CaptureThreadFunction, this);
    isCapturing_ = true;
    return true;
    */
}

bool LinuxAudioCapture::Stop() {
    if (!isCapturing_) return true;
    
    shouldStop_ = true;
    
    if (captureThread_.joinable()) {
        captureThread_.join();
    }
    
    isCapturing_ = false;
    return true;
}

bool LinuxAudioCapture::IsCapturing() const {
    return isCapturing_;
}

void LinuxAudioCapture::SetAudioCallback(AudioCallback callback) {
    audioCallback_ = callback;
}

AudioFormat LinuxAudioCapture::GetFormat() const {
    return currentFormat_;
}

std::vector<std::string> LinuxAudioCapture::GetAvailableDevices() {
    // TODO: Implement device enumeration
    return {"Default Monitor"};
}

bool LinuxAudioCapture::SetDevice(const std::string& deviceId) {
    // TODO: Implement device selection
    return true;
}

float LinuxAudioCapture::GetVolumeLevel() const {
    return currentVolumeLevel_;
}

std::string LinuxAudioCapture::GetLastError() const {
    return lastError_;
}

void LinuxAudioCapture::SetNoiseGateThreshold(float threshold) {
    // Linux PulseAudio doesn't have a built-in noise gate like macOS ScreenCaptureKit
    // This is a no-op for Linux - noise gating will be handled in JavaScript VAD
    // Clear any previous errors
    lastError_ = "";
}

void LinuxAudioCapture::CaptureThreadFunction() {
    // TODO: Implement actual capture loop using PulseAudio
    /*
    // Future implementation:
    static const size_t BUFFER_SIZE = 4096;
    float buffer[BUFFER_SIZE];
    
    while (!shouldStop_) {
        int error;
        if (pa_simple_read(stream_, buffer, sizeof(buffer), &error) < 0) {
            lastError_ = std::string("pa_simple_read() failed: ") + pa_strerror(error);
            break;
        }
        
        if (audioCallback_) {
            AudioSample sample;
            sample.data.resize(sizeof(buffer));
            std::memcpy(sample.data.data(), buffer, sizeof(buffer));
            sample.format = currentFormat_;
            sample.frameCount = BUFFER_SIZE / currentFormat_.channels;
            sample.timestamp = GetCurrentTimestamp();
            
            audioCallback_(sample);
        }
    }
    */
    
    while (!shouldStop_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

bool LinuxAudioCapture::InitializePulseAudio() {
    // TODO: Implement PulseAudio initialization
    /*
    // Future implementation:
    pa_sample_spec spec = {
        .format = PA_SAMPLE_FLOAT32LE,
        .rate = 48000,
        .channels = 2
    };
    
    // Connect to monitor of default sink
    stream_ = pa_simple_new(
        nullptr,                // Server
        "AI Audio Assistant",   // App name
        PA_STREAM_RECORD,       // Direction
        "@DEFAULT_MONITOR@",    // Device (monitor source)
        "System Audio",         // Stream name
        &spec,                  // Sample spec
        nullptr,                // Channel map
        nullptr,                // Buffer attr
        nullptr                 // Error
    );
    
    if (!stream_) {
        lastError_ = "Failed to create PulseAudio stream";
        return false;
    }
    
    return true;
    */
    
    return false;
}

void LinuxAudioCapture::CleanupPulseAudio() {
    if (stream_) {
        pa_simple_free(stream_);
        stream_ = nullptr;
    }
}

} // namespace AudioCapture

#endif // LINUX_PLATFORM