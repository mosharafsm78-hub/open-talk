import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../ads.dart';
import '../theme.dart';

/// Human-readable time left until [until], e.g. "45 min left", "3 h left", "1 d 2 h left".
String timeLeft(DateTime until) {
  final d = until.difference(DateTime.now());
  if (d.inMinutes < 1) return 'less than a minute left';
  if (d.inMinutes < 60) return '${d.inMinutes} min left';
  if (d.inHours < 24) return '${d.inHours} h left';
  final h = d.inHours % 24;
  return h == 0 ? '${d.inDays} d left' : '${d.inDays} d $h h left';
}

String friendlyError(Object e) {
  final m = e.toString();
  if (m.contains('not_enough_coins')) {
    return 'Not enough coins yet. Earn more in the Earn tab.';
  }
  if (m.contains('already_claimed')) return 'Already claimed.';
  if (m.contains('daily_limit')) return 'You have watched all of today\'s videos. Come back tomorrow.';
  if (m.contains('too_fast')) return 'Please wait a few seconds and try again.';
  if (m.contains('not_ready')) return 'Keep going, this one is not ready yet.';
  return 'Something went wrong. Please try again.';
}

class CoinsScreen extends StatefulWidget {
  final int initialTab;
  const CoinsScreen({super.key, this.initialTab = 0});

  @override
  State<CoinsScreen> createState() => _CoinsScreenState();
}

class _CoinsScreenState extends State<CoinsScreen> {
  SupabaseClient get _db => Supabase.instance.client;

  Map<String, dynamic>? _wallet;
  List<Map<String, dynamic>> _achievements = [];
  bool _loading = true;
  bool _failed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final w = await _db.rpc('get_wallet') as Map<String, dynamic>;
      final a = await _db.rpc('list_achievements') as List;
      if (!mounted) return;
      setState(() {
        _wallet = w;
        _achievements = a.cast<Map<String, dynamic>>();
        _loading = false;
        _failed = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  /// Runs a server action, then reloads. Returns true on success.
  Future<bool> _run(Future<void> Function() action, {String? success}) async {
    if (_busy) return false;
    setState(() => _busy = true);
    try {
      await action();
      await _load();
      if (mounted && success != null) showMessage(context, success);
      return true;
    } catch (e) {
      if (mounted) showMessage(context, friendlyError(e));
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _claimDaily() => _run(() async {
        final r = await _db.rpc('claim_daily') as int;
        if (mounted) showMessage(context, '+$r coins added');
      });

  Future<void> _watchVideo() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final earned = await AdsService.showRewarded();
      if (!earned) {
        if (mounted) showMessage(context, 'Watch the full video to earn coins.');
        return;
      }
      final r = await _db.rpc('claim_ad_reward') as Map<String, dynamic>;
      await _load();
      if (mounted) showMessage(context, '+${r['coins']} coins added');
    } on AdUnavailable {
      if (mounted) {
        showMessage(context, 'No video is available right now. Try again in a moment.');
      }
    } catch (e) {
      if (mounted) showMessage(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _claimAchievement(String key) => _run(() async {
        final r = await _db.rpc('claim_achievement', params: {'p_key': key});
        if (mounted) showMessage(context, '+$r coins added');
      });

  Future<void> _buy(String kind, String option, int price, String what) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Unlock $what?'),
        content: Text('This will use $price coins.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Unlock')),
        ],
      ),
    );
    if (ok != true) return;
    await _run(
      () => _db.rpc('buy_pass', params: {'p_kind': kind, 'p_option': option}),
      success: 'Unlocked. Choose it on the home screen.',
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      initialIndex: widget.initialTab,
      child: Scaffold(
        appBar: AppBar(title: const Text('Coins')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _failed
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('Could not load your coins.'),
                          const SizedBox(height: 16),
                          PrimaryButton(
                            label: 'Try again',
                            onPressed: () {
                              setState(() => _loading = true);
                              _load();
                            },
                          ),
                        ],
                      ),
                    ),
                  )
                : Column(
                    children: [
                      _Balance(wallet: _wallet!),
                      const TabBar(
                        labelStyle: TextStyle(fontWeight: FontWeight.w700),
                        tabs: [
                          Tab(text: 'Earn'),
                          Tab(text: 'Unlock'),
                          Tab(text: 'Buy'),
                        ],
                      ),
                      Expanded(
                        child: TabBarView(
                          children: [
                            _EarnTab(
                              wallet: _wallet!,
                              achievements: _achievements,
                              busy: _busy,
                              onDaily: _claimDaily,
                              onWatch: _watchVideo,
                              onClaim: _claimAchievement,
                            ),
                            _UnlockTab(
                              wallet: _wallet!,
                              busy: _busy,
                              onBuy: _buy,
                            ),
                            const _BuyTab(),
                          ],
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }
}

class _Balance extends StatelessWidget {
  final Map<String, dynamic> wallet;
  const _Balance({required this.wallet});

  @override
  Widget build(BuildContext context) {
    final streak = (wallet['streak'] as num).toInt();
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 4, 20, 12),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.accent, AppColors.accentDeep],
        ),
      ),
      child: Row(
        children: [
          const CoinIcon(size: 46),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${wallet['coins']}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 32,
                        fontWeight: FontWeight.w800)),
                Text('Your coins',
                    style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.8),
                        fontSize: 14)),
              ],
            ),
          ),
          if (streak > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.local_fire_department_rounded,
                      color: Color(0xFFFFB84D), size: 20),
                  const SizedBox(width: 4),
                  Text('$streak day${streak == 1 ? '' : 's'}',
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  final Widget child;
  const _Card({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.line),
      ),
      child: child,
    );
  }
}

class _Reward extends StatelessWidget {
  final int amount;
  const _Reward(this.amount);

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const CoinIcon(size: 16),
        const SizedBox(width: 4),
        Text('$amount',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
      ],
    );
  }
}

class _EarnTab extends StatelessWidget {
  final Map<String, dynamic> wallet;
  final List<Map<String, dynamic>> achievements;
  final bool busy;
  final VoidCallback onDaily;
  final VoidCallback onWatch;
  final void Function(String key) onClaim;
  const _EarnTab({
    required this.wallet,
    required this.achievements,
    required this.busy,
    required this.onDaily,
    required this.onWatch,
    required this.onClaim,
  });

  @override
  Widget build(BuildContext context) {
    final adsLeft = (wallet['ads_left'] as num).toInt();
    final adReward = (wallet['ad_reward'] as num).toInt();
    final available = wallet['daily_available'] == true;
    final streak = (wallet['streak'] as num).toInt();
    final next = streak % 7 == 0 && !available ? 7 : 7 - (streak % 7);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        _Card(
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: const BoxDecoration(
                    color: AppColors.goldSoft, shape: BoxShape.circle),
                child: const Icon(Icons.card_giftcard_rounded,
                    color: AppColors.gold),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Daily reward',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(
                      available
                          ? '+5 coins. Every 7th day in a row gives +20 more.'
                          : 'Come back tomorrow. $next more day${next == 1 ? '' : 's'} for the bonus.',
                      style: const TextStyle(
                          fontSize: 13, color: AppColors.muted, height: 1.35),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (available)
                FilledButton(
                  onPressed: busy ? null : onDaily,
                  style: FilledButton.styleFrom(
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Claim'),
                )
              else
                const Icon(Icons.check_circle_rounded,
                    color: AppColors.success),
            ],
          ),
        ),
        _Card(
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: const BoxDecoration(
                    color: AppColors.accentSoft, shape: BoxShape.circle),
                child: const Icon(Icons.play_circle_fill_rounded,
                    color: AppColors.accent),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Watch a video',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(
                      adsLeft > 0
                          ? '+$adReward coins each. $adsLeft left today.'
                          : 'All done for today. New videos tomorrow.',
                      style: const TextStyle(
                          fontSize: 13, color: AppColors.muted, height: 1.35),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (adsLeft > 0)
                FilledButton(
                  onPressed: busy ? null : onWatch,
                  style: FilledButton.styleFrom(
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Watch'),
                )
              else
                const Icon(Icons.check_circle_rounded,
                    color: AppColors.success),
            ],
          ),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(4, 12, 0, 10),
          child: Text('Achievements',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        ),
        for (final a in achievements) _AchievementTile(a: a, busy: busy, onClaim: onClaim),
      ],
    );
  }
}

class _AchievementTile extends StatelessWidget {
  final Map<String, dynamic> a;
  final bool busy;
  final void Function(String key) onClaim;
  const _AchievementTile(
      {required this.a, required this.busy, required this.onClaim});

  @override
  Widget build(BuildContext context) {
    final progress = (a['progress'] as num).toInt();
    final target = (a['target'] as num).toInt();
    final claimed = a['claimed'] == true;
    final ready = !claimed && progress >= target;
    return _Card(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(a['title'] as String,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(a['description'] as String,
                    style: const TextStyle(
                        fontSize: 13, color: AppColors.muted)),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: claimed ? 1 : progress / target,
                    minHeight: 7,
                    backgroundColor: AppColors.accentSoft,
                    color: claimed ? AppColors.success : AppColors.accent,
                  ),
                ),
                const SizedBox(height: 4),
                Text(claimed ? 'Completed' : '$progress / $target',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.muted)),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _Reward((a['reward'] as num).toInt()),
              const SizedBox(height: 8),
              if (claimed)
                const Icon(Icons.check_circle_rounded,
                    color: AppColors.success)
              else if (ready)
                FilledButton(
                  onPressed: busy ? null : () => onClaim(a['ach_key'] as String),
                  style: FilledButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Claim'),
                )
              else
                const Icon(Icons.lock_outline_rounded,
                    color: AppColors.muted, size: 22),
            ],
          ),
        ],
      ),
    );
  }
}

class _UnlockTab extends StatelessWidget {
  final Map<String, dynamic> wallet;
  final bool busy;
  final Future<void> Function(String kind, String option, int price, String what)
      onBuy;
  const _UnlockTab(
      {required this.wallet, required this.busy, required this.onBuy});

  DateTime? _until(String key) {
    final v = wallet[key] as String?;
    if (v == null) return null;
    final t = DateTime.parse(v).toLocal();
    return t.isAfter(DateTime.now()) ? t : null;
  }

  @override
  Widget build(BuildContext context) {
    final coins = (wallet['coins'] as num).toInt();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        _PassSection(
          icon: Icons.wc_rounded,
          title: 'Choose gender',
          subtitle: 'Talk only with men or only with women.',
          until: _until('gender_until'),
          coins: coins,
          busy: busy,
          options: [
            _PassOption('1 hour', 40,
                () => onBuy('gender', '1h', 40, 'gender choice for 1 hour')),
            _PassOption('1 day', 200,
                () => onBuy('gender', '1d', 200, 'gender choice for 1 day')),
          ],
        ),
        const SizedBox(height: 8),
        _PassSection(
          icon: Icons.public_rounded,
          title: 'Choose country',
          subtitle: 'Talk with people from one country you pick.',
          until: _until('country_until'),
          coins: coins,
          busy: busy,
          options: [
            _PassOption('1 day', 150,
                () => onBuy('country', '1d', 150, 'country choice for 1 day')),
            _PassOption('2 days', 250,
                () => onBuy('country', '2d', 250, 'country choice for 2 days')),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Buying again while a pass is active adds to the time you have left. '
          'With a filter on, matching can take a little longer.',
          style: TextStyle(fontSize: 13, color: AppColors.muted, height: 1.4),
        ),
      ],
    );
  }
}

class _PassOption {
  final String label;
  final int price;
  final VoidCallback onTap;
  _PassOption(this.label, this.price, this.onTap);
}

class _PassSection extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final DateTime? until;
  final int coins;
  final bool busy;
  final List<_PassOption> options;
  const _PassSection({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.until,
    required this.coins,
    required this.busy,
    required this.options,
  });

  @override
  Widget build(BuildContext context) {
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                    color: AppColors.accentSoft, shape: BoxShape.circle),
                child: Icon(icon, color: AppColors.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    Text(subtitle,
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          if (until != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFE6F6EF),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.check_circle_rounded,
                      size: 18, color: AppColors.success),
                  const SizedBox(width: 6),
                  Text('Active · ${timeLeft(until!)}',
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.success)),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              for (var i = 0; i < options.length; i++) ...[
                if (i > 0) const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton(
                    onPressed: busy || coins < options[i].price
                        ? null
                        : options[i].onTap,
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                      side: const BorderSide(color: AppColors.line),
                    ),
                    child: Column(
                      children: [
                        Text(options[i].label,
                            style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: AppColors.ink)),
                        const SizedBox(height: 4),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const CoinIcon(size: 15),
                            const SizedBox(width: 4),
                            Text('${options[i].price}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.ink)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (coins < options.first.price)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text('Earn more coins to unlock this.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted)),
            ),
        ],
      ),
    );
  }
}

class _BuyTab extends StatelessWidget {
  const _BuyTab();

  @override
  Widget build(BuildContext context) {
    const bundles = [
      ('Starter pack', 100, r'$0.99', null),
      ('Includes 10% bonus coins', 550, r'$4.99', 'Most popular'),
      ('Includes 20% bonus coins', 1200, r'$9.99', 'Best value'),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.accentSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Row(
            children: [
              Icon(Icons.info_outline_rounded, color: AppColors.accent),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Coin packs are coming soon. Until then you can earn coins for free from the Earn tab.',
                  style: TextStyle(fontSize: 13, height: 1.4),
                ),
              ),
            ],
          ),
        ),
        for (final b in bundles)
          _Card(
            child: Row(
              children: [
                const CoinIcon(size: 40),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text('${b.$2} coins',
                              style: const TextStyle(
                                  fontSize: 17, fontWeight: FontWeight.w800)),
                          if (b.$4 != null) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: AppColors.goldSoft,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(b.$4!,
                                  style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: Color(0xFFB36B00))),
                            ),
                          ],
                        ],
                      ),
                      Text(b.$1,
                          style: const TextStyle(
                              fontSize: 13, color: AppColors.muted)),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(b.$3,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, color: AppColors.muted)),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
