import { useMemo } from 'react';
import type { ColorContrastEnhancementConfig, ColorGradeState } from '../../engines/contracts';
import { buildSvgFilterParams, type SvgFilterParams } from '../../engines/shared/colorGrades';

export interface LiveGradeSvgFilterProps {
  filterId: string;
  colorGrade: ColorGradeState;
  colorContrast?: ColorContrastEnhancementConfig;
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

export function LiveGradeSvgFilter({
  filterId,
  colorGrade,
  colorContrast,
}: LiveGradeSvgFilterProps) {
  const params = useMemo(
    () => buildSvgFilterParams(colorGrade, colorContrast),
    [colorGrade, colorContrast]
  );

  if (!params.active) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
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
