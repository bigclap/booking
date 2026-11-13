# Frontend: vertical feature slices and atomic UI

The top level follows the product: `office`, `booking`, `users`, `auth`, `assistant`.
`app` composes providers and routes. `shared` contains reusable UI and transport primitives.

Within a business slice:

```text
pages/       route entry points and composition
organisms/   complete interface areas
molecules/   small combinations of controls
atoms/       indivisible, domain-specific presentation
hooks/       data access, state and command coordination
lib/         pure calculations, parsing and geometry
types.ts     domain-facing contracts
```

UI dependencies point down: pages → organisms → molecules → atoms. Any view may use
hooks and pure libraries. Hooks must not import views. Generic `shared` UI does not
read auth, office or booking providers. Domain UI is shared through deliberate public
entry points rather than by reaching into a neighbouring page.

`shared/atoms` owns Button, IconButton, CloseButton, Input, Select, Switch and Badge.
`shared/molecules` owns Field, Notice and Dialog. Dialog owns focus trapping, Escape,
return focus, the backdrop, a square close control, body scrolling and a fixed footer.
Business validation, ownership, revisions and commands belong to the relevant hooks.

Styles live inside the component that owns them. Ordinary values can use React's
`style` prop; hover, focus, media queries and keyframes use the native React 19 style
resource via `Styles`. Static styles are deduplicated by component and content.
Dynamic values use props or CSS custom properties. Selectors are scoped to the owning
component's root or unique names; a feature must not patch another feature's class.
Only reset, typography and design tokens are global. No Tailwind or additional CSS
runtime is introduced.

Server routes, DTOs, error handling, HttpOnly sessions, refresh single-flight,
optimistic concurrency, SSE handling and legacy browser archive keys are preserved.
This refactor changes frontend ownership and reuse, not backend permissions.

References: [Atomic Design](https://atomicdesign.bradfrost.com/chapter-2/),
[FSD public APIs](https://feature-sliced.design/docs/reference/public-api),
[React style resources](https://react.dev/reference/react-dom/components/style).
This project uses the business-first layout agreed with the user, rather than
claiming the standard FSD top-level layer layout.
