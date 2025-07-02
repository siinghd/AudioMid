#include <napi.h>
#include <iostream>

#ifdef _WIN32
#include <windows.h>
#include <dwmapi.h>
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")
#endif

#ifdef __APPLE__
#include <CoreGraphics/CoreGraphics.h>
#include <ApplicationServices/ApplicationServices.h>
#include <objc/objc.h>
#include <objc/runtime.h>
#include <objc/message.h>

// Define types from Foundation that we need
typedef unsigned long NSUInteger;
typedef long NSInteger;
#endif

#ifdef __linux__
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#endif

class WindowPrivacy : public Napi::ObjectWrap<WindowPrivacy> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  WindowPrivacy(const Napi::CallbackInfo& info);

 private:
  static Napi::FunctionReference constructor;
  
  Napi::Value SetWindowInvisibleToCapture(const Napi::CallbackInfo& info);
  Napi::Value RestoreWindowVisibility(const Napi::CallbackInfo& info);
  
#ifdef __APPLE__
  void* GetNSWindowFromElectron(Napi::Env env, Napi::Value electronWindow);
#endif
};

Napi::FunctionReference WindowPrivacy::constructor;

Napi::Object WindowPrivacy::Init(Napi::Env env, Napi::Object exports) {
  Napi::HandleScope scope(env);

  Napi::Function func = DefineClass(env, "WindowPrivacy", {
    InstanceMethod("setInvisibleToCapture", &WindowPrivacy::SetWindowInvisibleToCapture),
    InstanceMethod("restoreVisibility", &WindowPrivacy::RestoreWindowVisibility),
  });

  constructor = Napi::Persistent(func);
  constructor.SuppressDestruct();

  exports.Set("WindowPrivacy", func);
  return exports;
}

WindowPrivacy::WindowPrivacy(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<WindowPrivacy>(info) {
}

#ifdef __APPLE__
void* WindowPrivacy::GetNSWindowFromElectron(Napi::Env env, Napi::Value electronWindow) {
  if (!electronWindow.IsObject()) {
    // Accept a raw buffer (legacy path) and still attempt to get NSWindow from NSView
    if (electronWindow.IsBuffer()) {
      Napi::Buffer<uint8_t> buf = electronWindow.As<Napi::Buffer<uint8_t>>();
      if (buf.Length() < sizeof(void *)) {
        return nullptr;
      }

      void *rawPtr = *reinterpret_cast<void **>(buf.Data());
      id obj = (id)rawPtr;

      Class NSWindowClass = objc_getClass("NSWindow");
      Class NSViewClass   = objc_getClass("NSView");

      if (!NSWindowClass || !NSViewClass) {
        return nullptr;
      }

      SEL isKindOfClassSel = sel_registerName("isKindOfClass:");
      BOOL isView = ((BOOL (*)(id, SEL, Class))objc_msgSend)(obj, isKindOfClassSel, NSViewClass);

      if (isView) {
        SEL windowSel = sel_registerName("window");
        if (class_respondsToSelector(NSViewClass, windowSel)) {
          obj = ((id (*)(id, SEL))objc_msgSend)(obj, windowSel);
        }
      }

      BOOL isWindow = ((BOOL (*)(id, SEL, Class))objc_msgSend)(obj, isKindOfClassSel, NSWindowClass);
      return isWindow ? (void *)obj : nullptr;
    }
    return nullptr;
  }
  
  // Expect an Electron BrowserWindow instance. We will call getNativeWindowHandle()
  Napi::Object windowObj = electronWindow.As<Napi::Object>();
  if (!windowObj.Has("getNativeWindowHandle")) {
    return nullptr;
  }

  Napi::Value handleValue = windowObj.Get("getNativeWindowHandle").As<Napi::Function>().Call(windowObj, {});
  if (!handleValue.IsBuffer()) {
    return nullptr;
  }

  Napi::Buffer<uint8_t> buffer = handleValue.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) {
    return nullptr;
  }

  // The buffer contains a pointer. On macOS, Electron returns an NSView* (the
  // window's contentView), **not** the NSWindow*. We therefore convert the
  // pointer back to an Objective-C object and, if it is an NSView, query its
  // parent window. This gives us a reliable NSWindow* regardless of the
  // Electron version.
  void *rawPtr = *reinterpret_cast<void **>(buffer.Data());
  if (!rawPtr) {
    return nullptr;
  }

  id obj = (id)rawPtr;

  // Look up the classes we care about at runtime so we do not need to import
  // AppKit headers directly.
  Class NSWindowClass = objc_getClass("NSWindow");
  Class NSViewClass   = objc_getClass("NSView");

  if (NSViewClass && NSWindowClass) {
    SEL isKindOfClassSel = sel_registerName("isKindOfClass:");
    BOOL isView = ((BOOL (*)(id, SEL, Class))objc_msgSend)(obj, isKindOfClassSel, NSViewClass);

    if (isView) {
      // obj is an NSView – obtain its window property
      SEL windowSel = sel_registerName("window");
      if (class_respondsToSelector(NSViewClass, windowSel)) {
        obj = ((id (*)(id, SEL))objc_msgSend)(obj, windowSel);
      }
    }

    // Verify we now have an NSWindow instance
    BOOL isWindow = ((BOOL (*)(id, SEL, Class))objc_msgSend)(obj, isKindOfClassSel, NSWindowClass);
    if (!isWindow) {
      return nullptr;
    }
  }

  return (void *)obj;
}
#endif

Napi::Value WindowPrivacy::SetWindowInvisibleToCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected window handle").ThrowAsJavaScriptException();
    return env.Null();
  }

#ifdef _WIN32
  // Windows: Use SetWindowDisplayAffinity
  if (info[0].IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    HWND hwnd = *reinterpret_cast<HWND*>(buffer.Data());
    
    // WDA_EXCLUDEFROMCAPTURE = 0x00000011 (Windows 10 version 2004+)
    // This makes the window invisible to screen capture while still visible to the user
    const DWORD WDA_EXCLUDEFROMCAPTURE = 0x00000011;
    BOOL result = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    
    if (!result) {
      // Fallback to WDA_MONITOR for older Windows versions
      result = SetWindowDisplayAffinity(hwnd, WDA_MONITOR);
    }
    
    return Napi::Boolean::New(env, result != 0);
  }
#endif

#ifdef __APPLE__
  // macOS: Use private APIs to exclude from screen capture
  void* nsWindow = GetNSWindowFromElectron(env, info[0]);
  if (nsWindow) {
    // Get the objc runtime functions
    id window = (id)nsWindow;
    
    // Set the window sharing type to none
    SEL setSharingTypeSel = sel_registerName("setSharingType:");
    if (class_respondsToSelector(object_getClass(window), setSharingTypeSel)) {
      // NSWindowSharingNone = 0
      ((void (*)(id, SEL, NSUInteger))objc_msgSend)(window, setSharingTypeSel, 0);
    }
    
    // Set window level to be above screen savers but still interactive
    SEL setLevelSel = sel_registerName("setLevel:");
    if (class_respondsToSelector(object_getClass(window), setLevelSel)) {
      // NSScreenSaverWindowLevel = 1000
      // But we use a special level that's excluded from capture
      NSInteger specialLevel = CGShieldingWindowLevel();
      ((void (*)(id, SEL, NSInteger))objc_msgSend)(window, setLevelSel, specialLevel);
    }
    
    // Make sure window remains interactive
    SEL setIgnoresMouseEventsSel = sel_registerName("setIgnoresMouseEvents:");
    if (class_respondsToSelector(object_getClass(window), setIgnoresMouseEventsSel)) {
      ((void (*)(id, SEL, BOOL))objc_msgSend)(window, setIgnoresMouseEventsSel, NO);
    }
    
    // Set collection behavior to exclude from window cycling
    SEL setCollectionBehaviorSel = sel_registerName("setCollectionBehavior:");
    if (class_respondsToSelector(object_getClass(window), setCollectionBehaviorSel)) {
      // NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle
      NSUInteger behavior = (1 << 0) | (1 << 4) | (1 << 6);
      ((void (*)(id, SEL, NSUInteger))objc_msgSend)(window, setCollectionBehaviorSel, behavior);
    }
    
    return Napi::Boolean::New(env, true);
  }
#endif

#ifdef __linux__
  // Linux: Use X11 window properties
  Display* display = XOpenDisplay(nullptr);
  if (display && info[0].IsNumber()) {
    Window window = info[0].As<Napi::Number>().Uint32Value();
    
    // Set _NET_WM_STATE_ABOVE to keep window on top
    Atom wmState = XInternAtom(display, "_NET_WM_STATE", False);
    Atom wmStateAbove = XInternAtom(display, "_NET_WM_STATE_ABOVE", False);
    
    XChangeProperty(display, window, wmState, XA_ATOM, 32,
                   PropModeReplace, (unsigned char*)&wmStateAbove, 1);
    
    // Set custom property to exclude from screen capture (compositor-dependent)
    Atom excludeCapture = XInternAtom(display, "_EXCLUDE_FROM_CAPTURE", False);
    long excludeValue = 1;
    XChangeProperty(display, window, excludeCapture, XA_CARDINAL, 32,
                   PropModeReplace, (unsigned char*)&excludeValue, 1);
    
    XCloseDisplay(display);
    return Napi::Boolean::New(env, true);
  }
#endif

  return Napi::Boolean::New(env, false);
}

Napi::Value WindowPrivacy::RestoreWindowVisibility(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected window handle").ThrowAsJavaScriptException();
    return env.Null();
  }

#ifdef _WIN32
  if (info[0].IsBuffer()) {
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    HWND hwnd = *reinterpret_cast<HWND*>(buffer.Data());
    
    // WDA_NONE = 0x00000000 (restore normal visibility)
    BOOL result = SetWindowDisplayAffinity(hwnd, WDA_NONE);
    return Napi::Boolean::New(env, result != 0);
  }
#endif

#ifdef __APPLE__
  void* nsWindow = GetNSWindowFromElectron(env, info[0]);
  if (nsWindow) {
    id window = (id)nsWindow;
    
    // Restore normal window sharing
    SEL setSharingTypeSel = sel_registerName("setSharingType:");
    if (class_respondsToSelector(object_getClass(window), setSharingTypeSel)) {
      // NSWindowSharingReadOnly = 1
      ((void (*)(id, SEL, NSUInteger))objc_msgSend)(window, setSharingTypeSel, 1);
    }
    
    // Restore normal window level
    SEL setLevelSel = sel_registerName("setLevel:");
    if (class_respondsToSelector(object_getClass(window), setLevelSel)) {
      // NSNormalWindowLevel = 0
      ((void (*)(id, SEL, NSInteger))objc_msgSend)(window, setLevelSel, 0);
    }
    
    return Napi::Boolean::New(env, true);
  }
#endif

#ifdef __linux__
  Display* display = XOpenDisplay(nullptr);
  if (display && info[0].IsNumber()) {
    Window window = info[0].As<Napi::Number>().Uint32Value();
    
    // Remove the exclude from capture property
    Atom excludeCapture = XInternAtom(display, "_EXCLUDE_FROM_CAPTURE", False);
    XDeleteProperty(display, window, excludeCapture);
    
    XCloseDisplay(display);
    return Napi::Boolean::New(env, true);
  }
#endif

  return Napi::Boolean::New(env, false);
}

// Module initialization
Napi::Object InitWindowPrivacy(Napi::Env env, Napi::Object exports) {
  return WindowPrivacy::Init(env, exports);
}

NODE_API_MODULE(window_privacy, InitWindowPrivacy)