import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../theme.dart';
import 'profile_setup_screen.dart';

class SettingsScreen extends StatelessWidget {
  final Map<String, dynamic> profile;
  const SettingsScreen({super.key, required this.profile});

  SupabaseClient get _db => Supabase.instance.client;

  Future<void> _logout(BuildContext context) async {
    Navigator.of(context).popUntil((r) => r.isFirst);
    await _db.auth.signOut();
  }

  Future<void> _delete(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
            'This permanently removes your profile and history. This cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Delete',
                  style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await _db.rpc('delete_my_account');
      if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
      await _db.auth.signOut();
    } catch (_) {
      if (context.mounted) {
        showMessage(context, 'Could not delete the account. Try again.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final email = _db.auth.currentUser?.email ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.line),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(profile['display_name'] as String,
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(email,
                      style: const TextStyle(
                          fontSize: 14, color: AppColors.muted)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            _Item(
              icon: Icons.person_outline_rounded,
              label: 'Edit profile',
              onTap: () async {
                final saved = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                      builder: (_) => ProfileSetupScreen(existing: profile)),
                );
                if (saved == true && context.mounted) {
                  Navigator.of(context).pop();
                }
              },
            ),
            _Item(
              icon: Icons.privacy_tip_outlined,
              label: 'Privacy policy',
              onTap: () => launchUrl(Uri.parse(AppConfig.privacyUrl),
                  mode: LaunchMode.externalApplication),
            ),
            _Item(
              icon: Icons.description_outlined,
              label: 'Terms of use',
              onTap: () => launchUrl(Uri.parse(AppConfig.termsUrl),
                  mode: LaunchMode.externalApplication),
            ),
            _Item(
              icon: Icons.logout_rounded,
              label: 'Log out',
              onTap: () => _logout(context),
            ),
            const SizedBox(height: 24),
            _Item(
              icon: Icons.delete_outline_rounded,
              label: 'Delete account',
              danger: true,
              onTap: () => _delete(context),
            ),
            const SizedBox(height: 32),
            const Center(
              child: Text('Open Talk  ·  Version 1.0.0',
                  style: TextStyle(fontSize: 13, color: AppColors.muted)),
            ),
          ],
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;
  const _Item({
    required this.icon,
    required this.label,
    required this.onTap,
    this.danger = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = danger ? AppColors.danger : AppColors.ink;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: onTap,
        tileColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: AppColors.line),
        ),
        leading: Icon(icon, color: color),
        title: Text(label,
            style: TextStyle(color: color, fontWeight: FontWeight.w600)),
        trailing: danger
            ? null
            : const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
      ),
    );
  }
}
