import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';
import '../tips.dart';
import 'call_screen.dart';

class MatchingScreen extends StatefulWidget {
  final Map<String, dynamic> profile;
  final String? wantGender; // 'male' | 'female' | null (anyone)
  final String? wantCountry; // country name | null (anywhere)
  const MatchingScreen({
    super.key,
    required this.profile,
    this.wantGender,
    this.wantCountry,
  });

  @override
  State<MatchingScreen> createState() => _MatchingScreenState();
}

class _MatchingScreenState extends State<MatchingScreen>
    with SingleTickerProviderStateMixin {
  static const _timeoutSeconds = 60;

  SupabaseClient get _db => Supabase.instance.client;
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat();

  Timer? _poll;
  int _elapsed = 0;
  bool _timedOut = false;
  bool _permissionDenied = false;
  bool _matched = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _begin();
  }

  Future<void> _begin() async {
    setState(() {
      _timedOut = false;
      _permissionDenied = false;
      _elapsed = 0;
    });
    final status = await Permission.microphone.request();
    if (!status.isGranted) {
      if (mounted) setState(() => _permissionDenied = true);
      return;
    }
    _poll?.cancel();
    _tick();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _tick());
  }

  Future<void> _tick() async {
    if (_busy || _matched || !mounted) return;
    _busy = true;
    try {
      final rows = await _db.rpc('find_match', params: {
        'p_gender': widget.wantGender,
        'p_country': widget.wantCountry,
      }) as List;
      if (!mounted) return;
      if (rows.isNotEmpty) {
        final m = rows.first as Map<String, dynamic>;
        _matched = true;
        _poll?.cancel();
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => CallScreen(
              callId: m['call_id'] as String,
              channel: m['channel'] as String,
              partnerId: m['partner_id'] as String,
              myLevel: widget.profile['level'] as String,
            ),
          ),
        );
        return;
      }
      _elapsed += 2;
      if (_elapsed >= _timeoutSeconds) {
        _poll?.cancel();
        await _db.rpc('leave_queue');
        if (mounted) setState(() => _timedOut = true);
      }
    } catch (_) {
      // transient network error; keep trying until timeout
    } finally {
      _busy = false;
    }
  }

  Future<void> _cancel() async {
    _poll?.cancel();
    try {
      await _db.rpc('leave_queue');
    } catch (_) {}
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _pulse.dispose();
    if (!_matched) {
      _db.rpc('leave_queue').then((_) {}, onError: (_) {});
    }
    super.dispose();
  }

  String? get _lookingFor {
    final parts = <String>[
      if (widget.wantGender != null)
        widget.wantGender == 'female' ? 'Women' : 'Men',
      if (widget.wantCountry != null) widget.wantCountry!,
    ];
    return parts.isEmpty ? null : 'Looking for: ${parts.join(' · ')}';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _cancel();
      },
      child: Scaffold(
        body: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [AppColors.accentSoft, AppColors.bg],
              stops: [0, 0.55],
            ),
          ),
          child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                const Spacer(),
                if (_permissionDenied)
                  _Message(
                    icon: Icons.mic_off_rounded,
                    title: 'Microphone access needed',
                    body:
                        'Open Talk needs your microphone so your partner can hear you.',
                    primary: 'Open settings',
                    onPrimary: openAppSettings,
                    secondary: 'Try again',
                    onSecondary: _begin,
                  )
                else if (_timedOut)
                  _Message(
                    icon: Icons.hourglass_empty_rounded,
                    title: 'No one is available right now',
                    body:
                        'Not many people are online at this moment. Try again in a minute.',
                    primary: 'Try again',
                    onPrimary: _begin,
                  )
                else ...[
                  SizedBox(
                    width: 220,
                    height: 220,
                    child: AnimatedBuilder(
                      animation: _pulse,
                      builder: (context, _) {
                        return Stack(
                          alignment: Alignment.center,
                          children: [
                            for (final shift in [0.0, 0.5])
                              _Ring(progress: (_pulse.value + shift) % 1),
                            Container(
                              width: 84,
                              height: 84,
                              decoration: const BoxDecoration(
                                color: AppColors.accent,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.mic_rounded,
                                  color: Colors.white, size: 38),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 32),
                  const Text('Finding a partner',
                      style:
                          TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text(_lookingFor ?? 'This usually takes a few seconds.',
                      style: const TextStyle(
                          fontSize: 15, color: AppColors.muted)),
                  const SizedBox(height: 28),
                  const TipCard(),
                ],
                const Spacer(),
                if (!_timedOut && !_permissionDenied)
                  PrimaryButton(
                      label: 'Cancel', outlined: true, onPressed: _cancel)
                else
                  TextButton(onPressed: _cancel, child: const Text('Back')),
              ],
            ),
          ),
        ),
        ),
      ),
    );
  }
}

/// Rotates a short tip every 5 seconds while the user waits.
class TipCard extends StatefulWidget {
  const TipCard({super.key});

  @override
  State<TipCard> createState() => _TipCardState();
}

class _TipCardState extends State<TipCard> {
  late final List<(String, String)> _tips = [...waitingTips]..shuffle();
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) setState(() => _index = (_index + 1) % _tips.length);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tip = _tips[_index];
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 132),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.line),
      ),
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 450),
        transitionBuilder: (child, anim) => FadeTransition(
          opacity: anim,
          child: SlideTransition(
            position: Tween<Offset>(
                    begin: const Offset(0, 0.12), end: Offset.zero)
                .animate(anim),
            child: child,
          ),
        ),
        child: Column(
          key: ValueKey(_index),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.lightbulb_rounded,
                    size: 18, color: AppColors.gold),
                const SizedBox(width: 6),
                Text(tip.$1.toUpperCase(),
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.8,
                        color: AppColors.accent)),
              ],
            ),
            const SizedBox(height: 10),
            Text(tip.$2,
                style: const TextStyle(
                    fontSize: 16, height: 1.45, fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}

class _Ring extends StatelessWidget {
  final double progress;
  const _Ring({required this.progress});

  @override
  Widget build(BuildContext context) {
    final size = 84 + 136 * progress;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.accent.withValues(alpha: 0.16 * (1 - progress)),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;
  final String primary;
  final VoidCallback onPrimary;
  final String? secondary;
  final VoidCallback? onSecondary;
  const _Message({
    required this.icon,
    required this.title,
    required this.body,
    required this.primary,
    required this.onPrimary,
    this.secondary,
    this.onSecondary,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 84,
          height: 84,
          decoration: const BoxDecoration(
              color: AppColors.accentSoft, shape: BoxShape.circle),
          child: Icon(icon, size: 38, color: AppColors.accent),
        ),
        const SizedBox(height: 24),
        Text(title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text(body,
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 15, color: AppColors.muted, height: 1.4)),
        const SizedBox(height: 24),
        PrimaryButton(label: primary, onPressed: onPrimary),
        if (secondary != null) ...[
          const SizedBox(height: 10),
          PrimaryButton(
              label: secondary!, outlined: true, onPressed: onSecondary),
        ],
      ],
    );
  }
}
