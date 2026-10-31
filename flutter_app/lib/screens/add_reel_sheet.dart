import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../providers/reels_provider.dart';
import '../services/share_intent_service.dart';

class AddReelSheet extends StatefulWidget {
  final IncomingSharePayload? initialShare;

  const AddReelSheet({super.key, this.initialShare});

  @override
  State<AddReelSheet> createState() => _AddReelSheetState();
}

class _AddReelSheetState extends State<AddReelSheet> {
  final _urlCtrl = TextEditingController();
  final _captionCtrl = TextEditingController();
  final _transcriptCtrl = TextEditingController();
  final _categoryCtrl = TextEditingController();

  final stt.SpeechToText _speech = stt.SpeechToText();
  File? _pickedMediaFile;
  bool _isListening = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    final shared = widget.initialShare;
    if (shared != null) {
      if (shared.reelUrl != null) _urlCtrl.text = shared.reelUrl!;
      if (shared.sharedText != null && shared.sharedText != shared.reelUrl) {
        _captionCtrl.text = shared.sharedText!;
      }
      _pickedMediaFile = shared.mediaFile;
    }
  }

  @override
  void dispose() {
    _speech.stop();
    _urlCtrl.dispose();
    _captionCtrl.dispose();
    _transcriptCtrl.dispose();
    _categoryCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickMedia() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['mp4', 'mov', 'webm', 'mp3', 'm4a', 'wav', 'ogg'],
    );
    if (result != null && result.files.single.path != null) {
      setState(() {
        _pickedMediaFile = File(result.files.single.path!);
      });
    }
  }

  Future<void> _toggleOnDeviceSpeech() async {
    if (_isListening) {
      await _speech.stop();
      setState(() => _isListening = false);
      return;
    }

    final available = await _speech.initialize();
    if (!available) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('On-device speech recognition is unavailable.'),
          ),
        );
      }
      return;
    }

    setState(() => _isListening = true);
    await _speech.listen(
      onResult: (val) {
        if (val.finalResult) {
          final current = _transcriptCtrl.text.trim();
          _transcriptCtrl.text =
              [current, val.recognizedWords].where((s) => s.isNotEmpty).join(' ');
        }
      },
    );
  }

  Future<void> _submit() async {
    if (_urlCtrl.text.trim().isEmpty && _pickedMediaFile == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Paste an Instagram Reel URL or pick an MP4/MP3 file.'),
        ),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      await context.read<ReelsProvider>().createReel(
            sourceUrl: _urlCtrl.text,
            mediaFile: _pickedMediaFile,
            caption: _captionCtrl.text,
            transcript: _transcriptCtrl.text,
            categoryName: _categoryCtrl.text,
          );
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final suggestions = context.watch<ReelsProvider>().allCategoryNameSuggestions;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Save Reel (URL or MP4 / MP3)',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _urlCtrl,
              decoration: const InputDecoration(
                labelText: 'Instagram Reel URL (optional if uploading MP4/MP3)',
                hintText: 'https://www.instagram.com/reel/...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _pickMedia,
              icon: const Icon(Icons.upload_file_rounded),
              label: Text(
                _pickedMediaFile == null
                    ? 'Pick MP4 Video or MP3 Audio (FFmpeg → MP3)'
                    : 'Selected: ${_pickedMediaFile!.path.split('/').last}',
              ),
            ),
            const SizedBox(height: 12),
            Autocomplete<String>(
              optionsBuilder: (val) {
                if (val.text.isEmpty) return suggestions;
                return suggestions.where(
                  (c) => c.toLowerCase().contains(val.text.toLowerCase()),
                );
              },
              onSelected: (choice) => _categoryCtrl.text = choice,
              fieldViewBuilder: (ctx, ctrl, focusNode, onSubmitted) {
                ctrl.addListener(() => _categoryCtrl.text = ctrl.text);
                return TextField(
                  controller: ctrl,
                  focusNode: focusNode,
                  decoration: const InputDecoration(
                    labelText: 'Category (blank = AI auto-selects)',
                    border: OutlineInputBorder(),
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _captionCtrl,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Shared Caption / Context (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _transcriptCtrl,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Transcript (blank = auto Whisper STT)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  onPressed: _toggleOnDeviceSpeech,
                  tooltip: 'Free On-Device Voice Transcription',
                  icon: Icon(_isListening ? Icons.stop : Icons.mic),
                ),
              ],
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: _submitting
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Convert, Transcribe & Summarize'),
            ),
          ],
        ),
      ),
    );
  }
}
