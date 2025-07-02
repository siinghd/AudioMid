#include <napi.h>
#include "audio-capture/audio_capture_base.h"
#include "audio-capture/audio_format_converter.h"
#include "audio-capture/audio_buffer.h"
#include "webrtc-vad/vad_wrapper.h"
#include <memory>
#include <thread>
#include <atomic>

using namespace AudioCapture;

class AudioCaptureWrapper : public Napi::ObjectWrap<AudioCaptureWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    AudioCaptureWrapper(const Napi::CallbackInfo& info);
    ~AudioCaptureWrapper();

private:
    // JavaScript-exposed methods
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value IsCapturing(const Napi::CallbackInfo& info);
    Napi::Value GetFormat(const Napi::CallbackInfo& info);
    Napi::Value GetAvailableDevices(const Napi::CallbackInfo& info);
    Napi::Value SetDevice(const Napi::CallbackInfo& info);
    Napi::Value GetVolumeLevel(const Napi::CallbackInfo& info);
    Napi::Value GetLastError(const Napi::CallbackInfo& info);
    Napi::Value SetAudioCallback(const Napi::CallbackInfo& info);
    Napi::Value GetBufferedAudio(const Napi::CallbackInfo& info);
    Napi::Value GetBufferedFloat32Audio(const Napi::CallbackInfo& info);
    Napi::Value ClearBuffer(const Napi::CallbackInfo& info);
    
    // WebRTC VAD methods
    Napi::Value CreateVAD(const Napi::CallbackInfo& info);
    Napi::Value ProcessVAD(const Napi::CallbackInfo& info);
    Napi::Value SetVADMode(const Napi::CallbackInfo& info);
    Napi::Value ResetVAD(const Napi::CallbackInfo& info);
    
    // Internal members
    std::unique_ptr<AudioCaptureBase> audioCapture_;
    std::unique_ptr<AudioBuffer> audioBuffer_;
    std::unique_ptr<WebRTCVAD::VADWrapper> vad_;
    Napi::ThreadSafeFunction jsCallback_;
    std::atomic<bool> hasJSCallback_;
    
    // Audio processing
    void OnAudioData(const AudioSample& sample);
    void ProcessAndBufferAudio(const AudioSample& sample);
};

Napi::Object AudioCaptureWrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AudioCapture", {
        InstanceMethod("start", &AudioCaptureWrapper::Start),
        InstanceMethod("stop", &AudioCaptureWrapper::Stop),
        InstanceMethod("isCapturing", &AudioCaptureWrapper::IsCapturing),
        InstanceMethod("getFormat", &AudioCaptureWrapper::GetFormat),
        InstanceMethod("getAvailableDevices", &AudioCaptureWrapper::GetAvailableDevices),
        InstanceMethod("setDevice", &AudioCaptureWrapper::SetDevice),
        InstanceMethod("getVolumeLevel", &AudioCaptureWrapper::GetVolumeLevel),
        InstanceMethod("getLastError", &AudioCaptureWrapper::GetLastError),
        InstanceMethod("setAudioCallback", &AudioCaptureWrapper::SetAudioCallback),
        InstanceMethod("getBufferedAudio", &AudioCaptureWrapper::GetBufferedAudio),
        InstanceMethod("getBufferedFloat32Audio", &AudioCaptureWrapper::GetBufferedFloat32Audio),
        InstanceMethod("clearBuffer", &AudioCaptureWrapper::ClearBuffer),
        InstanceMethod("createVAD", &AudioCaptureWrapper::CreateVAD),
        InstanceMethod("processVAD", &AudioCaptureWrapper::ProcessVAD),
        InstanceMethod("setVADMode", &AudioCaptureWrapper::SetVADMode),
        InstanceMethod("resetVAD", &AudioCaptureWrapper::ResetVAD),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("AudioCapture", func);
    return exports;
}

AudioCaptureWrapper::AudioCaptureWrapper(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<AudioCaptureWrapper>(info)
    , hasJSCallback_(false) {
    
    Napi::Env env = info.Env();
    
    // Create platform-specific audio capture instance
    audioCapture_ = CreateAudioCapture();
    if (!audioCapture_) {
        Napi::TypeError::New(env, "Failed to create audio capture for this platform")
            .ThrowAsJavaScriptException();
        return;
    }
    
    // Create audio buffer
    audioBuffer_ = std::make_unique<AudioBuffer>(5 * 1024 * 1024); // 5MB buffer
    
    // Set up audio callback
    audioCapture_->SetAudioCallback([this](const AudioSample& sample) {
        OnAudioData(sample);
    });
}

AudioCaptureWrapper::~AudioCaptureWrapper() {
    if (audioCapture_ && audioCapture_->IsCapturing()) {
        audioCapture_->Stop();
    }
    
    if (jsCallback_) {
        jsCallback_.Release();
    }
}

Napi::Value AudioCaptureWrapper::Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        Napi::Error::New(env, "Audio capture not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    bool success = audioCapture_->Start();
    return Napi::Boolean::New(env, success);
}

Napi::Value AudioCaptureWrapper::Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        Napi::Error::New(env, "Audio capture not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    bool success = audioCapture_->Stop();
    return Napi::Boolean::New(env, success);
}

Napi::Value AudioCaptureWrapper::IsCapturing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        return Napi::Boolean::New(env, false);
    }
    
    return Napi::Boolean::New(env, audioCapture_->IsCapturing());
}

Napi::Value AudioCaptureWrapper::GetFormat(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        return env.Null();
    }
    
    AudioFormat format = audioCapture_->GetFormat();
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("sampleRate", Napi::Number::New(env, format.sampleRate));
    result.Set("channels", Napi::Number::New(env, format.channels));
    result.Set("bitsPerSample", Napi::Number::New(env, format.bitsPerSample));
    result.Set("bytesPerFrame", Napi::Number::New(env, format.bytesPerFrame));
    
    return result;
}

Napi::Value AudioCaptureWrapper::GetAvailableDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        return Napi::Array::New(env, 0);
    }
    
    auto devices = audioCapture_->GetAvailableDevices();
    
    Napi::Array result = Napi::Array::New(env, devices.size());
    for (size_t i = 0; i < devices.size(); ++i) {
        result[i] = Napi::String::New(env, devices[i]);
    }
    
    return result;
}

Napi::Value AudioCaptureWrapper::SetDevice(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected device ID string").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!audioCapture_) {
        Napi::Error::New(env, "Audio capture not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string deviceId = info[0].As<Napi::String>().Utf8Value();
    bool success = audioCapture_->SetDevice(deviceId);
    
    return Napi::Boolean::New(env, success);
}

Napi::Value AudioCaptureWrapper::GetVolumeLevel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        return Napi::Number::New(env, 0.0);
    }
    
    float level = audioCapture_->GetVolumeLevel();
    return Napi::Number::New(env, level);
}

Napi::Value AudioCaptureWrapper::GetLastError(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioCapture_) {
        return Napi::String::New(env, "Audio capture not initialized");
    }
    
    std::string error = audioCapture_->GetLastError();
    return Napi::String::New(env, error);
}

Napi::Value AudioCaptureWrapper::SetAudioCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Release previous callback if exists
    if (jsCallback_) {
        jsCallback_.Release();
    }
    
    // Create new thread-safe function
    jsCallback_ = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "AudioCaptureCallback",
        0,      // Unlimited queue size
        1       // Single thread
    );
    
    hasJSCallback_ = true;
    
    return env.Undefined();
}

Napi::Value AudioCaptureWrapper::GetBufferedAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioBuffer_) {
        return Napi::Array::New(env, 0);
    }
    
    // Get all available chunks at once
    auto chunks = audioBuffer_->PopMultiple(1000);
    
    Napi::Array result = Napi::Array::New(env, chunks.size());
    
    for (size_t i = 0; i < chunks.size(); ++i) {
        const auto& chunk = chunks[i];
        
        Napi::Object chunkObj = Napi::Object::New(env);
        
        // Convert int16 data to Node.js Buffer
        Napi::Buffer<int16_t> buffer = Napi::Buffer<int16_t>::Copy(
            env, 
            chunk.data.data(), 
            chunk.data.size()
        );
        
        chunkObj.Set("data", buffer);
        chunkObj.Set("timestamp", Napi::Number::New(env, chunk.timestamp));
        chunkObj.Set("sampleRate", Napi::Number::New(env, chunk.sampleRate));
        chunkObj.Set("channels", Napi::Number::New(env, chunk.channels));
        
        result[i] = chunkObj;
    }
    
    return result;
}

Napi::Value AudioCaptureWrapper::GetBufferedFloat32Audio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!audioBuffer_) {
        return Napi::Array::New(env, 0);
    }
    
    // Get all available float32 chunks for streaming to OpenAI
    auto chunks = audioBuffer_->PopMultipleFloat32(1000);
    
    if (chunks.empty()) {
        return Napi::Array::New(env, 0);
    }
    
    // Combine all chunks into a single Float32Array (40ms chunks ideal)
    size_t totalSamples = 0;
    for (const auto& chunk : chunks) {
        totalSamples += chunk.data.size();
    }
    
    // Create a single Float32Array with all the data
    Napi::Float32Array result = Napi::Float32Array::New(env, totalSamples);
    
    size_t offset = 0;
    for (const auto& chunk : chunks) {
        std::memcpy(
            reinterpret_cast<uint8_t*>(result.Data()) + offset * sizeof(float),
            chunk.data.data(),
            chunk.data.size() * sizeof(float)
        );
        offset += chunk.data.size();
    }
    
    return result;
}

Napi::Value AudioCaptureWrapper::ClearBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (audioBuffer_) {
        audioBuffer_->Clear();
    }
    
    return env.Undefined();
}

void AudioCaptureWrapper::OnAudioData(const AudioSample& sample) {
    // Process and buffer the audio
    ProcessAndBufferAudio(sample);
    
    // If JavaScript callback is set, call it
    if (hasJSCallback_ && jsCallback_) {
        auto callback = [](Napi::Env env, Napi::Function jsCallback, AudioSample* sample) {
            if (sample) {
                // Convert sample to JavaScript object
                Napi::Object sampleObj = Napi::Object::New(env);
                
                // Create buffer from audio data
                Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
                    env,
                    sample->data.data(),
                    sample->data.size()
                );
                
                sampleObj.Set("data", buffer);
                sampleObj.Set("timestamp", Napi::Number::New(env, sample->timestamp));
                sampleObj.Set("frameCount", Napi::Number::New(env, sample->frameCount));
                
                Napi::Object formatObj = Napi::Object::New(env);
                formatObj.Set("sampleRate", Napi::Number::New(env, sample->format.sampleRate));
                formatObj.Set("channels", Napi::Number::New(env, sample->format.channels));
                formatObj.Set("bitsPerSample", Napi::Number::New(env, sample->format.bitsPerSample));
                
                sampleObj.Set("format", formatObj);
                
                jsCallback.Call({sampleObj});
                
                delete sample;
            }
        };
        
        AudioSample* sampleCopy = new AudioSample(sample);
        jsCallback_.BlockingCall(sampleCopy, callback);
    }
}

void AudioCaptureWrapper::ProcessAndBufferAudio(const AudioSample& sample) {
    if (!audioBuffer_) return;
    
    // Convert to clean 48kHz mono float32 for high-quality resampling in JS
    std::vector<float> float32Data = AudioFormatConverter::ConvertToMonoFloat32(sample);
    
    // Debug output disabled for production
    // fprintf(stderr, "PBA size=%zu\n", float32Data.size());
    
    if (!float32Data.empty()) {
        audioBuffer_->PushFloat32(float32Data, 48000, 1);  // Always 48kHz mono
    }
}

// WebRTC VAD method implementations
Napi::Value AudioCaptureWrapper::CreateVAD(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Parse arguments: createVAD(sampleRate, mode)
    int sampleRate = 48000;  // Default
    int mode = 2;            // Default aggressive mode
    
    if (info.Length() >= 1 && info[0].IsNumber()) {
        sampleRate = info[0].As<Napi::Number>().Int32Value();
    }
    
    if (info.Length() >= 2 && info[1].IsNumber()) {
        mode = info[1].As<Napi::Number>().Int32Value();
    }
    
    try {
        vad_ = std::make_unique<WebRTCVAD::VADWrapper>(sampleRate, mode);
        return Napi::Boolean::New(env, true);
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("Failed to create VAD: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value AudioCaptureWrapper::ProcessVAD(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!vad_) {
        Napi::Error::New(env, "VAD not initialized. Call createVAD() first.")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Expected audio buffer as first argument")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Get the audio buffer (expects Int16Array/Buffer)
    Napi::Buffer<int16_t> buffer = info[0].As<Napi::Buffer<int16_t>>();
    
    int result = vad_->Process(buffer.Data(), buffer.Length());
    
    if (result == -1) {
        Napi::Error::New(env, "Invalid frame length for VAD processing")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Return boolean: true = speech detected, false = no speech
    return Napi::Boolean::New(env, result == 1);
}

Napi::Value AudioCaptureWrapper::SetVADMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!vad_) {
        Napi::Error::New(env, "VAD not initialized. Call createVAD() first.")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected mode number (0-3)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    int mode = info[0].As<Napi::Number>().Int32Value();
    bool success = vad_->SetMode(mode);
    
    return Napi::Boolean::New(env, success);
}

Napi::Value AudioCaptureWrapper::ResetVAD(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!vad_) {
        Napi::Error::New(env, "VAD not initialized. Call createVAD() first.")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    vad_->Reset();
    return env.Undefined();
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return AudioCaptureWrapper::Init(env, exports);
}

NODE_API_MODULE(audio_capture, Init)