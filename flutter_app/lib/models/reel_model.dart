class ReelCategoryRef {
  final String id;
  final String name;

  const ReelCategoryRef({required this.id, required this.name});

  factory ReelCategoryRef.fromJson(Map<String, dynamic> json) {
    return ReelCategoryRef(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
    );
  }
}

class ReelModel {
  final String id;
  final String sourceUrl;
  final String? title;
  final String? authorHandle;
  final String? caption;
  final String? thumbnailUrl;
  final String? transcript;
  final String? summary;
  final List<String> keyPoints;
  final String? notes;
  final String? audioUrl;
  final double? audioDurationSec;
  final String? transcriptionSource;
  final String status;
  final String? errorMessage;
  final String? categoryId;
  final ReelCategoryRef? category;
  final String createdAt;
  final String? processedAt;

  const ReelModel({
    required this.id,
    required this.sourceUrl,
    this.title,
    this.authorHandle,
    this.caption,
    this.thumbnailUrl,
    this.transcript,
    this.summary,
    this.keyPoints = const [],
    this.notes,
    this.audioUrl,
    this.audioDurationSec,
    this.transcriptionSource,
    required this.status,
    this.errorMessage,
    this.categoryId,
    this.category,
    required this.createdAt,
    this.processedAt,
  });

  bool get isProcessing =>
      status == 'PENDING' ||
      status == 'EXTRACTING' ||
      status == 'TRANSCRIBING' ||
      status == 'SUMMARIZING';

  factory ReelModel.fromJson(Map<String, dynamic> json) {
    final rawPoints = json['keyPoints'];
    final points = rawPoints is List
        ? rawPoints.map((e) => e.toString()).toList()
        : <String>[];

    return ReelModel(
      id: json['id']?.toString() ?? '',
      sourceUrl: json['sourceUrl']?.toString() ?? '',
      title: json['title'] as String?,
      authorHandle: json['authorHandle'] as String?,
      caption: json['caption'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      transcript: json['transcript'] as String?,
      summary: json['summary'] as String?,
      keyPoints: points,
      notes: json['notes'] as String?,
      audioUrl: json['audioUrl'] as String?,
      audioDurationSec: (json['audioDurationSec'] as num?)?.toDouble(),
      transcriptionSource: json['transcriptionSource'] as String?,
      status: json['status']?.toString() ?? 'PENDING',
      errorMessage: json['errorMessage'] as String?,
      categoryId: json['categoryId'] as String?,
      category: json['category'] is Map<String, dynamic>
          ? ReelCategoryRef.fromJson(json['category'] as Map<String, dynamic>)
          : null,
      createdAt: json['createdAt']?.toString() ?? '',
      processedAt: json['processedAt'] as String?,
    );
  }
}
