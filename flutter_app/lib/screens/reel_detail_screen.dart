import 'dart:io';
import 'package:audioplayers/audioplayers.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config/api_config.dart';
import '../models/reel_model.dart';
import '../providers/reels_provider.dart';

class ReelDetailScreen extends StatefulWidget {
  final ReelModel reel;

  const ReelDetailScreen({super.key, required this.reel});

  @override
  State<ReelDetailScreen> createState() => _ReelDetailScreenState();
}

class _ReelDetailScreenState extends State<ReelDetailScreen> {
  late ReelModel _reel;
  late final TextEditingController _titleCtrl;
  late final TextEditingController _categoryCtrl;
  late final TextEditingController _authorCtrl;
  late final TextEditingController _summaryCtrl;
  late final TextEditingController _keyPointsCtrl;
  late final TextEditingController _transcriptCtrl;
  late final TextEditingController _notesCtrl;

  final AudioPlayer _audioPlayer = AudioPlayer();
  bool _playingAudio = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _reel = widget.reel;
    _titleCtrl = TextEditingController(text: _reel.title ?? '');
    _categoryCtrl = TextEditingController(text: _reel.category?.name ?? '');
    _authorCtrl = TextEditingController(text: _reel.authorHandle ?? '');
    _summaryCtrl = TextEditingController(text: _reel.summary ?? '');
    _keyPointsCtrl = TextEditingController(text: _reel.keyPoints.join('\n'));
    _transcriptCtrl = TextEditingController(text: _reel.transcript ?? '');
    _notesCtrl = TextEditingController(text: _reel.notes ?? '');

    _audioPlayer.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playingAudio = false);
    });
  }

  @override
  void dispose() {
    _audioPlayer.dispose();
    _titleCtrl.dispose();
    _categoryCtrl.dispose();
    _authorCtrl.dispose();
    _summaryCtrl.dispose();
    _keyPointsCtrl.dispose();
    _transcriptCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _toggleAudioPlayback() async {
    if (_reel.audioUrl == null) return;
    if (_playingAudio) {
      await _audioPlayer.pause();
      setState(() => _playingAudio = false);
    } else {
      final url = ApiConfig.resolveMediaUrl(_reel.audioUrl!);
      await _audioPlayer.play(UrlSource(url));
      setState(() => _playingAudio = true);
    }
  }

  Future<void> _save({bool resummarize = false}) async {
    setState(() => _saving = true);
    try {
      final points = _keyPointsCtrl.text
          .split('\n')
          .map((l) => l.replaceFirst(RegExp(r'^[-•*]\s*'), '').trim())
          .where((l) => l.isNotEmpty)
          .toList();

      final updated = await context.read<ReelsProvider>().updateReel(
            _reel.id,
            title: _titleCtrl.text,
            categoryName: _categoryCtrl.text,
            authorHandle: _authorCtrl.text,
            summary: _summaryCtrl.text,
            keyPoints: points,
            transcript: _transcriptCtrl.text,
            notes: _notesCtrl.text,
            resummarize: resummarize,
          );

      setState(() {
        _reel = updated;
        _titleCtrl.text = updated.title ?? '';
        _categoryCtrl.text = updated.category?.name ?? '';
        _summaryCtrl.text = updated.summary ?? '';
        _keyPointsCtrl.text = updated.keyPoints.join('\n');
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              resummarize
                  ? 'Summary regenerated from transcript!'
                  : 'All adjustments saved!',
            ),
          ),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _attachMedia() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['mp4', 'mov', 'webm', 'mp3', 'm4a', 'wav'],
    );
    if (picked == null || picked.files.single.path == null) return;

    setState(() => _saving = true);
    try {
      await context.read<ReelsProvider>().attachMediaToReel(
            _reel.id,
            File(picked.files.single.path!),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Media uploaded! Converting MP4 → MP3 & transcribing...'),
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _deleteReel() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Reel?'),
        content: const Text('This saved reel and its extracted MP3 will be removed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;

    await context.read<ReelsProvider>().deleteReel(_reel.id);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Adjust & Edit Reel'),
        actions: [
          if (_reel.sourceUrl.startsWith('http'))
            IconButton(
              tooltip: 'Open Original Reel',
              icon: const Icon(Icons.open_in_new),
              onPressed: () => launchUrl(Uri.parse(_reel.sourceUrl)),
            ),
          IconButton(
            tooltip: 'Delete Reel',
            icon: const Icon(Icons.delete_outline),
            onPressed: _deleteReel,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (_reel.audioUrl != null)
            Card(
              child: ListTile(
                leading: IconButton.filled(
                  icon: Icon(_playingAudio ? Icons.pause : Icons.play_arrow),
                  onPressed: _toggleAudioPlayback,
                ),
                title: const Text('Extracted 16kHz MP3 Audio'),
                subtitle: Text(
                  _reel.audioDurationSec != null
                      ? 'Duration: ${_reel.audioDurationSec}s'
                      : 'Ready for playback',
                ),
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _titleCtrl,
            decoration: const InputDecoration(
              labelText: 'Reel Title',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _categoryCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Category (pick or type new name)',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _authorCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Creator Handle',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _summaryCtrl,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'AI Summary (Editable)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _keyPointsCtrl,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Key Points (one per line)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _transcriptCtrl,
            maxLines: 6,
            decoration: const InputDecoration(
              labelText: 'Spoken Transcript (Editable)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _notesCtrl,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Personal Notes & Adjustments',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: _saving ? null : _attachMedia,
                icon: const Icon(Icons.audio_file_outlined),
                label: const Text('Attach MP4/MP3'),
              ),
              OutlinedButton.icon(
                onPressed: _saving ? null : () => _save(resummarize: true),
                icon: const Icon(Icons.auto_awesome_outlined),
                label: const Text('Re-Summarize Transcript'),
              ),
              FilledButton.icon(
                onPressed: _saving ? null : () => _save(),
                icon: const Icon(Icons.check),
                label: const Text('Save Adjustments'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
