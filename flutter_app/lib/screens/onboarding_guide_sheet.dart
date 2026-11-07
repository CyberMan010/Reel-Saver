import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _OnboardingStepData {
  final IconData icon;
  final String badge;
  final String title;
  final String description;
  final List<String> tips;

  const _OnboardingStepData({
    required this.icon,
    required this.badge,
    required this.title,
    required this.description,
    required this.tips,
  });
}

class OnboardingGuideSheet extends StatefulWidget {
  const OnboardingGuideSheet({super.key});

  static const String _seenPrefKey = 'rs_flutter_onboarding_seen_v1';

  /// Shows the interactive 4-step guide automatically once for brand-new users.
  static Future<void> maybeShowForNewUser(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final alreadySeen = prefs.getBool(_seenPrefKey) ?? false;
    if (alreadySeen || !context.mounted) return;
    await show(context);
  }

  /// Opens the interactive guide sheet anytime (e.g. from the '?' Help icon).
  static Future<void> show(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const OnboardingGuideSheet(),
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_seenPrefKey, true);
  }

  @override
  State<OnboardingGuideSheet> createState() => _OnboardingGuideSheetState();
}

class _OnboardingGuideSheetState extends State<OnboardingGuideSheet> {
  final PageController _pageController = PageController();
  int _currentIndex = 0;

  static const List<_OnboardingStepData> _steps = [
    _OnboardingStepData(
      icon: Icons.share_rounded,
      badge: 'STEP 1 OF 4 · SAVE ANY REEL',
      title: 'Share from Instagram or Upload MP4 / MP3',
      description:
          'Stop losing recipes, workouts, and ideas in endless bookmarks. Send any Reel straight to Reel-Saver:',
      tips: [
        'Tap Share in Instagram → choose Reel-Saver to prefill the link automatically.',
        'Or tap "+ Save Reel" to paste a link or upload an MP4 video / MP3 audio clip.',
        'Use the mic icon anytime for free on-device voice dictation.',
      ],
    ),
    _OnboardingStepData(
      icon: Icons.graphic_eq_rounded,
      badge: 'STEP 2 OF 4 · ASK-FIRST AUDIO & WHISPER',
      title: 'You Choose MP3 Audio or Full MP4 Video',
      description:
          'Reel-Saver always asks for your confirmation before converting media so you save space and data:',
      tips: [
        'MP3 Audio (Recommended): ~30× smaller than video (~0.5 MB/min) with offline playback.',
        'MP4 + MP3: Keeps the full video plus extracted 16kHz speech audio.',
        'Card-Free Whisper AI transcribes English, Arabic, and 90+ languages accurately.',
      ],
    ),
    _OnboardingStepData(
      icon: Icons.format_list_bulleted_rounded,
      badge: 'STEP 3 OF 4 · BRIEF SUMMARY IN YOUR FORMAT',
      title: 'Brief, Complete Summaries — Formatted Your Way',
      description:
          'No long walls of text! Pick how your summary and takeaways are structured — and switch anytime:',
      tips: [
        '• Bullet Points — Crisp, scannable takeaways & facts.',
        '1. Numbered Steps — Ordered steps for recipes, workouts & tutorials.',
        '☑ Action Checklist — Tap items to check off ingredients or tasks.',
        '¶ Brief Paragraph — Tight 2–3 sentence overview + highlight chips.',
      ],
    ),
    _OnboardingStepData(
      icon: Icons.folder_special_rounded,
      badge: 'STEP 4 OF 4 · SMART FOLDERS & FULL EDITING',
      title: 'Auto-Categorized & 100% Adjustable',
      description:
          'Every saved Reel is automatically organized and remains completely under your control:',
      tips: [
        'AI assigns smart folders (Recipes, Fitness, Tech, Nutrition, or your custom folders).',
        'Open the left drawer anytime to create, rename, or reorganize categories.',
        'Tap any Reel to play MP3 audio, switch summary style, or edit every field.',
      ],
    ),
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _nextOrClose() {
    if (_currentIndex < _steps.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
      );
    } else {
      Navigator.of(context).pop();
    }
  }

  void _prev() {
    if (_currentIndex > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isLast = _currentIndex == _steps.length - 1;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 22),
      child: SizedBox(
        height: 455,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: theme.colorScheme.primaryContainer,
                  child: Icon(
                    Icons.auto_awesome_rounded,
                    size: 18,
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Welcome to Reel-Saver',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        'How the app works in 4 quick steps',
                        style: TextStyle(fontSize: 12, color: Colors.white60),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                  tooltip: 'Close guide',
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: List.generate(_steps.length, (idx) {
                final active = idx <= _currentIndex;
                return Expanded(
                  child: Container(
                    height: 5,
                    margin: EdgeInsets.only(right: idx == _steps.length - 1 ? 0 : 6),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(99),
                      color: active
                          ? theme.colorScheme.primary
                          : Colors.white.withValues(alpha: 0.14),
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _steps.length,
                onPageChanged: (idx) => setState(() => _currentIndex = idx),
                itemBuilder: (ctx, idx) {
                  final step = _steps[idx];
                  return Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.25),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.1),
                      ),
                    ),
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                step.icon,
                                size: 20,
                                color: theme.colorScheme.primary,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                step.badge,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: theme.colorScheme.primary,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            step.title,
                            style: const TextStyle(
                              fontSize: 17.5,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            step.description,
                            style: const TextStyle(
                              fontSize: 13.5,
                              color: Colors.white70,
                            ),
                          ),
                          const SizedBox(height: 12),
                          ...step.tips.map(
                            (tip) => Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(
                                    Icons.check_circle_outline_rounded,
                                    size: 17,
                                    color: theme.colorScheme.secondary,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      tip,
                                      style: const TextStyle(fontSize: 13),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                TextButton(
                  onPressed: _currentIndex == 0 ? null : _prev,
                  child: const Text('← Back'),
                ),
                Row(
                  children: [
                    if (!isLast)
                      TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Skip'),
                      ),
                    const SizedBox(width: 6),
                    FilledButton(
                      onPressed: _nextOrClose,
                      child: Text(isLast ? 'Got It · Start Saving!' : 'Next →'),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
