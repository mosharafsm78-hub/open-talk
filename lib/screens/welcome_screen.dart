import 'package:flutter/material.dart';

import '../theme.dart';
import 'auth_screen.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(flex: 2),
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.accent,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.record_voice_over_rounded,
                    color: Colors.white, size: 32),
              ),
              const SizedBox(height: 28),
              const Text(
                'Open Talk',
                style: TextStyle(
                    fontSize: 40, fontWeight: FontWeight.w800, height: 1.1),
              ),
              const SizedBox(height: 12),
              const Text(
                'Learn English by talking with real people.',
                style: TextStyle(
                    fontSize: 19, color: AppColors.muted, height: 1.4),
              ),
              const SizedBox(height: 36),
              const _Point(
                  icon: Icons.bolt_rounded,
                  text: 'Get matched with a partner in seconds'),
              const _Point(
                  icon: Icons.forum_rounded,
                  text: 'Topic cards keep the conversation going'),
              const _Point(
                  icon: Icons.trending_up_rounded,
                  text: 'Track your speaking time every day'),
              const Spacer(flex: 3),
              PrimaryButton(
                label: 'Join Now',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const AuthScreen(startAsSignUp: true)),
                ),
              ),
              const SizedBox(height: 12),
              PrimaryButton(
                label: 'Log In',
                outlined: true,
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const AuthScreen(startAsSignUp: false)),
                ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _Point extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Point({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.accentSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 20, color: AppColors.accent),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(text,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }
}
