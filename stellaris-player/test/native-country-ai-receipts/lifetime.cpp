#include "country_ai_command_lifetime.hpp"
#include <cstdlib>
#include <iostream>
using namespace bridge::cyberfish;
void Check(bool value){if(!value)std::abort();}
int main(){
 NativeAICommandLifetime queued;Check(!queued.Drained());
 queued.postEntered=true;queued.postReturned=true;queued.originalReleased=true;
 Check(!queued.Drained()); // A returned transport call does not prove execution or rejection.
 queued.deserialized=1;queued.liveCopies.insert(0x1234);Check(!queued.Drained());
 queued.executed=1;Check(!queued.Drained()); // Execute returned while a clone is still owned by the engine.
 queued.liveCopies.clear();Check(queued.Drained());
 NativeAICommandLifetime rejected;rejected.originalReleased=true;Check(rejected.Drained());
 rejected.postEntered=true;rejected.postReturned=true;rejected.deserialized=1;Check(rejected.Drained());
 NativeAICommandLifetime direct;direct.postEntered=true;direct.postReturned=true;direct.executed=1;
 Check(!direct.Drained());direct.originalReleased=true;Check(direct.Drained());
 direct.uncertain=true;Check(!direct.Drained());
 // The wire copy can be destroyed before a later engine Clone executes.
 NativeAICommandLifetime fork;fork.postEntered=true;fork.postReturned=true;fork.originalReleased=true;
 fork.deserialized=1;fork.liveCopies.insert(0x1000);
 fork.cloned=1;fork.liveCopies.insert(0x2000);
 fork.liveCopies.erase(0x1000);Check(!fork.Drained());
 fork.executed=1;Check(!fork.Drained());
 fork.liveCopies.erase(0x2000);Check(fork.Drained());
 NativeAICommandLifetime copyRejected;copyRejected.postEntered=true;copyRejected.postReturned=true;
 copyRejected.originalReleased=true;copyRejected.cloned=1;Check(copyRejected.Drained());
 copyRejected.activeClones=1;Check(!copyRejected.Drained());
 copyRejected.activeClones=0;copyRejected.activeExecutions=1;Check(!copyRejected.Drained());
 copyRejected.activeExecutions=0;Check(copyRejected.Drained());
 std::cout<<"native command ownership drain passed"<<std::endl;
}
