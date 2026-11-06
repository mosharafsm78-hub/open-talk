class AppConfig {
  // These values are public by design (client-side keys). The Agora App
  // Certificate is NOT here; it lives only on the server.
  static const supabaseUrl = 'https://pmyfswozvkdpqgnsiibf.supabase.co';
  static const supabaseAnonKey = 'sb_publishable_RrciEiRwRPkbU6yO6wt8Zg_BI0tSYEW';
  static const agoraAppId = '0025f1acf06d492c8e1426521a24e5c6';
  static const privacyUrl = 'https://mosharafsm78-hub.github.io/open-talk/privacy.html';
  static const dailyGoalMinutes = 10;

  // AdMob. These are Google's public TEST ids (safe, show test ads only).
  // Before the Play Store release, replace with the real ids from AdMob:
  // the app id also goes in tool/patch_android.py.
  static const admobRewardedUnitId = 'ca-app-pub-3940256099942544/5224354917';
}
