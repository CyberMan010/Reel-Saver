class ReelCategoryRef {
  final String id;
  final String name;

  const ReelCategoryRef({required this.id, required this.name});

  factory ReelCategoryRef.fromJson(Map<String, dynamic> json) {
    return ReelCategoryRef(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Uncategorized',
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
  final String summaryStyle;
  final String? notes;
  final String? audioUrl;
  final String? videoUrl;
  final double? audioDurationSec;
  final String? transcriptionSource;
  final String status;
  final String? errorMessage;
  final String? categoryId;
  final ReelCategoryRef? category;
  final String createdAt;

  const ReelModel({
    required this.id,
    required this.sourceUrl,
    this.title,
    this.authorHandle,
    this.caption,
    this.thumbnailUrl,
    this.transcript,
    this.summary,
    required this.keyPoints,
    this.summaryStyle = 'bullets',
    this.notes,
    this.audioUrl,
    this.videoUrl,
    this.audioDurationSec,
    this.transcriptionSource,
    required this.status,
    this.errorMessage,
    this.categoryId,
    this.category,
    required this.createdAt,
  });

  bool get isProcessing => const {
        'PENDING',
        'EXTRACTING',
        'TRANSCRIBING',
        'SUMMARIZING',
      }.contains(status);

  String get summaryStyleLabel {
    switch (summaryStyle) {
      case 'numbered':
        return '1. Steps';
      case 'checklist':
        return '☑ Checklist';
      case 'paragraph':
        return '¶ Paragraph';
      case 'bullets':
      default:
        return '• Bullets';
    }
  }

  static String normalizeStyle(String? raw) {
    if (raw == 'bullets' ||
        raw == 'numbered' ||
        raw == 'checklist' ||
        raw == 'paragraph') {
      return raw!;
    }
    return 'bullets';
  }

  factory ReelModel.fromJson(Map<String, dynamic> json) {
    final rawPoints = json['keyPoints'];
    final points = rawPoints is List
        ? rawPoints.map((e) => e.toString()).toList()
        : <String>[];

    return ReelModel(
      id: json['id']?.toString() ?? '',
      sourceUrl: json['sourceUrl']?.toString() ?? '',
      title: json['title']?.toString(),
      authorHandle: json['authorHandle']?.toString(),
      caption: json['caption']?.toString(),
      thumbnailUrl: json['thumbnailUrl']?.toString(),
      transcript: json['transcript']?.toString(),
      summary: json['summary']?.toString(),
      keyPoints: points,
      summaryStyle: normalizeStyle(json['summaryStyle']?.toString()),
      notes: json['notes']?.toString(),
      audioUrl: json['audioUrl']?.toString(),
      videoUrl: json['videoUrl']?.toString(),
      audioDurationSec: (json['audioDurationSec'] is num)
          ? (json['audioDurationSec'] as num).toDouble()
          : null,
      transcriptionSource: json['transcriptionSource']?.toString(),
      status: json['status']?.toString() ?? 'PENDING',
      errorMessage: json['errorMessage']?.toString(),
      categoryId: json['categoryId']?.toString(),
      category: json['category'] is Map<String, dynamic>
          ? ReelCategoryRef.fromJson(json['category'] as Map<String, dynamic>)
          : null,
      createdAt: json['createdAt']?.toString() ?? '',
    );
  }
}
