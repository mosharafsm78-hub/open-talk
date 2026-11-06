import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';

class AuthScreen extends StatefulWidget {
  final bool startAsSignUp;
  const AuthScreen({super.key, required this.startAsSignUp});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  late bool _signUp = widget.startAsSignUp;
  bool _loading = false;
  bool _hidden = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    final password = _password.text;
    if (!email.contains('@') || !email.contains('.')) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final auth = Supabase.instance.client.auth;
      if (_signUp) {
        final res = await auth.signUp(email: email, password: password);
        if (res.session == null && mounted) {
          setState(() => _error = null);
          showMessage(context,
              'Check your email to confirm your account, then log in.');
          setState(() => _signUp = false);
          return;
        }
      } else {
        await auth.signInWithPassword(email: email, password: password);
      }
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Something went wrong. Check your connection.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _forgot() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = 'Enter your email first, then tap Forgot password.');
      return;
    }
    try {
      await Supabase.instance.client.auth.resetPasswordForEmail(email);
      if (mounted) showMessage(context, 'Password reset email sent.');
    } catch (_) {
      if (mounted) showMessage(context, 'Could not send the reset email.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _signUp ? 'Create your account' : 'Welcome back',
                style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                _signUp
                    ? 'It takes less than a minute.'
                    : 'Log in to keep practicing.',
                style: const TextStyle(fontSize: 16, color: AppColors.muted),
              ),
              const SizedBox(height: 28),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _password,
                obscureText: _hidden,
                autofillHints: const [AutofillHints.password],
                decoration: InputDecoration(
                  labelText: 'Password',
                  suffixIcon: IconButton(
                    icon: Icon(_hidden
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined),
                    onPressed: () => setState(() => _hidden = !_hidden),
                  ),
                ),
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style: const TextStyle(color: AppColors.danger, fontSize: 14)),
              ],
              if (!_signUp)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _forgot,
                    child: const Text('Forgot password?'),
                  ),
                ),
              const SizedBox(height: 16),
              PrimaryButton(
                label: _signUp ? 'Join Now' : 'Log In',
                loading: _loading,
                onPressed: _submit,
              ),
              const SizedBox(height: 16),
              Center(
                child: TextButton(
                  onPressed: () => setState(() {
                    _signUp = !_signUp;
                    _error = null;
                  }),
                  child: Text(_signUp
                      ? 'Already have an account? Log in'
                      : 'New here? Join now'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
