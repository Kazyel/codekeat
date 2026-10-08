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

The overview shows four recent executions with a link to the complete history. KPI captions distinguish the recent-run sample from the available usage and quality history; the 14-day chart exposes exact values in a keyboard-operable disclosure.

Connections keep GitHub installation status separate from Codekeat permission. Only active repositories in active, permitted installations count as having review access. Search is submitted by account or repository and stored in `q`; it filters the list without changing the totals. Repository lists use explicit disclosures and return to their collapsed state when the search changes. Recovery guidance names the responsible administrator instead of implying unsupported dashboard mutations.

Opening and closing review details preserves the review list's scroll position. Closing removes the URL selection immediately while retaining the selected content until the sheet's fade-out transition completes.

## Visual direction: Review Track

Review Track takes its graphic language from the Codekeat rabbit mark and a code-review gutter: a textured concrete canvas, solid ink surfaces, sharp container edges, and red/orange tracks. The interface avoids glass, diffuse glow, low-contrast surfaces, tiny tracked labels, and identical rounded cards.

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

- Pixelify Sans (`font-display`) gives page and section titles, model display names, headline KPI values, the overview statement, dialog titles, and state headings a readable pixel silhouette.
- Switzer uses regular weight for reading and medium/semibold for navigation, controls, metric labels, and tables. Detailed token prices remain in Switzer for precision at smaller sizes.
- JetBrains Mono remains limited to SHA values, identifiers, model API names, and technical metadata at 13 px rather than a shrinking relative size.

Reading text uses 16/26 px, supporting text 14/22 px, and captions 13/20 px. Titles use sentence case, modest negative tracking, and at least 1.08 line height. Labels do not use generic all-caps tracking. Numeric metrics use tabular figures. Chart axes retain a compact 12 px size.

Keep 8–12 px between related titles and descriptions, 24 px between form fields, and 32–40 px between page headers and content. Default buttons and inputs are 44 px tall; mobile input text remains 16 px. The login brand panel stays ink-colored in both themes so its white text remains readable.

### Shape and composition

- Main surfaces use 12–16 px radii; controls use 8–12 px. Pills are reserved for badges.
- Card borders and offset shadows use matching solid colors in each mode: ink (`#171719`) in light mode and subdued gray (`#2C2C2C`) in dark mode. Neither uses alpha transparency.
- Red/orange rails echo a diff gutter and the two-piece rabbit mark.
- The overview hero uses a compact two-column composition with a matte, opaque card background. Faint flowing red/orange contours sit behind a large extruded rabbit, fading away beneath the copy. Mobile keeps the copy and actions without the decorative scene.
- Overview metrics preserve their red, orange, and ink brand composition in both color modes. In dark mode, their solid borders and offset shadows use the corresponding darker semantic edge: red `#8F0B18`, orange `#9A3412`, and ink `#2C2C2C`.
- Neutral model cards omit the decorative top rail, and their offset shadows exactly match their border color in both modes. The selected default fills the entire card in brand red, uses a dark-red shadow, and alone receives an orange top rail. Every model keeps a technical API-name chip and one borderless pricing band; rates display USD per million tokens, and nested price cards are prohibited.
- Unselected model cards use a single neutral pricing band, restrained edit/select actions, and solid matching borders and shadows. Currency and token units appear once in the footer; prices and model identifiers wrap instead of truncating.
- Tables prioritize legible 14 px content and 48 px headers while preserving operational density.
- Operational list rows keep a neutral muted hover surface, then add Codekeat character through a short physical lift and a solid orange offset shadow. The status badge remains unchanged; keyboard focus receives the same treatment with a brand-colored border.
- Use spacing and surface contrast instead of internal dividers across page headers, lists, tables, pricing columns, menus, and review details. Preserve outer card/control borders, focus indicators, and brand rails.

## Shader and motion

A single application-level Paper Shaders dithering canvas uses a slowly animated warp field rotated 25° at scale 0.8, with an 8×8 Bayer pattern, a 2 px grid, and up to 1.5 million rendered pixels. Radial masks emphasize the top-right and bottom-left corners; a 16% mask floor gently connects them through the center. Light mode renders black ink over the page background at 24% opacity; dark mode renders orange ink over an explicit near-black background at 26% opacity. Animation starts from frame 8,000 at speed 0.12, stops for `prefers-reduced-motion`, and relies on the shader library to pause while the document is hidden. The original Codekeat SVG remains unchanged; standard brand marks render it directly.

The overview hero is the explicit 3D exception: one local Three.js canvas shares its context between the contour background and geometry extruded from the original SVG paths. It initializes only when visible, renders at most 30 frames per second, and stops animation offscreen, in hidden documents, or with reduced motion. There is no flat loading placeholder: the completed scene fades in over 280 ms, or appears immediately with reduced motion. The original SVG is reserved for rendering failures. Pending loads are aborted and GPU resources are disposed on unmount.

The login reuses the application-level dithering canvas with orange ink on near-black in both themes, a diagonal mask, and 75% opacity. Its open composition places the product statement beside an opaque, theme-aware sign-in surface; mobile stacks them. The original rabbit mark stays unmodified.

Magic UI is limited to:

- Border Beam on a currently running review;
- Number Ticker when overview KPIs appear for the first time.

Interface transitions last 100–200 ms; the sidebar width transition lasts 200 ms. Buttons keep their position and dimensions while color, borders, and hard shadows provide hover and pressed feedback. Dropdowns fade without sliding or scaling. Refresh feedback stays inside a fixed-size icon control. `prefers-reduced-motion` reduces transitions. The dashboard remains complete without WebGL or animation.

Page content groups fade in independently when mounted: headers use 140 ms and other groups use 180 ms, from 55% to full opacity. No sliding, scaling, staggered delays, or native View Transitions are used. Existing groups do not replay their entrance when data updates; the sidebar and portalled controls keep their own interaction behavior. Reduced-motion preferences disable content entrances. Skeletons retain their layout while a 1.8 s internal shimmer supplies activity; reduced motion keeps them static.

## Component vocabulary

Use shadcn/ui primitives with a Codekeat treatment: rounded control geometry, brand-colored focus states, semibold labels, solid offset button depth, and generous hit areas. Keep familiar interaction behavior for forms, tables, tabs, menus, dialogs, sheets, tooltips, alerts, and skeletons. Do not introduce a second component system.
The expanded sidebar brand lockup uses only the original 48 px rabbit mark, aligned to the sidebar content edge. The link carries an accessible name without rendering a title or subtitle.
The sidebar uses the page background in light mode and ink in dark mode. Its surface gradually reveals the existing application dither toward the bottom, without another canvas, blur, or animation. A neutral 1 px edge replaces the orange offset rail. Navigation targets are at least 44 px; neutral hover and keyboard focus strengthen the duotone icons without moving them, and the active destination stays red. The navigation scrolls independently in short windows, keeping the header and profile reachable. The 44 px collapse control has a transparent resting surface, neutral hover feedback, an accessible name and expanded state, but no tooltip in either state. Orange remains the keyboard focus color.
The user trigger has 12 px padding and uses a 40 px editorial medal: a circular warm-white monogram, solid ink border, and short orange offset shadow. Compact contexts use a 32 px medal inside a 44 px target. Profile menus fade in above the expanded sidebar trigger and below the compact header trigger, with collision handling.
Badges preserve their semantic fill colors, except the selected-model badge, which uses a white surface and red label for contrast. In dark mode, border and offset shadow derive from a solid darker tone of each fill: green `#166534`, amber `#92400E`, rose `#9F1239`, orange `#9A3412`, sky `#075985`, slate `#475569`, and primary red `#8F0B18`. Light mode keeps the shared ink edge.
All styled app buttons use the same semantic-edge rule in dark mode. Primary red buttons use `#8F0B18`, destructive buttons use `#9F1239`, neutral outline and ghost states use `#2C2C2C`, orange outline hover uses `#9A3412`, and light secondary buttons use `#787878`; each edge color drives both border and offset shadow. Light mode retains the existing ink and orange treatment.

The user menu uses the same solid orange focus fill and dark text/icons in both themes. Its surface border matches the offset-shadow token; dark-mode focused items use the orange semantic edge rather than a translucent fill or white outline.

Recharts renders charts, and its native tooltips inherit the same surface, border, radius, and offset-shadow tokens as the rest of the interface. Every chart also exposes precise values through a table or textual summary. Product navigation and highlights use the local bold/duotone SVG family in `product-icons.tsx`: 20 px in navigation, 28–32 px in highlights, without decorative icon boxes. Active navigation increases the duotone fill. Lucide remains for familiar utility actions, with a firmer 2.25 stroke inside buttons; provider logos come from individual theSVG imports. Empty states pair a small code/diff illustration with the unmodified rabbit mark. Icons remain static. Sonner reports transient mutation results; persistent failures stay next to the affected content.

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
- Keep one application-level shader. The overview's requested 3D scene adds one local context shared with its own background, capped at 650,000 pixels and a device pixel ratio of 1.5; do not add a separate canvas for that background.
- Keep filters in the router, remote data in TanStack Query, and ephemeral interaction state in React.
- Add virtualization only after measured list volume requires it.
