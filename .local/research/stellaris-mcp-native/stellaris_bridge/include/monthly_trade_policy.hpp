#pragma once
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
namespace bridge {
inline bool ValidateMonthlyTradeInput(const std::string& resource,const std::string& action,
                                      double amount,double price,bool cancel,int32_t order_id,
                                      std::string& error) {
    if(cancel) {
        if(order_id < 0) { error="cancel requires an existing nonnegative order_id"; return false; }
        return true; // The live order supplies all other cancellation fields.
    }
    if(action!="buy" && action!="sell") { error="monthly action must be buy or sell"; return false; }
    if(resource.empty() || resource.size()>100) { error="invalid resource key"; return false; }
    for(char c:resource) if(!((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_')) { error="invalid resource key"; return false; }
    if(resource.front()>='0'&&resource.front()<='9') { error="invalid resource key"; return false; }
    constexpr double max=static_cast<double>(std::numeric_limits<int32_t>::max());
    if(!std::isfinite(amount)||amount<1||amount>max||std::floor(amount)!=amount) { error="monthly amount must be a positive int32, without truncation"; return false; }
    if(!std::isfinite(price)||price<0||price>max||std::floor(price)!=price) { error="monthly price limit must be a nonnegative int32, without truncation"; return false; }
    if(price>0 && amount*price>max) { error="monthly amount times price limit exceeds the engine int32 comparison range"; return false; }
    return true;
}
}
