import { useId } from 'react';
import type { PlanElement } from '../lib/officeModel';

export interface RoomLabelProps {
  room: PlanElement;
  zoom: number;
  title?: string;
  subtitle?: string;
  subtitleColor?: string;
  markerColor?: string;
  count?: string;
  countColor?: string;
}

const textWidth = (text: string, size: number) =>
  Array.from(text).reduce(
    (width, letter) =>
      width +
      (/\s/.test(letter)
        ? 0.32
        : /[ilI.,:;!|'`]/.test(letter)
          ? 0.3
          : /[MWЖШЩЮФ@]/.test(letter)
            ? 0.88
            : 0.62) *
        size,
    0,
  );
function shorten(text: string, width: number, size: number): string {
  if (textWidth(text, size) <= width) return text;
  if (width < size) return '';
  let result = '';
  for (const letter of text) {
    if (textWidth(result + letter + '…', size) > width) break;
    result += letter;
  }
  return result.trimEnd() + '…';
}

/** A screen-sized SVG label above the plan, with no pointer or geometry effects. */
export default function RoomLabel({
  room,
  zoom,
  title = room.name,
  subtitle = '',
  subtitleColor = '#8898aa',
  markerColor,
  count,
  countColor = '#c18a3c',
}: RoomLabelProps) {
  const clipId = 'room-label-' + useId().replace(/:/g, '');
  if (!Number.isFinite(zoom) || zoom <= 0 || room.width * zoom <= 78 || room.height * zoom <= 42)
    return null;
  const markerWidth = markerColor ? 10 : 0;
  const countWidth = count ? Math.max(22, Math.ceil(textWidth(count, 8.5) + 12)) : 0;
  const naturalWidth =
    Math.max(
      textWidth(title, 11) + markerWidth,
      textWidth(subtitle, 8.5) + (count ? countWidth + 6 : 0),
    ) + 12;
  const width = Math.min(room.width * zoom - 16, 220, Math.max(36, Math.ceil(naturalWidth)));
  const secondRow = !!subtitle || !!count;
  const height = secondRow ? 34 : 22;
  const contentWidth = width - 12;
  const pillWidth = Math.min(contentWidth, countWidth);
  const subtitleWidth = Math.max(0, contentWidth - (count ? pillWidth + 6 : 0));
  const labelTitle = [title, subtitle, count].filter(Boolean).join(' · ');
  return (
    <g
      pointerEvents="none"
      aria-hidden="true"
      data-room-label-id={room.id}
      transform={`rotate(${room.rotation} ${room.x + room.width / 2} ${room.y + room.height / 2}) translate(${room.x + 8 / zoom} ${room.y + 8 / zoom}) scale(${1 / zoom})`}
    >
      <title>{labelTitle}</title>
      <defs>
        <clipPath id={clipId}>
          <rect width={width} height={height} rx="5" />
        </clipPath>
      </defs>
      <rect width={width} height={height} rx="5" fill="white" fillOpacity=".9" />
      <g clipPath={`url(#${clipId})`}>
        {markerColor && <circle cx="8.5" cy="10.5" r="2.5" fill={markerColor} />}
        <text x={6 + markerWidth} y="14" fontSize="11" fontWeight="750" fill="#4e6078">
          {shorten(title, contentWidth - markerWidth, 11)}
        </text>
        {subtitle && (
          <text x="6" y="27" fontSize="8.5" fill={subtitleColor}>
            {shorten(subtitle, subtitleWidth, 8.5)}
          </text>
        )}
        {count && (
          <g>
            <rect
              x={width - 6 - pillWidth}
              y="18"
              width={pillWidth}
              height="13"
              rx="4"
              fill="#fff1dc"
            />
            <text
              x={width - 6 - pillWidth / 2}
              y="27"
              textAnchor="middle"
              fontSize="8.5"
              fontWeight="700"
              fill={countColor}
            >
              {shorten(count, pillWidth - 8, 8.5)}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}
