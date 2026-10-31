#pragma once

#include "common.hpp"
#include <optional>

namespace bridge {

struct Task {
    std::function<nlohmann::json()> fn;
    std::shared_ptr<std::promise<nlohmann::json>> promise;
    std::optional<uint64_t> expected_world;
};

class RequestWorldScope {
public:
    explicit RequestWorldScope(std::optional<uint64_t> expected);
    ~RequestWorldScope();
private:
    std::optional<uint64_t> previous_;
};

class TaskQueue {
public:
    static TaskQueue& Get();

    // Enqueue a callable from IPC thread to be executed in game main thread
    std::future<nlohmann::json> Enqueue(std::function<nlohmann::json()> fn);

    // Drain and execute all tasks on main thread (called in Present hook)
    void ProcessAll();

private:
    TaskQueue() = default;
    ~TaskQueue() = default;

    std::mutex mutex_;
    std::vector<Task> tasks_;
};

} // namespace bridge
