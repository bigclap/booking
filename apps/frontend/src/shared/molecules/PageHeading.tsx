import type { ReactElement } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Styles } from '../atoms';
const styles = String.raw`
.ui-page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin: 0 0 25px;
  min-width: 0;
}
.ui-page-heading > div {
  min-width: 0;
}
.ui-page-heading h1 {
  font-size: 27px;
  font-weight: 750;
  line-height: 1.4;
  letter-spacing: -0.8px;
  color: #40516c;
  margin: 0 0 9px;
  overflow-wrap: anywhere;
}
.ui-page-heading p {
  font-size: 11px;
  color: #98a4b8;
  margin: 0;
  line-height: 1.7;
}
.ui-page-heading-eyebrow {
  display: block;
  font-size: 8px;
  font-weight: 750;
  letter-spacing: 1.3px;
  color: #a7b1c4;
  margin-bottom: 8px;
}
.ui-page-heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .ui-page-heading {
    gap: 13px;
    align-items: flex-start;
  }
  .ui-page-heading h1 {
    font-size: 23px;
  }
  .ui-page-heading p {
    font-size: 10px;
  }
  .ui-page-heading-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
`;
export function PageHeading({
  title,
  eyebrow,
  description,
  actions,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <>
      <Styles id="page-heading">{styles}</Styles>
      <div {...props} className={`ui-page-heading ${className}`.trim()}>
        <div>
          {eyebrow && <span className="ui-page-heading-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="ui-page-heading-actions">{actions}</div>}
      </div>
    </>
  );
}
