#include "country_ai_receipts.hpp"
#include <cstdlib>
#include <iostream>
using namespace bridge::cyberfish;
void Check(bool result){if(!result)std::abort();}
int main(){
    AICommandIdentity original{1,42,1,true};
    // The deserialized engine object has a DIFFERENT address. Its stable
    // session identity must confirm execution; pointer equality is irrelevant.
    AICommandExecution clone{{1,42,1,true},101,1};
    original.object=0x1000;clone.identity.object=0x2000;
    Check(MatchesAIReceipt(original,clone,1,100));
    auto other=clone;other.identity.client=2;Check(!MatchesAIReceipt(original,other,1,100));
    other=clone;other.identity.sequence=43;Check(!MatchesAIReceipt(original,other,1,100));
    other=clone;other.identity.value=0;Check(!MatchesAIReceipt(original,other,1,100));
    other=clone;other.kind=2;Check(!MatchesAIReceipt(original,other,1,100));
    other=clone;other.event=100;Check(!MatchesAIReceipt(original,other,1,100));
    other=clone;other.identity.valid=false;Check(!MatchesAIReceipt(original,other,1,100));
    original.valid=false;Check(!MatchesAIReceipt(original,clone,1,100));
    // Command sequence zero is legal, not an invalid-handle sentinel.
    original={1,0,0,true};clone={{1,0,0,true},102,2};Check(MatchesAIReceipt(original,clone,2,101));
    std::cout<<"country AI serialized-command receipt checks passed\n";
}
