#include <jni.h>
#include <node.h>
#include <signal.h>
#include <unistd.h>

#include <cstdlib>
#include <string>
#include <vector>

namespace {
std::string FromJava(JNIEnv* env, jstring value) {
    if (value == nullptr) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}
}

extern "C" JNIEXPORT jint JNICALL
Java_com_leslietavern_dreamland_nodebridge_NodeRuntime_startNode(
    JNIEnv* env, jclass, jstring server_root, jstring data_root,
    jstring config_path, jstring cache_root) {
    const std::string server = FromJava(env, server_root);
    const std::string data = FromJava(env, data_root);
    const std::string config = FromJava(env, config_path);
    const std::string cache = FromJava(env, cache_root);
    if (server.empty() || data.empty() || config.empty() || cache.empty()) return 2;

    if (chdir(server.c_str()) != 0) return 3;
    setenv("HOME", data.c_str(), 1);
    setenv("TMPDIR", cache.c_str(), 1);
    setenv("NODE_ENV", "production", 1);
    setenv("DREAMLAND_ANDROID", "1", 1);
    setenv("NODE_OPTIONS", "--max-old-space-size-percentage=25 --dns-result-order=ipv4first", 1);

    std::vector<std::string> arguments = {
        "node", "server.js", "--listen=false", "--enableIPv4=true",
        "--enableIPv6=false", "--browserLaunchEnabled=false", "--port=18790",
        "--dataRoot=" + data, "--configPath=" + config,
    };
    std::vector<char*> argv;
    argv.reserve(arguments.size() + 1);
    for (std::string& argument : arguments) argv.push_back(argument.data());
    argv.push_back(nullptr);
    return node::Start(static_cast<int>(arguments.size()), argv.data());
}

extern "C" JNIEXPORT void JNICALL
Java_com_leslietavern_dreamland_nodebridge_NodeRuntime_stopNode(JNIEnv*, jclass) {
    kill(getpid(), SIGTERM);
}
