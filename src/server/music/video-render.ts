import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AlignedLyricLine } from "./aligned-lyrics";

const VIDEO_ROOT = path.join(process.cwd(), "storage", "music-videos");
const VIDEO_OUTPUT_DIR = path.join(VIDEO_ROOT, "output");
const VIDEO_SUBTITLE_DIR = path.join(VIDEO_ROOT, "subtitles");
const SUBTITLE_GAP_PADDING_S = 0.12;
const TITLE_EVENT_END = "9:59:59.00";

type SubtitleCue = {
  text: string;
  start_s: number;
  end_s: number;
};

function resolveFfmpegPath() {
  const configuredPath = process.env.FFMPEG_PATH;

  if (configuredPath) {
    return configuredPath;
  }

  return "ffmpeg";
}

async function ensureVideoDirs() {
  await Promise.all([
    mkdir(VIDEO_OUTPUT_DIR, { recursive: true }),
    mkdir(VIDEO_SUBTITLE_DIR, { recursive: true }),
  ]);
}

function buildSubtitleCues(lines: AlignedLyricLine[]) {
  const rawCues: SubtitleCue[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const first = lines[index];
    const second = lines[index + 1];

    if (!first) {
      continue;
    }

    const parts = [first.text.trim()];
    let end_s = first.end_s;

    if (second && second.text.trim().length > 0) {
      parts.push(second.text.trim());
      end_s = second.end_s;
    }

    rawCues.push({
      text: parts.join("\n"),
      start_s: first.start_s,
      end_s,
    });
  }

  return rawCues
    .map((cue, index) => {
      const next = rawCues[index + 1];
      const extendedEnd = next ? Math.max(cue.end_s, next.start_s - SUBTITLE_GAP_PADDING_S) : cue.end_s;

      return {
        ...cue,
        end_s: extendedEnd,
      };
    })
    .filter((cue) => cue.text.trim().length > 0 && cue.end_s > cue.start_s);
}

function toAssTimestamp(seconds: number) {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function toSubtitleFilterPath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

async function writeAssSubtitleFile(params: {
  musicId: string;
  lines: AlignedLyricLine[];
  titleText?: string | null;
}) {
  const subtitlePath = path.join(VIDEO_SUBTITLE_DIR, `${params.musicId}.ass`);
  const cues = buildSubtitleCues(params.lines);
  const events: string[] = [];

  const normalizedTitle = params.titleText?.trim();
  if (normalizedTitle) {
    events.push(
      `Dialogue: 0,0:00:00.00,${TITLE_EVENT_END},Title,,0,0,0,,${escapeAssText(normalizedTitle)}`,
    );
  }

  for (const cue of cues) {
    events.push(
      `Dialogue: 0,${toAssTimestamp(cue.start_s)},${toAssTimestamp(cue.end_s)},Default,,0,0,0,,${escapeAssText(cue.text.trim())}`,
    );
  }

  const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Malgun Gothic,70,&H0000F6FF,&H0000F6FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2.8,0,2,90,90,165,1
Style: Title,Malgun Gothic,44,&H0000F6FF,&H0000F6FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2.4,0,7,46,70,62,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;

  await writeFile(subtitlePath, assContent, "utf8");
  return subtitlePath;
}

function runFfmpeg(
  inputImagePath: string,
  inputAudioPath: string,
  outputVideoPath: string,
  subtitlePath?: string,
) {
  return new Promise<void>((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();

    const videoFilter = [
      "scale=1280:2276:force_original_aspect_ratio=increase",
      "crop=1280:2276",
      "zoompan=z='if(lte(on,180),1.02+on*0.00035,if(lte(on,360),1.083-(on-180)*0.00025,1.038))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30",
      "format=yuv420p",
    ];

    if (subtitlePath) {
      videoFilter.push(`subtitles='${toSubtitleFilterPath(subtitlePath)}'`);
    }

    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-i",
        inputImagePath,
        "-i",
        inputAudioPath,
        "-vf",
        videoFilter.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        "-shortest",
        outputVideoPath,
      ],
      {
        windowsHide: true,
      },
    );

    let errorOutput = "";

    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ffmpeg를 찾지 못했습니다."));
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(errorOutput || `ffmpeg exited with code ${code}`));
    });
  });
}

export async function renderMusicVideo(params: {
  musicId: string;
  title?: string | null;
  mp3Path: string;
  coverPath: string;
  lyricLines?: AlignedLyricLine[];
}) {
  await ensureVideoDirs();

  const outputPath = path.join(VIDEO_OUTPUT_DIR, `${params.musicId}.mp4`);
  const subtitlePath =
    (params.lyricLines && params.lyricLines.length > 0) || params.title?.trim()
      ? await writeAssSubtitleFile({
          musicId: params.musicId,
          lines: params.lyricLines ?? [],
          titleText: params.title,
        })
      : null;

  await runFfmpeg(params.coverPath, params.mp3Path, outputPath, subtitlePath ?? undefined);

  return {
    outputPath,
    srtPath: subtitlePath,
  };
}
