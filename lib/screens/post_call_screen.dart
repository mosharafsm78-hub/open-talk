import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';

class PostCallScreen extends StatefulWidget {
  final String callId;
  final String partnerId;
  final String partnerName;
  final int seconds;
  final String? note;
  const PostCallScreen({
    super.key,
    required this.callId,
    required this.partnerId,
    required this.partnerName,
    required this.seconds,
    this.note,
  });

  @override
  State<PostCallScreen> createState() => _PostCallScreenState();
}

class _PostCallScreenState extends State<PostCallScreen> {
  SupabaseClient get _db => Supabase.instance.client;
  int _rating = 0;
  bool _blocked = false;
  bool _reported = false;

  Future<void> _rate(int r) async {
    setState(() => _rating = r);
    try {
      await _db.rpc('rate_call',
          params: {'p_call_id': widget.callId, 'p_rating': r});
    } catch (_) {}
  }

  Future<void> _block() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Block ${widget.partnerName}?'),
        content: const Text('You will not be matched with this person again.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Block',
                  style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _db.rpc('block_user', params: {'p_target': widget.partnerId});
      if (mounted) setState(() => _blocked = true);
    } catch (_) {
      if (mounted) showMessage(context, 'Could not block. Try again.');
    }
  }

  Future<void> _report() async {
    const reasons = [
      'Inappropriate or offensive language',
      'Harassment or bullying',
      'Spam or advertising',
      'Under 18 / unsafe behavior',
      'Other',
    ];
    final reason = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Report this user',
                    style:
                        TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              ),
            ),
            for (final r in reasons)
              ListTile(title: Text(r), onTap: () => Navigator.pop(ctx, r)),
          ],
        ),
      ),
    );
    if (reason == null) return;
    try {
      await _db.rpc('report_user', params: {
        'p_target': widget.partnerId,
        'p_call_id': widget.callId,
        'p_reason': reason,
      });
      await _db.rpc('block_user', params: {'p_target': widget.partnerId});
      if (mounted) {
        setState(() {
          _reported = true;
          _blocked = true;
        });
        showMessage(context, 'Thanks. We will review this report.');
      }
    } catch (_) {
      if (mounted) showMessage(context, 'Could not send the report.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.seconds ~/ 60;
    final s = widget.seconds % 60;
    final spoke = widget.seconds < 5
        ? null
        : (m > 0 ? '$m min ${s.toString().padLeft(2, '0')} sec' : '$s sec');

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              Container(
                width: 76,
                height: 76,
                decoration: const BoxDecoration(
                    color: AppColors.accentSoft, shape: BoxShape.circle),
                child: const Icon(Icons.check_rounded,
                    size: 40, color: AppColors.accent),
              ),
              const SizedBox(height: 20),
              Text(widget.note ?? 'Nice conversation!',
                  textAlign: TextAlign.center,
                  style:
                      const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
              if (spoke != null) ...[
                const SizedBox(height: 8),
                Text('You spoke with ${widget.partnerName} for $spoke.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 15, color: AppColors.muted, height: 1.4)),
              ],
              const SizedBox(height: 32),
              if (spoke != null) ...[
                const Text('How was the conversation?',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 1; i <= 5; i++)
                      IconButton(
                        iconSize: 40,
                        onPressed: () => _rate(i),
                        icon: Icon(
                          i <= _rating
                              ? Icons.star_rounded
                              : Icons.star_outline_rounded,
                          color: i <= _rating
                              ? const Color(0xFFF5B301)
                              : AppColors.line,
                        ),
                      ),
                  ],
                ),
              ],
              const Spacer(),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _reported ? null : _report,
                      icon: const Icon(Icons.flag_outlined),
                      label: Text(_reported ? 'Reported' : 'Report'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        foregroundColor: AppColors.danger,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _blocked ? null : _block,
                      icon: const Icon(Icons.block_rounded),
                      label: Text(_blocked ? 'Blocked' : 'Block'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        foregroundColor: AppColors.ink,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              PrimaryButton(
                label: 'Done',
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
