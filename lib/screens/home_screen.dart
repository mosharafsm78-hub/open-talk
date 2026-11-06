import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';
import '../theme.dart';
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
  int _todaySeconds = 0;
  int _totalSeconds = 0;

  SupabaseClient get _db => Supabase.instance.client;

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
      if (!mounted) return;
      setState(() {
        _todaySeconds = (today as num).toInt();
        _profile = p;
        _totalSeconds = (p['total_seconds'] as num).toInt();
      });
    } catch (_) {}
  }

  Future<void> _start() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => MatchingScreen(profile: _profile)),
    );
    _refresh();
  }

  Future<void> _openSettings() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SettingsScreen(profile: _profile)),
    );
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final name = (_profile['display_name'] as String).split(' ').first;
    const goal = AppConfig.dailyGoalMinutes * 60;
    final progress = (_todaySeconds / goal).clamp(0.0, 1.0);
    final todayMin = _todaySeconds ~/ 60;
    final totalMin = _totalSeconds ~/ 60;
    final level = _profile['level'] as String;

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
                  IconButton(
                    onPressed: _openSettings,
                    icon: const Icon(Icons.settings_outlined),
                    tooltip: 'Settings',
                  ),
                ],
              ),
              const SizedBox(height: 24),
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
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: AppColors.accent,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Column(
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
                              fontSize: 17, fontWeight: FontWeight.w700)),
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
              ),
              const SizedBox(height: 20),
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
