#pragma once
#include <algorithm>
#include <cmath>
#include <string>

namespace bridge {
// Main-thread last-moment balance check. The controller additionally protects
// task commitments and strategic floors; this layer never invents those values.
template<class Resource>
bool ValidateMarketSpending(const Resource& paid, const Resource& received,
                            double debit, double credit, std::string& error) {
    if (!paid.stockpile_known || !paid.net_known || !paid.expense_known ||
        !received.stockpile_known || !std::isfinite(paid.stockpile) ||
        !std::isfinite(paid.net) || !std::isfinite(paid.expense) ||
        !std::isfinite(received.stockpile) || !std::isfinite(received.max) ||
        paid.stockpile < 0 || paid.expense < 0 || received.stockpile < 0 ||
        received.max <= 0 || !std::isfinite(debit) || !std::isfinite(credit) ||
        debit <= 0 || credit <= 0) {
        error = "Actual market balance, upkeep or receiving capacity unknown";
        return false;
    }
    const double reserve = std::max(paid.expense, std::max(0.0, -paid.net) * 3.0);
    if (paid.stockpile - debit < reserve) {
        error = "Actual market upkeep reserve would be consumed";
        return false;
    }
    if (received.stockpile + credit > received.max) {
        error = "Actual market receiving storage capacity exceeded";
        return false;
    }
    return true;
}
}
