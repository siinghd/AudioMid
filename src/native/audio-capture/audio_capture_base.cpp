#include "audio_capture_base.h"

#ifdef WINDOWS_PLATFORM
#include "windows_audio_capture.h"
#elif defined(MACOS_PLATFORM)
#include "macos_audio_capture.h"
#elif defined(LINUX_PLATFORM)
#include "linux_audio_capture.h"
#endif

namespace AudioCapture {

std::unique_ptr<AudioCaptureBase> CreateAudioCapture() {
#ifdef WINDOWS_PLATFORM
    return std::make_unique<WindowsAudioCapture>();
#elif defined(MACOS_PLATFORM)
    return std::make_unique<MacOSAudioCapture>();
#elif defined(LINUX_PLATFORM)
    return std::make_unique<LinuxAudioCapture>();
#else
    return nullptr;
#endif
}

} // namespace AudioCapture