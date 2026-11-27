export type ColorGradeId =
  | 'original'
  | 'iphone-pro'
  | 'teal-orange'
  | 'golden-hour'
  | 'vintage-kodak'
  | 'vivid-hdr'
  | 'noir-bw';

export interface ToneAdjustments {
  /** Range: -50..50 (negative = cool, positive = warm) */
  temperature: number;
  /** Range: -50..50 (negative = green, positive = magenta) */
  tint: number;
  /** Range: -50..50 (lifts or deepens shadows) */
  shadows: number;
  /** Range: -50..50 (recovers or boosts highlights) */
  highlights: number;
}

export interface ColorGradeState {
  gradeId: ColorGradeId;
  /** Blend strength: 0..100 */
  intensity: number;
  tone: ToneAdjustments;
}

export type NoisePresetLevel = 'subtle' | 'balanced' | 'strong';

export interface NoiseEnhancementConfig {
  enabled: boolean;
  level: NoisePresetLevel;
  /** Luma spatial noise reduction strength: 1..10 */
  grainStrength: number;
  /** Chroma spatial smoothing strength: 1..8 */
  colorSmooth: number;
  /** Temporal motion stabilization across frames (video): 1..10 */
  motionStability: number;
}

export interface SharpenEnhancementConfig {
  enabled: boolean;
  /** Detail sharpen strength: 0.2..2.0 */
  strength: number;
  kernelSize: 3 | 5 | 7;
  antiArtifact: boolean;
}

export interface ColorContrastEnhancementConfig {
  enabled: boolean;
  /** Range: -50..50 */
  contrast: number;
  /** Range: -50..50 */
  brightness: number;
  /** Range: -50..50 */
  saturation: number;
  /** Shadows & brightness lift (gamma balance): -50..50 */
  shadowBright: number;
}

export interface Upscale1080Config {
  enabled: boolean;
  method: 'lanczos' | 'bicubic';
  keepAspect: boolean;
}

export interface EnhancementSuiteState {
  noise: NoiseEnhancementConfig;
  sharpen: SharpenEnhancementConfig;
  colorContrast: ColorContrastEnhancementConfig;
  upscale1080: Upscale1080Config;
}

export type EnhanceRecipeId = 'dark-footage' | 'crisp-text' | 'hd-balanced';
