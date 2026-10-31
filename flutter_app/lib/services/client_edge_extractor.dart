import 'package:http/http.dart' as http;

class EdgeReelPreview {
  final String? authorHandle;
  final String? caption;
  final String? thumbnailUrl;

  const EdgeReelPreview({
    this.authorHandle,
    this.caption,
    this.thumbnailUrl,
  });

  bool get hasAnyData =>
      (authorHandle != null && authorHandle!.isNotEmpty) ||
      (caption != null && caption!.isNotEmpty) ||
      (thumbnailUrl != null && thumbnailUrl!.isNotEmpty);
}

/// Resolves public OpenGraph link-preview metadata directly on the user's phone
/// for the single URL the user personally shared — identical to how chat apps
/// generate link previews.
///
/// Why this matters:
/// - Never uses Instagram logins or session cookies (zero user account risk).
/// - Prevents all users' link previews from originating on a single shared
///   backend datacenter IP.
class ClientEdgeExtractor {
  static String? extractInstagramUrl(String rawSharedText) {
    final match = RegExp(
      r'https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+',
      caseSensitive: false,
    ).firstMatch(rawSharedText);
    return match?.group(0);
  }

  static Future<EdgeReelPreview> fetchPublicLinkPreview(String url) async {
    try {
      final response = await http
          .get(
            Uri.parse(url),
            headers: const {
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
            },
          )
          .timeout(const Duration(seconds: 6));

      if (response.statusCode != 200) {
        return const EdgeReelPreview();
      }

      final html = response.body;
      final ogTitle = _extractMeta(html, 'og:title');
      final ogDesc = _extractMeta(html, 'og:description');
      final ogImage = _extractMeta(html, 'og:image');

      return EdgeReelPreview(
        authorHandle: ogTitle != null ? _parseHandle(ogTitle) : null,
        caption: ogDesc != null ? _parseCaption(ogDesc) : null,
        thumbnailUrl: ogImage,
      );
    } catch (_) {
      return const EdgeReelPreview();
    }
  }

  static String? _extractMeta(String html, String property) {
    final pattern = RegExp(
      '<meta[^>]+property=["\']${RegExp.escape(property)}["\'][^>]+content=["\']([^"\']*)["\']',
      caseSensitive: false,
    );
    final match = pattern.firstMatch(html);
    if (match != null && match.group(1) != null) {
      return _decodeEntities(match.group(1)!).trim();
    }
    return null;
  }

  static String? _parseHandle(String title) {
    final atMatch = RegExp(r'\(@([\w.]+)\)').firstMatch(title);
    if (atMatch != null) return atMatch.group(1);

    final onIg = RegExp(r'^(.+?)\s+on Instagram', caseSensitive: false)
        .firstMatch(title);
    return onIg?.group(1)?.trim();
  }

  static String? _parseCaption(String desc) {
    final quoted = RegExp(r':\s*"([\s\S]+)"\.?\s*$').firstMatch(desc);
    if (quoted != null) return quoted.group(1)?.trim();

    final colon = RegExp(r':\s*([\s\S]+)$').firstMatch(desc);
    return colon?.group(1)?.trim();
  }

  static String _decodeEntities(String input) {
    return input
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&#x27;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>');
  }
}
