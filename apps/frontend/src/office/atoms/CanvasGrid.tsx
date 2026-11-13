interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  step: number;
  editing: boolean;
}

export default function CanvasGrid({ x, y, width, height, zoom, step, editing }: Props) {
  const majorStep = step * 5;
  const screenScale = 1 / Math.max(zoom, 0.001);
  const bounds = { x, y, width, height };
  return (
    <g
      data-canvas-grid
      data-grid-step={step}
      data-grid-major-step={majorStep}
      data-editing={editing}
      pointerEvents="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="office-grid-minor"
          x="0"
          y="0"
          width={step}
          height={step}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${step} 0 H 0 V ${step}`}
            fill="none"
            stroke="#607b9e"
            strokeWidth={0.6 * screenScale}
            strokeOpacity={editing ? 0.25 : 0.13}
          />
        </pattern>
        <pattern
          id="office-grid-major"
          x="0"
          y="0"
          width={majorStep}
          height={majorStep}
          patternUnits="userSpaceOnUse"
        >
          {editing && (
            <path
              d={`M ${majorStep} 0 H 0 V ${majorStep}`}
              fill="none"
              stroke="white"
              strokeWidth={2.5 * screenScale}
              strokeOpacity=".55"
            />
          )}
          <path
            d={`M ${majorStep} 0 H 0 V ${majorStep}`}
            fill="none"
            stroke="#52729d"
            strokeWidth={screenScale}
            strokeOpacity={editing ? 0.45 : 0.24}
          />
        </pattern>
      </defs>
      <rect {...bounds} fill="url(#office-grid-minor)" />
      <rect {...bounds} fill="url(#office-grid-major)" />
    </g>
  );
}
