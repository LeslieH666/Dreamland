plugins {
    id("com.android.library")
}

android {
    namespace = "com.leslietavern.dreamland.mobile.shared"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
