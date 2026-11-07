import 'dart:io';
import 'package:audioplayers/audioplayers.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  late String _summaryStyle;
  late final TextEditingController _titleCtrl;
  late final TextEditingController _categoryCtrl;
  late final TextEditingController _authorCtrl;
  late final TextEditingController _summaryCtrl;
  late final TextEditingController _keyPointsCtrl;
  late final TextEditingController _transcriptCtrl;
  late final TextEditingController _notesCtrl;

  final AudioPlayer _audioPlayer = AudioPlayer();
  final Set<int> _checkedItems = <int>{};
  bool _playingAudio = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _reel = widget.reel;
    _summaryStyle = ReelModel.normalizeStyle(_reel.summaryStyle);
    _titleCtrl = TextEditingController(text: _reel.title ?? '');
    _categoryCtrl = TextEditingController(text: _reel.category?.name ?? '');
    _authorCtrl = TextEditingController(text: _reel.authorHandle ?? '');
    _summaryCtrl = TextEditingController(text: _reel.summary ?? '');
    _keyPointsCtrl = TextEditingController(text: _reel.keyPoints.join('\n'));
    _transcriptCtrl = TextEditingController(text: _reel.transcript ?? '');
    _notesCtrl = TextEditingController(text: _reel.notes ?? '');

    _summaryCtrl.addListener(() => setState(() {}));
    _keyPointsCtrl.addListener(() => setState(() {}));

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

  List<String> _parsedKeyPoints() {
    return _keyPointsCtrl.text
        .split('\n')
        .map(
          (l) => l
              .replaceFirst(RegExp(r'^(?:[-•*▪☑☐]\s*|\d+[.)]\s+)'), '')
              .trim(),
        )
        .where((l) => l.isNotEmpty)
        .toList();
  }

  Future<void> _changeSummaryStyle(String nextStyle) async {
    setState(() => _summaryStyle = nextStyle);
    try {
      final updated = await context.read<ReelsProvider>().updateReel(
            _reel.id,
            summaryStyle: nextStyle,
          );
      if (mounted) {
        setState(() => _reel = updated);
      }
    } catch {
      // Non-blocking style persistence
    }
  }

  Future<void> _copyFormattedSummary() async {
    final summary = _summaryCtrl.text.trim();
    final points = _parsedKeyPoints();
    String text;
    if (_summaryStyle == 'paragraph') {
      final tail =
          points.isNotEmpty ? '\n\nHighlights: ${points.join(' · ')}' : '';
      text = '$summary$tail'.trim();
    } else {
      final lines = List.generate(points.length, (i) {
        if (_summaryStyle == 'numbered') return '${i + 1}. ${points[i]}';
        if (_summaryStyle == 'checklist') return '☐ ${points[i]}';
        return '• ${points[i]}';
      });
      text = [if (summary.isNotEmpty) summary, ...lines].join('\n');
    }

    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Copied formatted summary to clipboard!')),
      );
    }
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
      final points = _parsedKeyPoints();

      final updated = await context.read<ReelsProvider>().updateReel(
            _reel.id,
            title: _titleCtrl.text,
            categoryName: _categoryCtrl.text,
            authorHandle: _authorCtrl.text,
            summary: _summaryCtrl.text,
            keyPoints: points,
            summaryStyle: _summaryStyle,
            transcript: _transcriptCtrl.text,
            notes: _notesCtrl.text,
            resummarize: resummarize,
          );

      setState(() {
        _reel = updated;
        _summaryStyle = ReelModel.normalizeStyle(updated.summaryStyle);
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
                  ? 'Brief summary rewritten in ${_reel.summaryStyleLabel} format!'
                  : 'All adjustments & format saved!',
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
            content:
                Text('Media uploaded! Converting MP4 → MP3 & transcribing...'),
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
        content: const Text(
          'This saved reel and its extracted MP3 will be removed.',
        ),
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

  Widget _buildFormattedSummaryView() {
    final summary = _summaryCtrl.text.trim();
    final points = _parsedKeyPoints();

    if (summary.isEmpty && points.isEmpty) {
      return const Text(
        'Summary will appear here once processing completes.',
        style: TextStyle(color: Colors.white60),
      );
    }

    if (_summaryStyle == 'paragraph') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            summary.isNotEmpty ? summary : points.join('. '),
            style: const TextStyle(fontSize: 14, height: 1.5),
          ),
          if (points.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: points
                  .take(4)
                  .map(
                    (p) => Chip(
                      label: Text('✦ $p', style: const TextStyle(fontSize: 12)),
                      visualDensity: VisualDensity.compact,
                    ),
                  )
                  .toList(),
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (summary.isNotEmpty) ...[
          Text(
            summary,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 14,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
        ],
        ...List.generate(points.length, (idx) {
          final text = points[idx];
          if (_summaryStyle == 'checklist') {
            final checked = _checkedItems.contains(idx);
            return InkWell(
              onTap: () {
                setState(() {
                  if (checked) {
                    _checkedItems.remove(idx);
                  } else {
                    _checkedItems.add(idx);
                  }
                });
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      checked
                          ? Icons.check_box_rounded
                          : Icons.check_box_outline_blank_rounded,
                      size: 18,
                      color: Colors.indigoAccent,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        text,
                        style: TextStyle(
                          fontSize: 13.5,
                          decoration: checked
                              ? TextDecoration.lineThrough
                              : TextDecoration.none,
                          color: checked ? Colors.white54 : Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          final marker = _summaryStyle == 'numbered' ? '${idx + 1}.' : '•';
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 3.5),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 22,
                  child: Text(
                    marker,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.indigoAccent,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(text, style: const TextStyle(fontSize: 13.5)),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('View, Format & Edit Reel'),
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
          const SizedBox(height: 10),
          // Interactive Brief Summary Card + Format Switcher
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        '✨ Brief & Complete Summary',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14.5,
                        ),
                      ),
                      Row(
                        children: [
                          IconButton(
                            tooltip: 'Copy formatted summary',
                            icon: const Icon(Icons.copy_rounded, size: 18),
                            onPressed: _copyFormattedSummary,
                          ),
                          FilledButton.tonalIcon(
                            onPressed: _saving
                                ? null
                                : () => _save(resummarize: true),
                            icon: const Icon(
                              Icons.auto_awesome_outlined,
                              size: 16,
                            ),
                            label: const Text('AI Rewrite'),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: 'bullets', label: Text('• Bullets')),
                      ButtonSegment(value: 'numbered', label: Text('1. Steps')),
                      ButtonSegment(value: 'checklist', label: Text('☑ Check')),
                      ButtonSegment(
                        value: 'paragraph',
                        label: Text('¶ Brief'),
                      ),
                    ],
                    selected: {_summaryStyle},
                    onSelectionChanged: (sel) => _changeSummaryStyle(sel.first),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.25),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: _buildFormattedSummaryView(),
                  ),
                ],
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
          const SizedBox(height: 12),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text(
              '✎ Edit Summary & Points Text Manually',
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            ),
            children: [
              const SizedBox(height: 8),
              TextField(
                controller: _summaryCtrl,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Brief Overview Sentence (Editable)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _keyPointsCtrl,
                maxLines: 5,
                decoration: const InputDecoration(
                  labelText: 'Structured Points (one per line)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _transcriptCtrl,
            maxLines: 5,
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
