import 'package:flutter/foundation.dart';
import '../models/user_model.dart';
import '../services/api_client.dart';

class AuthProvider extends ChangeNotifier {
  final ApiClient apiClient;

  UserModel? _user;
  bool _loading = true;

  AuthProvider({required this.apiClient});

  UserModel? get user => _user;
  bool get isLoading => _loading;
  bool get isAuthenticated => _user != null;

  Future<void> initialize() async {
    _loading = true;
    notifyListeners();
    try {
      final token = await apiClient.getAccessToken();
      if (token != null && token.isNotEmpty) {
        final res = await apiClient.request('GET', '/auth/me');
        final data = res['data'] as Map<String, dynamic>?;
        if (data != null && data['user'] is Map<String, dynamic>) {
          _user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
        }
      }
    } catch (_) {
      await apiClient.clearTokens();
      _user = null;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> login({required String email, required String password}) async {
    final res = await apiClient.request(
      'POST',
      '/auth/login',
      body: {'email': email.trim(), 'password': password},
    );
    await _handleAuthResponse(res);
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final res = await apiClient.request(
      'POST',
      '/auth/register',
      body: {
        'name': name.trim(),
        'email': email.trim(),
        'password': password,
      },
    );
    await _handleAuthResponse(res);
  }

  Future<void> _handleAuthResponse(Map<String, dynamic> res) async {
    final data = res['data'] as Map<String, dynamic>;
    final tokens = data['tokens'] as Map<String, dynamic>;
    await apiClient.saveTokens(
      accessToken: tokens['accessToken']?.toString() ?? '',
      refreshToken: tokens['refreshToken']?.toString() ?? '',
    );
    _user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await apiClient.request('POST', '/auth/logout');
    } catch (_) {}
    await apiClient.clearTokens();
    _user = null;
    notifyListeners();
  }
}
