#pragma once
#include <cstdint>
namespace bridge::cyberfish {
enum class NativeRoutineCommand { Unknown, ResearchTechnology, AddBuildable };
enum class NativeRoutineBuildable { Unknown, Building, District, BuildingUpgrade, Zone };
struct NativeRoutineRequest {
    NativeRoutineCommand command=NativeRoutineCommand::Unknown;
    NativeRoutineBuildable buildable=NativeRoutineBuildable::Unknown;
    uint32_t actor=0xffffffffu;
    uint32_t queue=0xffffffffu;
    bool technologyPresent=false;
};
inline bool AllowNativeRoutine(const NativeRoutineRequest& request,uint32_t own,
    bool research,bool planetConstruction) {
    if(own==0xffffffffu||request.actor!=own)return false;
    if(request.command==NativeRoutineCommand::ResearchTechnology)
        return research&&request.technologyPresent;
    if(request.command!=NativeRoutineCommand::AddBuildable||!planetConstruction||request.queue==0xffffffffu)return false;
    return request.buildable==NativeRoutineBuildable::Building||request.buildable==NativeRoutineBuildable::District||
        request.buildable==NativeRoutineBuildable::BuildingUpgrade||request.buildable==NativeRoutineBuildable::Zone;
}
}
