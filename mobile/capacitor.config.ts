import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.opentalk.app',
  appName: 'Open Talk',
  webDir: 'www',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#f7f7fb',
    allowMixedContent: false
  }
};

export default config;
