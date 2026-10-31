import 'package:shared_preferences/shared_preferences.dart';

class ApiConfig {
  static const String _prefKey = 'reel_saver_api_base_url';

  /// Default base URL (10.0.2.2 reaches host machine localhost from Android emulator;
  /// users can override this on the Login screen to point to their cloud/LAN backend).
  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );

  static String _currentBaseUrl = defaultBaseUrl;

  static String get baseUrl => _currentBaseUrl;

  static Future<void> loadSavedBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_prefKey);
    if (saved != null && saved.trim().isNotEmpty) {
      _currentBaseUrl = _normalize(saved);
    }
  }

  static Future<void> setBaseUrl(String url) async {
    _currentBaseUrl = _normalize(url);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKey, _currentBaseUrl);
  }

  static String resolveMediaUrl(String pathOrUrl) {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }
    return '$_currentBaseUrl${pathOrUrl.startsWith('/') ? '' : '/'}$pathOrUrl';
  }

  static String _normalize(String url) {
    var trimmed = url.trim();
    while (trimmed.endsWith('/')) {
      trimmed = trimmed.substring(0, trimmed.length - 1);
    }
    if (trimmed.endsWith('/api')) {
      trimmed = trimmed.substring(0, trimmed.length - 4);
    }
    return trimmed;
  }
}
