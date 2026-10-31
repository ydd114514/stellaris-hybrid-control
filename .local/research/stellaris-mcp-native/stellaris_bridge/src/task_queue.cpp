#include "task_queue.hpp"
#include "country_ai_world.hpp"
#include <stdexcept>

namespace bridge {
namespace {thread_local std::optional<uint64_t> expectedWorld;}
RequestWorldScope::RequestWorldScope(std::optional<uint64_t> expected):previous_(expectedWorld){expectedWorld=expected;}
RequestWorldScope::~RequestWorldScope(){expectedWorld=previous_;}

TaskQueue& TaskQueue::Get() {
    static TaskQueue instance;
    return instance;
}

std::future<nlohmann::json> TaskQueue::Enqueue(std::function<nlohmann::json()> fn) {
    auto promise = std::make_shared<std::promise<nlohmann::json>>();
    auto future = promise->get_future();

    {
        std::lock_guard<std::mutex> lock(mutex_);
        tasks_.push_back(Task{ std::move(fn), promise, expectedWorld });
    }

    return future;
}

void TaskQueue::ProcessAll() {
    std::vector<Task> local_tasks;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (tasks_.empty()) {
            return;
        }
        local_tasks.swap(tasks_);
    }

    for (auto& task : local_tasks) {
        try {
            if(task.expected_world&&(cyberfish::CountryAIWorldLoading()||*task.expected_world!=cyberfish::CountryAIWorldGeneration()))
                throw std::runtime_error("World generation changed or loading; refusing queued old-world request");
            nlohmann::json result = task.fn();
            task.promise->set_value(result);
        } catch (const std::exception& ex) {
            LOGF("[TASK_ERROR] Exception: %s", ex.what());
            nlohmann::json err = {
                {"error", {
                    {"code", -32001},
                    {"message", ex.what()}
                }}
            };
            task.promise->set_value(err);
        } catch (...) {
            LOG("[TASK_ERROR] Unknown exception during task execution.");
            nlohmann::json err = {
                {"error", {
                    {"code", -32002},
                    {"message", "Unknown exception executing task on main thread"}
                }}
            };
            task.promise->set_value(err);
        }
    }
}

} // namespace bridge
