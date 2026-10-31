// Evidence comes from the game's own rendered backbuffer, never the desktop.
#include "cyberfish_picture.hpp"
#include <filesystem>
#include <fstream>
#include <vector>
#include <wrl/client.h>
#include "fleet_access.hpp"
#include "game_state.hpp"
#include "command_builder.hpp"
#include <algorithm>

namespace bridge::cyberfish {
using Microsoft::WRL::ComPtr;
namespace {IDXGISwapChain* current = nullptr; uint64_t frames=0; void* managed_view=nullptr;}
void OnPresent(IDXGISwapChain* chain) {current=chain; ++frames;}
nlohmann::json PictureState() {
    DXGI_SWAP_CHAIN_DESC desc{};
    if (!current || FAILED(current->GetDesc(&desc))) return {{"rendering",false}};
    HWND window=desc.OutputWindow;
    RECT rect{}; GetClientRect(window,&rect);
    DWORD process=0; GetWindowThreadProcessId(window,&process);
    const bool visible=IsWindowVisible(window) && !IsIconic(window) &&
        process==GetCurrentProcessId() && rect.right>128 && rect.bottom>128;
    return {{"rendering",true},{"frames",frames},{"visible",visible},
            {"minimized",!!IsIconic(window)},{"foreground",GetForegroundWindow()==window},
            {"width",rect.right},{"height",rect.bottom}};
}
nlohmann::json CaptureFrame() {
    const auto picture=PictureState();
    if (!picture.value("visible",false)) return {{"success",false},{"error","Game picture is not visible"},{"picture",picture}};
    ComPtr<ID3D11Texture2D> buffer, staging, resolved;
    ComPtr<ID3D11Device> device; ComPtr<ID3D11DeviceContext> context;
    if (FAILED(current->GetBuffer(0,__uuidof(ID3D11Texture2D),(void**)buffer.GetAddressOf())))
        return {{"success",false},{"error","Game backbuffer unavailable"}};
    buffer->GetDevice(&device); device->GetImmediateContext(&context);
    D3D11_TEXTURE2D_DESC desc{}; buffer->GetDesc(&desc);
    if (desc.Width>4096 || desc.Height>2160 ||
        (desc.Format!=DXGI_FORMAT_R8G8B8A8_UNORM && desc.Format!=DXGI_FORMAT_B8G8R8A8_UNORM &&
         desc.Format!=DXGI_FORMAT_R8G8B8A8_UNORM_SRGB && desc.Format!=DXGI_FORMAT_B8G8R8A8_UNORM_SRGB))
        return {{"success",false},{"error","Unsupported evidence buffer format"},{"format",desc.Format}};
    const bool rgba=desc.Format==DXGI_FORMAT_R8G8B8A8_UNORM || desc.Format==DXGI_FORMAT_R8G8B8A8_UNORM_SRGB;
    if (desc.SampleDesc.Count>1) {
        auto single=desc; single.SampleDesc.Count=1; single.SampleDesc.Quality=0;
        single.BindFlags=0; single.MiscFlags=0;
        if (FAILED(device->CreateTexture2D(&single,nullptr,&resolved))) return {{"success",false},{"error","Resolve allocation failed"}};
        context->ResolveSubresource(resolved.Get(),0,buffer.Get(),0,desc.Format);
    }
    auto copy=desc; copy.SampleDesc.Count=1; copy.SampleDesc.Quality=0;
    copy.Usage=D3D11_USAGE_STAGING; copy.BindFlags=0; copy.CPUAccessFlags=D3D11_CPU_ACCESS_READ; copy.MiscFlags=0;
    if (FAILED(device->CreateTexture2D(&copy,nullptr,&staging))) return {{"success",false},{"error","Staging allocation failed"}};
    context->CopyResource(staging.Get(),resolved ? resolved.Get() : buffer.Get());
    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(context->Map(staging.Get(),0,D3D11_MAP_READ,0,&mapped))) return {{"success",false},{"error","Evidence map failed"}};
    std::vector<uint8_t> pixels(desc.Width*desc.Height*4);
    for (UINT y=0;y<desc.Height;++y) {
        const auto* src=(const uint8_t*)mapped.pData+y*mapped.RowPitch;
        auto* dst=pixels.data()+y*desc.Width*4;
        memcpy(dst,src,desc.Width*4);
        for (UINT x=0;x<desc.Width;++x) {if(rgba) std::swap(dst[x*4],dst[x*4+2]); dst[x*4+3]=255;}
    }
    context->Unmap(staging.Get(),0);
    wchar_t temp[MAX_PATH]{}; GetTempPathW(MAX_PATH,temp);
    const auto folder=std::filesystem::path(temp)/L"Cyberfish"/L"native-frames";
    std::filesystem::create_directories(folder);
    const auto path=folder/(std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(frames)+L".bmp");
    BITMAPFILEHEADER header{}; BITMAPINFOHEADER info{};
    header.bfType=0x4D42; header.bfOffBits=sizeof(header)+sizeof(info); header.bfSize=header.bfOffBits+(DWORD)pixels.size();
    info.biSize=sizeof(info); info.biWidth=desc.Width; info.biHeight=-(LONG)desc.Height;
    info.biPlanes=1; info.biBitCount=32; info.biCompression=BI_RGB; info.biSizeImage=(DWORD)pixels.size();
    std::ofstream file(path,std::ios::binary);
    file.write((const char*)&header,sizeof(header)); file.write((const char*)&info,sizeof(info));
    file.write((const char*)pixels.data(),pixels.size()); file.close();
    if (!file) return {{"success",false},{"error","Cannot save game frame"}};
    const auto utf8=path.u8string();
    return {{"success",true},{"path",std::string(utf8.begin(),utf8.end())},{"picture",picture}};
}
nlohmann::json FocusFleet(uint32_t fleet_id) {
    auto& builder=CommandBuilder::Get();
    const auto owned=fleets::Owned(GameState::Get().GetPlayerCountry());
    if (!builder.SdkMatchesExe() || std::find(owned.begin(),owned.end(),fleet_id)==owned.end())
        return {{"success",false},{"error","Owned fleet required"}};
    auto* fleet=(uint8_t*)fleets::Find(builder.Base(),fleet_id);
    auto* idler=(uint8_t*)GameState::Get().GetInGameIdler();
    if (!fleet || !idler) return {{"success",false},{"error","Fleet or active game missing"}};
    struct Context {uintptr_t base; void* camera; void* target; int kind;};
    Context ctx{builder.Base(),idler+0x218,fleet+sdk::rt::CFleet_coordinate_base,-1};
    auto run=[](void* p,void*) {
        auto* x=(Context*)p;
        auto vt=*(void***)x->target;
        x->kind=((int(*)(void*))vt[5])(x->target);
        if(x->kind==3) ((void(*)(void*,void*))(x->base+0xF32A40))(x->camera,x->target);
    };
    if(!builder.CallGuarded(run,&ctx) || ctx.kind!=3)
        return {{"success",false},{"error","Verified fleet camera interface unavailable"}};
    // Camera target at +0x288/+0x28C, assigned by the audited function above.
    uint32_t selected=*(uint32_t*)(idler+0x4A4);
    return {{"success",selected==fleet_id},{"fleet_id",fleet_id},{"camera_target_id",selected},
            {"camera_target_type",*(uint32_t*)(idler+0x4A0)},{"picture",PictureState()}};
}
nlohmann::json FocusPlanet(uint32_t planet_id) {
    auto& builder=CommandBuilder::Get();
    struct Context {uintptr_t base; uint32_t planet,country; void* idler; bool found;};
    Context ctx{builder.Base(),planet_id,GameState::Get().GetPlayerCountryId(),GameState::Get().GetInGameIdler(),false};
    auto run=[](void* p,void*) {
        auto* x=(Context*)p;
        auto* db=*(uint8_t**)(x->base+sdk::db::CPlanet);
        if(!db || !x->idler || (x->planet&0xFFFFFF)>=*(uint32_t*)(db+0x20)) return;
        auto* arr=*(uint8_t**)(db+0x18);
        auto* planet=*(uint8_t**)(arr+(x->planet&0xFFFFFF)*16+8);
        // Actual CPlanet lookup compares +0x18; generated rt::CPlanet_id is a
        // secondary-base offset and must not be used for a primary pointer.
        if(!planet || *(uint32_t*)(planet+0x18)!=x->planet || *(uint32_t*)(planet+sdk::ent::CPlanet::owner)!=x->country) return;
        auto* target=planet+0x20; auto vt=*(void***)target;
        if(((int(*)(void*))vt[5])(target)!=2) return;
        ((void(*)(void*,void*))(x->base+0xF32A40))((uint8_t*)x->idler+0x218,target);
        x->found=true;
    };
    if(!builder.SdkMatchesExe() || !builder.CallGuarded(run,&ctx) || !ctx.found)
        return {{"success",false},{"error","Owned planet camera target unavailable"}};
    auto* idler=(uint8_t*)ctx.idler;
    const uint32_t target=*(uint32_t*)(idler+0x4A4);
    return {{"success",target==planet_id},{"planet_id",planet_id},{"camera_target_id",target},{"camera_target_type",*(uint32_t*)(idler+0x4A0)}};
}
nlohmann::json ShowPanel(const std::string& panel) {
    struct Panel {const char* key; size_t member; uintptr_t vtable;};
    static constexpr Panel panels[]={
        {"research",0xD50,0x23F4110},{"fleets",0xD78,0x24106B8},
        {"contacts",0xD80,0x23F6F98},{"market",0xDC0,0x241B4B8},
        {"traditions",0xD48,0x241AC98},{"government",0xD40,0x2438858},
        {"leaders",0xD58,0x23F5778}
    };
    auto& builder=CommandBuilder::Get();
    auto* idler=(uint8_t*)GameState::Get().GetInGameIdler();
    if(!idler || !builder.SdkMatchesExe()) return {{"success",false},{"error","Game not ready"}};
    struct Context {void* view; bool show; bool shown;};
    auto call=[](void* p,void*) {
        auto* x=(Context*)p; auto vt=*(void***)x->view;
        ((void(*)(void*))vt[x->show?6:7])(x->view);
        auto* ui=*(uint8_t**)((uint8_t*)x->view+0x78);
        x->shown=ui && *(uint8_t*)(ui+0x41)!=0;
    };
    void* next=nullptr;
    for(const auto& candidate:panels) if(panel==candidate.key) {
        next=*(void**)(idler+candidate.member);
        if(!next || *(uintptr_t*)next!=builder.Base()+candidate.vtable) return {{"success",false},{"error","View type mismatch"}};
    }
    if(panel!="game" && !next) return {{"success",false},{"error","Unknown presentation panel"}};
    if(managed_view && managed_view!=next) {Context hide{managed_view,false,false}; if(!builder.CallGuarded(call,&hide)) return {{"success",false},{"error","Cannot close managed panel"}};}
    if(next) {Context show{next,true,false}; if(!builder.CallGuarded(call,&show) || !show.shown) return {{"success",false},{"error","Panel did not become visible"}};}
    managed_view=next;
    return {{"success",true},{"panel",panel},{"shown",next!=nullptr},{"picture",PictureState()}};
}
}
