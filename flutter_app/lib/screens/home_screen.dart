import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/category_model.dart';
import '../providers/auth_provider.dart';
import '../providers/reels_provider.dart';
import '../services/share_intent_service.dart';
import 'add_reel_sheet.dart';
import 'reel_detail_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ShareIntentService _shareService = ShareIntentService();
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ReelsProvider>().refreshAll();
      _shareService.startListening((payload) {
        if (!mounted) return;
        _openAddSheet(initialShare: payload);
      });
    });
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
      await context
          .read<ReelsProvider>()
          .renameCategory(category.id, nextName);
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
                            onPressed: () =>
                                provider.deleteCategory(cat.id),
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

  @override
  Widget build(BuildContext context) {
    final reelsProvider = context.watch<ReelsProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reel-Saver Library'),
        actions: [
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
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
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
                        onSelected: (_) =>
                            reelsProvider.selectCategory(cat.id),
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
                      children: const [
                        SizedBox(height: 100),
                        Center(
                          child: Padding(
                            padding: EdgeInsets.symmetric(horizontal: 32),
                            child: Text(
                              'No saved Reels yet. Tap "Share" inside Instagram and choose Reel Saver, or tap "+ Share Link / MP4" below!',
                              textAlign: TextAlign.center,
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
                                      Chip(
                                        label: Text(
                                          reel.category?.name ?? 'Uncategorized',
                                        ),
                                        visualDensity: VisualDensity.compact,
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
