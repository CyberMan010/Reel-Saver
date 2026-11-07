import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/category_model.dart';
import '../models/reel_model.dart';
import '../providers/auth_provider.dart';
import '../providers/reels_provider.dart';
import '../services/share_intent_service.dart';
import 'add_reel_sheet.dart';
import 'onboarding_guide_sheet.dart';
import 'reel_detail_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const String _bannerDismissedKey = 'rs_flutter_banner_dismissed_v1';

  final ShareIntentService _shareService = ShareIntentService();
  final TextEditingController _searchCtrl = TextEditingController();
  bool _showQuickGuideBanner = true;

  @override
  void initState() {
    super.initState();
    _loadBannerPref();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ReelsProvider>().refreshAll();
      OnboardingGuideSheet.maybeShowForNewUser(context);
      _shareService.startListening((payload) {
        if (!mounted) return;
        _openAddSheet(initialShare: payload);
      });
    });
  }

  Future<void> _loadBannerPref() async {
    final prefs = await SharedPreferences.getInstance();
    final dismissed = prefs.getBool(_bannerDismissedKey) ?? false;
    if (mounted) {
      setState(() => _showQuickGuideBanner = !dismissed);
    }
  }

  Future<void> _dismissQuickGuideBanner() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_bannerDismissedKey, true);
    if (mounted) {
      setState(() => _showQuickGuideBanner = false);
    }
  }

  @override
  void dispose() {
    _shareService.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _openAddSheet({IncomingSharePayload? initialShare}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => AddReelSheet(initialShare: initialShare),
    );
  }

  Future<void> _showRenameCategoryDialog(CategoryModel category) async {
    final ctrl = TextEditingController(text: category.name);
    final nextName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename Category'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Category name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Rename'),
          ),
        ],
      ),
    );
    if (nextName != null &&
        nextName.isNotEmpty &&
        nextName != category.name &&
        mounted) {
      await context.read<ReelsProvider>().renameCategory(category.id, nextName);
    }
  }

  void _openManageCategoriesSheet() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) {
        final provider = ctx.watch<ReelsProvider>();
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Manage & Rename Categories',
                    style: Theme.of(ctx)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  TextButton.icon(
                    onPressed: () async {
                      final ctrl = TextEditingController();
                      final created = await showDialog<String>(
                        context: ctx,
                        builder: (dCtx) => AlertDialog(
                          title: const Text('New Category'),
                          content: TextField(
                            controller: ctrl,
                            autofocus: true,
                            decoration: const InputDecoration(
                              hintText: 'e.g. Recipes, Gym, Coding...',
                            ),
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(dCtx),
                              child: const Text('Cancel'),
                            ),
                            FilledButton(
                              onPressed: () =>
                                  Navigator.pop(dCtx, ctrl.text.trim()),
                              child: const Text('Create'),
                            ),
                          ],
                        ),
                      );
                      if (created != null && created.isNotEmpty && ctx.mounted) {
                        await ctx.read<ReelsProvider>().createCategory(created);
                      }
                    },
                    icon: const Icon(Icons.add),
                    label: const Text('New'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: provider.categories.length,
                  itemBuilder: (_, idx) {
                    final cat = provider.categories[idx];
                    return ListTile(
                      title: Text(cat.name),
                      subtitle: Text('${cat.reelCount} reel(s)'),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: 'Rename category',
                            icon: const Icon(Icons.edit_outlined),
                            onPressed: () => _showRenameCategoryDialog(cat),
                          ),
                          IconButton(
                            tooltip: 'Delete category',
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => provider.deleteCategory(cat.id),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildFormattedPointsPreview(ReelModel reel) {
    if (reel.keyPoints.isEmpty) return const SizedBox.shrink();
    final preview = reel.keyPoints.take(2).toList();

    if (reel.summaryStyle == 'paragraph') {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(
          spacing: 6,
          runSpacing: 6,
          children: preview
              .map(
                (p) => Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.indigo.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(
                    '✦ $p',
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ),
              )
              .toList(),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: List.generate(preview.length, (idx) {
          final prefix = reel.summaryStyle == 'numbered'
              ? '${idx + 1}. '
              : reel.summaryStyle == 'checklist'
                  ? '☐ '
                  : '• ';
          return Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Text(
              '$prefix${preview[idx]}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12.5, color: Colors.white70),
            ),
          );
        }),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reelsProvider = context.watch<ReelsProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reel-Saver Library'),
        actions: [
          IconButton(
            tooltip: 'How It Works (User Guide)',
            icon: const Icon(Icons.help_outline_rounded),
            onPressed: () => OnboardingGuideSheet.show(context),
          ),
          IconButton(
            tooltip: 'Manage & Rename Categories',
            icon: const Icon(Icons.folder_copy_outlined),
            onPressed: _openManageCategoriesSheet,
          ),
          IconButton(
            tooltip: 'Log out',
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AuthProvider>().logout(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openAddSheet(),
        icon: const Icon(Icons.add),
        label: const Text('Share Link / MP4'),
      ),
      body: Column(
        children: [
          if (_showQuickGuideBanner)
            Container(
              margin: const EdgeInsets.fromLTRB(16, 10, 16, 4),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.indigo.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.indigoAccent.withValues(alpha: 0.35),
                ),
              ),
              child: Row(
                children: [
                  const Icon(Icons.tips_and_updates_outlined, size: 20),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Share a Reel → Confirm MP3/MP4 → Get a brief summary in Bullets, Steps, Checklist, or Paragraph!',
                      style: TextStyle(fontSize: 12.5),
                    ),
                  ),
                  TextButton(
                    onPressed: () => OnboardingGuideSheet.show(context),
                    child: const Text('Guide'),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: _dismissQuickGuideBanner,
                    icon: const Icon(Icons.close, size: 17),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              onChanged: reelsProvider.setSearchQuery,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search transcripts, summaries, categories...',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          SizedBox(
            height: 46,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: const Text('All'),
                    selected: reelsProvider.selectedCategoryId == null,
                    onSelected: (_) => reelsProvider.selectCategory(null),
                  ),
                ),
                ...reelsProvider.categories.map(
                  (cat) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: GestureDetector(
                      onLongPress: () => _showRenameCategoryDialog(cat),
                      child: ChoiceChip(
                        label: Text('${cat.name} (${cat.reelCount})'),
                        selected: reelsProvider.selectedCategoryId == cat.id,
                        onSelected: (_) => reelsProvider.selectCategory(cat.id),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 12),
          Expanded(
            child: RefreshIndicator(
              onRefresh: reelsProvider.refreshAll,
              child: reelsProvider.reels.isEmpty
                  ? ListView(
                      children: [
                        const SizedBox(height: 80),
                        Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 32),
                            child: Column(
                              children: [
                                const Text(
                                  'No saved Reels yet. Tap "Share" inside Instagram and choose Reel-Saver, or tap "+ Share Link / MP4" below!',
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 14),
                                OutlinedButton.icon(
                                  onPressed: () =>
                                      OnboardingGuideSheet.show(context),
                                  icon:
                                      const Icon(Icons.help_outline_rounded),
                                  label: const Text('See 4-Step Guide'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 6, 16, 90),
                      itemCount: reelsProvider.reels.length,
                      itemBuilder: (ctx, index) {
                        final reel = reelsProvider.reels[index];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 12),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => ReelDetailScreen(reel: reel),
                              ),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(15),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      Wrap(
                                        spacing: 6,
                                        children: [
                                          Chip(
                                            label: Text(
                                              reel.category?.name ??
                                                  'Uncategorized',
                                            ),
                                            visualDensity:
                                                VisualDensity.compact,
                                          ),
                                          if (reel.status == 'DONE')
                                            Chip(
                                              label: Text(
                                                reel.summaryStyleLabel,
                                                style: const TextStyle(
                                                  fontSize: 11.5,
                                                ),
                                              ),
                                              visualDensity:
                                                  VisualDensity.compact,
                                            ),
                                        ],
                                      ),
                                      Text(
                                        reel.status,
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                          color: reel.status == 'DONE'
                                              ? Colors.greenAccent
                                              : reel.status == 'FAILED'
                                                  ? Colors.redAccent
                                                  : Colors.amberAccent,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    reel.title ??
                                        (reel.authorHandle != null
                                            ? 'Reel by @${reel.authorHandle}'
                                            : 'Processing Reel...'),
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium
                                        ?.copyWith(fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    reel.summary ??
                                        'Converting audio, transcribing & summarizing...',
                                    maxLines: 3,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  _buildFormattedPointsPreview(reel),
                                  if (reel.audioUrl != null) ...[
                                    const SizedBox(height: 8),
                                    const Row(
                                      children: [
                                        Icon(Icons.audiotrack, size: 15),
                                        SizedBox(width: 4),
                                        Text(
                                          'MP3 extracted & ready',
                                          style: TextStyle(fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
