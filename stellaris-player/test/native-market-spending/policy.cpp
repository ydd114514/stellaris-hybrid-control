#include "market_spending_policy.hpp"
#include <cstdlib>
#include <iostream>
#include <limits>
struct Resource {
 double stockpile=3062,expense=52.78,net=95,max=15000;
 bool stockpile_known=true,expense_known=true,net_known=true;
};
static void require(bool value,const char* reason){if(!value){std::cerr<<reason;std::exit(1);}}
int main(){
 Resource paid,received;received.stockpile=1971.51;received.max=50000;
 std::string error;
 require(bridge::ValidateMarketSpending(paid,received,100,70,error),"real surplus below old20percent floor");
 paid.stockpile=550;paid.expense=100;
 require(bridge::ValidateMarketSpending(paid,received,400,100,error),"may leave less than500 while upkeep covered");
 paid.net=-50;
 require(bridge::ValidateMarketSpending(paid,received,400,100,error),"deficit and gross expense use max, not sum");
 require(!bridge::ValidateMarketSpending(paid,received,401,100,error),"real reserve cannot be spent");
 paid.net=0;received.stockpile=49900;
 require(bridge::ValidateMarketSpending(paid,received,400,100,error),"exact cap allowed");
 require(!bridge::ValidateMarketSpending(paid,received,400,101,error),"actual overflow refused");
 paid.expense_known=false;
 require(!bridge::ValidateMarketSpending(paid,received,100,1,error),"unknown expense cannot become zero");
 paid.expense_known=true;paid.net_known=false;
 require(!bridge::ValidateMarketSpending(paid,received,100,1,error),"unknown net refused");
 paid.net_known=true;received.max=-1;
 require(!bridge::ValidateMarketSpending(paid,received,100,1,error),"unknown cap refused");
 received.max=50000;paid.stockpile=std::numeric_limits<double>::quiet_NaN();
 require(!bridge::ValidateMarketSpending(paid,received,100,1,error),"nonfinite balance refused");
 paid.stockpile=550;
 require(!bridge::ValidateMarketSpending(paid,received,-1,1,error),"negative debit refused");
 require(!bridge::ValidateMarketSpending(paid,received,1,0,error),"zero credit refused");
 std::cout<<"native market spending boundaries passed\n";
}
