import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import { NarrationSegment } from './types';
import { SubtitleCue, generateSrtContent, breakBurmeseLines } from '../src/utils/subtitle';
import { getVideoMetadata } from './ffmpeg';

const execFileAsync = util.promisify(execFile);

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { EdgeTTS } = require('node-edge-tts');
export { EdgeTTS };

export interface TtsVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  sampleText: string;
}

export const BURMESE_VOICES: TtsVoiceOption[] = [
  {
    id: 'my-MM-NilarNeural',
    name: 'နီလာ (မိန်းကလေးအသံ - Nilar Neural)',
    gender: 'female',
    sampleText: 'မင်္ဂလာပါ၊ My AI Studio မှ ကြိုဆိုပါတယ်။ တရုတ်ရုပ်ရှင်ဇာတ်ကား ရှင်းပြချက်ကို စတင်နားဆင်ပါတော့မယ်။',
  },
  {
    id: 'my-MM-ThihaNeural',
    name: 'သီဟ (ယောက်ျားလေးအသံ - Thiha Neural)',
    gender: 'male',
    sampleText: 'မင်္ဂလာပါ၊ My AI Studio မှ ကြိုဆိုပါတယ်။ တရုတ်ရုပ်ရှင်ဇာတ်ကား ရှင်းပြချက်ကို စတင်နားဆင်ပါတော့မယ်။',
  },
];

/**
 * Generate a quick voice sample for preview
 */
export async function generateVoicePreview(
  voiceId: string,
  rate = '+0%',
  outputPath: string
): Promise<string> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const voice = BURMESE_VOICES.find((v) => v.id === voiceId) || BURMESE_VOICES[0];
  const tts = new EdgeTTS({
    voice: voice.id,
    lang: 'my-MM',
    rate,
  });

  await tts.ttsPromise(voice.sampleText, outputPath);
  return outputPath;
}

/**
 * Generate complete Burmese narration audio from script segments,
 * concatenate audio, and produce synchronized Burmese SRT subtitles.
 */
export async function generateBurmeseNarration(params: {
  segments: NarrationSegment[];
  voiceId: string;
  rate?: string;
  outputDir: string;
}): Promise<{
  audioPath: string;
  srtPath: string;
  totalDuration: number;
  cues: SubtitleCue[];
}> {
  const { segments, voiceId, rate = '+0%', outputDir } = params;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const segmentAudioDir = path.join(outputDir, 'narration_segments');
  if (!fs.existsSync(segmentAudioDir)) {
    fs.mkdirSync(segmentAudioDir, { recursive: true });
  }

  const tts = new EdgeTTS({
    voice: voiceId,
    lang: 'my-MM',
    rate,
  });

  const generatedAudioFiles: string[] = [];
  const subtitleCues: SubtitleCue[] = [];
  let currentTime = 0.5; // Start with a brief 0.5s pause

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segAudioFile = path.join(segmentAudioDir, `seg_${String(i + 1).padStart(3, '0')}.mp3`);

    // Clean text for TTS
    const cleanText = seg.text.trim();
    if (!cleanText) continue;

    try {
      await tts.ttsPromise(cleanText, segAudioFile);
      generatedAudioFiles.push(segAudioFile);

      // Measure exact duration of this audio segment
      const meta = await getVideoMetadata(segAudioFile);
      const segmentDuration = meta.duration > 0 ? meta.duration : 4.0;

      const startTime = currentTime;
      const endTime = currentTime + segmentDuration;

      // Break long sentences for clear subtitles
      const brokenText = breakBurmeseLines(cleanText, 45);

      subtitleCues.push({
        id: subtitleCues.length + 1,
        startTime,
        endTime,
        text: brokenText,
      });

      // Add a natural 0.4s pause between narrative paragraphs
      currentTime = endTime + 0.4;
    } catch (err: any) {
      console.error(`Failed to generate TTS for segment ${i + 1}:`, err);
      throw new Error(`Burmese TTS Error on segment ${i + 1}: ${err.message}`);
    }
  }

  // Concatenate all audio segments into a single narration.mp3 using FFmpeg concat
  const finalAudioPath = path.join(outputDir, 'narration.mp3');
  const concatListPath = path.join(segmentAudioDir, 'concat_list.txt');

  const fileEntries = generatedAudioFiles
    .map((f) => `file '${f.replace(/\\/g, '/')}'`)
    .join('\n');
  fs.writeFileSync(concatListPath, fileEntries, 'utf8');

  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-acodec',
    'libmp3lame',
    '-b:a',
    '192k',
    finalAudioPath,
  ]);

  // Generate SRT Subtitle file
  const srtContent = generateSrtContent(subtitleCues);
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtContent, 'utf8');

  return {
    audioPath: finalAudioPath,
    srtPath,
    totalDuration: currentTime,
    cues: subtitleCues,
  };
}
