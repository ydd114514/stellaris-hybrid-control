#pragma once
#include <cstdint>
namespace bridge::cyberfish {
enum class NativeRoutineCommand { Unknown, ResearchTechnology, AddBuildable, WorkforceLimit, ColonyDesignation };
enum class NativeRoutineBuildable { Unknown, Building, District, BuildingUpgrade, Zone, Ship, ColonyShip };
struct NativeRoutineRequest {
    NativeRoutineCommand command=NativeRoutineCommand::Unknown;
    NativeRoutineBuildable buildable=NativeRoutineBuildable::Unknown;
    uint32_t actor=0xffffffffu;
    uint32_t queue=0xffffffffu;
    bool technologyPresent=false;
    bool targetOwned=false;
    bool definitionPresent=false;
    bool queueOwned=false;
    bool targetProtected=false;
};
inline bool AllowNativeRoutine(const NativeRoutineRequest& request,uint32_t own,
    bool research,bool planetConstruction,bool economicAdministration=false,bool shipProduction=false) {
    if(own==0xffffffffu||request.actor!=own||request.targetProtected)return false;
    if(request.command==NativeRoutineCommand::ResearchTechnology)
        return research&&request.technologyPresent;
    if(request.command==NativeRoutineCommand::WorkforceLimit)return economicAdministration&&request.targetOwned;
    if(request.command==NativeRoutineCommand::ColonyDesignation)return economicAdministration&&request.targetOwned&&request.definitionPresent;
    if(request.command!=NativeRoutineCommand::AddBuildable||request.queue==0xffffffffu)return false;
    if(request.buildable==NativeRoutineBuildable::Ship||request.buildable==NativeRoutineBuildable::ColonyShip)
        return shipProduction&&request.targetOwned&&request.queueOwned&&request.definitionPresent;
    if(!planetConstruction)return false;
    return request.buildable==NativeRoutineBuildable::Building||request.buildable==NativeRoutineBuildable::District||
        request.buildable==NativeRoutineBuildable::BuildingUpgrade||request.buildable==NativeRoutineBuildable::Zone;
}
}
