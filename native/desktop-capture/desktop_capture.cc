#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <delayimp.h>
#include <dwmapi.h>
#include <d3d11_4.h>
#include <dxgi1_2.h>
#include <winrt/base.h>
#include <node_api.h>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <string>
#include <thread>

// Electron exports the Node API from its host executable. Delay loading keeps
// the same N-API binary usable in both Node and Electron, without node.exe next
// to the packaged application.
static FARPROC WINAPI ResolveNodeApi(unsigned event, PDelayLoadInfo info) {
  if (event == dliNotePreLoadLibrary && _stricmp(info->szDll, "node.exe") == 0)
    return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
  return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = ResolveNodeApi;

using namespace winrt;

namespace {

DWORD SetCaptureExclusion(HWND window, bool excluded) {
  DWORD owner = 0;
  GetWindowThreadProcessId(window, &owner);
  if (owner != GetCurrentProcessId())
    throw hresult_error(E_ACCESSDENIED, L"The capture window must belong to this process");
  const DWORD expected = excluded ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
  DWORD actual = WDA_NONE;
  // Electron's click-through state may make a redundant setter fail even when
  // Windows still reports the required affinity. Trust the verified OS value.
  if (GetWindowDisplayAffinity(window, &actual) && actual == expected) return actual;
  if (!SetWindowDisplayAffinity(window, expected)) {
    const auto error = GetLastError();
    if (GetWindowDisplayAffinity(window, &actual) && actual == expected) return actual;
    throw hresult_error(HRESULT_FROM_WIN32(error), hstring(L"SetWindowDisplayAffinity failed (" + std::to_wstring(error) + L")"));
  }
  if (!GetWindowDisplayAffinity(window, &actual)) {
    const auto error = GetLastError();
    throw hresult_error(HRESULT_FROM_WIN32(error), hstring(L"GetWindowDisplayAffinity failed (" + std::to_wstring(error) + L")"));
  }
  if (actual != expected)
    throw hresult_error(E_ACCESSDENIED, hstring(L"Window capture exclusion did not apply (expected " + std::to_wstring(expected) + L", actual " + std::to_wstring(actual) + L")"));
  return actual;
}

bool ReadWindow(napi_env env, napi_value value, HWND* window) {
  bool buffer = false;
  if (napi_is_buffer(env, value, &buffer) != napi_ok || !buffer) {
    napi_throw_type_error(env, nullptr, "windowHandle must be a Buffer");
    return false;
  }
  void* bytes = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, value, &bytes, &length);
  if (length != sizeof(HWND)) {
    napi_throw_type_error(env, nullptr, "windowHandle has an invalid pointer size");
    return false;
  }
  memcpy(window, bytes, sizeof(*window));
  if (!IsWindow(*window)) {
    napi_throw_type_error(env, nullptr, "windowHandle is not a live window");
    return false;
  }
  return true;
}

struct Frame {
  uint32_t id = 0;
  uint32_t width = 0;
  uint32_t height = 0;
  int64_t timestamp = 0;
  HANDLE handle = nullptr;
  com_ptr<ID3D11Texture2D> texture;
  ~Frame() { if (handle) CloseHandle(handle); }
};

struct Capture : std::enable_shared_from_this<Capture> {
  std::atomic<bool> closed{false};
  std::mutex mutex;
  uint32_t sequence = 0;
  std::unordered_map<uint32_t, std::shared_ptr<Frame>> frames;
  com_ptr<ID3D11Device> device;
  com_ptr<ID3D11DeviceContext> context;
  com_ptr<IDXGIOutput1> output;
  com_ptr<IDXGIOutputDuplication> duplication;
  DXGI_OUTPUT_DESC outputDescription{};
  HMONITOR monitor = nullptr;
  HWND window = nullptr;
  bool pointerKnown = false;
  bool separatePointerVisible = false;
  std::thread worker;
  napi_threadsafe_function callback = nullptr;
  std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
  std::chrono::steady_clock::time_point lastFrame{};

  ~Capture() { Close(); }

  void Close() {
    if (closed.exchange(true)) return;
    // The worker's wait is bounded; never hold the frame mutex while joining.
    // The worker aborts its TSFN only after its final native frame is released.
    if (worker.joinable()) worker.join();
    else if (callback) {
      napi_release_threadsafe_function(callback, napi_tsfn_abort);
      callback = nullptr;
    }
    // Delivered textures stay owned until Electron releases all GPU references.
  }

  void Release(uint32_t id) {
    std::lock_guard lock(mutex);
    frames.erase(id);
  }

  void OpenDuplication() {
    duplication = nullptr;
    output = nullptr;
    context = nullptr;
    device = nullptr;
    pointerKnown = false;
    separatePointerVisible = false;
    com_ptr<IDXGIFactory1> factory;
    check_hresult(CreateDXGIFactory1(__uuidof(IDXGIFactory1), factory.put_void()));
    for (UINT adapterIndex = 0; ; ++adapterIndex) {
      com_ptr<IDXGIAdapter1> adapter;
      const auto adapterResult = factory->EnumAdapters1(adapterIndex, adapter.put());
      if (adapterResult == DXGI_ERROR_NOT_FOUND) break;
      check_hresult(adapterResult);
      for (UINT outputIndex = 0; ; ++outputIndex) {
        com_ptr<IDXGIOutput> candidate;
        const auto outputResult = adapter->EnumOutputs(outputIndex, candidate.put());
        if (outputResult == DXGI_ERROR_NOT_FOUND) break;
        check_hresult(outputResult);
        DXGI_OUTPUT_DESC description{};
        check_hresult(candidate->GetDesc(&description));
        if (!description.AttachedToDesktop || description.Monitor != monitor) continue;
        outputDescription = description;
        D3D_FEATURE_LEVEL featureLevel;
        check_hresult(D3D11CreateDevice(adapter.get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
          D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
          device.put(), &featureLevel, context.put()));
        output = candidate.as<IDXGIOutput1>();
        check_hresult(output->DuplicateOutput(device.get(), duplication.put()));
        DXGI_OUTDUPL_DESC duplicateDescription{};
        duplication->GetDesc(&duplicateDescription);
        // System-memory duplication can contain a software-composited pointer.
        // Rotation needs a separate GPU transform before any surface can crop it.
        if (duplicateDescription.DesktopImageInSystemMemory)
          throw hresult_error(E_NOTIMPL, L"Cursor-free duplication requires a GPU desktop surface");
        if (duplicateDescription.Rotation != DXGI_MODE_ROTATION_IDENTITY)
          throw hresult_error(E_NOTIMPL, L"Rotated desktop duplication is not supported");
        return;
      }
    }
    throw hresult_error(DXGI_ERROR_NOT_FOUND, L"The application monitor has no duplication output");
  }

  bool PointerIsSafe(DXGI_OUTDUPL_FRAME_INFO const& information) {
    if (information.LastMouseUpdateTime.QuadPart != 0) {
      pointerKnown = true;
      separatePointerVisible = information.PointerPosition.Visible != FALSE;
    }
    if (pointerKnown && separatePointerVisible) return true;
    CURSORINFO cursor{sizeof(CURSORINFO)};
    if (!GetCursorInfo(&cursor)) return false;
    if ((cursor.flags & CURSOR_SHOWING) == 0) return true;
    // A visible system cursor in this output without a separately reported DXGI
    // pointer may already be baked into the desktop image. Never forward it.
    return !PtInRect(&outputDescription.DesktopCoordinates, cursor.ptScreenPos);
  }

  void CopyFrame(ID3D11Texture2D* source) {
    const auto now = std::chrono::steady_clock::now();
    {
      std::lock_guard lock(mutex);
      if (closed.load() || frames.size() >= 3 || now - lastFrame < std::chrono::milliseconds(30)) return;
    }
    D3D11_TEXTURE2D_DESC sourceDescription{};
    source->GetDesc(&sourceDescription);
    if (!sourceDescription.Width || !sourceDescription.Height || sourceDescription.Format != DXGI_FORMAT_B8G8R8A8_UNORM)
      throw hresult_error(E_NOTIMPL, L"Desktop duplication did not provide a BGRA surface");
    auto frame = std::make_shared<Frame>();
    frame->id = ++sequence;
    frame->width = sourceDescription.Width;
    frame->height = sourceDescription.Height;
    frame->timestamp = std::chrono::duration_cast<std::chrono::microseconds>(now - start).count();
    D3D11_TEXTURE2D_DESC description{};
    description.Width = frame->width;
    description.Height = frame->height;
    description.MipLevels = 1;
    description.ArraySize = 1;
    description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    description.SampleDesc.Count = 1;
    description.Usage = D3D11_USAGE_DEFAULT;
    description.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    description.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED;
    check_hresult(device->CreateTexture2D(&description, nullptr, frame->texture.put()));
    context->CopyResource(frame->texture.get(), source);
    D3D11_QUERY_DESC queryDescription{D3D11_QUERY_EVENT, 0};
    com_ptr<ID3D11Query> complete;
    check_hresult(device->CreateQuery(&queryDescription, complete.put()));
    context->End(complete.get());
    context->Flush();
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(40);
    HRESULT copyStatus;
    while ((copyStatus = context->GetData(complete.get(), nullptr, 0, 0)) == S_FALSE) {
      if (closed.load() || std::chrono::steady_clock::now() >= deadline) return;
      Sleep(0);
    }
    check_hresult(copyStatus);
    auto resource = frame->texture.as<IDXGIResource1>();
    check_hresult(resource->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &frame->handle));
    if (closed.load()) return;
    {
      std::lock_guard lock(mutex);
      frames.emplace(frame->id, frame);
    }
    auto* queued = new std::shared_ptr<Frame>(frame);
    if (napi_call_threadsafe_function(callback, queued, napi_tsfn_nonblocking) != napi_ok) {
      delete queued;
      Release(frame->id);
    } else lastFrame = now;
  }

  void Run() {
    while (!closed.load()) {
      try {
        if (!duplication) {
          SetCaptureExclusion(window, true);
          check_hresult(DwmFlush());
          OpenDuplication();
        }
        DXGI_OUTDUPL_FRAME_INFO information{};
        com_ptr<IDXGIResource> resource;
        const auto result = duplication->AcquireNextFrame(50, &information, resource.put());
        if (result == DXGI_ERROR_WAIT_TIMEOUT) continue;
        if (result == DXGI_ERROR_ACCESS_LOST || result == DXGI_ERROR_DEVICE_REMOVED || result == DXGI_ERROR_DEVICE_RESET) {
          duplication = nullptr;
          continue;
        }
        check_hresult(result);
        struct FrameLease {
          IDXGIOutputDuplication* duplicate;
          ~FrameLease() { duplicate->ReleaseFrame(); }
        } lease{duplication.get()};
        // Pointer-only acquisitions still update visibility metadata, but can
        // precede the first usable desktop texture. Retain the renderer's last
        // desktop frame instead of publishing an unpresented/transparent image.
        const bool safePointer = PointerIsSafe(information);
        if (closed.load() || !safePointer || information.LastPresentTime.QuadPart == 0) continue;
        DWORD affinity = WDA_NONE;
        if (!GetWindowDisplayAffinity(window, &affinity) || affinity != WDA_EXCLUDEFROMCAPTURE) {
          SetCaptureExclusion(window, true);
          check_hresult(DwmFlush());
          continue;
        }
        CopyFrame(resource.as<ID3D11Texture2D>().get());
      } catch (...) {
        duplication = nullptr;
        // Secure desktops, lock/resume and adapter resets can invalidate a
        // duplication session. Reopen without ever falling back to cursor capture.
        for (int wait = 0; wait < 10 && !closed.load(); ++wait) Sleep(20);
      }
    }
    duplication = nullptr;
    output = nullptr;
    context = nullptr;
    device = nullptr;
    if (callback) {
      napi_release_threadsafe_function(callback, napi_tsfn_abort);
      callback = nullptr;
    }
  }

  void Start(HWND captureWindow) {
    window = captureWindow;
    SetCaptureExclusion(window, true);
    monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
    if (!monitor) throw hresult_error(E_INVALIDARG, L"The window has no monitor");
    check_hresult(DwmFlush());
    OpenDuplication();
    worker = std::thread([this] { Run(); });
  }
};

napi_value Number(napi_env env, double value) { napi_value result; napi_create_double(env, value, &result); return result; }
void Property(napi_env env, napi_value target, char const* key, double value) { napi_set_named_property(env, target, key, Number(env, value)); }

napi_value SetWindowCaptureExcluded(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool excluded = false;
  if (argc != 2 || napi_get_value_bool(env, argv[1], &excluded) != napi_ok) {
    napi_throw_type_error(env, nullptr, "setWindowCaptureExcluded requires a window handle and boolean");
    return nullptr;
  }
  HWND window = nullptr;
  if (!ReadWindow(env, argv[0], &window)) return nullptr;
  try { return Number(env, SetCaptureExclusion(window, excluded)); }
  catch (hresult_error const& error) {
    const auto message = to_string(error.message());
    napi_throw_error(env, nullptr, message.c_str());
    return nullptr;
  }
}

void Deliver(napi_env env, napi_value callback, void* context, void* data) {
  std::unique_ptr<std::shared_ptr<Frame>> queued(static_cast<std::shared_ptr<Frame>*>(data));
  if (!queued) return;
  auto* owner = static_cast<std::weak_ptr<Capture>*>(context);
  auto capture = owner->lock();
  if (!env || !callback || !capture || capture->closed.load()) { if (capture) capture->Release((*queued)->id); return; }
  const auto& frame = *queued;
  napi_value result;
  napi_create_object(env, &result);
  Property(env, result, "id", frame->id);
  Property(env, result, "width", frame->width);
  Property(env, result, "height", frame->height);
  Property(env, result, "timestamp", static_cast<double>(frame->timestamp));
  napi_value handle;
  napi_create_buffer_copy(env, sizeof(HANDLE), &frame->handle, nullptr, &handle);
  napi_set_named_property(env, result, "ntHandle", handle);
  napi_value global;
  napi_get_undefined(env, &global);
  napi_value ignored;
  if (napi_call_function(env, global, callback, 1, &result, &ignored) != napi_ok)
    capture->Release(frame->id);
}

std::shared_ptr<Capture>* Unwrap(napi_env env, napi_callback_info info, size_t* argc, napi_value* argv) {
  napi_value self;
  napi_get_cb_info(env, info, argc, argv, &self, nullptr);
  std::shared_ptr<Capture>* state = nullptr;
  napi_unwrap(env, self, reinterpret_cast<void**>(&state));
  return state;
}

napi_value Close(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  if (auto state = Unwrap(env, info, &argc, nullptr)) (*state)->Close();
  return nullptr;
}

napi_value Release(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  auto state = Unwrap(env, info, &argc, argv);
  uint32_t id = 0;
  if (state && argc == 1 && napi_get_value_uint32(env, argv[0], &id) == napi_ok) (*state)->Release(id);
  return nullptr;
}

napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_value handle, callback;
  bool buffer = false;
  napi_valuetype callbackType = napi_undefined;
  if (argc != 1 || napi_get_named_property(env, argv[0], "windowHandle", &handle) != napi_ok ||
      napi_is_buffer(env, handle, &buffer) != napi_ok || !buffer ||
      napi_get_named_property(env, argv[0], "onFrame", &callback) != napi_ok ||
      napi_typeof(env, callback, &callbackType) != napi_ok || callbackType != napi_function) {
    napi_throw_type_error(env, nullptr, "createCapture requires { windowHandle: Buffer, onFrame: function }");
    return nullptr;
  }
  HWND window = nullptr;
  if (!ReadWindow(env, handle, &window)) return nullptr;
  auto capture = std::make_shared<Capture>();
  auto* weak = new std::weak_ptr<Capture>(capture);
  napi_value label;
  napi_create_string_utf8(env, "Violet cursor-free DXGI", NAPI_AUTO_LENGTH, &label);
  napi_status status = napi_create_threadsafe_function(env, callback, nullptr, label, 3, 1, weak,
    [](napi_env, void* data, void*) { delete static_cast<std::weak_ptr<Capture>*>(data); },
    weak, Deliver, &capture->callback);
  if (status != napi_ok) { delete weak; napi_throw_error(env, nullptr, "Could not initialize frame delivery"); return nullptr; }
  napi_unref_threadsafe_function(env, capture->callback);
  try { capture->Start(window); }
  catch (hresult_error const& error) {
    capture->Close();
    const auto message = to_string(error.message());
    napi_throw_error(env, nullptr, message.c_str());
    return nullptr;
  }
  napi_value controller;
  napi_create_object(env, &controller);
  auto* state = new std::shared_ptr<Capture>(capture);
  napi_wrap(env, controller, state, [](napi_env, void* data, void*) {
    auto* owner = static_cast<std::shared_ptr<Capture>*>(data);
    (*owner)->Close();
    delete owner;
  }, nullptr, nullptr);
  napi_property_descriptor properties[] = {
    {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"releaseFrame", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, controller, 2, properties);
  napi_value disabled;
  napi_get_boolean(env, false, &disabled);
  napi_property_descriptor cursor{"cursorCaptureEnabled", nullptr, nullptr, nullptr, nullptr, disabled, napi_enumerable, nullptr};
  napi_define_properties(env, controller, 1, &cursor);
  napi_value excluded;
  napi_get_boolean(env, true, &excluded);
  napi_property_descriptor exclusion{"captureExcluded", nullptr, nullptr, nullptr, nullptr, excluded, napi_enumerable, nullptr};
  napi_define_properties(env, controller, 1, &exclusion);
  Property(env, controller, "displayAffinity", WDA_EXCLUDEFROMCAPTURE);
  napi_value backend;
  napi_create_string_utf8(env, "dxgi-desktop-duplication", NAPI_AUTO_LENGTH, &backend);
  napi_property_descriptor backendProperty{"backend", nullptr, nullptr, nullptr, nullptr, backend, napi_enumerable, nullptr};
  napi_define_properties(env, controller, 1, &backendProperty);
  return controller;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"createCapture", nullptr, Create, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setWindowCaptureExcluded", nullptr, SetWindowCaptureExcluded, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, properties);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
