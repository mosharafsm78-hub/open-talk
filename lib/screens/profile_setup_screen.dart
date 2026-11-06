import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';
import '../topics.dart';

/// Used for first-time setup and for editing from Settings.
class ProfileSetupScreen extends StatefulWidget {
  final VoidCallback? onDone;
  final Map<String, dynamic>? existing;
  const ProfileSetupScreen({super.key, this.onDone, this.existing});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  late final _name =
      TextEditingController(text: widget.existing?['display_name'] as String?);
  late String? _country = (widget.existing?['country'] as String?)?.isEmpty ?? true
      ? null
      : widget.existing!['country'] as String;
  late String _level = (widget.existing?['level'] as String?) ?? 'beginner';
  late String? _gender = widget.existing?['gender'] as String?;
  bool _saving = false;
  String? _error;

  // Editing from Settings pops back; first-time (or completing an older profile) calls onDone.
  bool get _editing => widget.onDone == null;

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      setState(() => _error = 'Please enter your name (at least 2 letters).');
      return;
    }
    if (_country == null) {
      setState(() => _error = 'Please choose your country.');
      return;
    }
    if (_gender == null) {
      setState(() => _error = 'Please choose your gender.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final db = Supabase.instance.client;
      final uid = db.auth.currentUser!.id;
      if (_editing) {
        await db.from('profiles').update({
          'display_name': name,
          'country': _country,
          'level': _level,
          'gender': _gender,
        }).eq('id', uid);
      } else {
        await db.from('profiles').upsert({
          'id': uid,
          'display_name': name,
          'country': _country,
          'level': _level,
          'gender': _gender,
        });
      }
      if (!mounted) return;
      if (_editing) {
        Navigator.of(context).pop(true);
      } else {
        widget.onDone?.call();
      }
    } catch (_) {
      setState(() => _error = 'Could not save. Please try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const levels = {
      'beginner': ('Beginner', 'I know basic words and simple sentences'),
      'intermediate': ('Intermediate', 'I can talk about everyday topics'),
      'advanced': ('Advanced', 'I am comfortable and want to sound natural'),
    };
    return Scaffold(
      appBar: _editing ? AppBar(title: const Text('Edit profile')) : null,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!_editing) ...[
                const Text('Tell us about you',
                    style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                const Text(
                    'Partners will see your name, country and level.',
                    style: TextStyle(fontSize: 16, color: AppColors.muted)),
                const SizedBox(height: 28),
              ],
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                maxLength: 30,
                decoration: const InputDecoration(
                    labelText: 'Your name', counterText: ''),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: _country,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Country'),
                items: [
                  for (final c in countries)
                    DropdownMenuItem(value: c, child: Text(c)),
                ],
                onChanged: (v) => setState(() => _country = v),
              ),
              const SizedBox(height: 24),
              const Text('You are',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _GenderTile(
                      label: 'Male',
                      icon: Icons.male_rounded,
                      selected: _gender == 'male',
                      onTap: () => setState(() => _gender = 'male'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _GenderTile(
                      label: 'Female',
                      icon: Icons.female_rounded,
                      selected: _gender == 'female',
                      onTap: () => setState(() => _gender = 'female'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              const Text('Your English level',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              for (final e in levels.entries)
                _LevelTile(
                  title: e.value.$1,
                  subtitle: e.value.$2,
                  selected: _level == e.key,
                  onTap: () => setState(() => _level = e.key),
                ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!,
                    style: const TextStyle(color: AppColors.danger)),
              ],
              const SizedBox(height: 24),
              PrimaryButton(
                label: _editing ? 'Save' : 'Continue',
                loading: _saving,
                onPressed: _save,
              ),
              if (!_editing)
                Center(
                  child: TextButton(
                    onPressed: () => Supabase.instance.client.auth.signOut(),
                    child: const Text('Log out'),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GenderTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;
  const _GenderTile({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: selected ? AppColors.accentSoft : AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? AppColors.accent : AppColors.line,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Column(
          children: [
            Icon(icon,
                size: 30, color: selected ? AppColors.accent : AppColors.muted),
            const SizedBox(height: 4),
            Text(label,
                style:
                    const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

class _LevelTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;
  const _LevelTile({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: selected ? AppColors.accentSoft : AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected ? AppColors.accent : AppColors.line,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: const TextStyle(
                            fontSize: 14, color: AppColors.muted)),
                  ],
                ),
              ),
              if (selected)
                const Icon(Icons.check_circle_rounded, color: AppColors.accent),
            ],
          ),
        ),
      ),
    );
  }
}
