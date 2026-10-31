#include "country_ai_routine_policy.hpp"
#include <cstdlib>
#include <iostream>
using namespace bridge::cyberfish;
void Check(bool value){if(!value)std::abort();}
int main(){
    NativeRoutineRequest research{NativeRoutineCommand::ResearchTechnology,NativeRoutineBuildable::Unknown,0,0xffffffffu,true};
    Check(AllowNativeRoutine(research,0,true,false));
    Check(!AllowNativeRoutine(research,0,false,true));
    research.actor=0x1000000;Check(!AllowNativeRoutine(research,0,true,true));
    research.actor=0;research.technologyPresent=false;Check(!AllowNativeRoutine(research,0,true,true));
    NativeRoutineRequest construction{NativeRoutineCommand::AddBuildable,NativeRoutineBuildable::Building,0,0,false};
    for(auto kind:{NativeRoutineBuildable::Building,NativeRoutineBuildable::District,NativeRoutineBuildable::BuildingUpgrade,NativeRoutineBuildable::Zone}){
        construction.buildable=kind;Check(AllowNativeRoutine(construction,0,false,true));
        Check(!AllowNativeRoutine(construction,0,true,false));
    }
    construction.buildable=NativeRoutineBuildable::Unknown;Check(!AllowNativeRoutine(construction,0,true,true));
    construction.buildable=NativeRoutineBuildable::Building;construction.queue=0xffffffffu;Check(!AllowNativeRoutine(construction,0,true,true));
    NativeRoutineRequest unknown;unknown.actor=0;Check(!AllowNativeRoutine(unknown,0,true,true));
    Check(!AllowNativeRoutine(research,0xffffffffu,true,true));
    NativeRoutineRequest workforce;workforce.command=NativeRoutineCommand::WorkforceLimit;workforce.actor=0;workforce.targetOwned=true;
    Check(!AllowNativeRoutine(workforce,0,true,true));
    Check(AllowNativeRoutine(workforce,0,true,true,true));
    workforce.targetOwned=false;Check(!AllowNativeRoutine(workforce,0,true,true,true));
    workforce.targetOwned=true;workforce.actor=1;Check(!AllowNativeRoutine(workforce,0,true,true,true));
    NativeRoutineRequest designation;designation.command=NativeRoutineCommand::ColonyDesignation;designation.actor=0;designation.targetOwned=true;
    Check(!AllowNativeRoutine(designation,0,true,true,true));
    designation.definitionPresent=true;Check(AllowNativeRoutine(designation,0,true,true,true));
    Check(!AllowNativeRoutine(designation,0,true,true));
    designation.targetOwned=false;Check(!AllowNativeRoutine(designation,0,true,true,true));
    NativeRoutineRequest ship;ship.command=NativeRoutineCommand::AddBuildable;
    ship.actor=0;ship.queue=0;ship.targetOwned=true;ship.queueOwned=true;ship.definitionPresent=true;
    for(auto kind:{NativeRoutineBuildable::Ship,NativeRoutineBuildable::ColonyShip}) {
        ship.buildable=kind;
        Check(!AllowNativeRoutine(ship,0,true,true,true)); // old policy never silently grows
        Check(AllowNativeRoutine(ship,0,false,false,false,true));
        ship.actor=1;Check(!AllowNativeRoutine(ship,0,true,true,true,true));ship.actor=0;
        ship.targetOwned=false;Check(!AllowNativeRoutine(ship,0,true,true,true,true));ship.targetOwned=true;
        ship.queueOwned=false;Check(!AllowNativeRoutine(ship,0,true,true,true,true));ship.queueOwned=true;
        ship.definitionPresent=false;Check(!AllowNativeRoutine(ship,0,true,true,true,true));ship.definitionPresent=true;
        ship.queue=0xffffffffu;Check(!AllowNativeRoutine(ship,0,true,true,true,true));ship.queue=0;
        ship.targetProtected=true;Check(!AllowNativeRoutine(ship,0,true,true,true,true));ship.targetProtected=false;
    }
    workforce.actor=0;workforce.targetOwned=true;workforce.targetProtected=true;
    Check(!AllowNativeRoutine(workforce,0,true,true,true,true));
    designation.targetOwned=true;designation.targetProtected=true;
    Check(!AllowNativeRoutine(designation,0,true,true,true,true));
    std::cout<<"native routine admission boundaries passed\n";
}
