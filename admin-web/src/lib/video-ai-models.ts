export type VideoAiModel = {
  id: string;
  label: string;
  providerPath: string;
  supportsImage: boolean;
  supportsAudio: boolean;
  durations: number[];
  resolutions: string[];
};

// Catálogo inicial inspirado na arquitetura declarativa do OpenHiggsfield.
// O backend valida novamente cada opção; a interface nunca envia caminhos arbitrários.
export const VIDEO_AI_MODELS: VideoAiModel[] = [
  { id: "kling-3-turbo", label: "Kling 3 Turbo", providerPath: "kling-video/v3.0-turbo", supportsImage: true, supportsAudio: false, durations: [5, 10], resolutions: ["720p", "1080p"] },
  { id: "kling-3-pro", label: "Kling 3 Pro", providerPath: "kling-video/v3.0/pro", supportsImage: true, supportsAudio: true, durations: [5, 10], resolutions: ["720p", "1080p"] },
  { id: "seedance-2-fast", label: "Seedance 2 Fast", providerPath: "bytedance/seedance-2.0/fast", supportsImage: true, supportsAudio: true, durations: [5, 10], resolutions: ["720p", "1080p"] },
  { id: "seedance-2.5", label: "Seedance 2.5", providerPath: "bytedance/seedance-2.5", supportsImage: true, supportsAudio: true, durations: [5, 10], resolutions: ["720p", "1080p"] },
  { id: "wan-2.7", label: "Wan 2.7", providerPath: "wan-video/wan-2.7", supportsImage: true, supportsAudio: false, durations: [5, 10], resolutions: ["720p", "1080p"] },
  { id: "minimax-hailuo-2.3", label: "MiniMax Hailuo 2.3", providerPath: "minimax/hailuo-2.3", supportsImage: true, supportsAudio: false, durations: [6, 10], resolutions: ["768p", "1080p"] }
];

export const DEFAULT_VIDEO_AI_MODEL = VIDEO_AI_MODELS[0];
