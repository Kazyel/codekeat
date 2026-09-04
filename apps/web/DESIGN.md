# Codekeat Web Design

## Product job

The dashboard gives engineering teams a balanced view of review operations and outcomes. The overview gives equal weight to recent runs, usage, quality, and failures. The interface must not imply actions or data that `apps/api` does not provide.

## Information architecture

Protected navigation contains five destinations:

1. **Overview**: KPIs, usage and quality trends, recent runs.
2. **Reviews**: the latest 50 runs; each run's findings open in a URL-addressable detail sheet.
3. **Analytics**: usage, cost, quality, and processing metrics by period and repository.
4. **Connections**: GitHub installations and repository access.
5. **Models**: catalog access for every user and mutations for administrators.

Desktop uses a collapsible sidebar that becomes an icon rail with tooltips. The user identity remains visible while expanded and becomes an avatar in the rail. Mobile uses a header and sheet with the same destinations. Filters and selected review details use URL search parameters.

## Visual direction: Review Track

Review Track takes its graphic language from the Codekeat rabbit mark and a code-review gutter: a textured concrete canvas, solid ink surfaces, sharp rules, and red/orange tracks. The interface avoids glass, diffuse glow, low-contrast surfaces, tiny tracked labels, and identical rounded cards.

### Color roles

- Light canvas: warm off-white (`#F2F2EF`); dark canvas: true near-black (`#070707`).
- Working surfaces: white in light mode and graphite (`#151515`) in dark mode.
- Structural borders are black in light mode and translucent white in dark mode; offset shadows follow the same contrast shift.
- Primary brand accent: Codekeat red (`#E60216`).
- Secondary brand accent: Codekeat orange (`#FC6701`).
- Success, warning, and failure use solid semantic colors.

Brand red structures the page and marks primary actions. Orange marks secondary emphasis and keyboard focus. Status color never carries meaning alone.

### Typography

The interface uses Google Fonts and Fontshare:

- Pixelify Sans gives page titles, the overview statement, and state headings a readable pixel silhouette.
- Switzer handles navigation, controls, tables, reading text, numbers, and KPIs with medium or semibold weight.
- JetBrains Mono remains limited to SHA values, identifiers, model API names, and technical metadata.

Titles use sentence case and tight spacing. Labels do not use generic all-caps tracking. Numeric metrics use tabular figures.

### Shape and composition

- Main surfaces use 12–16 px radii; controls use 8–12 px. Pills are reserved for badges.
- Card borders and offset shadows use matching solid colors in each mode: ink (`#171719`) in light mode and subdued gray (`#2C2C2C`) in dark mode. Neither uses alpha transparency.
- Red/orange rails echo a diff gutter and the two-piece rabbit mark.
- The overview hero uses a faint operational signal grid that fades away beneath the copy, plus a restrained red/orange radial glow behind the rabbit mark. The treatment adds depth without introducing fake data or reducing text contrast.
- Overview metrics preserve their red, orange, and ink brand composition in both color modes. In dark mode, their solid borders and offset shadows use the corresponding darker semantic edge: red `#8F0B18`, orange `#9A3412`, and ink `#2C2C2C`.
- Neutral model cards omit the decorative top rail, and their offset shadows exactly match their border color in both modes. The selected default fills the entire card in brand red, uses a dark-red shadow, and alone receives an orange top rail. Every model keeps a technical API-name chip and one borderless pricing band; rates display USD per million tokens, and nested price cards are prohibited.
- Tables prioritize legible 14 px content and 48 px headers while preserving operational density.
- Operational list rows keep a neutral muted hover surface, then add Codekeat character through a short physical lift and a solid orange offset shadow. The status badge remains unchanged; keyboard focus receives the same treatment with a brand-colored border.

## Shader and motion

A single static Paper Shaders dithering accent is confined to the top-right edge by a radial mask. It uses an 8×8 Bayer pattern, a 2 px grid, and up to 1.5 million rendered pixels. Light mode renders black ink over the page background at 18% opacity; dark mode renders orange ink over an explicit near-black background at 20% opacity. The Codekeat rabbit always uses the original SVG without masks, shaders, opacity treatments, or decorative distortion.

Magic UI is limited to:

- Border Beam on a currently running review;
- Number Ticker when overview KPIs appear for the first time.

Interface transitions last 140–220 ms; the sidebar width transition lasts 300 ms. Motion changes only opacity, transform, shadow, or width, and `prefers-reduced-motion` reduces it. The dashboard remains complete without WebGL or animation.

## Component vocabulary

Use shadcn/ui primitives with a Codekeat treatment: rounded control geometry, brand-colored focus states, semibold labels, solid offset button depth, and generous hit areas. Keep familiar interaction behavior for forms, tables, tabs, menus, dialogs, sheets, tooltips, alerts, and skeletons. Do not introduce a second component system.
The expanded sidebar brand lockup uses only the original 48 px rabbit mark, aligned to the sidebar content edge. The link carries an accessible name without rendering a title or subtitle.
The user trigger aligns to the same left content edge and uses a 40 px editorial medal: a circular warm-white monogram, solid ink border, and short orange offset shadow. Compact contexts retain the same treatment at 36 px.
Badges preserve their semantic fill colors, except the selected-model badge, which uses a white surface and red label for contrast. In dark mode, border and offset shadow derive from a solid darker tone of each fill: green `#166534`, amber `#92400E`, rose `#9F1239`, orange `#9A3412`, sky `#075985`, slate `#475569`, and primary red `#8F0B18`. Light mode keeps the shared ink edge.
All styled app buttons use the same semantic-edge rule in dark mode. Primary red buttons use `#8F0B18`, destructive buttons use `#9F1239`, neutral outline and ghost states use `#2C2C2C`, orange outline hover uses `#9A3412`, and light secondary buttons use `#787878`; each edge color drives both border and offset shadow. Light mode retains the existing ink and orange treatment.

Recharts renders charts, and its native tooltips inherit the same surface, border, radius, and offset-shadow tokens as the rest of the interface. Every chart also exposes precise values through a table or textual summary. Lucide supplies interface icons; provider logos come from individual theSVG imports. Sonner reports transient mutation results; persistent failures stay next to the affected content.

## States

Every route covers the states it can reach:

- loading skeleton with final layout geometry;
- populated content;
- product-specific empty state;
- partial and page-level errors;
- expired session;
- insufficient permission;
- selected, expanded, disabled, submitting, success, and failure states where relevant.

Route-level failures use a consistent recovery boundary and retry action. Mutation failures remain next to the affected content. Review statuses are `queued`, `running`, `completed`, `failed`, and `ignored`; the UI never invents progress percentages.

## Accessibility

- Use semantic landmarks and one descriptive `h1` per page.
- Give each control an accessible name and visible focus.
- Keep dialogs and sheets focus-trapped and keyboard-operable.
- Hide decorative icons from the accessibility tree.
- Maintain readable contrast on working surfaces, controls, and the original brand mark.
- Provide non-color status cues and textual chart equivalents.
- Keep overlays outside clipping and overflow containers.

## Responsive behavior

Responsive changes alter structure instead of shrinking desktop layouts. Summary groups stack, navigation moves into a sheet, review details occupy the full mobile viewport, and tables preserve repository, pull request, and status before secondary columns. Row actions remain reachable from a menu.

## Security boundary

TanStack Start acts as a BFF. The browser calls same-origin server functions and stores the opaque dashboard session only in an `HttpOnly` cookie. `DASHBOARD_API_TOKEN`, the API URL, and session validation remain server-side. Every external response is validated with Zod before rendering.

## Performance limits

- Start independent requests in parallel.
- Stop review polling when no run is `queued` or `running`.
- Import Recharts and model dialogs only on routes that use them.
- Render one static application-level shader instance.
- Keep filters in the router, remote data in TanStack Query, and ephemeral interaction state in React.
- Add virtualization only after measured list volume requires it.
