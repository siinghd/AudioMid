#ifdef MACOS_PLATFORM

#import "macos_audio_capture.h"
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#include <chrono>

@interface AudioStreamDelegate : NSObject <SCStreamDelegate, SCStreamOutput>
@property (nonatomic, assign) AudioCapture::MacOSAudioCapture* captureInstance;
@end

@implementation AudioStreamDelegate

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeAudio || !self.captureInstance) {
        return;
    }
    
    // Extract audio data from CMSampleBuffer
    CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (!blockBuffer) return;
    
    size_t length = CMBlockBufferGetDataLength(blockBuffer);
    if (length == 0) return;
    
    // Allocate buffer for audio data
    std::vector<uint8_t> audioData(length);
    
    // Copy audio data
    OSStatus status = CMBlockBufferCopyDataBytes(blockBuffer, 0, length, audioData.data());
    if (status != noErr) return;
    
    // Get audio format description
    CMFormatDescriptionRef formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
    const AudioStreamBasicDescription* asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc);
    
    if (asbd) {
        // Update format info including float and interleaving flags
        bool isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
        bool isNonInterleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
        
        // Audio format detected: 48kHz, 2ch, 32-bit float, non-interleaved
        
        self.captureInstance->UpdateFormat(asbd->mSampleRate, asbd->mChannelsPerFrame, asbd->mBitsPerChannel, isFloat, isNonInterleaved, asbd->mFormatFlags);
        
        // Calculate RMS level for volume indication
        float rmsLevel = self.captureInstance->CalculateRMSLevel(audioData.data(), length, asbd);
        self.captureInstance->SetVolumeLevel(rmsLevel);
    }
    
    // Send audio data to callback
    self.captureInstance->OnAudioData(audioData.data(), length);
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    if (error) {
        NSLog(@"ScreenCaptureKit stream stopped with error: %@", error.localizedDescription);
        if (self.captureInstance) {
            self.captureInstance->SetLastError([error.localizedDescription UTF8String]);
        }
    }
}

@end

namespace AudioCapture {

MacOSAudioCapture::MacOSAudioCapture()
    : stream_(nil), streamDelegate_(nil), shouldStop_(false) {
    
    // Initialize default format (will be updated when stream starts)
    currentFormat_.sampleRate = 48000;
    currentFormat_.channels = 2;
    currentFormat_.bitsPerSample = 32;
    currentFormat_.bytesPerFrame = 8;
    currentFormat_.blockAlign = 8;
    
    // Create stream delegate
    streamDelegate_ = [[AudioStreamDelegate alloc] init];
    [(AudioStreamDelegate*)streamDelegate_ setCaptureInstance:this];
}

MacOSAudioCapture::~MacOSAudioCapture() {
    Stop();
    CleanupResources();
}

bool MacOSAudioCapture::Start() {
    if (isCapturing_) return true;
    
    @autoreleasepool {
        // Request screen recording permission first
        if (@available(macOS 11.0, *)) {
            // Use semaphore for proper async-to-sync conversion
            dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
            __block bool success = false;
            __block std::string asyncError = "";
            
            [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
                if (error) {
                    asyncError = std::string("Failed to get shareable content: ") + [error.localizedDescription UTF8String];
                    NSLog(@"❌ SCShareableContent error: %@", error);
                    dispatch_semaphore_signal(semaphore);
                    return;
                }
                
                if (!content || content.displays.count == 0) {
                    asyncError = "No displays available for capture";
                    NSLog(@"❌ No displays available - content: %@, display count: %lu", content, (unsigned long)(content ? content.displays.count : 0));
                    dispatch_semaphore_signal(semaphore);
                    return;
                }
                
                NSLog(@"✅ Got shareable content with %lu displays", (unsigned long)content.displays.count);
                
                // Use the first display
                SCDisplay* display = content.displays.firstObject;
                
                // Create content filter - use alternative initialization to avoid nil stream issue
                // Using initWithDisplay:excludingWindows: with empty array can cause stream to be nil
                NSArray<SCRunningApplication*>* applications = content.applications;
                SCContentFilter* filter = [[SCContentFilter alloc] initWithDisplay:display 
                                                            includingApplications:applications 
                                                              exceptingWindows:@[]];
                
                // Configure stream for audio capture
                SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
                config.capturesAudio = YES;
                config.excludesCurrentProcessAudio = YES;  // Don't capture our own audio
                config.sampleRate = 48000;
                config.channelCount = 2;
                
                // CRITICAL: Set minimal video config to avoid CoreGraphicsErrorDomain 1003
                // The stream fails if video dimensions are too small (e.g., 1x1)
                // We can't disable video capture entirely, so use minimum valid dimensions
                config.width = 16;  // Minimum valid width
                config.height = 16; // Minimum valid height
                config.minimumFrameInterval = CMTimeMake(1, 1);  // 1 FPS minimum
                config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
                
                // Create the stream and assign to class member
                NSLog(@"🔧 Creating ScreenCaptureKit stream with display: %@", display);
                SCStream* newStream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:(id<SCStreamDelegate>)streamDelegate_];
                
                // CRITICAL: Ensure stream is retained properly to avoid premature deallocation
                stream_ = newStream;  // Assign to class member immediately
                
                // Keep a strong reference in the block to prevent ARC from releasing it
                __strong SCStream* strongStream = stream_;
                
                if (!stream_) {
                    NSLog(@"❌ Failed to create SCStream object");
                    asyncError = "Failed to create ScreenCaptureKit stream";
                    dispatch_semaphore_signal(semaphore);
                    return;
                }
                NSLog(@"✅ SCStream created successfully");
                
                // Add audio output
                NSLog(@"🔊 Adding audio output to stream...");
                NSError* addOutputError = nil;
                BOOL addSuccess = [stream_ addStreamOutput:(id<SCStreamOutput>)streamDelegate_ 
                                                      type:SCStreamOutputTypeAudio 
                                          sampleHandlerQueue:dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_HIGH, 0) 
                                                       error:&addOutputError];
                
                if (!addSuccess || addOutputError) {
                    NSLog(@"❌ Failed to add audio output: %@", addOutputError);
                    asyncError = std::string("Failed to add audio output: ") + 
                                [addOutputError.localizedDescription UTF8String];
                    dispatch_semaphore_signal(semaphore);
                    return;
                }
                NSLog(@"✅ Audio output added successfully");
                
                // Start the capture stream
                NSLog(@"🚀 Starting ScreenCaptureKit stream... stream object: %@", strongStream);
                NSLog(@"🔍 Stream delegate: %@", streamDelegate_);
                NSLog(@"🔍 Stream state before start: valid=%@", strongStream ? @"YES" : @"NO");
                
                [strongStream startCaptureWithCompletionHandler:^(NSError * _Nullable startError) {
                    NSLog(@"📥 Start completion handler called - stream_: %@", strongStream);
                    if (startError) {
                        NSLog(@"❌ Stream start failed with error: %@", startError);
                        NSLog(@"❌ Error domain: %@, code: %ld", startError.domain, (long)startError.code);
                        NSLog(@"❌ User info: %@", startError.userInfo);
                        asyncError = std::string("Failed to start capture: ") + 
                                    [startError.localizedDescription UTF8String] +
                                    " (domain: " + [startError.domain UTF8String] +
                                    ", code: " + std::to_string(startError.code) + ")";
                        success = false;
                    } else {
                        NSLog(@"✅ ScreenCaptureKit stream started successfully!");
                        success = true;
                        isCapturing_ = true;
                        lastError_ = "";
                    }
                    dispatch_semaphore_signal(semaphore);
                }];
            }];
            
            // Wait for completion with 10 second timeout
            dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC);
            long result = dispatch_semaphore_wait(semaphore, timeout);
            
            if (result != 0) {
                lastError_ = "Timeout waiting for audio capture to start (10 seconds) - check Screen Recording permissions";
                return false;
            }
            
            if (!asyncError.empty()) {
                lastError_ = asyncError;
                return false;
            }
            
            return success;
        } else {
            lastError_ = "ScreenCaptureKit requires macOS 11.0 or later";
            return false;
        }
    }
}

bool MacOSAudioCapture::Stop() {
    if (!isCapturing_) return true;
    
    @autoreleasepool {
        if (stream_) {
            [stream_ stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
                if (error) {
                    NSLog(@"Error stopping capture: %@", error.localizedDescription);
                }
            }];
            stream_ = nil;
        }
    }
    
    isCapturing_ = false;
    return true;
}

bool MacOSAudioCapture::IsCapturing() const {
    return isCapturing_;
}

void MacOSAudioCapture::SetAudioCallback(AudioCallback callback) {
    audioCallback_ = callback;
}

AudioFormat MacOSAudioCapture::GetFormat() const {
    return currentFormat_;
}

std::vector<std::string> MacOSAudioCapture::GetAvailableDevices() {
    // TODO: Implement device enumeration
    return {"Default"};
}

bool MacOSAudioCapture::SetDevice(const std::string& deviceId) {
    // TODO: Implement device selection
    return true;
}

float MacOSAudioCapture::GetVolumeLevel() const {
    return currentVolumeLevel_;
}

std::string MacOSAudioCapture::GetLastError() const {
    return lastError_;
}

// Helper methods for audio processing
void MacOSAudioCapture::UpdateFormat(double sampleRate, uint32_t channels, uint32_t bitsPerSample, bool isFloat, bool isNonInterleaved, uint32_t formatFlags) {
    currentFormat_.sampleRate = static_cast<int>(sampleRate);
    currentFormat_.channels = channels;
    currentFormat_.bitsPerSample = bitsPerSample;
    currentFormat_.bytesPerFrame = (bitsPerSample / 8) * channels;
    currentFormat_.blockAlign = currentFormat_.bytesPerFrame;
    currentFormat_.isFloat = isFloat;
    currentFormat_.isNonInterleaved = isNonInterleaved;
    currentFormat_.formatFlags = formatFlags;
}

float MacOSAudioCapture::CalculateRMSLevel(const uint8_t* data, size_t length, const AudioStreamBasicDescription* format) {
    if (!data || length == 0 || !format) return 0.0f;
    
    float rms = 0.0f;
    size_t sampleCount = length / (format->mBitsPerChannel / 8);
    
    if (format->mBitsPerChannel == 32 && (format->mFormatFlags & kAudioFormatFlagIsFloat)) {
        // 32-bit float samples
        const float* samples = reinterpret_cast<const float*>(data);
        for (size_t i = 0; i < sampleCount; i++) {
            rms += samples[i] * samples[i];
        }
    } else if (format->mBitsPerChannel == 16) {
        // 16-bit integer samples
        const int16_t* samples = reinterpret_cast<const int16_t*>(data);
        for (size_t i = 0; i < sampleCount; i++) {
            float normalizedSample = samples[i] / 32768.0f;
            rms += normalizedSample * normalizedSample;
        }
    }
    
    if (sampleCount > 0) {
        rms = sqrt(rms / sampleCount);
    }
    
    return rms;
}

void MacOSAudioCapture::SetVolumeLevel(float level) {
    currentVolumeLevel_ = level;
}

void MacOSAudioCapture::SetLastError(const std::string& error) {
    lastError_ = error;
}

void MacOSAudioCapture::OnAudioData(const uint8_t* data, size_t length) {
    if (audioCallback_ && data && length > 0) {
        // Apply noise gate - filter out background noise
        const float noiseThreshold = 0.02f; // Adjust this value to filter more/less noise
        
        // Calculate current RMS level for gating
        float rms = 0.0f;
        size_t sampleCount = length / (currentFormat_.bitsPerSample / 8);
        
        if (currentFormat_.bitsPerSample == 32) {
            // 32-bit float samples
            const float* samples = reinterpret_cast<const float*>(data);
            for (size_t i = 0; i < sampleCount; i++) {
                rms += samples[i] * samples[i];
            }
        } else if (currentFormat_.bitsPerSample == 16) {
            // 16-bit integer samples
            const int16_t* samples = reinterpret_cast<const int16_t*>(data);
            for (size_t i = 0; i < sampleCount; i++) {
                float normalizedSample = samples[i] / 32768.0f;
                rms += normalizedSample * normalizedSample;
            }
        }
        
        if (sampleCount > 0) {
            rms = sqrt(rms / sampleCount);
        }
        
        // Only send audio if it's above the noise threshold
        if (rms > noiseThreshold) {
            AudioSample sample;
            sample.data.assign(data, data + length);
            sample.format = currentFormat_;
            sample.timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::steady_clock::now().time_since_epoch()).count();
            sample.frameCount = length / currentFormat_.bytesPerFrame;
            audioCallback_(sample);
        }
    }
}

void MacOSAudioCapture::CleanupResources() {
    @autoreleasepool {
        if (streamDelegate_) {
            [(AudioStreamDelegate*)streamDelegate_ setCaptureInstance:nil];
            streamDelegate_ = nil;
        }
        
        if (stream_) {
            stream_ = nil;
        }
    }
}

} // namespace AudioCapture

#endif // MACOS_PLATFORM