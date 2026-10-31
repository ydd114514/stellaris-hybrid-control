#include "ship_capacity_upkeep.hpp"
#include <cassert>
#include <limits>
using bridge::capacity_upkeep::project;
int main(){
 assert(project(0,100000,100000,false).factor==100000);
 assert(project(100000,100000,100000,false).factor==100000);
 assert(project(150000,100000,50000,false).factor==125000);
 assert(project(150000,100000,50000,true).factor==150000);
 assert(project(100001,100000,33333,false).factor==100000);
 assert(project(200000,100000,0,false).factor==100000);
 assert(!project(-1,100000,100000,false).known);
 assert(!project(1,0,100000,false).known);
 assert(!project(1,-1,100000,false).known);
 assert(!project(1,1,-1,false).known);
 assert(!project(std::numeric_limits<int64_t>::max(),1,100000,false).known);
 assert(!project(90000000000000,1,std::numeric_limits<int64_t>::max(),false).known);
}
