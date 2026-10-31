class CategoryModel {
  final String id;
  final String name;
  final int reelCount;

  const CategoryModel({
    required this.id,
    required this.name,
    this.reelCount = 0,
  });

  factory CategoryModel.fromJson(Map<String, dynamic> json) {
    return CategoryModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      reelCount: (json['reelCount'] as num?)?.toInt() ?? 0,
    );
  }
}
