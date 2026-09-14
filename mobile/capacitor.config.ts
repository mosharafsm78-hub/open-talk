import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.opentalk.app',
  appName: 'Open Talk',
  webDir: 'www',
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#f7f8fc',
      showSpinner: false
    },
    StatusBar: {
      style: 'light'
    }
  }
};

export default config;
