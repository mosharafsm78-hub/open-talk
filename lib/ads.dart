import 'dart:async';

import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'config.dart';

/// Rewarded video ads (AdMob). Optional for the user; coins are granted by the server.
class AdsService {
  static bool _ready = false;

  /// Asks for consent where the law requires it (EEA/UK), then starts the ads SDK.
  static Future<void> init() async {
    try {
      final done = Completer<void>();
      ConsentInformation.instance.requestConsentInfoUpdate(
        ConsentRequestParameters(),
        () async {
          try {
            await ConsentForm.loadAndShowConsentFormIfRequired((_) {});
          } catch (_) {}
          done.complete();
        },
        (_) => done.complete(),
      );
      await done.future.timeout(const Duration(seconds: 20), onTimeout: () {});
      if (await ConsentInformation.instance.canRequestAds()) {
        await MobileAds.instance.initialize();
        _ready = true;
      }
    } catch (_) {
      // Ads are optional; the app works without them.
    }
  }

  /// Loads and shows one rewarded video. Returns true only if the user earned the reward.
  /// Throws [AdUnavailable] when no ad could be shown.
  static Future<bool> showRewarded() async {
    if (!_ready) {
      await init();
      if (!_ready) throw AdUnavailable();
    }
    final loaded = Completer<RewardedAd>();
    await RewardedAd.load(
      adUnitId: AppConfig.admobRewardedUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: loaded.complete,
        onAdFailedToLoad: (e) => loaded.completeError(AdUnavailable()),
      ),
    );
    final ad = await loaded.future.timeout(const Duration(seconds: 20),
        onTimeout: () => throw AdUnavailable());

    final finished = Completer<bool>();
    var earned = false;
    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdDismissedFullScreenContent: (a) {
        a.dispose();
        if (!finished.isCompleted) finished.complete(earned);
      },
      onAdFailedToShowFullScreenContent: (a, _) {
        a.dispose();
        if (!finished.isCompleted) finished.completeError(AdUnavailable());
      },
    );
    await ad.show(onUserEarnedReward: (_, __) => earned = true);
    return finished.future;
  }
}

class AdUnavailable implements Exception {}
