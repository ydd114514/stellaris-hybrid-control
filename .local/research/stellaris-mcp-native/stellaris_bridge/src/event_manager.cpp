#include "event_manager.hpp"
#include "game_state.hpp"
#include "command_builder.hpp"
#include "sdk/stellaris_sdk.hpp"
#include "cyberfish_war.hpp"

namespace bridge {

#pragma pack(push, 1)
struct RawPdxString {
    union {
        char buf[16];
        char* heap_ptr;
    };
    uint64_t size;
    uint64_t capacity;
};

struct OptionNode {
    void* button;
    void* unk_8;
    OptionNode* next;
};
#pragma pack(pop)

// Safe wrappers to avoid C2712 SEH unwind conflicts
static bool SafeReadPtr(const void* addr, void** out) {
    __try {
        *out = *(void**)addr;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static bool SafeReadU32(const void* addr, uint32_t* out) {
    __try {
        *out = *(const uint32_t*)addr;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static bool SafeReadInt(const void* addr, int* out) {
    __try {
        *out = *(const int*)addr;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static bool SafeReadU8(const void* addr, uint8_t* out) {
    __try {
        *out = *(const uint8_t*)addr;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static bool SafeCopyChars(char* dest, const char* src, size_t count) {
    __try {
        memcpy(dest, src, count);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static void* SafeFindChild(EventManager::FnFindChild fn, void* container, void* pdx_str) {
    __try {
        return fn(container, pdx_str);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return nullptr;
    }
}

static bool SafeSelectOption(EventManager::FnSelectOption fn, void* win, int option_index) {
    __try {
        fn(win, option_index);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

using FnViewCall = void (*)(void* view);
static bool SafeViewCall(FnViewCall fn, void* view) {
    __try {
        fn(view);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

EventManager& EventManager::Get() {
    static EventManager instance;
    return instance;
}

bool EventManager::Init(uintptr_t base_address) {
    base_address_ = base_address;

    fn_find_child_ = nullptr;
    fn_select_option_ = SdkMatchesImage(base_address_)
        ? (FnSelectOption)(base_address_ + sdk::fn::CEventWindow_PostEventOptionSelection) : nullptr;

    return true;
}

static std::string CleanPdxString(const std::string& input) {
    return RenderPdxMarkup(input);
}

std::string EventManager::ExtractPdxString(void* ptr) {
    if (!ptr) return "";

    RawPdxString raw{};
    if (!SafeCopyChars((char*)&raw, (const char*)ptr, sizeof(RawPdxString))) {
        return "";
    }

    if (raw.size == 0) return "";

    if (raw.capacity < 16) {
        size_t len = raw.size < 16 ? (size_t)raw.size : 15;
        char temp[16]{ 0 };
        if (SafeCopyChars(temp, raw.buf, len)) {
            temp[len] = '\0';
            return CleanPdxString(std::string(temp, len));
        }
    } else if (raw.heap_ptr) {
        uintptr_t addr = (uintptr_t)raw.heap_ptr;
        if (addr > 0x10000 && addr < 0x7FFFFFFFFFFF) {
            size_t len = raw.size < 4096 ? (size_t)raw.size : 4096;
            std::string result(len, '\0');
            if (SafeCopyChars(&result[0], raw.heap_ptr, len)) {
                return CleanPdxString(result);
            }
        }
    }
    return "";
}

void* EventManager::FindChildByName(void* container, const char* name) {
    if (!container || !name) return nullptr;

    void* keys_arr = nullptr;
    uint32_t cnt = 0;
    void* vals_arr = nullptr;

    if (SafeReadPtr((const void*)((uintptr_t)container + 0x710), &keys_arr) &&
        SafeReadU32((const void*)((uintptr_t)container + 0x71C), &cnt) &&
        SafeReadPtr((const void*)((uintptr_t)container + 0x6F8), &vals_arr) &&
        keys_arr && vals_arr && cnt > 0 && cnt < 200) {

        for (uint32_t i = 0; i < cnt; ++i) {
            std::string k_name = ExtractPdxString((void*)((uintptr_t)keys_arr + i * 48 + 16));
            if (_stricmp(k_name.c_str(), name) == 0) {
                void* ctrl = nullptr;
                if (SafeReadPtr((const void*)((uintptr_t)vals_arr + i * 8), &ctrl) && ctrl) {
                    return ctrl;
                }
            }
        }
    }

    // Recurse into child containers in [container + 0x878]
    void* c_arr = nullptr;
    uint32_t c_cnt = 0;
    if (SafeReadPtr((const void*)((uintptr_t)container + 0x878), &c_arr) &&
        SafeReadU32((const void*)((uintptr_t)container + 0x884), &c_cnt) &&
        c_arr && c_cnt > 0 && c_cnt < 50) {

        for (uint32_t j = 0; j < c_cnt; ++j) {
            void* child = nullptr;
            if (SafeReadPtr((const void*)((uintptr_t)c_arr + j * 8), &child) && child) {
                void* found = FindChildByName(child, name);
                if (found) return found;
            }
        }
    }

    return nullptr;
}

// 4.5.2 audit: CFirstContactView::UpdateEvent (113B670) inserts option
// wrappers (113E900) into COverlappingElementsBox, not GUI container children.
// The box keeps its live wrapper vector at +278/+284. Callback 113EE90 is
// the exact signal handler installed by the normal option constructor.
std::vector<void*> EventManager::FirstContactOptions(void* view) {
    std::vector<void*> result;
    if(!FirstContactPending(view)) return result;
    void *box=nullptr,*array=nullptr; uint32_t count=0;
    if(!view || !SafeReadPtr((uint8_t*)view+0xE0,&box) || !box ||
       !SafeReadPtr((uint8_t*)box+0x278,&array) ||
       !SafeReadU32((uint8_t*)box+0x284,&count) || count>32 || (count&&!array)) return result;
    for(uint32_t i=0;i<count;++i) {
        void *option=nullptr,*owner=nullptr; uintptr_t vt=0;
        if(!SafeReadPtr((uint8_t*)array+i*8,&option) || !option ||
           !SafeCopyChars((char*)&vt,(char*)option,sizeof(vt)) || vt!=base_address_+0x2411358 ||
           !SafeReadPtr((uint8_t*)option+0x60,&owner) || owner!=view) return {};
        result.push_back(option);
    }
    return result;
}
bool EventManager::FirstContactPending(void* view) {
    __try {
        auto* db=*(uint8_t**)(base_address_+0x3114B70);
        if(!db || !view) return false;
        auto id=*(uint32_t*)((uint8_t*)view+0x628),slot=id&0xFFFFFF;
        if(slot>=*(uint32_t*)(db+0x20)) return false;
        auto* array=*(uint8_t**)(db+0x18);if(!array)return false;
        auto* contact=*(uint8_t**)(array+slot*16+8);
        if(!contact || *(uint32_t*)(contact+8)!=id ||
           *(uint32_t*)(contact+0x2C)!=GameState::Get().GetPlayerCountryId() ||
           *(uint8_t*)(contact+0xC0) || !*(void**)(contact+0xC8))return false;
        auto* scope=contact+0xD0;
        return ((bool(*)(void*))(*(void***)scope)[0x38/8])(scope);
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}
bool EventManager::FirstContactOptionValid(void* view,void* option) {
    // Same potential/allow checks used by UpdateEvent; never bypass a disabled
    // option. The view's event scope is constructed by the game itself.
    __try {
        auto* p=(uint8_t*)option; auto* v=(uint8_t*)view;
        auto* definition=*(void**)(p+0x68); auto* button=*(void**)(p+0x80);
        if(!definition || !button || *(uint8_t*)(v+0x648) || !*(void**)(v+0x650)) return false;
        auto potential=(bool(*)(void*,void*,bool,void*))(base_address_+0xA22CA0);
        auto allow=(bool(*)(void*,void*))(base_address_+0xA23220);
        return potential(definition,v+0x658,true,nullptr) && allow(definition,v+0x658);
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}

// ---- data behind a standard event window -------------------------------------------------
// CEventWindow (as listed at [idler + 0x170]): +0xA1C id of its COpenPlayerEvent (Setup reads it
// for CGameState::GetOpenPlayerEvent). CGameState: +0x180 COpenPlayerEvent* array, +0x18C count.
// COpenPlayerEvent: +0x8 CEventHandle* (-> CEvent*), +0x10 CEventScope (sdk::ent).
// CEvent: +0x10 CString script id, +0x5E0 CPdxArray of options, +0x590 pointer whose CEffect at
// +0x60 is passed with the option (both as CEventWindow::GetToolTip passes them).
constexpr std::ptrdiff_t kWinOpenEventId = 0xA1C;
constexpr std::ptrdiff_t kGsOpenEvents = 0x180;
constexpr std::ptrdiff_t kGsOpenEventCount = 0x18C;
constexpr std::ptrdiff_t kEventKey = 0x10 + 0x10;  // CString header, then its std::string
// CPdxArray of 0x10-byte entries {CEventOption*, ..}: data +8, size +0x14
constexpr std::ptrdiff_t kArrayData = 0x8, kArraySize = 0x14, kOptionEntry = 0x10;
constexpr std::ptrdiff_t kEventOptionEffectOwner = 0x590;
constexpr std::ptrdiff_t kEffectInOwner = 0x60;

struct EventTextCtx {
    uintptr_t fn;
    void* event;
    void* scope;
    void* options;
    int index;
    void* effect;
};

static void CallEventTitle(void* c, void* out) {
    auto* x = (EventTextCtx*)c;
    ((void* (*)(void*, void*, void*))x->fn)(x->event, out, x->scope);
}

static void CallEventDesc(void* c, void* out) {
    auto* x = (EventTextCtx*)c;
    ((void* (*)(void*, void*, void*))x->fn)(out, x->event, x->scope);
}

static void CallOptionEffects(void* c, void* out) {
    auto* x = (EventTextCtx*)c;
    ((void* (*)(void*, void*, bool, void*, int, void*, bool))x->fn)(out, x->scope, false, x->options, x->index,
                                                                    x->effect, true);
}

struct OptionCall {
    uintptr_t fn;
    const void* a;
    const void* b;
    const void* c;
    bool flag;
    int result;
};
static void CallFindExclusive(void* p, void*) {
    auto* x = (OptionCall*)p;
    x->result = ((int (*)(const void*, bool, const void*))x->fn)(x->a, x->flag, x->b);
}
static void CallIsPotential(void* p, void*) {
    auto* x = (OptionCall*)p;
    x->result = ((bool (*)(const void*, const void*, bool, bool))x->fn)(x->a, x->b, x->flag, true);
}
static void CallIsAllowed(void* p, void*) {
    auto* x = (OptionCall*)p;
    x->result = ((bool (*)(const void*, const void*))x->fn)(x->a, x->b);
}
static void CallOptionName(void* p, void* out) {
    auto* x = (OptionCall*)p;
    ((void* (*)(const void*, void*, const void*))x->fn)(x->a, out, x->b);
}

static void* FindOpenPlayerEvent(uintptr_t base, uint32_t id) {
    void* gs = nullptr;
    void** arr = nullptr;
    int count = 0;
    if (!SafeReadPtr((const void*)(base + sdk::glob::g_CurrentGameState), &gs) || !gs ||
        !SafeReadPtr((const void*)((uintptr_t)gs + kGsOpenEvents), (void**)&arr) || !arr ||
        !SafeReadInt((const void*)((uintptr_t)gs + kGsOpenEventCount), &count) || count <= 0 || count > 512) {
        return nullptr;
    }
    for (int i = 0; i < count; ++i) {
        void* ope = nullptr;
        uint32_t ope_id = 0xFFFFFFFF;
        if (SafeReadPtr(&arr[i], &ope) && ope &&
            SafeReadU32((const void*)((uintptr_t)ope + sdk::ent::COpenPlayerEvent::id), &ope_id) && ope_id == id) {
            return ope;
        }
    }
    return nullptr;
}

// Fills title, description, script id and per-option effects of a standard event window from the
// event and scope it was opened with, through the engine functions the window itself uses.
void EventManager::ReadEventData(void* win, EventInfo& info) {
    uint32_t open_id = 0xFFFFFFFF;
    if (!SafeReadU32((const void*)((uintptr_t)win + kWinOpenEventId), &open_id)) {
        return;
    }
    void* ope = FindOpenPlayerEvent(base_address_, open_id);
    void* handle = nullptr;
    void* event = nullptr;
    if (!ope || !SafeReadPtr((const void*)((uintptr_t)ope + sdk::ent::COpenPlayerEvent::event), &handle) || !handle ||
        !SafeReadPtr(handle, &event) || !event) {
        return;
    }
    info.open_event_id = open_id;
    info.event_key = ExtractPdxString((void*)((uintptr_t)event + kEventKey));

    auto& cb = CommandBuilder::Get();
    EventTextCtx ctx{};
    ctx.event = event;
    ctx.scope = (void*)((uintptr_t)ope + sdk::ent::COpenPlayerEvent::scope);
    std::string text;
    ctx.fn = base_address_ + sdk::fn::CEvent_GetTitle;
    if (cb.CallForText(&CallEventTitle, &ctx, &text) && !text.empty()) {
        info.title = CleanPdxString(text);
    }
    text.clear();
    ctx.fn = base_address_ + sdk::fn::NEventWindowUtil_GetEventWindowDesc;
    if (cb.CallForText(&CallEventDesc, &ctx, &text) && !text.empty()) {
        info.description = CleanPdxString(text);
    }

    ReadShownOptions(win, event, info);

    void* effect_owner = nullptr;
    SafeReadPtr((const void*)((uintptr_t)event + kEventOptionEffectOwner), &effect_owner);
    ctx.fn = base_address_ + sdk::fn::CEventOption_GetDescForOptionAtIndex;
    ctx.options = (void*)((uintptr_t)event + sdk::rt::CEvent_options);
    ctx.effect = effect_owner ? (void*)((uintptr_t)effect_owner + kEffectInOwner) : nullptr;
    for (auto& opt : info.options) {
        text.clear();
        ctx.index = opt.index;
        if (cb.CallForText(&CallOptionEffects, &ctx, &text)) {
            opt.effects = CleanPdxString(text);
        }
    }
}

// The options the window shows, as CEventWindow::Setup picks them (the matching exclusive option,
// else every potential one), with their text and whether they can be chosen. Works for every event
// window type (standard, leader story ...), unlike the window's own button list. The index is the
// option's place in the event, what the button carries and PostEventOptionSelection takes.
void EventManager::ReadShownOptions(void* win, void* event, EventInfo& info) {
    auto& cb = CommandBuilder::Get();
    const void* scope = (const void*)((uintptr_t)win + sdk::rt::CEventWindow_scope);
    uint8_t flag = 0;
    SafeReadU8((const void*)((uintptr_t)win + sdk::rt::CEventWindow_option_flag), &flag);
    const uintptr_t options = (uintptr_t)event + sdk::rt::CEvent_options;
    void* data = nullptr;
    uint32_t count = 0;
    if (!SafeReadPtr((const void*)(options + kArrayData), &data) || !data ||
        !SafeReadU32((const void*)(options + kArraySize), &count) || count == 0 || count > 64) {
        return;
    }
    auto option_at = [&](uint32_t i) {
        void* opt = nullptr;
        SafeReadPtr((const void*)((uintptr_t)data + i * kOptionEntry), &opt);
        return opt;
    };

    std::vector<uint32_t> shown;
    OptionCall find{ base_address_ + sdk::fn::CEventOption_FindMatchingPotentialExclusiveOptionIndex, scope,
                     (const void*)options, nullptr, flag != 0, -1 };
    if (!cb.CallGuarded(&CallFindExclusive, &find)) return;
    if (find.result >= 0 && (uint32_t)find.result < count) {
        shown.push_back((uint32_t)find.result);
    } else {
        for (uint32_t i = 0; i < count; ++i) {
            OptionCall pot{ base_address_ + sdk::fn::CEventOption_IsPotentialIgnoreExclusive, option_at(i), scope,
                            nullptr, flag != 0, 0 };
            if (pot.a && cb.CallGuarded(&CallIsPotential, &pot) && pot.result) shown.push_back(i);
        }
    }

    std::vector<EventOptionInfo> out;
    for (uint32_t i : shown) {
        void* opt = option_at(i);
        if (!opt) continue;
        EventOptionInfo o;
        o.index = (int)i;
        OptionCall name{ base_address_ + sdk::fn::CEventOption_GetName,
                         (const void*)((uintptr_t)opt + sdk::rt::CEventOption_name), scope, nullptr, false, 0 };
        std::string text;
        if (cb.CallForText(&CallOptionName, &name, &text)) o.text = CleanPdxString(text);
        OptionCall allowed{ base_address_ + sdk::fn::CEventOption_IsAllowedSkipPotential, opt, scope, nullptr, false, 0 };
        o.is_valid = cb.CallGuarded(&CallIsAllowed, &allowed) && allowed.result;
        // the window's own button text when the name call gave none
        for (const auto& b : info.options) {
            if (b.index == o.index && o.text.empty()) o.text = b.text;
        }
        out.push_back(o);
    }
    if (!out.empty()) info.options = std::move(out);
}

// A CInGameIdler window view (start screen / anomaly / first contact) when it is the class the SDK
// names and its gui window is shown.
void* EventManager::ShownView(void* idler, std::ptrdiff_t member, uintptr_t vtable_rva) {
    void* view = nullptr;
    void* vt = nullptr;
    void* ui_window = nullptr;
    uint8_t shown = 0;
    if (!SafeReadPtr((const void*)((uintptr_t)idler + member), &view) || !view) return nullptr;
    if (!SafeReadPtr(view, &vt) || (uintptr_t)vt != base_address_ + vtable_rva) return nullptr;
    if (!SafeReadPtr((const void*)((uintptr_t)view + 0x78), &ui_window) || !ui_window) return nullptr;
    if (!SafeReadU8((const void*)((uintptr_t)ui_window + 0x41), &shown) || !shown) return nullptr;
    return view;
}

// The view's CGuiView::Hide override (slot from the SDK, read from its own vtable)
bool EventManager::HideView(void* view) {
    void* vt = nullptr;
    void* fn = nullptr;
    if (!SafeReadPtr(view, &vt) || !vt) return false;
    if (!SafeReadPtr((const void*)((uintptr_t)vt + sdk::vt::CGuiView_Hide * sizeof(void*)), &fn) || !fn) return false;
    return SafeViewCall((FnViewCall)fn, view);
}

std::vector<EventInfo> EventManager::GetActiveEvents() {
    std::vector<EventInfo> events;

    void* idler = GameState::Get().GetInGameIdler();
    if (!idler) {
        return events;
    }

    // 1. Check Opening Start Screen ("开局背景特殊事件") at [idler + 0xBE8]
    void* start_screen = ShownView(idler, sdk::rt::CInGameIdler_CStartScreenWindow, sdk::vt::CStartScreenWindow);
    if (start_screen) {
        void* ui_window = nullptr;
        if (SafeReadPtr((const void*)((uintptr_t)start_screen + 0x78), &ui_window) && ui_window) {
            {
                EventInfo start_ev;
                start_ev.window_id = START_SCREEN_EVENT_ID;

                // Title: empire_name - origin_name
                void* emp_ctrl = FindChildByName(ui_window, "empire_name");
                std::string emp_name = emp_ctrl ? ExtractPdxString((void*)((uintptr_t)emp_ctrl + 0x168)) : "";

                void* orig_ctrl = FindChildByName(ui_window, "origin_name");
                std::string orig_name = orig_ctrl ? ExtractPdxString((void*)((uintptr_t)orig_ctrl + 0x168)) : "";

                if (!emp_name.empty() && !orig_name.empty()) {
                    start_ev.title = emp_name + " - " + orig_name;
                } else if (!emp_name.empty()) {
                    start_ev.title = emp_name;
                } else {
                    start_ev.title = "开局帝国背景";
                }

                // Description: starting_description
                void* desc_ctrl = FindChildByName(ui_window, "starting_description");
                if (desc_ctrl) {
                    start_ev.description = ExtractPdxString((void*)((uintptr_t)desc_ctrl + 0x168));
                }

                // Close Button Option
                void* close_btn = FindChildByName(ui_window, "close");
                std::string btn_text = close_btn ? ExtractPdxString((void*)((uintptr_t)close_btn + 0x168)) : "";
                if (btn_text.empty()) {
                    btn_text = "我们的征途是星辰大海！";
                }

                start_ev.options.push_back({ 0, btn_text, true });
                events.push_back(start_ev);
            }
        }
    }

    // 2. Check Anomaly Window ("异常现象发现窗口") at [idler + 0xB08]
    void* anomaly_view = ShownView(idler, sdk::rt::CInGameIdler_CAnomalyWindow, sdk::vt::CAnomalyWindow);
    if (anomaly_view) {
        void* ui_window = nullptr;
        if (SafeReadPtr((const void*)((uintptr_t)anomaly_view + 0x78), &ui_window) && ui_window) {
            {
                EventInfo anom_ev;
                anom_ev.window_id = ANOMALY_EVENT_ID;

                // Anomaly title & description from header_win at [anomaly_view + 0xD0]
                void* header_win = nullptr;
                SafeReadPtr((const void*)((uintptr_t)anomaly_view + 0xD0), &header_win);

                std::string header_str;
                std::string desc_str;
                if (header_win) {
                    header_str = ExtractPdxString((void*)((uintptr_t)header_win + 0x168));
                    desc_str = ExtractPdxString((void*)((uintptr_t)header_win + 0x12E8));
                }

                if (!header_str.empty()) {
                    anom_ev.title = header_str;
                } else {
                    void* title_ctrl = FindChildByName(ui_window, "title");
                    std::string title_str = title_ctrl ? ExtractPdxString((void*)((uintptr_t)title_ctrl + 0x168)) : "";
                    anom_ev.title = !title_str.empty() ? title_str : "异常现象";
                }

                if (!desc_str.empty()) {
                    anom_ev.description = desc_str;
                } else {
                    void* anom_sub_win = FindChildByName(ui_window, "anomaly_window");
                    if (anom_sub_win) {
                        void* desc_ctrl = FindChildByName(anom_sub_win, "desc");
                        if (desc_ctrl) anom_ev.description = ExtractPdxString((void*)((uintptr_t)desc_ctrl + 0x168));
                    }
                }

                // Option 0: ok ("暂时离开")
                void* ok_btn = FindChildByName(ui_window, "ok");
                std::string ok_text = ok_btn ? ExtractPdxString((void*)((uintptr_t)ok_btn + 0x168)) : "";
                if (ok_text.empty()) ok_text = "暂时离开";
                anom_ev.options.push_back({ 0, ok_text, true });

                // Option 1: research ("调查")
                void* res_btn = FindChildByName(ui_window, "research");
                std::string res_text = res_btn ? ExtractPdxString((void*)((uintptr_t)res_btn + 0x168)) : "";
                if (res_text.empty()) res_text = "调查";
                anom_ev.options.push_back({ 1, res_text, true });

                events.push_back(anom_ev);
            }
        }
    }

    // 3. Check First Contact View ("第一次接触事件/阶段窗口") at [idler + 0xC90]
    void* fc_view = ShownView(idler, sdk::rt::CInGameIdler_CFirstContactView, sdk::vt::CFirstContactView);
    if (fc_view) {
        void* ui_window = nullptr;
        if (SafeReadPtr((const void*)((uintptr_t)fc_view + 0x78), &ui_window) && ui_window) {
            {
                EventInfo fc_ev;
                fc_ev.window_id = FIRST_CONTACT_EVENT_ID;
                fc_ev.kind = "first_contact_information";
                SafeReadU32((uint8_t*)fc_view+0x628,&fc_ev.first_contact_id);

                // Title: site_name + " - " + chapter_subtitle
                void* site_ctrl = FindChildByName(ui_window, "site_name");
                std::string site_name = site_ctrl ? ExtractPdxString((void*)((uintptr_t)site_ctrl + 0x168)) : "";

                void* sub_ctrl = FindChildByName(ui_window, "chapter_subtitle");
                std::string subtitle = sub_ctrl ? ExtractPdxString((void*)((uintptr_t)sub_ctrl + 0x168)) : "";

                void* stage_ctrl = FindChildByName(ui_window, "title_text");
                std::string stage_name = stage_ctrl ? ExtractPdxString((void*)((uintptr_t)stage_ctrl + 0x168)) : "";

                if (!site_name.empty() && !subtitle.empty()) {
                    fc_ev.title = site_name + " - " + subtitle;
                } else if (!site_name.empty()) {
                    fc_ev.title = site_name;
                } else {
                    fc_ev.title = "第一次接触事件";
                }
                if (!stage_name.empty()) {
                    fc_ev.title += " (" + stage_name + ")";
                }

                // Description: check description control, or locked status text
                void* desc_ctrl = FindChildByName(ui_window, "description");
                std::string desc_str = desc_ctrl ? ExtractPdxString((void*)((uintptr_t)desc_ctrl + 0x168)) : "";
                if (desc_str.empty() && desc_ctrl) {
                    desc_str = ExtractPdxString((void*)((uintptr_t)desc_ctrl + 0x268));
                }

                if (desc_str.empty()) {
                    void* status_text_ctrl = FindChildByName(ui_window, "text");
                    if (status_text_ctrl) {
                        desc_str = ExtractPdxString((void*)((uintptr_t)status_text_ctrl + 0x168));
                    }
                }
                if (desc_str.empty()) {
                    void* no_rep_ctrl = FindChildByName(ui_window, "no_report_text");
                    if (no_rep_ctrl) {
                        desc_str = ExtractPdxString((void*)((uintptr_t)no_rep_ctrl + 0x168));
                    }
                }
                fc_ev.description = desc_str;

                for(auto* option:FirstContactOptions(fc_view)) {
                    void* text=nullptr; uint32_t index=0;
                    SafeReadPtr((uint8_t*)option+0x78,&text);
                    SafeReadU32((uint8_t*)option+0x70,&index);
                    auto label=text?ExtractPdxString((uint8_t*)text+0x168):std::string();
                    if(index<128 && !label.empty())
                        fc_ev.options.push_back({(int)index,label,FirstContactOptionValid(fc_view,option)});
                }
                if(!fc_ev.options.empty()) {
                    fc_ev.kind="first_contact_choice";
                    // Report entries are wrappers in the text-list linked list.
                    // Read their displayed description, not hidden block_window text.
                    void *list=nullptr,*node=nullptr;
                    SafeReadPtr((uint8_t*)fc_view+0xD8,&list);
                    if(list) SafeReadPtr((uint8_t*)list+0x100,&node);
                    std::string report;
                    for(int n=0;node && n<16;++n) {
                        void *entry=nullptr,*ui=nullptr,*next=nullptr;
                        SafeReadPtr(node,&entry);
                        // CTextListBox stores the entry's +48 interface, not
                        // its primary object; ctor 113E1A0 binds GUI at +70.
                        if(entry) SafeReadPtr((uint8_t*)entry+0x28,&ui);
                        void* ctrl=nullptr;
                        if(entry) SafeReadPtr((uint8_t*)entry+0xD8,&ctrl);
                        if(!ctrl) ctrl=FindChildByName(ui,"description");
                        auto text=ctrl?ExtractPdxString((uint8_t*)ctrl+0x168):std::string();
                        if(!text.empty()) {if(!report.empty())report+="\n";report+=text;}
                        SafeReadPtr((uint8_t*)node+0x10,&next);node=next;
                    }
                    fc_ev.description=report;
                } else fc_ev.options.push_back({0,"关闭接触信息面板（不推进调查）",true});

                events.push_back(fc_ev);
            }
        }
    }

    // 4. Check Standard Modal Event Windows at [idler + 0x170]
    void** windows = nullptr;
    uint32_t count = 0;

    if (!SafeReadPtr((const void*)((uintptr_t)idler + 0x170), (void**)&windows) ||
        !SafeReadU32((const void*)((uintptr_t)idler + 0x17c), &count)) {
        return events;
    }

    if (!windows || count == 0 || count > 200) {
        return events;
    }

    for (uint32_t i = 0; i < count; ++i) {
        void* win = nullptr;
        if (!SafeReadPtr((const void*)&windows[i], &win) || !win) {
            continue;
        }

        EventInfo info;
        SafeReadU32((const void*)((uintptr_t)win + 0x98), &info.window_id);

        void* ui_window = nullptr;
        SafeReadPtr((const void*)((uintptr_t)win + 0x78), &ui_window);

        if(cyberfish::IsWarDeclarationNotice(win)) {
            auto* heading=FindChildByName(ui_window,"heading");
            auto* text=FindChildByName(ui_window,"alien_message");
            info.title=(heading?ExtractPdxString((uint8_t*)heading+0x168):std::string())+" 宣战通知";
            info.description=text?ExtractPdxString((uint8_t*)text+0x168):std::string();
            info.event_key="cyberfish.war_declaration_notice";
            info.options.push_back({0,"确认（已选择战争目标后关闭通知）",true});
            events.push_back(info);
            continue;
        }

        if (ui_window) {
            // Extract Title
            void* title_ctrl = FindChildByName(ui_window, "title");
            if (!title_ctrl) title_ctrl = FindChildByName(win, "title");
            if (title_ctrl) {
                info.title = ExtractPdxString((void*)((uintptr_t)title_ctrl + 0x168));
                if (info.title.empty()) {
                    info.title = ExtractPdxString((void*)((uintptr_t)title_ctrl + 0x268));
                }
            }

            // Extract Description (search container tree for description)
            void* desc_ctrl = FindChildByName(ui_window, "description");
            if (!desc_ctrl) desc_ctrl = FindChildByName(win, "description");
            if (desc_ctrl) {
                info.description = ExtractPdxString((void*)((uintptr_t)desc_ctrl + 0x168));
                if (info.description.empty()) {
                    info.description = ExtractPdxString((void*)((uintptr_t)desc_ctrl + 0x268));
                }
            }
        }

        // Extract Options list from linked list at +0x9d8
        void* node = nullptr;
        SafeReadPtr((const void*)((uintptr_t)win + 0x9d8), &node);

        uint32_t opt_count = 0;
        SafeReadU32((const void*)((uintptr_t)win + 0x9e8), &opt_count);

        for (uint32_t o = 0; o < opt_count && node != nullptr; ++o) {
            void* button = nullptr;
            SafeReadPtr((const void*)((uintptr_t)node + 0), &button);

            if (button) {
                int opt_idx = 0;
                SafeReadInt((const void*)((uintptr_t)button + 0x20), &opt_idx);

                std::string opt_text = ExtractPdxString((void*)((uintptr_t)button + 0x268));
                if (opt_text.empty()) {
                    opt_text = ExtractPdxString((void*)((uintptr_t)button + 0x168));
                }

                info.options.push_back({ opt_idx, opt_text, true });
            }

            void* next_node = nullptr;
            SafeReadPtr((const void*)((uintptr_t)node + 16), &next_node);
            node = next_node;
        }

        ReadEventData(win, info);
        events.push_back(info);
    }

    return events;
}

nlohmann::json EventManager::GetActiveEventsJson() {
    auto events = GetActiveEvents();
    nlohmann::json arr = nlohmann::json::array();

    for (const auto& ev : events) {
        nlohmann::json opt_arr = nlohmann::json::array();
        for (const auto& opt : ev.options) {
            nlohmann::json o = {
                {"index", opt.index},
                {"text", opt.text},
                {"is_valid", opt.is_valid}
            };
            if (!opt.effects.empty()) o["effects"] = opt.effects;
            opt_arr.push_back(o);
        }

        nlohmann::json e = {
            {"window_id", ev.window_id},
            {"title", ev.title},
            {"description", ev.description},
            {"options", opt_arr}
        };
        if (!ev.event_key.empty()) e["event_key"] = ev.event_key;
        if (!ev.kind.empty()) e["kind"] = ev.kind;
        if (ev.first_contact_id!=0xFFFFFFFF) e["first_contact_id"] = ev.first_contact_id;
        arr.push_back(e);
    }

    return arr;
}

nlohmann::json EventManager::ResolveEvent(uint32_t window_id, int option_index) {
    void* idler = GameState::Get().GetInGameIdler();
    if (!idler) {
        return {
            {"error", {
                {"code", -32001},
                {"message", "InGameIdler is null"}
            }}
        };
    }

    auto fail = [](int code, const std::string& message) {
        return nlohmann::json{ {"error", { {"code", code}, {"message", message} }} };
    };
    auto done = [&](const char* message) {
        return nlohmann::json{
            {"success", true},
            {"resolved_window_id", window_id},
            {"selected_option", option_index},
            {"message", message}
        };
    };
    bool pseudo = window_id == START_SCREEN_EVENT_ID || window_id == ANOMALY_EVENT_ID ||
                  window_id == FIRST_CONTACT_EVENT_ID;
    if (pseudo && !CommandBuilder::Get().SdkMatchesExe()) {
        return fail(-32003, "SDK does not match this stellaris.exe; regenerate it with tools/sdk_dumper/dump.py");
    }

    // Start screen: CStartScreenWindow::Close, what its button runs (hide, focus the capital,
    // fire on_press_begin)
    if (window_id == START_SCREEN_EVENT_ID) {
        void* view = ShownView(idler, sdk::rt::CInGameIdler_CStartScreenWindow, sdk::vt::CStartScreenWindow);
        if (!view) return fail(-32002, "Start screen is not shown");
        LOG("[EVENT_MGR] Resolving start screen: CStartScreenWindow::Close");
        if (!SafeViewCall((FnViewCall)(base_address_ + sdk::fn::CStartScreenWindow_Close), view)) {
            return fail(-32004, "CStartScreenWindow::Close raised an exception");
        }
        return done("Start screen closed");
    }

    // Anomaly window: "leave be" hides it (the window's CGuiView::Hide override is OnLeaveBe);
    // research is a fleet order, stellaris_research_anomalies
    if (window_id == ANOMALY_EVENT_ID) {
        void* view = ShownView(idler, sdk::rt::CInGameIdler_CAnomalyWindow, sdk::vt::CAnomalyWindow);
        if (!view) return fail(-32010, "Anomaly window is not shown");
        if (option_index == 1) {
            return fail(-32013, "Research the anomaly with stellaris_research_anomalies (fleet_id of the science ship)");
        }
        if (option_index != 0) {
            return fail(-32015, "Invalid option_index for the anomaly window. Legal options: 0 (暂时离开), 1 (调查)");
        }
        if (!HideView(view)) return fail(-32012, "CAnomalyWindow::OnLeaveBe raised an exception");
        return done("Anomaly left be (暂时离开)");
    }

    // A pending first-contact option must run its real UI callback, not Hide.
    if (window_id == FIRST_CONTACT_EVENT_ID) {
        void* view = ShownView(idler, sdk::rt::CInGameIdler_CFirstContactView, sdk::vt::CFirstContactView);
        if (!view) return fail(-32016, "First contact view is not shown");
        auto options=FirstContactOptions(view);
        for(auto* option:options) {
            uint32_t index=0;SafeReadU32((uint8_t*)option+0x70,&index);
            if(index!=(uint32_t)option_index) continue;
            if(!FirstContactOptionValid(view,option)) return fail(-32011,"First contact option is disabled");
            if(!SafeViewCall((FnViewCall)(base_address_+0x113EE90),option))
                return fail(-32020,"First contact option callback raised an exception");
            auto result=done("First contact option selected through normal UI callback");
            result["phase"]="first_contact_choice_posted";
            return result;
        }
        if(!options.empty() || option_index!=0) return fail(-32009,"First contact option is not shown");
        if (!HideView(view)) return fail(-32020, "CFirstContactView::Hide raised an exception");
        auto result=done("First contact information panel closed; investigation not advanced");
        result["phase"]="first_contact_information_closed";
        return result;
    }

    // Handle Standard Modal Event Window
    void** windows = nullptr;
    uint32_t count = 0;

    if (!SafeReadPtr((const void*)((uintptr_t)idler + 0x170), (void**)&windows) ||
        !SafeReadU32((const void*)((uintptr_t)idler + 0x17c), &count)) {
        return {
            {"error", {
                {"code", -32005},
                {"message", "Failed to read active event windows array"}
            }}
        };
    }

    void* target_win = nullptr;
    for (uint32_t i = 0; i < count; ++i) {
        void* win = nullptr;
        if (SafeReadPtr((const void*)&windows[i], &win) && win) {
            uint32_t cur_id = 0;
            if (SafeReadU32((const void*)((uintptr_t)win + 0x98), &cur_id) && cur_id == window_id) {
                target_win = win;
                break;
            }
        }
    }

    if (!target_win) {
        return {
            {"error", {
                {"code", -32006},
                {"message", "Event window_id not found among active events"}
            }}
        };
    }

    if(cyberfish::IsWarDeclarationNotice(target_win)) {
        if(option_index!=0) return fail(-32009,"Only confirmation option 0 is available for this informational declaration");
        auto response=cyberfish::AcknowledgeWarDeclaration(target_win);
        response["resolved_window_id"]=window_id;response["selected_option"]=option_index;
        return response;
    }

    if (!fn_select_option_) {
        return {
            {"error", {
                {"code", -32007},
                {"message", "SDK does not match this stellaris.exe; regenerate it with tools/sdk_dumper/dump.py"}
            }}
        };
    }

    // PostEventOptionSelection does not check the index, so only accept an option the window shows
    // (hidden options fail their potential trigger and must not be picked).
    bool option_shown = false;
    bool option_valid = false;
    std::string shown;
    for (const auto& ev : GetActiveEvents()) {
        if (ev.window_id != window_id) continue;
        for (const auto& opt : ev.options) {
            if (opt.index == option_index) {
                option_shown = true;
                option_valid = opt.is_valid;
            }
            shown += (shown.empty() ? "" : ", ") + std::to_string(opt.index);
        }
    }
    if (!option_shown) {
        return {
            {"error", {
                {"code", -32009},
                {"message", "Option " + std::to_string(option_index) + " is not shown in event window " +
                                std::to_string(window_id) + " (available: " + shown + ")"}
            }}
        };
    }

    if (!option_valid) {
        return {
            {"error", {
                {"code", -32011},
                {"message", "Option " + std::to_string(option_index) + " is disabled in event window " +
                                std::to_string(window_id) + " (its allow conditions are not met)"}
            }}
        };
    }

    LOGF("[EVENT_MGR] Resolving standard event window_id %u with option %d...", window_id, option_index);
    if (!SafeSelectOption(fn_select_option_, target_win, option_index)) {
        LOGF("[EVENT_MGR] Exception in SelectOption for window_id %u", window_id);
        return {
            {"error", {
                {"code", -32008},
                {"message", "Exception occurred executing CEventWindow::SelectOption"}
            }}
        };
    }

    LOGF("[EVENT_MGR] Event window %u successfully resolved with option %d.", window_id, option_index);
    return {
        {"success", true},
        {"resolved_window_id", window_id},
        {"selected_option", option_index}
    };
}

} // namespace bridge
