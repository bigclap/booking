import type { ReactElement } from 'react';
import { Styles } from '../shared/atoms';

const css = String.raw`
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;650;700;750;800&display=swap');
:root {
  font-family: Manrope, system-ui, sans-serif;
  color: #273245;
  background: #f6f7fb;
  font-synthesis: none;
  font-weight: 500;
  --color-accent: #7d89dc;
  --color-text: #647591;
  --color-muted: #98a5ba;
  --color-border: #e2e7f0;
  --color-free: #35aa88;
  --color-busy: #d66e7b;
  --color-partial: #df9b3e;
  --radius-control: 8px;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
}
button,
input,
select,
textarea {
  font: inherit;
}
button {
  cursor: pointer;
  border: 0;
  background: none;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
button:focus-visible,
a:focus-visible {
  outline: 2px solid #95a6ef;
  outline-offset: 3px;
}
`;

export function GlobalStyles(): ReactElement {
  return (
    <Styles id="foundation" precedence="reset">
      {css}
    </Styles>
  );
}
