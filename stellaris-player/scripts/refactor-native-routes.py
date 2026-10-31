"""Split fork routes out of the upstream dispatcher to stay below MSVC nesting limits."""
from pathlib import Path
p=Path("../.local/research/stellaris-mcp-native/stellaris_bridge/src/ipc_server.cpp")
s=p.read_text(encoding="utf-8")
start=s.index('    } else if (method == "get_wars")')
end=s.index('    } else if (method == "get_fleets")',start)
body=s[start:end].replace('    } else if (method == "get_wars")','    if (method == "get_wars")',1)
helper='static std::future<nlohmann::json> EnqueueCyberfishRequest(const std::string& method,const nlohmann::json& params) {\n    std::future<nlohmann::json> fut;\n'+body+'    }\n    return fut;\n}\n\n'
s=s[:start]+s[end:]
marker='nlohmann::json IPCServer::ProcessRequest('
s=s.replace(marker,helper+marker,1)
s=s.replace('    std::future<nlohmann::json> fut;\n\n    if (method == "self_test_purecall_guard")', '    auto fut=EnqueueCyberfishRequest(method,params);\n\n    if (fut.valid()) {\n        // Already queued by the fork dispatcher.\n    } else if (method == "self_test_purecall_guard")',1)
p.write_text(s,encoding="utf-8")
