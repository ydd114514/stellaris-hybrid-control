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
#include "galaxy_camera_layout.hpp"
#include "event_manager.hpp"
#include "cyberfish_war.hpp"
#include "galaxy_manager.hpp"

namespace bridge::cyberfish {
using Microsoft::WRL::ComPtr;
namespace {IDXGISwapChain* current = nullptr; uint64_t frames=0; void* managed_view=nullptr; void* managed_idler=nullptr;}
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
namespace {
template<class T> bool CameraRead(uintptr_t at,T& value){SIZE_T n=0;return at>=0x10000&&ReadProcessMemory(GetCurrentProcess(),(void*)at,&value,sizeof value,&n)&&n==sizeof value;}
// These are presentation methods from the pinned Windows 4.5.2 executable, not
// game commands. The normal planet/starbase selection paths bind these same views.
constexpr uintptr_t kPlanetViewMember=0xB30, kPlanetViewVtable=0x24221F0;
constexpr uintptr_t kOpenPlanetView=0x9247E0, kPlanetViewObject=0xA0, kPlanetViewSubview=0xE068;
constexpr uintptr_t kStarbaseViewMember=0xB70, kStarbaseViewVtable=0x2413808;
constexpr uintptr_t kBindStarbaseView=0x11572B0, kStarbaseViewObject=0xA8;
bool ViewVisible(uintptr_t view) {
 uintptr_t ui=0;uint8_t visible=0;
 return CameraRead(view+0x78,ui)&&ui&&CameraRead(ui+0x41,visible)&&visible!=0;
}
bool DirectorWindowsClear() {
 const auto events=EventManager::Get().GetActiveEventsJson();
 const auto wars=Wars();
 return events.is_array()&&events.empty()&&wars.contains("warGoalsWindow")&&!wars.value("warGoalsWindow",true);
}
bool NativeView(uintptr_t idler,uintptr_t member,uintptr_t expected,uintptr_t& view) {
 uintptr_t vtable=0;
 return CameraRead(idler+member,view)&&view&&CameraRead(view,vtable)&&vtable==expected;
}
template<size_t N> bool NativePrefix(uintptr_t address,const uint8_t (&expected)[N]) {
 uint8_t actual[N]{};return CameraRead(address,actual)&&memcmp(actual,expected,N)==0;
}
nlohmann::json DirectorFailure(const char* error) {
 return {{"success",false},{"shown",false},{"error",error}};
}
uintptr_t ViewObject(uintptr_t base,uintptr_t database,uint32_t id,uintptr_t id_field) {
 uintptr_t db=0,slots=0,object=0;uint32_t capacity=0,actual=0xFFFFFFFFu;
 if(id==0xFFFFFFFFu||!CameraRead(base+database,db)||!db||!CameraRead(db+0x18,slots)||!slots||
    !CameraRead(db+0x20,capacity)||capacity>1048576u||(id&0xFFFFFFu)>=capacity||
    !CameraRead(slots+(id&0xFFFFFFu)*16+8,object)||!object||!CameraRead(object+id_field,actual)||actual!=id)return 0;
 return object;
}
bool GalaxyRadius(double& radius){
 const auto base=CommandBuilder::Get().Base();uintptr_t db=0,slots=0;uint32_t capacity=0;float scale=0;unsigned count=0;radius=0;
 if(!CameraRead(base+sdk::db::CGalacticObject,db)||!CameraRead(db+0x18,slots)||!CameraRead(db+0x20,capacity)||capacity>65536||!CameraRead(base+0x3114f00,scale)||!std::isfinite(scale)||scale<=0||scale>100)return false;
 for(uint32_t i=0;i<capacity;++i){uintptr_t object=0;uint32_t id=0xffffffffu;int64_t x=0,y=0;
  if(!CameraRead(slots+i*16+8,object))return false;if(!object)continue;
  if(!CameraRead(object+sdk::rt::CGalacticObject_id,id)||id==0xffffffffu||(id&0xffffffu)!=i)continue;
  const auto coord=object+sdk::ent::CGalacticObject::coordinate;
  if(!CameraRead(coord+sdk::ent::CCelestialCoordinate::x,x)||!CameraRead(coord+sdk::ent::CCelestialCoordinate::y,y))return false;
  const double r=std::hypot(double(x)/100000.0,double(y)/100000.0)*scale;if(!std::isfinite(r))return false;
  radius=std::max(radius,r);++count;
 }
 return count>0&&radius>0;
}
}
nlohmann::json CameraState(){
 const auto base=CommandBuilder::Get().Base();auto idler=(uintptr_t)GameState::Get().GetInGameIdler();
 uint32_t system=0,focus=0;float pose[6]{};double radius=0;const auto picture=PictureState();
 if(!idler||!CommandBuilder::Get().SdkMatchesExe()||!CameraRead(idler+0x218+0x274,system)||!CameraRead(idler+0x218+0x288,focus)||!CameraRead(idler+0x218+0x230,pose)||!GalaxyRadius(radius))return {{"success",false},{"error","Galaxy camera state unavailable"}};
 const auto required=GalaxyOverviewZoom(radius,double(picture.value("width",0))/std::max(1,picture.value("height",0)));
 const bool finite=std::all_of(std::begin(pose),std::end(pose),[](float x){return std::isfinite(x);});
 const bool full=finite&&system==0xffffffffu&&focus==10&&required>0&&std::abs(pose[0])<1&&std::abs(pose[1])<1&&std::abs(pose[2])<1&&pose[3]>=required*0.995f&&pose[4]>=1.47f;
 return {{"success",true},{"galaxy_view",system==0xffffffffu},{"full_galaxy",full},{"follow_target_cleared",focus==10},{"center",{pose[0],pose[1],pose[2]}},{"zoom",pose[3]},{"pitch",pose[4]},{"required_zoom",required},{"galaxy_radius",radius}};
}
nlohmann::json ShowGalaxyMap(float zoom_override){
 auto& builder=CommandBuilder::Get();const auto base=builder.Base();auto idler=(uint8_t*)GameState::Get().GetInGameIdler();double radius=0;const auto picture=PictureState();
 const uint8_t clearPrefix[]{0x48,0x83,0xec,0x08,0x83,0xb9,0x88,0x02,0,0,0x0a};
 const uint8_t galaxyPrefix[]{0x48,0x89,0x5c,0x24,0x08,0x57,0x48,0x83,0xec,0x30};
 if(!idler||!builder.SdkMatchesExe()||!picture.value("visible",false)||!GalaxyRadius(radius)||memcmp((void*)(base+0xf30ee0),clearPrefix,sizeof clearPrefix)||memcmp((void*)(base+0xf323f0),galaxyPrefix,sizeof galaxyPrefix))return {{"success",false},{"error","Galaxy camera interface unavailable"}};
 const float fitted=GalaxyOverviewZoom(radius,double(picture.value("width",0))/std::max(1,picture.value("height",0)));if(!fitted)return {{"success",false},{"error","Galaxy extent cannot be fitted safely"}};
 if(!std::isfinite(zoom_override)||zoom_override<0||zoom_override>3000||(zoom_override>0&&zoom_override<100))return {{"success",false},{"error","Zoom must be zero (full map) or a native range 100..3000"}};
 const float zoom=zoom_override>0?zoom_override:fitted;
 if(ShowPanel("game").value("success",false)!=true)return {{"success",false},{"error","Managed panel could not close"}};
 struct Context{uintptr_t base;uint8_t* camera;float zoom;};Context ctx{base,idler+0x218,zoom};
 auto run=[](void* p,void*){auto& x=*(Context*)p;
  ((void(*)(void*))(x.base+0xf30ee0))(x.camera);
  if(*(uint32_t*)(x.camera+0x274)!=0xffffffffu)((void(*)(void*))(x.base+0xf323f0))(x.camera);
  // The two native camera-position records are desired/current, each six floats.
  // Set only presentation state; no world, fleet, player or pause state changes.
  const float pose[]{0,0,0,x.zoom,1.48352986f,0};
  memcpy(x.camera+0x218,pose,sizeof pose);memcpy(x.camera+0x230,pose,sizeof pose);
  *(uint32_t*)(x.camera+0x24c)=6;
 };
 if(!builder.CallGuarded(run,&ctx))return {{"success",false},{"error","Galaxy camera call failed"}};
 auto state=CameraState();state["success"]=state.value("galaxy_view",false)&&std::abs(state.value("zoom",0.f)-zoom)<1.f;return state;
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
nlohmann::json ShowPlanetView(uint32_t planet_id,const std::string& tab) {
    if(tab!="construction")return DirectorFailure("Only the construction planet tab is supported");
    auto& builder=CommandBuilder::Get();const auto base=builder.Base();
    const auto idler=(uintptr_t)GameState::Get().GetInGameIdler();uintptr_t view=0;
    // CInGameIdler::OpenPlanetView, called with CPlanet's +0x20 celestial
    // interface. Subview 1 is the ordinary main planet/construction page; 0
    // restores the previous subview and could leave the director on armies.
    const uint8_t prefix[]{0x48,0x89,0x5c,0x24,0x18,0x55,0x56,0x41,0x56,0x48,0x83,0xec,0x20};
    if(!idler||!builder.SdkMatchesExe()||!NativePrefix(base+kOpenPlanetView,prefix)||
       !NativeView(idler,kPlanetViewMember,base+kPlanetViewVtable,view))return DirectorFailure("Verified planet view unavailable");
    const auto planet=ViewObject(base,sdk::db::CPlanet,planet_id,0x18);
    uint32_t owner=0xFFFFFFFFu;
    if(!planet||!CameraRead(planet+sdk::ent::CPlanet::owner,owner)||owner==0xFFFFFFFFu||owner!=GameState::Get().GetPlayerCountryId())
        return DirectorFailure("Owned planet required");
    if(!DirectorWindowsClear())return DirectorFailure("Handle the active event or war-goals window first");
    struct Context {uintptr_t base,idler,planet,view;uint32_t selected=0xFFFFFFFFu;int subview=0;bool shown=false;};
    Context ctx{base,idler,planet,view};
    auto run=[](void* p,void*) {
        auto& x=*(Context*)p;auto target=(void*)(x.planet+0x20);auto** vt=*(void***)target;
        if(((int(*)(void*))vt[5])(target)!=2)return;
        ((void(*)(void*,void*,int))(x.base+kOpenPlanetView))((void*)x.idler,target,1);
        x.selected=*(uint32_t*)(x.view+kPlanetViewObject);
        x.subview=*(int*)(x.view+kPlanetViewSubview);
        x.shown=ViewVisible(x.view);
    };
    if(!ShowPanel("game").value("success",false))return DirectorFailure("Cannot close the managed panel");
    managed_view=(void*)view;managed_idler=(void*)idler;
    if(!builder.CallGuarded(run,&ctx)){ShowPanel("game");return DirectorFailure("Planet view call failed");}
    const bool shown=ctx.shown&&ctx.selected==planet_id&&ctx.subview==1;
    if(!shown)ShowPanel("game");
    return {{"success",shown},{"shown",shown},{"panel","planet"},{"tab","construction"},{"planet_id",planet_id},
        {"selected_planet_id",ctx.selected},{"native_subview",ctx.subview}};
}
nlohmann::json ShowStarbaseView(uint32_t system_id,uint32_t starbase_id) {
    auto& builder=CommandBuilder::Get();const auto base=builder.Base();
    const auto idler=(uintptr_t)GameState::Get().GetInGameIdler();uintptr_t view=0;
    // Normal owned-starbase selection at 0xC5CDEE calls this binder with
    // idler+0xB70. It sets +0xA8, shows the real window and refreshes its queue.
    const uint8_t prefix[]{0x48,0x89,0x5c,0x24,0x08,0x57,0x48,0x83,0xec,0x20,0x8b,0x42,0x08};
    if(!idler||!builder.SdkMatchesExe()||!NativePrefix(base+kBindStarbaseView,prefix)||
       !NativeView(idler,kStarbaseViewMember,base+kStarbaseViewVtable,view))return DirectorFailure("Verified starbase view unavailable");
    if(system_id==0xFFFFFFFFu&&starbase_id==0xFFFFFFFFu)return DirectorFailure("System or starbase ID required");
    const auto targets=GalaxyManager::Get().GetStarbaseViewsJson();uint32_t chosen=0xFFFFFFFFu,system=0xFFFFFFFFu;
    if(targets.value("success",false)&&targets.contains("starbases")&&targets["starbases"].is_array()) {
        for(const auto& row:targets["starbases"]) {
            const auto sid=row.value("system_id",0xFFFFFFFFu),bid=row.value("starbase_id",0xFFFFFFFFu);
            if((system_id==0xFFFFFFFFu||sid==system_id)&&(starbase_id==0xFFFFFFFFu||bid==starbase_id)) {chosen=bid;system=sid;break;}
        }
    }
    const auto starbase=ViewObject(base,sdk::db::CStarbase,chosen,sdk::rt::CStarbase_id);
    if(!starbase)return DirectorFailure("Starbase in an owned system required");
    if(!DirectorWindowsClear())return DirectorFailure("Handle the active event or war-goals window first");
    struct Context {uintptr_t base,view,starbase;uint32_t selected=0xFFFFFFFFu;bool shown=false;};
    Context ctx{base,view,starbase};
    auto run=[](void* p,void*) {
        auto& x=*(Context*)p;
        ((void(*)(void*,void*))(x.base+kBindStarbaseView))((void*)x.view,(void*)x.starbase);
        x.selected=*(uint32_t*)(x.view+kStarbaseViewObject);x.shown=ViewVisible(x.view);
    };
    if(!ShowPanel("game").value("success",false))return DirectorFailure("Cannot close the managed panel");
    managed_view=(void*)view;managed_idler=(void*)idler;
    if(!builder.CallGuarded(run,&ctx)){ShowPanel("game");return DirectorFailure("Starbase view call failed");}
    const bool shown=ctx.shown&&ctx.selected==chosen;
    if(!shown)ShowPanel("game");
    return {{"success",shown},{"shown",shown},{"panel","starbase"},{"system_id",system},{"starbase_id",chosen},{"selected_starbase_id",ctx.selected}};
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
    // A managed view belongs to its idler. Never reuse its pointer after a world
    // change; the former world may already have destroyed all of its windows.
    if(managed_idler!=idler){managed_view=nullptr;managed_idler=idler;}
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
