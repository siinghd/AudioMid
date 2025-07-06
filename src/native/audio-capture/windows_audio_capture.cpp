#ifdef WINDOWS_PLATFORM

#include "windows_audio_capture.h"
#include <chrono>
#include <sstream>
#include <iomanip>

namespace AudioCapture {

WindowsAudioCapture::WindowsAudioCapture()
    : deviceEnumerator_(nullptr)
    , device_(nullptr)
    , audioClient_(nullptr)
    , captureClient_(nullptr)
    , endpointVolume_(nullptr)
    , shouldStop_(false)
    , deviceFormat_(nullptr) {
    
    InitializeCOM();
}

WindowsAudioCapture::~WindowsAudioCapture() {
    Stop();
    CleanupCOM();
}

bool WindowsAudioCapture::InitializeCOM() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
        lastError_ = "Failed to initialize COM: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Create device enumerator
    hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        reinterpret_cast<void**>(&deviceEnumerator_)
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to create device enumerator: " + GetCOMErrorString(hr);
        return false;
    }
    
    return InitializeDevice();
}

bool WindowsAudioCapture::InitializeDevice() {
    if (!deviceEnumerator_) return false;
    
    // Get default audio endpoint (speakers/headphones)
    HRESULT hr = deviceEnumerator_->GetDefaultAudioEndpoint(
        eRender,  // Render devices (speakers)
        eConsole, // Console role
        &device_
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to get default audio endpoint: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Get endpoint volume interface
    hr = device_->Activate(
        __uuidof(IAudioEndpointVolume),
        CLSCTX_ALL,
        nullptr,
        reinterpret_cast<void**>(&endpointVolume_)
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to get endpoint volume interface: " + GetCOMErrorString(hr);
        return false;
    }
    
    return InitializeAudioClient();
}

bool WindowsAudioCapture::InitializeAudioClient() {
    if (!device_) return false;
    
    // Activate audio client
    HRESULT hr = device_->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        reinterpret_cast<void**>(&audioClient_)
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to activate audio client: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Get the mix format
    hr = audioClient_->GetMixFormat(&deviceFormat_);
    if (FAILED(hr)) {
        lastError_ = "Failed to get mix format: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Initialize audio client in loopback mode
    REFERENCE_TIME bufferDuration = CAPTURE_BUFFER_SIZE_MS * 10000; // Convert to 100ns units
    
    hr = audioClient_->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,  // Loopback capture
        bufferDuration,
        0,
        deviceFormat_,
        nullptr
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to initialize audio client: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Get capture client
    hr = audioClient_->GetService(
        __uuidof(IAudioCaptureClient),
        reinterpret_cast<void**>(&captureClient_)
    );
    
    if (FAILED(hr)) {
        lastError_ = "Failed to get capture client: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Store current format
    currentFormat_ = WaveFormatToAudioFormat(deviceFormat_);
    
    return true;
}

bool WindowsAudioCapture::Start() {
    if (isCapturing_) return true;
    
    if (!audioClient_ || !captureClient_) {
        lastError_ = "Audio client not initialized";
        return false;
    }
    
    // Start the audio client
    HRESULT hr = audioClient_->Start();
    if (FAILED(hr)) {
        lastError_ = "Failed to start audio client: " + GetCOMErrorString(hr);
        return false;
    }
    
    // Start capture thread
    shouldStop_ = false;
    captureThread_ = std::thread(&WindowsAudioCapture::CaptureThreadFunction, this);
    
    isCapturing_ = true;
    return true;
}

bool WindowsAudioCapture::Stop() {
    if (!isCapturing_) return true;
    
    // Signal thread to stop
    shouldStop_ = true;
    
    // Wait for thread to finish
    if (captureThread_.joinable()) {
        captureThread_.join();
    }
    
    // Stop audio client
    if (audioClient_) {
        audioClient_->Stop();
    }
    
    isCapturing_ = false;
    return true;
}

void WindowsAudioCapture::CaptureThreadFunction() {
    while (!shouldStop_) {
        UINT32 packetLength = 0;
        HRESULT hr = captureClient_->GetNextPacketSize(&packetLength);
        
        if (FAILED(hr)) {
            lastError_ = "Failed to get packet size: " + GetCOMErrorString(hr);
            break;
        }
        
        while (packetLength != 0) {
            BYTE* data;
            UINT32 framesAvailable;
            DWORD flags;
            
            hr = captureClient_->GetBuffer(
                &data,
                &framesAvailable,
                &flags,
                nullptr,
                nullptr
            );
            
            if (FAILED(hr)) {
                lastError_ = "Failed to get buffer: " + GetCOMErrorString(hr);
                break;
            }
            
            // Calculate volume level
            UpdateVolumeLevel();
            
            // Create audio sample
            if (audioCallback_ && framesAvailable > 0) {
                AudioSample sample;
                sample.format = currentFormat_;
                sample.frameCount = framesAvailable;
                sample.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now().time_since_epoch()
                ).count();
                
                // Copy audio data
                size_t dataSize = framesAvailable * currentFormat_.bytesPerFrame;
                sample.data.resize(dataSize);
                
                if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
                    std::memcpy(sample.data.data(), data, dataSize);
                } else {
                    // Silent buffer, fill with zeros
                    std::fill(sample.data.begin(), sample.data.end(), 0);
                }
                
                // Call the callback
                {
                    std::lock_guard<std::mutex> lock(callbackMutex_);
                    if (audioCallback_) {
                        audioCallback_(sample);
                    }
                }
            }
            
            hr = captureClient_->ReleaseBuffer(framesAvailable);
            if (FAILED(hr)) {
                lastError_ = "Failed to release buffer: " + GetCOMErrorString(hr);
                break;
            }
            
            hr = captureClient_->GetNextPacketSize(&packetLength);
            if (FAILED(hr)) {
                lastError_ = "Failed to get next packet size: " + GetCOMErrorString(hr);
                break;
            }
        }
        
        // Short sleep to prevent excessive CPU usage
        std::this_thread::sleep_for(std::chrono::milliseconds(POLL_INTERVAL_MS));
    }
}

void WindowsAudioCapture::UpdateVolumeLevel() {
    if (!endpointVolume_) return;
    
    float peak = 0.0f;
    HRESULT hr = endpointVolume_->GetMasterScalarVolume(&peak);
    if (SUCCEEDED(hr)) {
        currentVolumeLevel_ = peak;
    }
}

bool WindowsAudioCapture::IsCapturing() const {
    return isCapturing_;
}

void WindowsAudioCapture::SetAudioCallback(AudioCallback callback) {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    audioCallback_ = callback;
}

AudioFormat WindowsAudioCapture::GetFormat() const {
    return currentFormat_;
}

std::vector<std::string> WindowsAudioCapture::GetAvailableDevices() {
    std::vector<std::string> devices;
    
    if (!deviceEnumerator_) return devices;
    
    IMMDeviceCollection* collection = nullptr;
    HRESULT hr = deviceEnumerator_->EnumAudioEndpoints(
        eRender, 
        DEVICE_STATE_ACTIVE, 
        &collection
    );
    
    if (FAILED(hr)) return devices;
    
    UINT count = 0;
    hr = collection->GetCount(&count);
    if (FAILED(hr)) {
        collection->Release();
        return devices;
    }
    
    for (UINT i = 0; i < count; i++) {
        IMMDevice* device = nullptr;
        hr = collection->Item(i, &device);
        if (FAILED(hr)) continue;
        
        LPWSTR deviceId = nullptr;
        hr = device->GetId(&deviceId);
        if (SUCCEEDED(hr)) {
            // Convert to narrow string
            int len = WideCharToMultiByte(CP_UTF8, 0, deviceId, -1, nullptr, 0, nullptr, nullptr);
            std::string deviceIdStr(len - 1, 0);
            WideCharToMultiByte(CP_UTF8, 0, deviceId, -1, &deviceIdStr[0], len, nullptr, nullptr);
            devices.push_back(deviceIdStr);
            
            CoTaskMemFree(deviceId);
        }
        
        device->Release();
    }
    
    collection->Release();
    return devices;
}

bool WindowsAudioCapture::SetDevice(const std::string& deviceId) {
    // For simplicity, we'll use the default device for now
    // This can be extended to support specific device selection
    return true;
}

float WindowsAudioCapture::GetVolumeLevel() const {
    return currentVolumeLevel_;
}

std::string WindowsAudioCapture::GetLastError() const {
    return lastError_;
}

AudioFormat WindowsAudioCapture::WaveFormatToAudioFormat(const WAVEFORMATEX* wf) {
    AudioFormat format;
    format.sampleRate = wf->nSamplesPerSec;
    format.channels = wf->nChannels;
    format.bitsPerSample = wf->wBitsPerSample;
    format.bytesPerFrame = wf->nBlockAlign;
    format.blockAlign = wf->nBlockAlign;
    return format;
}

void WindowsAudioCapture::SetNoiseGateThreshold(float threshold) {
    // Windows WASAPI doesn't have a built-in noise gate like macOS ScreenCaptureKit
    // This is a no-op for Windows - noise gating will be handled in JavaScript VAD
    // Log the threshold for debugging purposes
    lastError_ = "";  // Clear any previous errors
}

std::string WindowsAudioCapture::GetCOMErrorString(HRESULT hr) {
    std::stringstream ss;
    ss << "HRESULT 0x" << std::hex << std::uppercase << hr;
    
    _com_error err(hr);
    LPCTSTR errMsg = err.ErrorMessage();
    if (errMsg) {
        ss << " (" << errMsg << ")";
    }
    
    return ss.str();
}

void WindowsAudioCapture::CleanupCOM() {
    if (captureClient_) {
        captureClient_->Release();
        captureClient_ = nullptr;
    }
    
    if (audioClient_) {
        audioClient_->Release();
        audioClient_ = nullptr;
    }
    
    if (endpointVolume_) {
        endpointVolume_->Release();
        endpointVolume_ = nullptr;
    }
    
    if (deviceFormat_) {
        CoTaskMemFree(deviceFormat_);
        deviceFormat_ = nullptr;
    }
    
    if (device_) {
        device_->Release();
        device_ = nullptr;
    }
    
    if (deviceEnumerator_) {
        deviceEnumerator_->Release();
        deviceEnumerator_ = nullptr;
    }
    
    CoUninitialize();
}

} // namespace AudioCapture

#endif // WINDOWS_PLATFORM