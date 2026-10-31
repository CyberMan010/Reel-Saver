import 'dart:async';
import 'dart:io';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'client_edge_extractor.dart';

class IncomingSharePayload {
  final String? reelUrl;
  final String? sharedText;
  final File? mediaFile;

  const IncomingSharePayload({
    this.reelUrl,
    this.sharedText,
    this.mediaFile,
  });
}

/// Listens to Android & iOS native Share Sheet intents so users can tap
/// "Share -> Reel Saver" inside Instagram (URL) or share a saved MP4/MP3 file.
class ShareIntentService {
  StreamSubscription<List<SharedMediaFile>>? _sub;

  void startListening(void Function(IncomingSharePayload payload) onShared) {
    // 1. Handle shares received while app is already in memory
    _sub = ReceiveSharingIntent.instance.getMediaStream().listen((files) {
      final parsed = _parseSharedItems(files);
      if (parsed != null) onShared(parsed);
    });

    // 2. Handle cold-start shares that launched the app
    ReceiveSharingIntent.instance.getInitialMedia().then((files) {
      final parsed = _parseSharedItems(files);
      if (parsed != null) {
        onShared(parsed);
        ReceiveSharingIntent.instance.reset();
      }
    });
  }

  IncomingSharePayload? _parseSharedItems(List<SharedMediaFile> items) {
    if (items.isEmpty) return null;

    String? detectedUrl;
    String? textNote;
    File? mediaFile;

    for (final item in items) {
      if (item.type == SharedMediaType.text || item.type == SharedMediaType.url) {
        final raw = item.path;
        detectedUrl ??= ClientEdgeExtractor.extractInstagramUrl(raw);
        textNote = raw;
      } else if (item.type == SharedMediaType.video ||
          item.type == SharedMediaType.file) {
        final candidate = File(item.path);
        mediaFile ??= candidate;
      }
    }

    if (detectedUrl == null && mediaFile == null && textNote == null) {
      return null;
    }

    return IncomingSharePayload(
      reelUrl: detectedUrl,
      sharedText: textNote,
      mediaFile: mediaFile,
    );
  }

  void dispose() {
    _sub?.cancel();
  }
}
