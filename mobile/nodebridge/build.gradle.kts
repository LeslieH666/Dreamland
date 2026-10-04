plugins {
    id("com.android.library")
}

android {
    namespace = "com.leslietavern.dreamland.nodebridge"
    compileSdk = 36
    ndkVersion = "29.0.13113456"

    defaultConfig {
        minSdk = 26
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild {
            cmake {
                arguments += "-DNODE_RUNTIME_ROOT=${projectDir.parentFile.resolve("android/.runtime-cache/node24").absolutePath}"
                arguments += "-DANDROID_STL=c++_shared"
                cppFlags += listOf("-std=c++20", "-fexceptions", "-frtti")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }

    sourceSets["main"].jniLibs.srcDir(
        projectDir.parentFile.resolve("android/.runtime-cache/node24/jniLibs"),
    )

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}
