import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';

class ApiException implements Exception {
  final String message;
  final int statusCode;

  const ApiException(this.message, {this.statusCode = 400});

  @override
  String toString() => message;
}

class ApiClient {
  static const _accessKey = 'rs_access_token';
  static const _refreshKey = 'rs_refresh_token';

  Future<String?> getAccessToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_accessKey);
  }

  Future<String?> getRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_refreshKey);
  }

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accessKey, accessToken);
    await prefs.setString(_refreshKey, refreshToken);
  }

  Future<void> clearTokens() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessKey);
    await prefs.remove(_refreshKey);
  }

  Uri _uri(String apiPath, [Map<String, String>? query]) {
    final base = '${ApiConfig.baseUrl}/api$apiPath';
    return Uri.parse(base).replace(
      queryParameters: (query != null && query.isNotEmpty) ? query : null,
    );
  }

  Future<Map<String, dynamic>> request(
    String method,
    String apiPath, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool retried = false,
  }) async {
    final token = await getAccessToken();
    final headers = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };

    late http.Response res;
    final uri = _uri(apiPath, query);

    switch (method.toUpperCase()) {
      case 'GET':
        res = await http.get(uri, headers: headers);
        break;
      case 'POST':
        res = await http.post(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'PATCH':
        res = await http.patch(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      case 'DELETE':
        res = await http.delete(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
        break;
      default:
        throw ApiException('Unsupported HTTP method: $method');
    }

    if (res.statusCode == 401 && !retried && !apiPath.startsWith('/auth/')) {
      final refreshed = await _tryRefresh();
      if (refreshed) {
        return request(method, apiPath, body: body, query: query, retried: true);
      }
      await clearTokens();
    }

    return _decodeResponse(res);
  }

  Future<Map<String, dynamic>> multipartPost(
    String apiPath, {
    Map<String, String>? fields,
    File? mediaFile,
    bool retried = false,
  }) async {
    final token = await getAccessToken();
    final req = http.MultipartRequest('POST', _uri(apiPath));

    if (token != null && token.isNotEmpty) {
      req.headers['Authorization'] = 'Bearer $token';
    }
    if (fields != null) {
      req.fields.addAll(fields);
    }
    if (mediaFile != null && await mediaFile.exists()) {
      req.files.add(await http.MultipartFile.fromPath('media', mediaFile.path));
    }

    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);

    if (res.statusCode == 401 && !retried) {
      final refreshed = await _tryRefresh();
      if (refreshed) {
        return multipartPost(
          apiPath,
          fields: fields,
          mediaFile: mediaFile,
          retried: true,
        );
      }
      await clearTokens();
    }

    return _decodeResponse(res);
  }

  Future<bool> _tryRefresh() async {
    final refreshToken = await getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) return false;

    try {
      final res = await http.post(
        _uri('/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final tokens = (data['data'] as Map<String, dynamic>?)?['tokens']
            as Map<String, dynamic>?;
        if (tokens != null) {
          await saveTokens(
            accessToken: tokens['accessToken']?.toString() ?? '',
            refreshToken: tokens['refreshToken']?.toString() ?? '',
          );
          return true;
        }
      }
    } catch (_) {
      // Ignore refresh error
    }
    return false;
  }

  Map<String, dynamic> _decodeResponse(http.Response res) {
    Map<String, dynamic> decoded = {};
    if (res.body.isNotEmpty) {
      try {
        decoded = jsonDecode(res.body) as Map<String, dynamic>;
      } catch (_) {
        decoded = {'message': res.body};
      }
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return decoded;
    }

    final errors = decoded['errors'];
    if (errors is List && errors.isNotEmpty) {
      final joined = errors
          .map((e) => (e is Map ? e['message']?.toString() : e.toString()) ?? '')
          .where((s) => s.isNotEmpty)
          .join(' ');
      if (joined.isNotEmpty) {
        throw ApiException(joined, statusCode: res.statusCode);
      }
    }

    throw ApiException(
      decoded['message']?.toString() ?? 'Request failed (${res.statusCode})',
      statusCode: res.statusCode,
    );
  }
}
