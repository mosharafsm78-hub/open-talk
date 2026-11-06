import 'dart:async';
import 'dart:math';

import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';
import '../theme.dart';
import '../topics.dart';
import 'post_call_screen.dart';

class CallScreen extends StatefulWidget {
  final String callId;
  final String channel;
  final String partnerId;
  final String myLevel;
  const CallScreen({
    super.key,
    required this.callId,
    required this.channel,
    required this.partnerId,
    required this.myLevel,
  });

  @override
  State<CallScreen> createState() => _CallScreenState();
}

enum _Phase { connecting, waiting, live, ended }

class _CallScreenState extends State<CallScreen> {
  SupabaseClient get _db => Supabase.instance.client;

  RtcEngine? _engine;
  _Phase _phase = _Phase.connecting;
  Map<String, dynamic>? _partner;
  bool _muted = false;
  bool _speaker = true;
  bool _finishing = false;
  String? _problem;
  String _stage = 'start';

  Timer? _clock;
  Timer? _waitTimer;
  int _seconds = 0;
  late List<String> _topics;
  int _topicIndex = 0;

  @override
  void initState() {
    super.initState();
    final list = List<String>.from(
        topicsByLevel[widget.myLevel] ?? topicsByLevel['beginner']!);
    list.shuffle(Random());
    _topics = list;
    _loadPartner();
    _join();
  }

  Future<void> _loadPartner() async {
    try {
      final p = await _db
          .from('profiles')
          .select('display_name,country,level')
          .eq('id', widget.partnerId)
          .single();
      if (mounted) setState(() => _partner = p);
    } catch (_) {}
  }

  Future<String> _fetchToken() async {
    final res = await _db.functions
        .invoke('agora-token', body: {'channel': widget.channel});
    final data = res.data;
    if (data is Map && data['token'] is String) return data['token'] as String;
    throw Exception('No token');
  }

  Future<void> _join() async {
    try {
      _stage = 'token';
      final token = await _fetchToken();
      _stage = 'create';
      final engine = createAgoraRtcEngine();
      _engine = engine;
      _stage = 'initialize';
      await engine.initialize(RtcEngineContext(
        appId: AppConfig.agoraAppId,
        channelProfile: ChannelProfileType.channelProfileCommunication,
      ));
      engine.registerEventHandler(RtcEngineEventHandler(
        onJoinChannelSuccess: (connection, elapsed) {
          _engine?.setEnableSpeakerphone(_speaker).then((_) {}, onError: (_) {});
          if (!mounted || _phase == _Phase.live) return;
          setState(() => _phase = _Phase.waiting);
        },
        onUserJoined: (connection, remoteUid, elapsed) {
          if (!mounted) return;
          _waitTimer?.cancel();
          _clock?.cancel();
          setState(() {
            _phase = _Phase.live;
            _seconds = 0;
          });
          _clock = Timer.periodic(const Duration(seconds: 1), (_) {
            if (mounted) setState(() => _seconds++);
          });
        },
        onUserOffline: (connection, remoteUid, reason) {
          if (_phase == _Phase.live) {
            _finish(note: 'Your partner left the call.');
          }
        },
        onTokenPrivilegeWillExpire: (connection, token) async {
          try {
            final fresh = await _fetchToken();
            await _engine?.renewToken(fresh);
          } catch (_) {}
        },
        onError: (err, msg) {
          // Non-fatal audio warnings are common; only surface hard failures.
        },
      ));
      _stage = 'enableAudio';
      await engine.enableAudio();
      _stage = 'audioProfile';
      await engine.setAudioProfile(
        profile: AudioProfileType.audioProfileSpeechStandard,
        scenario: AudioScenarioType.audioScenarioChatroom,
      );
      _stage = 'speakerRoute';
      await engine.setDefaultAudioRouteToSpeakerphone(_speaker);
      _stage = 'joinChannel';
      await engine.joinChannel(
        token: token,
        channelId: widget.channel,
        uid: 0,
        options: const ChannelMediaOptions(
          clientRoleType: ClientRoleType.clientRoleBroadcaster,
          channelProfile: ChannelProfileType.channelProfileCommunication,
          autoSubscribeAudio: true,
          publishMicrophoneTrack: true,
        ),
      );
      _waitTimer = Timer(const Duration(seconds: 30), () {
        if (_phase != _Phase.live) {
          _finish(note: "Your partner couldn't connect. Please try again.");
        }
      });
    } catch (e) {
      try {
        await _engine?.release();
      } catch (_) {}
      _engine = null;
      if (mounted) {
        setState(() => _problem = 'Could not start the call.\n\n[$_stage] $e');
      }
    }
  }

  Future<void> _finish({String? note}) async {
    if (_finishing) return;
    _finishing = true;
    _clock?.cancel();
    _waitTimer?.cancel();
    final spoke = _seconds;
    if (mounted) setState(() => _phase = _Phase.ended);
    try {
      await _engine?.leaveChannel();
      await _engine?.release();
    } catch (_) {}
    _engine = null;
    try {
      await _db.rpc('end_call', params: {'p_call_id': widget.callId});
    } catch (_) {}
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => PostCallScreen(
          callId: widget.callId,
          partnerId: widget.partnerId,
          partnerName: _partner?['display_name'] as String? ?? 'your partner',
          seconds: spoke,
          note: note,
        ),
      ),
    );
  }

  Future<void> _confirmEnd() async {
    final end = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('End this call?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Keep talking')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('End call',
                  style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (end == true) _finish();
  }

  @override
  void dispose() {
    _clock?.cancel();
    _waitTimer?.cancel();
    final e = _engine;
    if (e != null) {
      e.leaveChannel().then((_) => e.release(), onError: (_) {});
    }
    super.dispose();
  }

  String get _timeText {
    final m = (_seconds ~/ 60).toString().padLeft(2, '0');
    final s = (_seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final name = _partner?['display_name'] as String? ?? 'Partner';
    final country = _partner?['country'] as String? ?? '';
    final level = _partner?['level'] as String? ?? '';
    final status = switch (_phase) {
      _Phase.connecting => 'Connecting...',
      _Phase.waiting => 'Waiting for $name to join...',
      _Phase.live => _timeText,
      _Phase.ended => 'Call ended',
    };

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _problem == null) _confirmEnd();
      },
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
            child: _problem != null
                ? Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_problem!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 16)),
                      const SizedBox(height: 20),
                      PrimaryButton(
                        label: 'Back to home',
                        onPressed: () async {
                          try {
                            await _db.rpc('end_call',
                                params: {'p_call_id': widget.callId});
                          } catch (_) {}
                          if (context.mounted) Navigator.of(context).pop();
                        },
                      ),
                    ],
                  )
                : Column(
                    children: [
                      const SizedBox(height: 16),
                      _Avatar(name: name, live: _phase == _Phase.live),
                      const SizedBox(height: 18),
                      Text(name,
                          style: const TextStyle(
                              fontSize: 26, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text(
                        [
                          if (country.isNotEmpty) country,
                          if (level.isNotEmpty)
                            '${level[0].toUpperCase()}${level.substring(1)}',
                        ].join('  ·  '),
                        style: const TextStyle(
                            fontSize: 15, color: AppColors.muted),
                      ),
                      const SizedBox(height: 12),
                      Text(status,
                          style: TextStyle(
                            fontSize: _phase == _Phase.live ? 22 : 15,
                            fontWeight: _phase == _Phase.live
                                ? FontWeight.w700
                                : FontWeight.w500,
                            color: _phase == _Phase.live
                                ? AppColors.accent
                                : AppColors.muted,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          )),
                      const Spacer(),
                      _TopicCard(
                        topic: _topics[_topicIndex % _topics.length],
                        onNext: () => setState(() => _topicIndex++),
                      ),
                      const SizedBox(height: 28),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          _RoundButton(
                            icon: _muted
                                ? Icons.mic_off_rounded
                                : Icons.mic_rounded,
                            label: _muted ? 'Unmute' : 'Mute',
                            active: _muted,
                            onTap: () async {
                              setState(() => _muted = !_muted);
                              await _engine?.muteLocalAudioStream(_muted);
                            },
                          ),
                          _RoundButton(
                            icon: Icons.call_end_rounded,
                            label: 'End',
                            danger: true,
                            onTap: _confirmEnd,
                          ),
                          _RoundButton(
                            icon: _speaker
                                ? Icons.volume_up_rounded
                                : Icons.hearing_rounded,
                            label: _speaker ? 'Speaker' : 'Earpiece',
                            active: _speaker,
                            onTap: () async {
                              setState(() => _speaker = !_speaker);
                              await _engine?.setEnableSpeakerphone(_speaker);
                            },
                          ),
                        ],
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String name;
  final bool live;
  const _Avatar({required this.name, required this.live});

  @override
  Widget build(BuildContext context) {
    final initial = name.isEmpty ? '?' : name[0].toUpperCase();
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: live ? AppColors.success : AppColors.line,
          width: 3,
        ),
      ),
      child: CircleAvatar(
        radius: 52,
        backgroundColor: AppColors.accentSoft,
        child: Text(initial,
            style: const TextStyle(
                fontSize: 42,
                fontWeight: FontWeight.w800,
                color: AppColors.accent)),
      ),
    );
  }
}

class _TopicCard extends StatelessWidget {
  final String topic;
  final VoidCallback onNext;
  const _TopicCard({required this.topic, required this.onNext});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('TALK ABOUT',
              style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w700,
                  color: AppColors.accent)),
          const SizedBox(height: 8),
          Text(topic,
              style: const TextStyle(
                  fontSize: 19, fontWeight: FontWeight.w600, height: 1.35)),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: onNext,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Next topic'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool danger;
  const _RoundButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.danger = false,
  });

  @override
  Widget build(BuildContext context) {
    final bg = danger
        ? AppColors.danger
        : active
            ? AppColors.accentSoft
            : AppColors.surface;
    final fg = danger
        ? Colors.white
        : active
            ? AppColors.accent
            : AppColors.ink;
    final size = danger ? 76.0 : 64.0;
    return Column(
      children: [
        Material(
          color: bg,
          shape: CircleBorder(
            side: danger
                ? BorderSide.none
                : const BorderSide(color: AppColors.line),
          ),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: size,
              height: size,
              child: Icon(icon, color: fg, size: danger ? 34 : 28),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(label,
            style: const TextStyle(fontSize: 13, color: AppColors.muted)),
      ],
    );
  }
}
