import { useMemo } from 'react';
import type { ColorContrastEnhancementConfig, ColorGradeState } from '../../engines/contracts';
import {
  buildSvgFilterParams,
  getCssPreviewFilter,
  type SvgFilterParams,
} from '../../engines/shared/colorGrades';

export interface LiveGradeSvgFilterProps {
  filterId: string;
  colorGrade: ColorGradeState;
  colorContrast?: ColorContrastEnhancementConfig;
  disabled?: boolean;
}

export function getLiveFilterCssStyle(
  filterId: string,
  params: SvgFilterParams
): string | undefined {
  if (!params.active) {
    return undefined;
  }
  return `url(#${filterId})`;
}

export function resolvePreviewFilterStyle(options: {
  filterId: string;
  colorGrade: ColorGradeState;
  colorContrast?: ColorContrastEnhancementConfig;
  useLightweightCss: boolean;
}): string | undefined {
  if (options.useLightweightCss) {
    const css = getCssPreviewFilter(options.colorGrade, options.colorContrast);
    return css === 'none' ? undefined : css;
  }
  const params = buildSvgFilterParams(options.colorGrade, options.colorContrast);
  return getLiveFilterCssStyle(options.filterId, params);
}

export function LiveGradeSvgFilter({
  filterId,
  colorGrade,
  colorContrast,
  disabled = false,
}: LiveGradeSvgFilterProps) {
  const params = useMemo(
    () => (disabled ? null : buildSvgFilterParams(colorGrade, colorContrast)),
    [disabled, colorGrade, colorContrast]
  );

  if (disabled || !params?.active) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'fixed',
        width: 0,
        height: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={params.matrixValues} />
          <feComponentTransfer>
            <feFuncR type="linear" slope={params.slopeR} intercept={params.interceptR} />
            <feFuncG type="linear" slope={params.slopeG} intercept={params.interceptG} />
            <feFuncB type="linear" slope={params.slopeB} intercept={params.interceptB} />
          </feComponentTransfer>
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude="1" exponent={params.gammaExponent} offset="0" />
            <feFuncG type="gamma" amplitude="1" exponent={params.gammaExponent} offset="0" />
            <feFuncB type="gamma" amplitude="1" exponent={params.gammaExponent} offset="0" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
