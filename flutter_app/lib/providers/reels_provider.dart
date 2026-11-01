import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import '../models/category_model.dart';
import '../models/reel_model.dart';
import '../services/api_client.dart';
import '../services/client_edge_extractor.dart';

class ReelsProvider extends ChangeNotifier {
  final ApiClient apiClient;

  List<ReelModel> _reels = [];
  List<CategoryModel> _categories = [];
  List<String> _suggestedCategories = [];
  String? _selectedCategoryId;
  String _searchQuery = '';
  bool _loading = false;
  Timer? _pollTimer;

  ReelsProvider({required this.apiClient});

  List<ReelModel> get reels => _reels;
  List<CategoryModel> get categories => _categories;
  List<String> get suggestedCategories => _suggestedCategories;
  String? get selectedCategoryId => _selectedCategoryId;
  String get searchQuery => _searchQuery;
  bool get isLoading => _loading;

  List<String> get allCategoryNameSuggestions {
    final set = <String>{
      ..._categories.map((c) => c.name),
      ..._suggestedCategories,
    };
    return set.toList();
  }

  Future<void> refreshAll() async {
    _loading = true;
    notifyListeners();
    try {
      await Future.wait([fetchCategories(), fetchReels()]);
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> fetchCategories() async {
    final res = await apiClient.request('GET', '/categories');
    final data = res['data'] as Map<String, dynamic>? ?? {};
    final list = data['categories'] as List<dynamic>? ?? [];
    final defaults = data['suggestedDefaults'] as List<dynamic>? ?? [];

    _categories = list
        .whereType<Map<String, dynamic>>()
        .map(CategoryModel.fromJson)
        .toList();
    _suggestedCategories = defaults.map((e) => e.toString()).toList();
    notifyListeners();
  }

  Future<void> fetchReels() async {
    final query = <String, String>{};
    if (_selectedCategoryId != null && _selectedCategoryId!.isNotEmpty) {
      query['categoryId'] = _selectedCategoryId!;
    }
    if (_searchQuery.trim().isNotEmpty) {
      query['search'] = _searchQuery.trim();
    }

    final res = await apiClient.request('GET', '/reels', query: query);
    final data = res['data'] as Map<String, dynamic>? ?? {};
    final list = data['reels'] as List<dynamic>? ?? [];

    _reels = list
        .whereType<Map<String, dynamic>>()
        .map(ReelModel.fromJson)
        .toList();

    _syncPollingState();
    notifyListeners();
  }

  void selectCategory(String? categoryId) {
    _selectedCategoryId = categoryId;
    fetchReels();
  }

  void setSearchQuery(String query) {
    _searchQuery = query;
    fetchReels();
  }

  /// Submits a shared Instagram Reel URL, MP4/MP3 file, or both.
  /// Automatically runs client-edge OpenGraph extraction on the phone first
  /// so the backend server IP never makes bulk requests to Meta.
  Future<ReelModel> createReel({
    String? sourceUrl,
    File? mediaFile,
    String? caption,
    String? authorHandle,
    String? transcript,
    String? categoryName,
    String? notes,
    String mediaFormat = 'mp3',
  }) async {
    var resolvedAuthor = authorHandle?.trim();
    var resolvedCaption = caption?.trim();
    String? resolvedThumb;

    if (sourceUrl != null &&
        sourceUrl.trim().isNotEmpty &&
        (resolvedCaption == null || resolvedCaption.isEmpty)) {
      final preview =
          await ClientEdgeExtractor.fetchPublicLinkPreview(sourceUrl.trim());
      resolvedAuthor = (resolvedAuthor != null && resolvedAuthor.isNotEmpty)
          ? resolvedAuthor
          : preview.authorHandle;
      resolvedCaption = preview.caption ?? resolvedCaption;
      resolvedThumb = preview.thumbnailUrl;
    }

    final fields = <String, String>{
      if (sourceUrl != null && sourceUrl.trim().isNotEmpty)
        'sourceUrl': sourceUrl.trim(),
      if (resolvedAuthor != null && resolvedAuthor.isNotEmpty)
        'authorHandle': resolvedAuthor,
      if (resolvedCaption != null && resolvedCaption.isNotEmpty)
        'caption': resolvedCaption,
      if (resolvedThumb != null && resolvedThumb.isNotEmpty)
        'thumbnailUrl': resolvedThumb,
      if (transcript != null && transcript.trim().isNotEmpty)
        'transcript': transcript.trim(),
      if (categoryName != null && categoryName.trim().isNotEmpty)
        'categoryName': categoryName.trim(),
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      'mediaFormat': mediaFormat,
    };

    final res = await apiClient.multipartPost(
      '/reels',
      fields: fields,
      mediaFile: mediaFile,
    );
    final reelJson =
        (res['data'] as Map<String, dynamic>)['reel'] as Map<String, dynamic>;
    final created = ReelModel.fromJson(reelJson);

    await refreshAll();
    return created;
  }

  Future<ReelModel> updateReel(
    String reelId, {
    String? title,
    String? authorHandle,
    String? summary,
    List<String>? keyPoints,
    String? transcript,
    String? notes,
    String? categoryName,
    bool resummarize = false,
  }) async {
    final res = await apiClient.request(
      'PATCH',
      '/reels/$reelId',
      body: {
        if (title != null) 'title': title,
        if (authorHandle != null) 'authorHandle': authorHandle,
        if (summary != null) 'summary': summary,
        if (keyPoints != null) 'keyPoints': keyPoints,
        if (transcript != null) 'transcript': transcript,
        if (notes != null) 'notes': notes,
        if (categoryName != null) 'categoryName': categoryName,
        if (resummarize) 'resummarize': true,
      },
    );
    final updated = ReelModel.fromJson(
      (res['data'] as Map<String, dynamic>)['reel'] as Map<String, dynamic>,
    );
    await refreshAll();
    return updated;
  }

  Future<ReelModel> attachMediaToReel(String reelId, File mediaFile) async {
    final res = await apiClient.multipartPost(
      '/reels/$reelId/media',
      mediaFile: mediaFile,
    );
    final updated = ReelModel.fromJson(
      (res['data'] as Map<String, dynamic>)['reel'] as Map<String, dynamic>,
    );
    await refreshAll();
    return updated;
  }

  Future<void> deleteReel(String reelId) async {
    await apiClient.request('DELETE', '/reels/$reelId');
    await refreshAll();
  }

  // ─── Category Management (Create / Rename / Delete) ───────────────────────
  Future<void> createCategory(String name) async {
    await apiClient.request('POST', '/categories', body: {'name': name.trim()});
    await fetchCategories();
  }

  Future<void> renameCategory(String categoryId, String newName) async {
    await apiClient.request(
      'PATCH',
      '/categories/$categoryId',
      body: {'name': newName.trim()},
    );
    await refreshAll();
  }

  Future<void> deleteCategory(String categoryId) async {
    await apiClient.request('DELETE', '/categories/$categoryId');
    if (_selectedCategoryId == categoryId) {
      _selectedCategoryId = null;
    }
    await refreshAll();
  }

  void _syncPollingState() {
    final anyProcessing = _reels.any((r) => r.isProcessing);
    if (anyProcessing && _pollTimer == null) {
      _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        fetchCategories();
        fetchReels();
      });
    } else if (!anyProcessing && _pollTimer != null) {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}
