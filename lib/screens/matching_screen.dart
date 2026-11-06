import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';
import 'call_screen.dart';

class MatchingScreen extends StatefulWidget {
  final Map<String, dynamic> profile;
  const MatchingScreen({super.key, required this.profile});

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
      final rows = await _db.rpc('find_match') as List;
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

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _cancel();
      },
      child: Scaffold(
        body: SafeArea(
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
                  const Text('This usually takes a few seconds.',
                      style: TextStyle(fontSize: 15, color: AppColors.muted)),
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
