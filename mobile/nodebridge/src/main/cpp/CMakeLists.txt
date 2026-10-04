cmake_minimum_required(VERSION 3.22.1)
project(dreamland_node_bridge LANGUAGES CXX)

if(NOT NODE_RUNTIME_ROOT)
    message(FATAL_ERROR "Set NODE_RUNTIME_ROOT to the verified Node mobile runtime directory")
endif()

set(NODE_LIBRARY "${NODE_RUNTIME_ROOT}/bin/${ANDROID_ABI}/libnode.so")
if(NOT EXISTS "${NODE_LIBRARY}")
    message(FATAL_ERROR "Node mobile runtime is missing for ABI ${ANDROID_ABI}: ${NODE_LIBRARY}")
endif()

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION "${NODE_LIBRARY}")

add_library(dreamlandnode SHARED dreamland_node.cpp)
target_include_directories(dreamlandnode PRIVATE "${NODE_RUNTIME_ROOT}/include/node")
target_link_libraries(dreamlandnode PRIVATE node c++_shared android log)
