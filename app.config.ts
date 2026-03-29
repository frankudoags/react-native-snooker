import { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "react-native-snooker",
  slug: "react-native-snooker",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.oysterai.reactnativesnooker",
  },
  android: {
    package: "com.oysterai.reactnativesnooker",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
  },
  web: {
    favicon: "./assets/favicon.png",
  },
};

export default config;
