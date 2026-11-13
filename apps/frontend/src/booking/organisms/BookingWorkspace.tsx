import type { ReactElement } from 'react';
import type { ReactNode, Ref } from 'react';
import { Styles } from '../../shared/atoms';
/** Shared map/Gantt layout; state and mutation policy belong to the caller's controller. */
export default function BookingWorkspace({
  map,
  timeline,
  toolbar,
  className = '',
  mapClassName = '',
  timelineClassName = '',
  viewportRef,
  landmark = false,
}: {
  map: ReactNode;
  timeline: ReactNode;
  toolbar?: ReactNode;
  className?: string;
  mapClassName?: string;
  timelineClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  landmark?: boolean;
}): ReactElement {
  return (
    <>
      <Styles id="booking-workspace">{styles}</Styles>
      <div
        role={landmark ? 'main' : undefined}
        ref={viewportRef}
        className={`booking-workspace ${className}`}
      >
        {toolbar}
        <div className={`booking-workspace-map ${mapClassName}`}>{map}</div>
        <div className={`booking-workspace-timeline ${timelineClassName}`}>{timeline}</div>
      </div>
    </>
  );
}
const styles = String.raw`
.booking-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.booking-workspace-map {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 100px;
  min-width: 0;
  overflow: hidden;
}
.booking-workspace-timeline {
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
  background: #fff;
}
.booking-workspace-timeline > .bk-timeline {
  width: 100%;
}
`;
