pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "DreamLandAndroid"
include(":app", ":shared", ":nodebridge")
project(":shared").projectDir = file("../shared")
project(":nodebridge").projectDir = file("../nodebridge")
