import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';
import '../theme.dart';
import '../topics.dart';
import 'coins_screen.dart';
import 'matching_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  final Map<String, dynamic> profile;
  const HomeScreen({super.key, required this.profile});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Map<String, dynamic> _profile = widget.profile;
  Map<String, dynamic>? _wallet;
  int _todaySeconds = 0;
  int _totalSeconds = 0;
  String? _wantGender; // null = anyone
  String? _wantCountry; // null = anywhere
  bool _claiming = false;

  SupabaseClient get _db => Supabase.instance.client;

  DateTime? _until(String key) {
    final v = _wallet?[key] as String?;
    if (v == null) return null;
    final t = DateTime.parse(v).toLocal();
    return t.isAfter(DateTime.now()) ? t : null;
  }

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final today = await _db.rpc('today_seconds');
      final p = await _db
          .from('profiles')
          .select()
          .eq('id', _db.auth.currentUser!.id)
          .single();
      final w = await _db.rpc('get_wallet') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _todaySeconds = (today as num).toInt();
        _profile = p;
        _totalSeconds = (p['total_seconds'] as num).toInt();
        _wallet = w;
        // A choice only stays selected while its pass is active.
        if (_until('gender_until') == null) _wantGender = null;
        if (_until('country_until') == null) _wantCountry = null;
      });
    } catch (_) {}
  }

  Future<void> _start() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => MatchingScreen(
          profile: _profile,
          wantGender: _wantGender,
          wantCountry: _wantCountry,
        ),
      ),
    );
    _refresh();
  }

  Future<void> _openSettings() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SettingsScreen(profile: _profile)),
    );
    _refresh();
  }

  Future<void> _openCoins([int tab = 0]) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => CoinsScreen(initialTab: tab)),
    );
    _refresh();
  }

  Future<void> _claimDaily() async {
    if (_claiming) return;
    setState(() => _claiming = true);
    try {
      final r = await _db.rpc('claim_daily') as int;
      if (mounted) showMessage(context, '+$r coins added');
      await _refresh();
    } catch (e) {
      if (mounted) showMessage(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  Future<void> _pickGender() async {
    if (_until('gender_until') == null) return _openCoins(1);
    final v = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            const Text('Talk with',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            for (final o in const [
              ('any', 'Anyone'),
              ('female', 'Women'),
              ('male', 'Men'),
            ])
              ListTile(
                title: Text(o.$2),
                trailing: (_wantGender ?? 'any') == o.$1
                    ? const Icon(Icons.check_rounded, color: AppColors.accent)
                    : null,
                onTap: () => Navigator.pop(ctx, o.$1),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (v != null) setState(() => _wantGender = v == 'any' ? null : v);
  }

  Future<void> _pickCountry() async {
    if (_until('country_until') == null) return _openCoins(1);
    final v = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (ctx, scroll) => Column(
          children: [
            const SizedBox(height: 16),
            const Text('From country',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                controller: scroll,
                children: [
                  ListTile(
                    title: const Text('Anywhere'),
                    trailing: _wantCountry == null
                        ? const Icon(Icons.check_rounded,
                            color: AppColors.accent)
                        : null,
                    onTap: () => Navigator.pop(ctx, ''),
                  ),
                  for (final c in countries)
                    ListTile(
                      title: Text(c),
                      trailing: _wantCountry == c
                          ? const Icon(Icons.check_rounded,
                              color: AppColors.accent)
                          : null,
                      onTap: () => Navigator.pop(ctx, c),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (v != null) setState(() => _wantCountry = v.isEmpty ? null : v);
  }

  @override
  Widget build(BuildContext context) {
    final name = (_profile['display_name'] as String).split(' ').first;
    const goal = AppConfig.dailyGoalMinutes * 60;
    final progress = (_todaySeconds / goal).clamp(0.0, 1.0);
    final todayMin = _todaySeconds ~/ 60;
    final totalMin = _totalSeconds ~/ 60;
    final level = _profile['level'] as String;
    final coins = (_wallet?['coins'] as num?)?.toInt() ?? 0;
    final dailyReady = _wallet?['daily_available'] == true;
    final genderUntil = _until('gender_until');
    final countryUntil = _until('country_until');

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Hello, $name',
                            style: const TextStyle(
                                fontSize: 28, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 4),
                        Text(
                          '${level[0].toUpperCase()}${level.substring(1)} level',
                          style: const TextStyle(
                              fontSize: 15, color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                  InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: () => _openCoins(),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppColors.goldSoft,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const CoinIcon(size: 20),
                          const SizedBox(width: 6),
                          Text('$coins',
                              style: const TextStyle(
                                  fontSize: 15, fontWeight: FontWeight.w800)),
                        ],
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: _openSettings,
                    icon: const Icon(Icons.settings_outlined),
                    tooltip: 'Settings',
                  ),
                ],
              ),
              const SizedBox(height: 20),
              if (dailyReady) ...[
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                  decoration: BoxDecoration(
                    color: AppColors.goldSoft,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.card_giftcard_rounded,
                          color: AppColors.gold),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Text('Your daily reward is ready',
                            style: TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w700)),
                      ),
                      FilledButton(
                        onPressed: _claiming ? null : _claimDaily,
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.gold,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                        ),
                        child: const Text('Claim +5'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: AppColors.line),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 84,
                      height: 84,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          SizedBox.expand(
                            child: CircularProgressIndicator(
                              value: progress,
                              strokeWidth: 8,
                              strokeCap: StrokeCap.round,
                              backgroundColor: AppColors.accentSoft,
                              color: progress >= 1
                                  ? AppColors.success
                                  : AppColors.accent,
                            ),
                          ),
                          Text('$todayMin',
                              style: const TextStyle(
                                  fontSize: 26, fontWeight: FontWeight.w800)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 20),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Speaking today',
                              style: TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text(
                            progress >= 1
                                ? 'Daily goal reached. Great work!'
                                : '$todayMin of ${AppConfig.dailyGoalMinutes} minutes',
                            style: const TextStyle(
                                fontSize: 14, color: AppColors.muted),
                          ),
                          const SizedBox(height: 4),
                          Text('$totalMin min spoken in total',
                              style: const TextStyle(
                                  fontSize: 13, color: AppColors.muted)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              ClipRRect(
                borderRadius: BorderRadius.circular(24),
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.accent, AppColors.accentDeep],
                    ),
                  ),
                  child: Stack(
                    children: [
                      Positioned(
                        right: -50,
                        top: -60,
                        child: Container(
                          width: 160,
                          height: 160,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white.withValues(alpha: 0.07),
                          ),
                        ),
                      ),
                      Positioned(
                        right: 30,
                        bottom: -40,
                        child: Container(
                          width: 90,
                          height: 90,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white.withValues(alpha: 0.06),
                          ),
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Ready to practice?',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 22,
                                  fontWeight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          Text(
                            "We'll connect you with someone who is online right now.",
                            style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.85),
                                fontSize: 15,
                                height: 1.4),
                          ),
                          const SizedBox(height: 20),
                          FilledButton.icon(
                            onPressed: _start,
                            icon: const Icon(Icons.mic_rounded),
                            label: const Text('Start Talking',
                                style: TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w700)),
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(56),
                              backgroundColor: Colors.white,
                              foregroundColor: AppColors.accent,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16)),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _PrefRow(
                icon: Icons.wc_rounded,
                title: 'Talk with',
                value: _wantGender == null
                    ? 'Anyone'
                    : (_wantGender == 'female' ? 'Women' : 'Men'),
                status: genderUntil == null ? null : timeLeft(genderUntil),
                onTap: _pickGender,
              ),
              const SizedBox(height: 10),
              _PrefRow(
                icon: Icons.public_rounded,
                title: 'From country',
                value: _wantCountry ?? 'Anywhere',
                status: countryUntil == null ? null : timeLeft(countryUntil),
                onTap: _pickCountry,
              ),
              const SizedBox(height: 16),
              const _Tip(
                  text:
                      'Tip: Speak in full sentences, even if you make mistakes. '
                      'Being understood matters more than being perfect.'),
            ],
          ),
        ),
      ),
    );
  }
}

/// One match preference. Locked until the user unlocks it with coins.
class _PrefRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String value;
  final String? status; // null = locked
  final VoidCallback onTap;
  const _PrefRow({
    required this.icon,
    required this.title,
    required this.value,
    required this.status,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final locked = status == null;
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.line),
        ),
        child: Row(
          children: [
            Icon(icon, color: locked ? AppColors.muted : AppColors.accent),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          fontSize: 13, color: AppColors.muted)),
                  const SizedBox(height: 2),
                  Text(value,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
            if (locked)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.goldSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.lock_rounded, size: 14, color: AppColors.gold),
                    SizedBox(width: 4),
                    Text('Unlock',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFFB36B00))),
                  ],
                ),
              )
            else
              Text(status!,
                  style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.success)),
          ],
        ),
      ),
    );
  }
}

class _Tip extends StatelessWidget {
  final String text;
  const _Tip({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.accentSoft,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(text,
          style: const TextStyle(fontSize: 14, height: 1.45, color: AppColors.ink)),
    );
  }
}
