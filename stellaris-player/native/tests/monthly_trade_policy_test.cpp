#include "monthly_trade_policy.hpp"
#include <limits>
#include <iostream>
int main() {
    std::string error;
    auto valid=[&](const char* action,double amount,double price,bool cancel=false,int32_t id=-1){return bridge::ValidateMonthlyTradeInput("food",action,amount,price,cancel,id,error);};
    auto check=[](bool condition){if(!condition)throw std::runtime_error("monthly policy test failed");};
    check(valid("buy",1,0));check(valid("sell",100,3));check(valid("buy",2147483647.,1.));
    check(!valid("buy",2147483647.,2147483647.));check(!valid("sell",50000,50000));
    check(!valid("nonsense",100,0));check(!valid("purchase",100,0));
    for(double n:{0.,-1.,1.5,2147483648.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})check(!valid("buy",n,0));
    for(double n:{-1.,0.5,2147483648.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})check(!valid("sell",1,n));
    check(valid("ignored",0,0,true,0));check(!valid("buy",0,0,true,-1));
    check(!bridge::ValidateMonthlyTradeInput("bad key","buy",1,0,false,-1,error));
    std::cout<<"monthly native parameter checks passed\n";
}
