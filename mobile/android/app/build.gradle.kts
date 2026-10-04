plugins {
    id("com.android.application")
}

android {
    namespace = "com.leslietavern.dreamland.mobile"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    flavorDimensions += "runtime"
    productFlavors {
        create("client") {
            dimension = "runtime"
            buildConfigField("boolean", "STANDALONE", "false")
        }
        create("standalone") {
            dimension = "runtime"
            applicationIdSuffix = ".standalone"
            versionNameSuffix = "-beta"
            buildConfigField("boolean", "STANDALONE", "true")
        }
    }

    defaultConfig {
        applicationId = "com.leslietavern.dreamland.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 11800
        versionName = "1.18.0"
        buildConfigField("String", "SERVER_ASSET_VERSION", "\"${versionName}-beta7\"")
    }

    sourceSets.getByName("standalone").assets.srcDir(
        rootProject.projectDir.resolve(".runtime-cache/standalone-package-assets"),
    )

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation(project(":shared"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.google.android.material:material:1.13.0")
    add("standaloneImplementation", project(":nodebridge"))
}

val standaloneServerSource = rootProject.projectDir.resolve(".runtime-cache/standalone-server")
val standaloneServerAssets = rootProject.projectDir.resolve(".runtime-cache/standalone-package-assets")
val packageStandaloneServer = tasks.register<Zip>("packageStandaloneServer") {
    from(standaloneServerSource)
    archiveFileName.set("dreamland-server.zip")
    destinationDirectory.set(standaloneServerAssets)
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    includeEmptyDirs = false
}

tasks.matching { it.name.contains("Standalone") && it.name != "packageStandaloneServer" }.configureEach {
    dependsOn(packageStandaloneServer)
}
